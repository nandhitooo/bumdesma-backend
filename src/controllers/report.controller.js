const { Op } = require("sequelize");
const PDFDocument = require("pdfkit");
const { Attendance, User } = require("../models");
const { failure, success } = require("../utils/response");
const { logActivity } = require("../utils/activityLogger");
const { ATTENDANCE_STATUS, CHECKOUT_STATUS } = require("../utils/constants");
const {
  buildAttendanceGridWorkbook,
} = require("../utils/attendanceGridReport");

const STATUS_LABEL = {
  [ATTENDANCE_STATUS.TEPAT_WAKTU]: "Tepat Waktu",
  [ATTENDANCE_STATUS.TERLAMBAT]: "Terlambat",
  [ATTENDANCE_STATUS.ALPA]: "Alpa",
  [ATTENDANCE_STATUS.IZIN_CUTI]: "Izin/Cuti",
};

function formatTime(date) {
  if (!date) return "-";
  return new Date(date).toTimeString().slice(0, 8);
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

// GET /api/reports/attendance/export?start=&end=&format=pdf|xlsx&type=harian|mingguan|bulanan|tahunan
// `type` (periodType) hanya berpengaruh pada format xlsx: kalau 'tahunan',
// laporan akan berisi gabungan 12 blok bulan (Januari - Desember) dalam
// sheet yang sama, bukan cuma rentang start-end yang dikirim.
const exportAttendance = async (req, res) => {
  const { start, end, user_id, format = "pdf", type } = req.query;

  if (!start || !end) {
    return failure(res, {
      statusCode: 422,
      message: "Parameter start dan end (YYYY-MM-DD) wajib diisi.",
    });
  }

  await logActivity(
    req,
    "EXPORT_LAPORAN",
    `${req.user.name} mengekspor laporan absensi (${start} s/d ${end}) format ${format}`,
  );

  if (format === "xlsx") {
    return exportExcel(res, { start, end, userId: user_id, periodType: type });
  }

  const rows = await fetchRecap({ start, end, user_id });
  return exportPdf(res, rows, start, end);
};

// Sheet 1 "Daftar Hadir" (kode H/P/I/S/C/-/Minggu/Libur), Sheet 2 "Jam
// Masuk", Sheet 3 "Jam Pulang" - meniru format kalender bulanan Book1.xlsx.
// Untuk laporan tahunan, setiap sheet berisi gabungan 12 blok bulan.
async function exportExcel(res, { start, end, userId, periodType }) {
  const workbook = await buildAttendanceGridWorkbook({
    start,
    end,
    userId,
    periodType,
  });

  const isTahunan = periodType === "tahunan";
  const filenameSuffix = isTahunan ? start.slice(0, 4) : `${start}_${end}`;

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="laporan-absensi-${filenameSuffix}.xlsx"`,
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
