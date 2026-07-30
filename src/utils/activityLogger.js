const { ActivityLog } = require('../models');

/**
 * Mencatat aktivitas pengguna ke tabel activity_logs untuk kebutuhan audit trail.
 * Dipanggil "fire-and-forget" - kegagalan pencatatan log tidak boleh menggagalkan request utama.
 */
async function logActivity(req, action, description = null, userId = null) {
  try {
    await ActivityLog.create({
      user_id: userId || req?.user?.id || null,
      action,
      description,
      ip_address: req?.ip || req?.connection?.remoteAddress || null,
      user_agent: req?.headers?.['user-agent'] || null,
    });
  } catch (err) {
    console.error('[ActivityLog] Gagal mencatat log:', err.message);
  }
}

module.exports = { logActivity };
