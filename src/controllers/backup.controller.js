const { Sequelize } = require('sequelize');
const sequelize = require('../config/database');
const { success, failure } = require('../utils/response');
const { logActivity } = require('../utils/activityLogger');

// Nama tabel fisik yang ikut di-backup, urut mengikuti ketergantungan FK
// (parent dulu) supaya restore bisa langsung jalan secara berurutan.
const BACKUP_TABLES = [
  'admin_accounts',
  'users',
  'work_schedules',
  'system_settings',
  'qr_codes',
  'attendances',
  'leaves',
  'piket_schedules',
  'notifications',
  'push_tokens',
  'activity_logs',
];

// GET /api/backup/export  (Admin - unduh backup JSON seluruh data)
// Mengembalikan file JSON berisi seluruh isi tabel (termasuk password hash,
// karena ini backup penuh untuk pemulihan bencana). File cukup sensitif:
// hanya Admin yang boleh mengunduh.
const exportBackup = async (req, res) => {
  const backup = {
    meta: {
      app: 'BUMDESMA Podo Rukun LKD - Sistem Absensi',
      generated_at: new Date().toISOString(),
      generated_by: req.user?.name || 'unknown',
      tables: BACKUP_TABLES,
    },
    data: {},
  };

  try {
    for (const table of BACKUP_TABLES) {
      const [rows] = await sequelize.query(`SELECT * FROM "${table}"`);
      backup.data[table] = rows;
    }
  } catch (err) {
    return failure(res, {
      statusCode: 500,
      message: `Gagal membaca tabel untuk backup: ${err.message}`,
    });
  }

  await logActivity(req, 'EXPORT_BACKUP', 'Admin mengunduh backup data sistem');

  const fileName = `backup-bumdesma-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${fileName}"`,
  );
  return res.status(200).send(JSON.stringify(backup, null, 2));
};

// POST /api/backup/restore  (Admin - pulihkan data dari file backup JSON)
// PROSES DESTRUKTIF: seluruh baris pada tabel tujuan DIHAPUS dulu, lalu
// diisi ulang dari isi file. Semuanya berjalan dalam satu transaksi - kalau
// ada kegagalan di tengah jalan, database kembali ke kondisi semula.
// Wajib mengirim field `confirm` bernilai "RESTORE" sebagai konfirmasi
// eksplisit dari user, selain sudah dilindungi authorize(ADMIN) di route.
const RESTORE_CONFIRM_TEXT = 'RESTORE';

const restoreBackup = async (req, res) => {
  // req.file diisi multer (memoryStorage) dari route.
  if (!req.file || !req.file.buffer) {
    return failure(res, {
      statusCode: 422,
      message: 'File backup JSON wajib diunggah.',
    });
  }

  if ((req.body?.confirm || '').trim().toUpperCase() !== RESTORE_CONFIRM_TEXT) {
    return failure(res, {
      statusCode: 422,
      message: `Konfirmasi wajib diisi dengan teks "${RESTORE_CONFIRM_TEXT}" untuk melakukan restore.`,
    });
  }

  let backup;
  try {
    backup = JSON.parse(req.file.buffer.toString('utf8'));
  } catch {
    return failure(res, {
      statusCode: 422,
      message: 'File bukan JSON yang valid.',
    });
  }

  if (!backup || backup.meta == null || typeof backup.data !== 'object' || backup.data == null) {
    return failure(res, {
      statusCode: 422,
      message: 'Struktur file backup tidak dikenali (butuh bagian meta & data).',
    });
  }

  const unknownTables = Object.keys(backup.data).filter(
    (t) => !BACKUP_TABLES.includes(t),
  );
  if (unknownTables.length > 0) {
    return failure(res, {
      statusCode: 422,
      message: `File backup memuat tabel yang tidak dikenal: ${unknownTables.join(', ')}.`,
    });
  }

  const restoredCounts = {};

  try {
    await sequelize.transaction(async (t) => {
      const queryInterface = sequelize.getQueryInterface();

      // Hapus semua baris (anak dulu, induk belakang) supaya FK tidak
      // menghentikan proses. TRUNCATE ... CASCADE juga bisa, tapi DELETE
      // memberi perilaku yang sama di dalam transaksi dan lebih aman
      // terhadap tabel yang mungkin punya trigger.
      for (const table of [...BACKUP_TABLES].reverse()) {
        await sequelize.query(`DELETE FROM "${table}"`, { transaction: t });
      }

      // Isi ulang: induk dulu sesuai urutan BACKUP_TABLES.
      for (const table of BACKUP_TABLES) {
        const rows = backup.data[table];
        if (!Array.isArray(rows) || rows.length === 0) {
          restoredCounts[table] = 0;
          continue;
        }
        // bulkInsert menangani quoting kolom & konversi tipe (Date, dsb).
        await queryInterface.bulkInsert(table, rows, { transaction: t });
        restoredCounts[table] = rows.length;
      }
    });
  } catch (err) {
    return failure(res, {
      statusCode: 500,
      message: `Restore gagal, database dikembalikan ke kondisi semula: ${err.message}`,
    });
  }

  await logActivity(
    req,
    'RESTORE_BACKUP',
    `Admin memulihkan data sistem dari file backup (${req.file.originalname})`,
  );

  return success(res, {
    message: 'Restore data berhasil.',
    data: {
      source_file: req.file.originalname,
      backup_generated_at: backup.meta.generated_at || null,
      restored: restoredCounts,
    },
  });
};

// GET /api/backup/stats  (Admin - ringkasan jumlah baris per tabel)
const backupStats = async (req, res) => {
  const stats = {};
  try {
    for (const table of BACKUP_TABLES) {
      const [rows] = await sequelize.query(
        `SELECT COUNT(*)::int AS count FROM "${table}"`,
      );
      stats[table] = rows[0]?.count ?? 0;
    }
  } catch (err) {
    return failure(res, {
      statusCode: 500,
      message: `Gagal membaca statistik tabel: ${err.message}`,
    });
  }

  return success(res, { data: { tables: stats, generated_at: new Date().toISOString() } });
};

module.exports = { exportBackup, backupStats, restoreBackup, BACKUP_TABLES };
