const admin = require('firebase-admin');
const { PushToken, User } = require('../models');

/**
 * Push notification FCM ke notif bar HP karyawan.
 *
 * Inisialisasi firebase-admin dibungkus try/catch: kalau kredensial service
 * account belum di-setup (mis. laptop dev tanpa GOOGLE_APPLICATION_CREDENTIALS),
 * server tetap hidup dan notifikasi in-app (tabel notifications) tetap jalan —
 * hanya push ke notif bar yang dilewati dengan warning sekali.
 */
let initWarned = false;
function ensureInit() {
  if (admin.apps.length > 0) return true;
  try {
    // firebase-admin membaca GOOGLE_APPLICATION_CREDENTIALS secara otomatis,
    // atau fallback ke ADC metadata server saat jalan di GCP.
    admin.initializeApp();
    return true;
  } catch (err) {
    if (!initWarned) {
      initWarned = true;
      console.warn(
        '[push] Firebase admin tidak terinisialisasi — push FCM dilewati.' +
          '\n       Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json' +
          '\n       Error: ' +
          (err && err.message ? err.message : err)
      );
    }
    return false;
  }
}

const TYPE_TO_CHANNEL = {
  piket: 'piket',
  izin_cuti: 'izin_cuti',
};

/**
 * Kirim push FCM ke seluruh perangkat milik satu karyawan (by user id),
 * lalu bersihkan token yang sudah tidak valid (app diuninstall dsb).
 *
 * @param {string} userId - UUID user penerima (tabel users.id)
 * @param {object} payload
 * @param {string} payload.title - Judul di notif bar
 * @param {string} payload.message - Isi notif
 * @param {'piket'|'izin_cuti'} [payload.type] - Menentukan channel Android
 * @param {string|number} [payload.notificationId] - ID baris notifikasi in-app
 * @returns {Promise<void>} Tidak pernah throw — push gagal tidak boleh
 *          menggagalkan alur bisnis (keputusan izin, kirim notif piket).
 */
async function pushToUser(userId, { title, message, type, notificationId }) {
  try {
    if (!ensureInit()) return;

    const rows = await PushToken.findAll({
      where: { user_id: userId },
      include: [{ model: User, as: 'user', attributes: ['id', 'nip', 'name'] }],
    });
    if (rows.length === 0) return;

    const channelId = TYPE_TO_CHANNEL[type] || 'izin_cuti';

    // "notification" payload -> otomatis ditampilkan OS saat app background/
    // terminated. "data" -> dibaca app untuk pilih channel & deeplink saat
    // foreground (FcmPushService.showRemoteMessage) dan jaring pengaman
    // background handler (firebaseMessagingBackgroundHandler).
    const messagePayload = {
      tokens: rows.map((r) => r.token),
      notification: { title, body: message },
      android: {
        priority: 'high',
        // Channel harus sama dengan yang dibuat app
        // (lib/services/fcm_push_service.dart).
        channel_id: channelId,
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
      data: {
        type: type || '',
        notification_id: notificationId != null ? String(notificationId) : '',
      },
    };

    const res = await admin.messaging().sendEachForMulticast(messagePayload);

    // Token invalid/expired -> hapus supaya tabel tidak menumpuk sampah.
    const invalid = res.responses
      .map((r, i) => (r.success ? null : rows[i].token))
      .filter(Boolean);
    if (invalid.length > 0) {
      await PushToken.destroy({ where: { token: invalid } });
    }
  } catch (err) {
    // Jangan pernah biarkan kegagalan push menggagalkan request utama
    // (decision izin, notify piket) yang sudah sukses tersimpan di DB.
    console.error('[push] Gagal mengirim FCM:', err && err.message ? err.message : err);
  }
}

module.exports = { pushToUser };
