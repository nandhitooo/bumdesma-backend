const { Op } = require("sequelize");
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const { Attendance, User } = require("../models");
const { failure, success } = require("../utils/response");
const { logActivity } = require("../utils/activityLogger");
const { ATTENDANCE_STATUS, CHECKOUT_STATUS } = require("../utils/constants");

const STATUS_LABEL = {
  [ATTENDANCE_STATUS.TEPAT_WAKTU]: "Tepat Waktu",
  [ATTENDANCE_STATUS.TERLAMBAT]: "Terlambat",
  [ATTENDANCE_STATUS.ALPA]: "Alpa",
  [ATTENDANCE_STATUS.IZIN_CUTI]: "Izin/Cuti",
};

// Warna isi sel status (ARGB), diselaraskan dengan warna badge status di
// Website (hijau = tepat waktu, oranye = terlambat, merah = alpa, biru =
// izin/cuti) supaya laporan cetak/Excel konsisten secara visual dengan UI.
const STATUS_FILL = {
  [ATTENDANCE_STATUS.TEPAT_WAKTU]: "FFDCFCE7", // hijau muda
  [ATTENDANCE_STATUS.TERLAMBAT]: "FFFFEDD5", // oranye muda
  [ATTENDANCE_STATUS.ALPA]: "FFFEE2E2", // merah muda
  [ATTENDANCE_STATUS.IZIN_CUTI]: "FFDBEAFE", // biru muda
};
const STATUS_FONT_COLOR = {
  [ATTENDANCE_STATUS.TEPAT_WAKTU]: "FF15803D",
  [ATTENDANCE_STATUS.TERLAMBAT]: "FFC2410C",
  [ATTENDANCE_STATUS.ALPA]: "FFDC2626",
  [ATTENDANCE_STATUS.IZIN_CUTI]: "FF1D4ED8",
};

const BRAND_GREEN = "FF1A7A1A";

function formatTime(date) {
  if (!date) return "-";
  return new Date(date).toTimeString().slice(0, 8);
}

function formatDateLong(dateStr) {
  if (!dateStr) return "-";
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

async function fetchRecap({ start, end, user_id }) {
  const where = {};
  if (start && end) where.tanggal = { [Op.between]: [start, end] };
  if (user_id) where.user_id = user_id;

  return Attendance.findAll({
    where,
    include: [
      {
        model: User,
        as: "user",
        attributes: ["nip", "name", "jabatan"],
      },
    ],
    order: [
      ["tanggal", "ASC"],
      [{ model: User, as: "user" }, "name", "ASC"],
    ],
  });
}

// GET /api/reports/summary?start=&end=
// Rekapitulasi ringkas (dipakai halaman Laporan sebelum export)
const summary = async (req, res) => {
  const { start, end, user_id } = req.query;
  if (!start || !end) {
    return failure(res, {
      statusCode: 422,
      message: "Parameter start dan end (YYYY-MM-DD) wajib diisi.",
    });
  }

  const rows = await fetchRecap({ start, end, user_id });

  const recap = {
    totalRecords: rows.length,
    tepatWaktu: rows.filter((r) => r.status === ATTENDANCE_STATUS.TEPAT_WAKTU)
      .length,
    terlambat: rows.filter((r) => r.status === ATTENDANCE_STATUS.TERLAMBAT)
      .length,
    alpa: rows.filter((r) => r.status === ATTENDANCE_STATUS.ALPA).length,
    izinCuti: rows.filter((r) => r.status === ATTENDANCE_STATUS.IZIN_CUTI)
      .length,
    lembur: rows.filter((r) => r.checkout_status === CHECKOUT_STATUS.LEMBUR)
      .length,
    totalOvertimeMinutes: rows.reduce(
      (sum, r) => sum + (r.overtime_minutes || 0),
      0,
    ),
  };

  return success(res, { data: { periode: { start, end }, recap, rows } });
};

// GET /api/reports/attendance/export?start=&end=&format=pdf|xlsx
const exportAttendance = async (req, res) => {
  const { start, end, user_id, format = "pdf" } = req.query;

  if (!start || !end) {
    return failure(res, {
      statusCode: 422,
      message: "Parameter start dan end (YYYY-MM-DD) wajib diisi.",
    });
  }

  const rows = await fetchRecap({ start, end, user_id });

  await logActivity(
    req,
    "EXPORT_LAPORAN",
    `${req.user.name} mengekspor laporan absensi (${start} s/d ${end}) format ${format}`,
  );

  if (format === "xlsx") {
    return exportExcel(res, rows, start, end);
  }
  return exportPdf(res, rows, start, end);
};

// === Kolom rekap yang dipakai di worksheet Excel ===
// key harus sinkron dengan field yang diisi di baris data & baris ringkasan.
const EXCEL_COLUMNS = [
  { header: "Tanggal", key: "tanggal", width: 14 },
  { header: "NIP", key: "nip", width: 16 },
  { header: "Nama", key: "nama", width: 26 },
  { header: "Jabatan", key: "jabatan", width: 18 },
  { header: "Jam Masuk", key: "jamMasuk", width: 12 },
  { header: "Jam Pulang", key: "jamPulang", width: 12 },
  { header: "Status", key: "status", width: 14 },
  { header: "Keterangan Pulang", key: "checkout", width: 18 },
  { header: "Lembur (menit)", key: "lembur", width: 15 },
];
const LAST_COL_LETTER = String.fromCharCode(64 + EXCEL_COLUMNS.length); // 9 kolom -> 'I'

const CHECKOUT_LABEL = {
  [CHECKOUT_STATUS.NORMAL]: "Normal",
  [CHECKOUT_STATUS.LEMBUR]: "Lembur",
  [CHECKOUT_STATUS.BELUM_PULANG]: "Belum Pulang",
};

async function exportExcel(res, rows, start, end) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sistem Absensi BUMDESMA Podo Rukun LKD";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Rekap Absensi", {
    views: [{ state: "frozen", ySplit: 5, xSplit: 0 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });

  // === Blok judul laporan (baris 1-4), digabung selebar tabel agar terasa
  // seperti kop laporan resmi, bukan sekadar dump data mentah ===
  sheet.mergeCells(`A1:${LAST_COL_LETTER}1`);
  sheet.getCell("A1").value = "Laporan Rekapitulasi Absensi Karyawan";
  sheet.getCell("A1").font = {
    bold: true,
    size: 15,
    color: { argb: "FF1A7A1A" },
  };
  sheet.getCell("A1").alignment = { horizontal: "center" };

  sheet.mergeCells(`A2:${LAST_COL_LETTER}2`);
  sheet.getCell("A2").value = "BUMDESMA Podo Rukun LKD";
  sheet.getCell("A2").font = { size: 11, color: { argb: "FF555555" } };
  sheet.getCell("A2").alignment = { horizontal: "center" };

  sheet.mergeCells(`A3:${LAST_COL_LETTER}3`);
  sheet.getCell("A3").value =
    `Periode: ${formatDateLong(start)}  —  ${formatDateLong(end)}`;
  sheet.getCell("A3").font = {
    size: 10,
    italic: true,
    color: { argb: "FF777777" },
  };
  sheet.getCell("A3").alignment = { horizontal: "center" };

  sheet.mergeCells(`A4:${LAST_COL_LETTER}4`);
  sheet.getCell("A4").value =
    `Dicetak: ${new Date().toLocaleString("id-ID")}  |  Total data: ${rows.length}`;
  sheet.getCell("A4").font = { size: 9, color: { argb: "FFAAAAAA" } };
  sheet.getCell("A4").alignment = { horizontal: "center" };

  sheet.getRow(1).height = 26;

  // === Header tabel (baris 5) ===
  const headerRowIndex = 5;
  sheet.columns = EXCEL_COLUMNS.map((c) => ({ key: c.key, width: c.width }));
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.values = EXCEL_COLUMNS.map((c) => c.header);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: BRAND_GREEN },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFFFFFFF" } },
      bottom: { style: "thin", color: { argb: "FFFFFFFF" } },
      left: { style: "thin", color: { argb: "FFFFFFFF" } },
      right: { style: "thin", color: { argb: "FFFFFFFF" } },
    };
  });
  headerRow.height = 22;

  // === Baris data, dengan warna belang & status berkode warna ===
  const thinBorder = { style: "thin", color: { argb: "FFE5E7EB" } };
  rows.forEach((r, i) => {
    const row = sheet.addRow({
      tanggal: r.tanggal,
      nip: r.user?.nip || "-",
      nama: r.user?.name || "-",
      jabatan: r.user?.jabatan || "-",
      jamMasuk: formatTime(r.jam_masuk),
      jamPulang: formatTime(r.jam_pulang),
      status: STATUS_LABEL[r.status] || r.status,
      checkout: CHECKOUT_LABEL[r.checkout_status] || "-",
      lembur: r.overtime_minutes || 0,
    });

    const isEven = i % 2 === 1;
    row.eachCell((cell, colNumber) => {
      cell.border = {
        top: thinBorder,
        bottom: thinBorder,
        left: thinBorder,
        right: thinBorder,
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber === 3 ? "left" : "center",
      };
      if (isEven) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF9FAFB" },
        };
      }
    });

    // Kolom Nama tetap rata kiri & tebal supaya gampang dipindai mata
    row.getCell("nama").font = { bold: true };
    row.getCell("nama").alignment = { vertical: "middle", horizontal: "left" };

    // Kolom Status diberi warna latar sesuai status kehadiran
    const statusCell = row.getCell("status");
    statusCell.font = {
      bold: true,
      color: { argb: STATUS_FONT_COLOR[r.status] || "FF374151" },
    };
    statusCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: STATUS_FILL[r.status] || "FFF3F4F6" },
    };

    if (r.overtime_minutes) {
      row.getCell("lembur").font = { bold: true, color: { argb: "FF1D4ED8" } };
    }
  });

  // === Baris ringkasan total di bagian bawah ===
  const summaryStartRow = sheet.rowCount + 2;
  const tepatWaktu = rows.filter(
    (r) => r.status === ATTENDANCE_STATUS.TEPAT_WAKTU,
  ).length;
  const terlambat = rows.filter(
    (r) => r.status === ATTENDANCE_STATUS.TERLAMBAT,
  ).length;
  const alpa = rows.filter((r) => r.status === ATTENDANCE_STATUS.ALPA).length;
  const izinCuti = rows.filter(
    (r) => r.status === ATTENDANCE_STATUS.IZIN_CUTI,
  ).length;
  const totalLembur = rows.reduce(
    (sum, r) => sum + (r.overtime_minutes || 0),
    0,
  );

  sheet.getCell(`A${summaryStartRow}`).value = "Ringkasan Periode";
  sheet.getCell(`A${summaryStartRow}`).font = {
    bold: true,
    size: 12,
    color: { argb: BRAND_GREEN },
  };

  const summaryData = [
    ["Total Data Absensi", rows.length],
    ["Tepat Waktu", tepatWaktu],
    ["Terlambat", terlambat],
    ["Alpa", alpa],
    ["Izin/Cuti", izinCuti],
    ["Total Lembur (menit)", totalLembur],
  ];

  summaryData.forEach(([label, value], idx) => {
    const rowIdx = summaryStartRow + 1 + idx;
    const labelCell = sheet.getCell(`A${rowIdx}`);
    const valueCell = sheet.getCell(`B${rowIdx}`);
    labelCell.value = label;
    labelCell.font = { bold: true, color: { argb: "FF374151" } };
    valueCell.value = value;
    valueCell.font = { bold: true };
    valueCell.alignment = { horizontal: "left" };
  });

  // === Filter otomatis di header tabel supaya mudah disortir/difilter ===
  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: EXCEL_COLUMNS.length },
  };

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="laporan-absensi-${start}_${end}.xlsx"`,
  );

  await workbook.xlsx.write(res);
  res.end();
}

function exportPdf(res, rows, start, end) {
  const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="laporan-absensi-${start}_${end}.pdf"`,
  );
  doc.pipe(res);

  doc
    .fontSize(14)
    .text("Laporan Rekapitulasi Absensi Karyawan", { align: "center" });
  doc.fontSize(11).text("BUMDESMA Podo Rukun LKD", { align: "center" });
  doc.moveDown(0.3);
  doc.fontSize(10).text(`Periode: ${start} s/d ${end}`, { align: "center" });
  doc.moveDown(1);

  const headers = [
    "Tanggal",
    "NIP",
    "Nama",
    "Jabatan",
    "Masuk",
    "Pulang",
    "Status",
    "Keterangan",
    "Lembur",
  ];
  const colWidths = [65, 55, 110, 90, 55, 55, 70, 80, 55];
  let y = doc.y;
  const startX = doc.page.margins.left;

  function drawRow(values, isHeader = false) {
    let x = startX;
    doc.fontSize(8).font(isHeader ? "Helvetica-Bold" : "Helvetica");
    values.forEach((val, i) => {
      doc.text(String(val ?? "-"), x, y, {
        width: colWidths[i],
        ellipsis: true,
      });
      x += colWidths[i];
    });
    y += 16;
    if (y > doc.page.height - doc.page.margins.bottom) {
      doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
      y = doc.page.margins.top;
    }
  }

  drawRow(headers, true);
  doc
    .moveTo(startX, y - 4)
    .lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y - 4)
    .stroke();

  rows.forEach((r) => {
    drawRow([
      r.tanggal,
      r.user?.nip,
      r.user?.name,
      r.user?.jabatan,
      formatTime(r.jam_masuk),
      formatTime(r.jam_pulang),
      STATUS_LABEL[r.status] || r.status,
      r.checkout_status || "-",
      r.overtime_minutes ? `${r.overtime_minutes}m` : "-",
    ]);
  });

  doc.end();
}

module.exports = { summary, exportAttendance };
