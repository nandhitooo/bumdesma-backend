const { Notification } = require('../models');

/**
 * Membuat satu notifikasi in-app untuk seorang karyawan. Notifikasi ini
 * yang dibaca oleh app mobile lewat GET /api/notifications dan ditampilkan
 * di panel lonceng Dashboard.
 */
async function notifyUser({ userId, type, title, message, data = null, sentBy = null }) {
  return Notification.create({
    user_id: userId,
    type,
    title,
    message,
    data,
    sent_by: sentBy,
  });
}

/**
 * Membuat notifikasi yang sama untuk beberapa karyawan sekaligus.
 */
async function notifyUsers({ userIds, type, title, message, data = null, sentBy = null }) {
  const rows = userIds.map((userId) => ({
    user_id: userId,
    type,
    title,
    message,
    data,
    sent_by: sentBy,
  }));
  return Notification.bulkCreate(rows);
}

module.exports = { notifyUser, notifyUsers };
