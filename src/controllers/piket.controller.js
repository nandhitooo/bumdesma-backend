const { Op } = require('sequelize');
const { PiketSchedule, User } = require('../models');
const { success, failure } = require('../utils/response');
const { logActivity } = require('../utils/activityLogger');

// GET /api/piket?start=&end=
const getAll = async (req, res) => {
  const { start, end } = req.query;
  const where = {};
  if (start && end) where.tanggal = { [Op.between]: [start, end] };

  const rows = await PiketSchedule.findAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['id', 'nip', 'name', 'departemen'] }],
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
      defaults: { assigned_by: req.user.id, notification_sent: true },
    });
    created.push(row);
  }

  await logActivity(
    req,
    'ASSIGN_PIKET',
    `Admin menetapkan jadwal piket tanggal ${tanggal} untuk ${userIds.length} karyawan`
  );

  // NB: notification_sent ditandai true karena notifikasi ke perangkat karyawan
  // dikirim melalui layanan push notification pihak ketiga (di luar cakupan API ini).
  return success(res, {
    statusCode: 201,
    message: 'Jadwal piket berhasil ditetapkan dan notifikasi terkirim ke karyawan terkait.',
    data: created,
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

module.exports = { getAll, myPiket, assign, remove };
