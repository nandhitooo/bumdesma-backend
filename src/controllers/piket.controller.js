const { Op } = require('sequelize');
const { PiketSchedule, User } = require('../models');
const { success, failure } = require('../utils/response');
const { logActivity } = require('../utils/activityLogger');
const { notifyUser } = require('../utils/notifier');
const { NOTIFICATION_TYPE } = require('../utils/constants');

// GET /api/piket?start=&end=
const getAll = async (req, res) => {
  const { start, end } = req.query;
  const where = {};
  if (start && end) where.tanggal = { [Op.between]: [start, end] };

  const rows = await PiketSchedule.findAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['id', 'nip', 'name'] }],
    order: [['tanggal', 'ASC']],
  });

  return success(res, { data: rows });
};

// GET /api/piket/me
const myPiket = async (req, res) => {
  const rows = await PiketSchedule.findAll({
    where: { user_id: req.user.id },
    order: [['tanggal', 'DESC']],
  });
  return success(res, { data: rows });
};

// POST /api/piket  (Admin assign - bisa banyak karyawan sekaligus)
// Body: { tanggal, userIds: [] }
const assign = async (req, res) => {
  const { tanggal, userIds } = req.body;

  if (!tanggal || !Array.isArray(userIds) || userIds.length === 0) {
    return failure(res, {
      statusCode: 422,
      message: 'tanggal dan userIds (array) wajib diisi.',
    });
  }

  const dayOfWeek = new Date(`${tanggal}T00:00:00`).getDay();
  if (dayOfWeek !== 6) {
    return failure(res, { statusCode: 422, message: 'Jadwal piket hanya berlaku untuk hari Sabtu.' });
  }

  const created = [];
  for (const userId of userIds) {
    const [row] = await PiketSchedule.findOrCreate({
      where: { user_id: userId, tanggal },
      defaults: { assigned_by: req.user.id },
    });
    created.push(row);
  }

  await logActivity(
    req,
    'ASSIGN_PIKET',
    `Admin menetapkan jadwal piket tanggal ${tanggal} untuk ${userIds.length} karyawan`
  );

  return success(res, {
    statusCode: 201,
    message:
      'Jadwal piket berhasil ditetapkan. Tekan "Kirim Notifikasi" untuk memberi tahu karyawan di app mobile.',
    data: created,
  });
};

// POST /api/piket/:id/notify  (Admin - tombol "Kirim Notifikasi")
// Membuat notifikasi in-app untuk karyawan bersangkutan dan menandai
// notification_sent = true. Ini yang membuat badge lonceng di Dashboard
// mobile menyala dan mengisi panel notifikasi (Gambar 3.24).
const notify = async (req, res) => {
  const row = await PiketSchedule.findByPk(req.params.id, {
    include: [{ model: User, as: 'user', attributes: ['id', 'nip', 'name'] }],
  });

  if (!row) {
    return failure(res, { statusCode: 404, message: 'Jadwal piket tidak ditemukan.' });
  }

  const tanggalFormatted = new Date(`${row.tanggal}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  await notifyUser({
    userId: row.user_id,
    type: NOTIFICATION_TYPE.PIKET,
    title: 'Jadwal Piket Sabtu',
    message: `Anda ditugaskan piket pada ${tanggalFormatted}. Mohon hadir sesuai jadwal.`,
    data: { piketScheduleId: row.id, tanggal: row.tanggal },
    sentBy: req.user.id,
  });

  row.notification_sent = true;
  await row.save();

  await logActivity(
    req,
    'NOTIFY_PIKET',
    `Admin mengirim notifikasi piket kepada ${row.user?.name ?? row.user_id}`
  );

  return success(res, {
    message: `Notifikasi piket berhasil dikirim ke ${row.user?.name ?? 'karyawan'}.`,
    data: row,
  });
};

// DELETE /api/piket/:id
const remove = async (req, res) => {
  const row = await PiketSchedule.findByPk(req.params.id);
  if (!row) return failure(res, { statusCode: 404, message: 'Jadwal piket tidak ditemukan.' });

  await row.destroy();
  await logActivity(req, 'REMOVE_PIKET', `Admin menghapus jadwal piket ID ${req.params.id}`);

  return success(res, { message: 'Jadwal piket berhasil dihapus.' });
};

module.exports = { getAll, myPiket, assign, notify, remove };
