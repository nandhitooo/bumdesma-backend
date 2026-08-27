const ExcelJS = require("exceljs");
const { Op } = require("sequelize");
const { User, Attendance, Leave, PiketSchedule } = require("../models");
const { getSettingsMap } = require("./settingsHelper");

// === Konstanta tampilan, diselaraskan dengan warna badge status di
// Website & Laporan Excel yang sudah ada sebelumnya (report.controller.js) ===
const BRAND_GREEN = "FF1A7A1A";
const COLOR = {
  hadir: { fill: "FFDCFCE7", font: "FF15803D" }, // hijau - tepat waktu
  terlambat: { fill: "FFFFEDD5", font: "FFC2410C" }, // oranye
  alpa: { fill: "FFFEE2E2", font: "FFDC2626" }, // merah
  izin: { fill: "FFDBEAFE", font: "FF1D4ED8" }, // biru
  sakit: { fill: "FFFCE7F3", font: "FFBE185D" }, // pink
  cuti: { fill: "FFEDE9FE", font: "FF6D28D9" }, // ungu
  piket: { fill: "FFE0E7FF", font: "FF4338CA" }, // indigo
  liburMinggu: { fill: "FFFF4040", font: "FFFFFFFF" }, // merah terang (Minggu/Libur)
};

const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function daysInMonth(year, month) {
  // month: 1-12
  return new Date(year, month, 0).getDate();
}

function isoDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function addDaysISO(dateStr, amount) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + amount);
  return isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function formatDateLong(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(dateValue) {
  if (!dateValue) return "";
  return new Date(dateValue).toTimeString().slice(0, 5);
}

// Menormalisasi entri system_settings.national_holidays. Mendukung dua
// format: string tanggal tunggal (format lama) dan objek rentang tanggal
// { tanggal_mulai, tanggal_selesai, keterangan } (format baru), sama seperti
// isNationalHoliday() pada attendance.controller.js.
function normalizeHolidays(raw) {
  let list;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw || [];
  } catch {
    list = [];
  }
  return list
    .map((h) => {
      if (typeof h === "string") return { start: h, end: h, keterangan: "" };
      const start = h.tanggal_mulai ?? h.start;
      const end = h.tanggal_selesai ?? h.end ?? start;
      return { start, end, keterangan: h.keterangan || "" };
    })
    .filter((h) => h.start);
}

function findHoliday(dateStr, holidays) {
  return holidays.find((h) => dateStr >= h.start && dateStr <= h.end) || null;
}

// === Pengambilan data dari database untuk seluruh rentang laporan sekaligus,
// supaya tidak perlu query berulang per bulan pada laporan tahunan ===
async function loadReportData({ overallStart, overallEnd, userId }) {
  const employees = await User.findAll({
    where: userId ? { id: userId } : { status: "active" },
    order: [["name", "ASC"]],
  });
  const userIds = employees.map((e) => e.id);

  const attendanceMap = new Map(); // key: `${userId}|${tanggal}` -> row
  const leaveJenisMap = new Map(); // key: `${userId}|${tanggal}` -> 'izin'|'sakit'|'cuti'
  const piketSet = new Set(); // key: `${userId}|${tanggal}`

  if (userIds.length > 0) {
    const attendances = await Attendance.findAll({
      where: {
        user_id: { [Op.in]: userIds },
        tanggal: { [Op.between]: [overallStart, overallEnd] },
      },
    });
    for (const a of attendances) {
      attendanceMap.set(`${a.user_id}|${a.tanggal}`, a);
    }

    const leaves = await Leave.findAll({
      where: {
        user_id: { [Op.in]: userIds },
        status: "approved",
        tanggal_mulai: { [Op.lte]: overallEnd },
        tanggal_selesai: { [Op.gte]: overallStart },
      },
    });
    for (const l of leaves) {
      const from =
        l.tanggal_mulai > overallStart ? l.tanggal_mulai : overallStart;
      const to =
        l.tanggal_selesai < overallEnd ? l.tanggal_selesai : overallEnd;
      let cursor = from;
      // Batas pengaman supaya tidak looping tak terkendali jika data tidak wajar
      let guard = 0;
      while (cursor <= to && guard < 1000) {
        leaveJenisMap.set(`${l.user_id}|${cursor}`, l.jenis);
        cursor = addDaysISO(cursor, 1);
        guard += 1;
      }
    }

    const piketRows = await PiketSchedule.findAll({
      where: {
        user_id: { [Op.in]: userIds },
        tanggal: { [Op.between]: [overallStart, overallEnd] },
      },
    });
    for (const p of piketRows) {
      piketSet.add(`${p.user_id}|${p.tanggal}`);
    }
  }

  const settings = await getSettingsMap();
  const holidays = normalizeHolidays(settings.national_holidays);

  return { employees, attendanceMap, leaveJenisMap, piketSet, holidays };
}

// Menentukan isi & warna satu sel untuk sheet "Daftar Hadir" (kode status)
function statusCell({ attRow, leaveJenis, dayOfWeek, isPiketDay }) {
  if (attRow) {
    if (attRow.status === "izin_cuti") {
      if (leaveJenis === "sakit") return { text: "S", ...COLOR.sakit };
      if (leaveJenis === "cuti") return { text: "C", ...COLOR.cuti };
      return { text: "I", ...COLOR.izin };
    }
    if (attRow.status === "terlambat") return { text: "H", ...COLOR.terlambat };
    if (attRow.status === "tepat_waktu") return { text: "H", ...COLOR.hadir };
    if (attRow.status === "alpa") return { text: "-", ...COLOR.alpa };
    return { text: "H", ...COLOR.hadir };
  }

  if (dayOfWeek === 6) {
    // Sabtu: hanya karyawan piket yang punya kewajiban hadir
    if (isPiketDay) return { text: "P", ...COLOR.piket };
    return { text: "", fill: null, font: null };
  }

  // Senin-Jumat tanpa catatan absensi -> Alpa
  return { text: "-", ...COLOR.alpa };
}

// Menentukan isi sel untuk sheet "Jam Masuk" / "Jam Pulang"
function timeCell({ attRow, field }) {
  if (!attRow) return { text: "" };
  const value = attRow[field];
  if (!value) return { text: "" };
  if (field === "jam_masuk") {
    if (attRow.status === "terlambat")
      return { text: formatTime(value), ...COLOR.terlambat };
    return { text: formatTime(value), ...COLOR.hadir };
  }
  // jam_pulang
  if (attRow.checkout_status === "lembur")
    return { text: formatTime(value), ...COLOR.izin };
  return { text: formatTime(value), ...COLOR.hadir };
}

function applyThinBorder(cell) {
  cell.border = {
    top: { style: "thin", color: { argb: "FFD1D5DB" } },
    bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
    left: { style: "thin", color: { argb: "FFD1D5DB" } },
    right: { style: "thin", color: { argb: "FFD1D5DB" } },
  };
}

/**
 * Menulis satu blok grid absensi (judul + header tanggal + baris karyawan)
 * ke worksheet, dimulai dari `startRow`. Dipakai berulang untuk laporan
 * tahunan (satu blok per bulan, digabung dalam satu sheet).
 *
 * @param {'status'|'masuk'|'pulang'} cellMode
 * @returns {number} baris berikutnya yang masih kosong setelah blok ini
 */
function writeBlock(
  sheet,
  startRow,
  {
    title,
    dateList,
    employees,
    attendanceMap,
    leaveJenisMap,
    piketSet,
    holidays,
    cellMode,
  },
) {
  const dayCount = dateList.length;
  const firstDayCol = 3; // kolom C
  const lastDayCol = firstDayCol + dayCount - 1;
  const withTotals = cellMode === "status";
  const totalsStartCol = lastDayCol + 2; // beri 1 kolom jarak
  const TOTAL_COLS = [
    { key: "hadir", label: "Hadir" },
    { key: "terlambat", label: "Terlambat" },
    { key: "izin", label: "Izin" },
    { key: "sakit", label: "Sakit" },
    { key: "cuti", label: "Cuti" },
    { key: "piket", label: "Piket" },
    { key: "alpa", label: "Alpa" },
  ];
  const lastCol = withTotals
    ? totalsStartCol + TOTAL_COLS.length - 1
    : lastDayCol;

  // === Judul blok ===
  const titleRow = startRow;
  sheet.mergeCells(titleRow, 1, titleRow + 1, lastCol);
  const titleCell = sheet.getCell(titleRow, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, color: { argb: BRAND_GREEN } };
  titleCell.alignment = { horizontal: "center", vertical: "center" };

  // === Header (No. / Nama / Tanggal / kolom tanggal / Total) ===
  const headerRow1 = titleRow + 2;
  const headerRow2 = headerRow1 + 1;

  sheet.mergeCells(headerRow1, 1, headerRow2, 1);
  sheet.mergeCells(headerRow1, 2, headerRow2, 2);
  sheet.getCell(headerRow1, 1).value = "No.";
  sheet.getCell(headerRow1, 2).value = "Nama";

  sheet.mergeCells(headerRow1, firstDayCol, headerRow1, lastDayCol);
  sheet.getCell(headerRow1, firstDayCol).value = "Tanggal";

  dateList.forEach((dateStr, idx) => {
    const cell = sheet.getCell(headerRow2, firstDayCol + idx);
    cell.value = Number(dateStr.slice(8, 10));
  });

  if (withTotals) {
    sheet.mergeCells(headerRow1, totalsStartCol, headerRow1, lastCol);
    sheet.getCell(headerRow1, totalsStartCol).value = "Total";
    TOTAL_COLS.forEach((t, idx) => {
      sheet.getCell(headerRow2, totalsStartCol + idx).value = t.label;
    });
  } else if (dayCount > 0) {
    // Sheet jam masuk/pulang tidak punya kolom Total, tapi tetap perlu
    // baris header ke-2 kosong yang konsisten tingginya.
  }

  for (let r = headerRow1; r <= headerRow2; r += 1) {
    for (let c = 1; c <= lastCol; c += 1) {
      const cell = sheet.getCell(r, c);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: BRAND_GREEN },
      };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      applyThinBorder(cell);
    }
  }

  // === Baris data karyawan ===
  const firstDataRow = headerRow2 + 1;

  employees.forEach((emp, empIdx) => {
    const rowIndex = firstDataRow + empIdx;
    const noCell = sheet.getCell(rowIndex, 1);
    noCell.value = empIdx + 1;
    noCell.alignment = { horizontal: "center", vertical: "middle" };
    applyThinBorder(noCell);

    const nameCell = sheet.getCell(rowIndex, 2);
    nameCell.value = emp.name;
    nameCell.font = { bold: true };
    nameCell.alignment = { vertical: "middle" };
    applyThinBorder(nameCell);

    const totals = {
      hadir: 0,
      terlambat: 0,
      izin: 0,
      sakit: 0,
      cuti: 0,
      piket: 0,
      alpa: 0,
    };

    dateList.forEach((dateStr, idx) => {
      const col = firstDayCol + idx;
      const cell = sheet.getCell(rowIndex, col);
      applyThinBorder(cell);
      cell.alignment = { horizontal: "center", vertical: "middle" };

      const dayOfWeek = new Date(`${dateStr}T00:00:00`).getDay();
      const holiday = dayOfWeek === 0 ? null : findHoliday(dateStr, holidays);
      // Sel Minggu/Libur ditangani terpisah di bawah (merge lintas baris),
      // di sini cukup dilewati agar tidak tertimpa.
      if (dayOfWeek === 0 || holiday) return;

      const attRow = attendanceMap.get(`${emp.id}|${dateStr}`);
      const leaveJenis = leaveJenisMap.get(`${emp.id}|${dateStr}`);
      const isPiketDay = piketSet.has(`${emp.id}|${dateStr}`);

      if (cellMode === "status") {
        const result = statusCell({
          attRow,
          leaveJenis,
          dayOfWeek,
          isPiketDay,
        });
        cell.value = result.text || null;
        if (result.fill) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: result.fill },
          };
          cell.font = { bold: true, color: { argb: result.font } };
        }
        if (result.text === "H" && result.font === COLOR.hadir.font)
          totals.hadir += 1;
        if (result.text === "H" && result.font === COLOR.terlambat.font)
          totals.terlambat += 1;
        if (result.text === "I") totals.izin += 1;
        if (result.text === "S") totals.sakit += 1;
        if (result.text === "C") totals.cuti += 1;
        if (result.text === "P") totals.piket += 1;
        if (result.text === "-") totals.alpa += 1;
      } else {
        const field = cellMode === "masuk" ? "jam_masuk" : "jam_pulang";
        const result = timeCell({ attRow, field });
        cell.value = result.text || null;
        if (result.fill) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: result.fill },
          };
          cell.font = { color: { argb: result.font } };
        }
      }
    });

    if (withTotals) {
      const values = [
        totals.hadir,
        totals.terlambat,
        totals.izin,
        totals.sakit,
        totals.cuti,
        totals.piket,
        totals.alpa,
      ];
      values.forEach((v, idx) => {
        const cell = sheet.getCell(rowIndex, totalsStartCol + idx);
        cell.value = v;
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.font = { bold: true };
        applyThinBorder(cell);
      });
    }
  });

  const lastDataRow = firstDataRow + employees.length - 1;

  // === Kolom Minggu/Libur - merge vertikal lintas seluruh baris karyawan ===
  if (employees.length > 0) {
    dateList.forEach((dateStr, idx) => {
      const col = firstDayCol + idx;
      const dayOfWeek = new Date(`${dateStr}T00:00:00`).getDay();
      const holiday = dayOfWeek === 0 ? null : findHoliday(dateStr, holidays);
      if (!(dayOfWeek === 0 || holiday)) return;

      sheet.mergeCells(firstDataRow, col, lastDataRow, col);
      const cell = sheet.getCell(firstDataRow, col);
      cell.value =
        dayOfWeek === 0
          ? "Minggu"
          : `Libur${holiday.keterangan ? " - " + holiday.keterangan : ""}`;
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.liburMinggu.fill },
      };
      cell.font = { bold: true, color: { argb: COLOR.liburMinggu.font } };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        textRotation: 180,
        wrapText: true,
      };
      applyThinBorder(cell);
    });
  }

  // Baris kosong pemisah sebelum blok berikutnya (untuk laporan tahunan)
  return lastDataRow + 3;
}

function setupSheet(sheet, dayCount, withTotals) {
  sheet.getColumn(1).width = 5;
  sheet.getColumn(2).width = 22;
  for (let i = 0; i < dayCount; i += 1) {
    sheet.getColumn(3 + i).width = 4.5;
  }
  if (withTotals) {
    for (let i = 0; i < 7; i += 1) {
      sheet.getColumn(3 + dayCount + 1 + i).width = 9;
    }
  }
  sheet.views = [{ state: "frozen", xSplit: 2 }];
}

function buildRangeDateList(start, end) {
  const dates = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 2000) {
    dates.push(cursor);
    cursor = addDaysISO(cursor, 1);
    guard += 1;
  }
  return dates;
}

/**
 * Membangun workbook laporan absensi dengan 3 sheet: Daftar Hadir (kode
 * status H/P/I/S/C/-/Minggu/Libur), Jam Masuk, dan Jam Pulang - meniru
 * format kalender bulanan pada Book1.xlsx.
 *
 * Untuk periodType 'tahunan', setiap sheet berisi 12 blok bulan (Januari -
 * Desember) yang digabung berurutan ke bawah dalam satu sheet yang sama.
 * Untuk periodType lain, setiap sheet berisi satu blok sesuai rentang
 * tanggal yang diminta (satu bulan penuh untuk 'bulanan', atau persis
 * rentang tanggal yang dipilih untuk 'harian'/'mingguan'/rentang bebas).
 */
async function buildAttendanceGridWorkbook({ start, end, userId, periodType }) {
  const isTahunan = periodType === "tahunan";
  const year = Number(start.slice(0, 4));

  const overallStart = isTahunan ? `${year}-01-01` : start;
  const overallEnd = isTahunan ? `${year}-12-31` : end;

  const { employees, attendanceMap, leaveJenisMap, piketSet, holidays } =
    await loadReportData({
      overallStart,
      overallEnd,
      userId,
    });

  // Menyiapkan daftar blok yang akan ditulis: satu blok per bulan (tahunan),
  // atau satu blok tunggal sesuai rentang tanggal yang diminta.
  let blocks;
  if (isTahunan) {
    blocks = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const dateList = Array.from(
        { length: daysInMonth(year, month) },
        (_, d) => isoDate(year, month, d + 1),
      );
      return { title: `${MONTH_NAMES_ID[i]} ${year}`, dateList };
    });
  } else if (periodType === "bulanan") {
    // Satu blok kalender penuh untuk bulan yang dipilih, judul "Bulan Tahun"
    // sama seperti format Book1.xlsx (start/end dari frontend sudah berupa
    // tanggal 1 s/d akhir bulan yang sama).
    const month = Number(start.slice(5, 7));
    const dateList = Array.from({ length: daysInMonth(year, month) }, (_, d) =>
      isoDate(year, month, d + 1),
    );
    blocks = [{ title: `${MONTH_NAMES_ID[month - 1]} ${year}`, dateList }];
  } else {
    const dateList = buildRangeDateList(start, end);
    const title =
      start === end
        ? formatDateLong(start)
        : `${formatDateShort(start)} s/d ${formatDateShort(end)}`;
    blocks = [{ title, dateList }];
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sistem Absensi BUMDESMA Podo Rukun LKD";
  workbook.created = new Date();

  const sheetDefs = [
    { name: "Daftar Hadir", cellMode: "status" },
    { name: "Jam Masuk", cellMode: "masuk" },
    { name: "Jam Pulang", cellMode: "pulang" },
  ];

  sheetDefs.forEach(({ name, cellMode }) => {
    const sheet = workbook.addWorksheet(name, {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    const maxDayCount = Math.max(...blocks.map((b) => b.dateList.length), 0);
    setupSheet(sheet, maxDayCount, cellMode === "status");

    // Legenda kode, ditulis sekali di baris paling atas sheet, sebelum blok pertama.
    sheet.getCell(1, 1).value = "Keterangan:";
    sheet.getCell(1, 1).font = { bold: true };
    sheet.getCell(2, 1).value =
      cellMode === "status"
        ? "H = Hadir, P = Piket, I = Izin, S = Sakit, C = Cuti, - = Tidak Absen (Alpa)"
        : "Sel kosong berarti karyawan tidak memiliki catatan pada tanggal tersebut (libur, alpa, atau izin/cuti).";
    sheet.getCell(2, 1).font = {
      italic: true,
      size: 9,
      color: { argb: "FF6B7280" },
    };

    let cursorRow = 4;
    blocks.forEach((block) => {
      cursorRow = writeBlock(sheet, cursorRow, {
        title: block.title,
        dateList: block.dateList,
        employees,
        attendanceMap,
        leaveJenisMap,
        piketSet,
        holidays,
        cellMode,
      });
    });
  });

  return workbook;
}

module.exports = { buildAttendanceGridWorkbook };
