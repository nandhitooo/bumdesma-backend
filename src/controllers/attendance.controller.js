const { Op } = require('sequelize');
const {
  Attendance,
  QrCode,
  WorkSchedule,
  PiketSchedule,
  Leave,
  User,
} = require('../models');
const { success, failure } = require('../utils/response');
const { checkGeofence } = require('../utils/geofencing');
const { getSettingsMap } = require('../utils/settingsHelper');
const { logActivity } = require('../utils/activityLogger');
const {
  ATTENDANCE_STATUS,
  CHECKOUT_STATUS,
  LEAVE_STATUS,
  DAY_TYPE,
} = require('../utils/constants');

function todayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

function minutesBetween(a, b) {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

// Menggabungkan tanggal hari ini dengan jam (HH:mm:ss) dari kolom TIME work_schedules
function combineDateAndTime(dateOnlyStr, timeStr) {
  return new Date(`${dateOnlyStr}T${timeStr}`);
}

/**
 * Menentukan jadwal kerja yang berlaku untuk seorang karyawan pada tanggal tertentu.
 * Senin-Jumat -> jadwal reguler.
 * Sabtu -> hanya berlaku jika karyawan terdaftar di piket_schedules pada tanggal itu.
 * Minggu -> tidak ada jadwal (bukan hari kerja).
 */
async function resolveScheduleForUser(userId, dateOnlyStr) {
  const dayOfWeek = new Date(`${dateOnlyStr}T00:00:00`).getDay(); // 0=Minggu, 6=Sabtu

  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    const schedule = await WorkSchedule.findOne({
      where: { day_type: DAY_TYPE.REGULER, is_active: true },
    });
    return { schedule, allowed: true };
  }

  if (dayOfWeek === 6) {
    const piket = await PiketSchedule.findOne({
      where: { user_id: userId, tanggal: dateOnlyStr },
    });
    if (!piket) {
      return { schedule: null, allowed: false, reason: 'not_scheduled_piket' };
    }
    const schedule = await WorkSchedule.findOne({
      where: { day_type: DAY_TYPE.SABTU, is_active: true },
    });
    return { schedule, allowed: true };
  }

  return { schedule: null, allowed: false, reason: 'sunday' };
}

// POST /api/attendance/scan
// Body: { token, latitude, longitude }
const scan = async (req, res) => {
  const { token, latitude, longitude } = req.body;
  const userId = req.user.id;

  if (!token || latitude === undefined || longitude === undefined) {
    return failure(res, {
      statusCode: 422,
      message: 'token, latitude, dan longitude wajib dikirim.',
    });
  }

  // Layer 2: Verifikasi token QR Code statis
  const qrCode = await QrCode.findOne({ where: { token, is_active: true } });
  if (!qrCode) {
    await logActivity(req, 'SCAN_REJECTED', 'Token QR Code tidak valid/tidak aktif');
    return failure(res, { statusCode: 400, message: 'QR Code tidak valid atau sudah tidak aktif.' });
  }

  // Layer 3: Geofencing
  const settings = await getSettingsMap();
  const officeLat = Number(settings.office_latitude);
  const officeLon = Number(settings.office_longitude);
  const radius = Number(settings.geofence_radius_meters) || 50;

  const { distance, isWithinRadius } = checkGeofence(
    Number(latitude),
    Number(longitude),
    officeLat,
    officeLon,
    radius
  );

  if (!isWithinRadius) {
    await logActivity(
      req,
      'SCAN_REJECTED',
      `Geofencing gagal, jarak ${distance}m dari kantor (radius ${radius}m)`
    );
    return failure(res, {
      statusCode: 400,
      message: `Lokasi Anda berada di luar radius kantor (${distance} meter). Absensi ditolak.`,
      errors: { distance, radius },
    });
  }

  const dateOnlyStr = todayDateOnly();

  // Karyawan sedang izin/cuti disetujui pada tanggal ini -> tutup akses scan
  const approvedLeave = await Leave.findOne({
    where: {
      user_id: userId,
      status: LEAVE_STATUS.APPROVED,
      tanggal_mulai: { [Op.lte]: dateOnlyStr },
      tanggal_selesai: { [Op.gte]: dateOnlyStr },
    },
  });
  if (approvedLeave) {
    return failure(res, {
      statusCode: 400,
      message: 'Anda sedang dalam masa izin/cuti yang disetujui. Absensi tidak diperlukan hari ini.',
    });
  }

  // Layer 4: Jadwal kerja & hak akses hari ini (termasuk validasi piket Sabtu)
  const { schedule, allowed, reason } = await resolveScheduleForUser(userId, dateOnlyStr);
  if (!allowed) {
    const message =
      reason === 'not_scheduled_piket'
        ? 'Anda tidak terdaftar dalam jadwal piket Sabtu ini. Akses absensi ditutup.'
        : 'Hari ini bukan hari kerja. Akses absensi ditutup.';
    return failure(res, { statusCode: 400, message });
  }

  let attendance = await Attendance.findOne({ where: { user_id: userId, tanggal: dateOnlyStr } });
  const now = new Date();

  // === ABSEN MASUK ===
  if (!attendance || !attendance.jam_masuk) {
    const scheduleStart = schedule
      ? combineDateAndTime(dateOnlyStr, schedule.start_time)
      : null;
    const toleranceMinutes = schedule ? schedule.late_tolerance_minutes : 0;
    let status = ATTENDANCE_STATUS.TEPAT_WAKTU;
    let lateMinutes = 0;

    if (scheduleStart) {
      const deadline = new Date(scheduleStart.getTime() + toleranceMinutes * 60000);
      if (now > deadline) {
        status = ATTENDANCE_STATUS.TERLAMBAT;
        lateMinutes = minutesBetween(now, scheduleStart);
      }
    }

    const payload = {
      user_id: userId,
      qr_code_id: qrCode.id,
      schedule_id: schedule ? schedule.id : null,
      tanggal: dateOnlyStr,
      jam_masuk: now,
      status,
      checkout_status: CHECKOUT_STATUS.BELUM_PULANG,
      late_minutes: lateMinutes,
      latitude_in: latitude,
      longitude_in: longitude,
      distance_in_meters: distance,
    };

    attendance = attendance
      ? await attendance.update(payload)
      : await Attendance.create(payload);

    await logActivity(req, 'SCAN_ABSEN_MASUK', `Absen masuk tercatat, status: ${status}`);

    return success(res, {
      statusCode: 201,
      message:
        status === ATTENDANCE_STATUS.TERLAMBAT
          ? `Absen masuk berhasil, namun Anda tercatat TERLAMBAT ${lateMinutes} menit.`
          : 'Absen masuk berhasil. Selamat bekerja!',
      data: { attendance, jenis: 'masuk' },
    });
  }

  // === SCAN DITOLAK: sudah absen lengkap ===
  if (attendance.jam_pulang) {
    return failure(res, {
      statusCode: 400,
      message: 'Anda sudah melakukan absen masuk dan pulang pada hari ini.',
    });
  }

  // === ABSEN PULANG ===
  const scheduleEnd = schedule ? combineDateAndTime(dateOnlyStr, schedule.end_time) : null;
  let checkoutStatus = CHECKOUT_STATUS.NORMAL;
  let overtimeMinutes = 0;

  if (scheduleEnd && now > scheduleEnd) {
    checkoutStatus = CHECKOUT_STATUS.LEMBUR;
    overtimeMinutes = minutesBetween(now, scheduleEnd);
  }

  await attendance.update({
    jam_pulang: now,
    checkout_status: checkoutStatus,
    overtime_minutes: overtimeMinutes,
    latitude_out: latitude,
    longitude_out: longitude,
    distance_out_meters: distance,
  });

  await logActivity(
    req,
    'SCAN_ABSEN_PULANG',
    `Absen pulang tercatat, status: ${checkoutStatus}${
      overtimeMinutes ? `, lembur ${overtimeMinutes} menit` : ''
    }`
  );

  return success(res, {
    message:
      checkoutStatus === CHECKOUT_STATUS.LEMBUR
        ? `Absen pulang berhasil. Anda tercatat lembur selama ${overtimeMinutes} menit.`
        : 'Absen pulang berhasil. Terima kasih atas kerja keras Anda hari ini!',
    data: { attendance, jenis: 'pulang' },
  });
};

// GET /api/attendance/me?start=&end=
const myAttendance = async (req, res) => {
  const { start, end } = req.query;
  const where = { user_id: req.user.id };
  if (start && end) where.tanggal = { [Op.between]: [start, end] };

  const rows = await Attendance.findAll({
    where,
    order: [['tanggal', 'DESC']],
    include: [{ model: WorkSchedule, as: 'schedule', attributes: ['label', 'start_time', 'end_time'] }],
  });

  return success(res, { data: rows });
};

// GET /api/attendance?tanggal=&user_id=&status=&page=&limit=
// Untuk Admin & Pimpinan memantau kehadiran seluruh karyawan
const getAll = async (req, res) => {
  const { tanggal, start, end, user_id, status, page = 1, limit = 50 } = req.query;
  const where = {};
  if (tanggal) where.tanggal = tanggal;
  if (start && end) where.tanggal = { [Op.between]: [start, end] };
  if (user_id) where.user_id = user_id;
  if (status) where.status = status;

  const offset = (Number(page) - 1) * Number(limit);
  const { rows, count } = await Attendance.findAndCountAll({
    where,
    include: [
      { model: User, as: 'user', attributes: ['id', 'nip', 'name', 'jabatan'] },
      { model: WorkSchedule, as: 'schedule', attributes: ['label'] },
    ],
    order: [
      ['tanggal', 'DESC'],
      ['jam_masuk', 'ASC'],
    ],
    limit: Number(limit),
    offset,
  });

  return success(res, {
    data: rows,
    meta: { total: count, page: Number(page), limit: Number(limit) },
  });
};

// GET /api/attendance/dashboard-summary?tanggal=
// Ringkasan real-time untuk Dashboard Admin/Pimpinan
const dashboardSummary = async (req, res) => {
  const tanggal = req.query.tanggal || todayDateOnly();

  const totalKaryawan = await User.count({ where: { role: 'karyawan', status: 'active' } });
  const records = await Attendance.findAll({ where: { tanggal } });

  const hadir = records.filter((r) => r.jam_masuk).length;
  const terlambat = records.filter((r) => r.status === ATTENDANCE_STATUS.TERLAMBAT).length;
  const izinCuti = records.filter((r) => r.status === ATTENDANCE_STATUS.IZIN_CUTI).length;
  const lembur = records.filter((r) => r.checkout_status === CHECKOUT_STATUS.LEMBUR).length;
  const belumAbsen = Math.max(totalKaryawan - records.length, 0);

  return success(res, {
    data: {
      tanggal,
      totalKaryawan,
      hadir,
      terlambat,
      izinCuti,
      lembur,
      belumAbsen,
    },
  });
};

// PUT /api/attendance/:id  (Admin - koreksi manual)
const correctManually = async (req, res) => {
  const attendance = await Attendance.findByPk(req.params.id);
  if (!attendance) return failure(res, { statusCode: 404, message: 'Data absensi tidak ditemukan.' });

  const { jam_masuk, jam_pulang, status, checkout_status, notes } = req.body;

  if (jam_masuk !== undefined) attendance.jam_masuk = jam_masuk;
  if (jam_pulang !== undefined) attendance.jam_pulang = jam_pulang;
  if (status !== undefined) attendance.status = status;
  if (checkout_status !== undefined) attendance.checkout_status = checkout_status;
  if (notes !== undefined) attendance.notes = notes;

  attendance.is_manual_correction = true;
  attendance.corrected_by = req.user.id;
  await attendance.save();

  await logActivity(
    req,
    'KOREKSI_ABSENSI',
    `Admin melakukan koreksi manual data absensi ID ${attendance.id}`
  );

  return success(res, { message: 'Data absensi berhasil dikoreksi.', data: attendance });
};

module.exports = { scan, myAttendance, getAll, dashboardSummary, correctManually };
