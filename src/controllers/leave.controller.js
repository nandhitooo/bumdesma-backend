const { Op } = require('sequelize');
const { Leave, User, Attendance } = require('../models');
const { success, failure } = require('../utils/response');
const { logActivity } = require('../utils/activityLogger');
const { LEAVE_STATUS, ATTENDANCE_STATUS } = require('../utils/constants');

// POST /api/leaves  (Karyawan mengajukan izin/cuti dari mobile, multipart dengan file lampiran)
const create = async (req, res) => {
  const { jenis, tanggal_mulai, tanggal_selesai, alasan } = req.body;

  if (!jenis || !tanggal_mulai || !tanggal_selesai || !alasan) {
    return failure(res, {
      statusCode: 422,
      message: 'jenis, tanggal_mulai, tanggal_selesai, dan alasan wajib diisi.',
    });
  }

  if (new Date(tanggal_selesai) < new Date(tanggal_mulai)) {
    return failure(res, {
      statusCode: 422,
      message: 'tanggal_selesai tidak boleh sebelum tanggal_mulai.',
    });
  }

  const leave = await Leave.create({
    user_id: req.user.id,
    jenis,
    tanggal_mulai,
    tanggal_selesai,
    alasan,
    file_lampiran: req.file ? `/uploads/surat-izin/${req.file.filename}` : null,
    status: LEAVE_STATUS.PENDING,
  });

  await logActivity(req, 'AJUKAN_IZIN_CUTI', `Mengajukan ${jenis} (${tanggal_mulai} s/d ${tanggal_selesai})`);

  return success(res, {
    statusCode: 201,
    message: 'Pengajuan izin/cuti berhasil dikirim dan menunggu tinjauan Admin.',
    data: leave,
  });
};

// GET /api/leaves/me
const myLeaves = async (req, res) => {
  const rows = await Leave.findAll({
    where: { user_id: req.user.id },
    order: [['created_at', 'DESC']],
  });
  return success(res, { data: rows });
};

// GET /api/leaves?status=&user_id=
// Admin melihat semua pengajuan untuk ditinjau; Pimpinan melihat yang sudah diteruskan Admin
const getAll = async (req, res) => {
  const { status, user_id, page = 1, limit = 20 } = req.query;
  const where = {};
  if (status) where.status = status;
  if (user_id) where.user_id = user_id;

  // Pimpinan hanya perlu melihat pengajuan yang sudah ditinjau Admin ke atas
  if (req.user.role === 'pimpinan' && !status) {
    where.status = { [Op.in]: [LEAVE_STATUS.DITERUSKAN, LEAVE_STATUS.APPROVED, LEAVE_STATUS.REJECTED] };
  }

  const offset = (Number(page) - 1) * Number(limit);
  const { rows, count } = await Leave.findAndCountAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['id', 'nip', 'name', 'departemen'] }],
    order: [['created_at', 'DESC']],
    limit: Number(limit),
    offset,
  });

  return success(res, {
    data: rows,
    meta: { total: count, page: Number(page), limit: Number(limit) },
  });
};

// PUT /api/leaves/:id/review  (Admin meninjau & meneruskan ke Pimpinan)
const review = async (req, res) => {
  const leave = await Leave.findByPk(req.params.id);
  if (!leave) return failure(res, { statusCode: 404, message: 'Pengajuan tidak ditemukan.' });
  if (leave.status !== LEAVE_STATUS.PENDING) {
    return failure(res, { statusCode: 400, message: 'Pengajuan ini sudah ditinjau sebelumnya.' });
  }

  leave.status = LEAVE_STATUS.DITERUSKAN;
  leave.reviewed_by = req.user.id;
  leave.reviewed_at = new Date();
  await leave.save();

  await logActivity(req, 'REVIEW_IZIN_CUTI', `Admin meneruskan pengajuan izin/cuti ID ${leave.id} ke Pimpinan`);

  return success(res, { message: 'Pengajuan berhasil diteruskan ke Pimpinan untuk keputusan akhir.', data: leave });
};

// PUT /api/leaves/:id/decision  (Pimpinan memberi keputusan akhir)
// Body: { decision: 'approved' | 'rejected', catatan_keputusan }
const decide = async (req, res) => {
  const { decision, catatan_keputusan } = req.body;

  if (![LEAVE_STATUS.APPROVED, LEAVE_STATUS.REJECTED].includes(decision)) {
    return failure(res, { statusCode: 422, message: 'decision harus "approved" atau "rejected".' });
  }

  const leave = await Leave.findByPk(req.params.id);
  if (!leave) return failure(res, { statusCode: 404, message: 'Pengajuan tidak ditemukan.' });
  if (![LEAVE_STATUS.DITERUSKAN, LEAVE_STATUS.PENDING].includes(leave.status)) {
    return failure(res, { statusCode: 400, message: 'Pengajuan ini sudah mendapat keputusan sebelumnya.' });
  }

  leave.status = decision;
  leave.decided_by = req.user.id;
  leave.decided_at = new Date();
  leave.catatan_keputusan = catatan_keputusan || null;
  await leave.save();

  // Jika disetujui, otomatis isi rekapitulasi harian berstatus "Izin/Cuti" untuk setiap
  // tanggal dalam rentang pengajuan dan menutup akses scanning pada tanggal tersebut.
  if (decision === LEAVE_STATUS.APPROVED) {
    const start = new Date(leave.tanggal_mulai);
    const end = new Date(leave.tanggal_selesai);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const tanggal = d.toISOString().slice(0, 10);
      const [attendance] = await Attendance.findOrCreate({
        where: { user_id: leave.user_id, tanggal },
        defaults: { user_id: leave.user_id, tanggal, status: ATTENDANCE_STATUS.IZIN_CUTI },
      });
      if (attendance.status !== ATTENDANCE_STATUS.IZIN_CUTI) {
        attendance.status = ATTENDANCE_STATUS.IZIN_CUTI;
        await attendance.save();
      }
    }
  }

  await logActivity(
    req,
    'KEPUTUSAN_IZIN_CUTI',
    `Pimpinan memberi keputusan "${decision}" untuk pengajuan ID ${leave.id}`
  );

  // NB: notifikasi hasil keputusan ke perangkat karyawan dikirim melalui layanan
  // push notification pihak ketiga (di luar cakupan API ini).
  return success(res, {
    message: `Pengajuan izin/cuti telah ${decision === 'approved' ? 'disetujui' : 'ditolak'} dan notifikasi terkirim ke karyawan.`,
    data: leave,
  });
};

module.exports = { create, myLeaves, getAll, review, decide };
