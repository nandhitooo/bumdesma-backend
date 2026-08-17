// Enum / konstanta yang dipakai bersama di seluruh sistem

// ROLES dipakai untuk pengecekan otorisasi rute (authorize(ROLES.ADMIN), dst).
// Nilainya sama seperti sebelumnya; sumbernya sekarang dua tabel berbeda:
// karyawan (implisit 'karyawan', tabel users) atau admin_accounts.role.
const ROLES = Object.freeze({
  ADMIN: "admin",
  KARYAWAN: "karyawan",
  PIMPINAN: "pimpinan",
});

// Nilai valid untuk kolom admin_accounts.role.
const ADMIN_ROLES = Object.freeze({
  ADMIN: "admin",
  PIMPINAN: "pimpinan",
});

const ATTENDANCE_STATUS = Object.freeze({
  TEPAT_WAKTU: "tepat_waktu",
  TERLAMBAT: "terlambat",
  ALPA: "alpa",
  IZIN_CUTI: "izin_cuti",
});

const CHECKOUT_STATUS = Object.freeze({
  NORMAL: "normal",
  LEMBUR: "lembur",
  BELUM_PULANG: "belum_pulang",
});

const LEAVE_TYPE = Object.freeze({
  IZIN: "izin",
  SAKIT: "sakit",
  CUTI: "cuti",
});

// Status pengajuan izin/cuti mengikuti alur: pengajuan -> ditinjau Admin -> keputusan Pimpinan
const LEAVE_STATUS = Object.freeze({
  PENDING: "pending", // Menunggu tinjauan Admin
  DITERUSKAN: "diteruskan", // Admin sudah meneruskan ke Pimpinan
  APPROVED: "approved",
  REJECTED: "rejected",
});

const DAY_TYPE = Object.freeze({
  REGULER: "reguler", // Senin - Jumat
  SABTU: "sabtu",
});

const USER_STATUS = Object.freeze({
  ACTIVE: "active",
  INACTIVE: "inactive",
});

const NOTIFICATION_TYPE = Object.freeze({
  PIKET: "piket",
  IZIN_CUTI: "izin_cuti",
});

module.exports = {
  ROLES,
  ADMIN_ROLES,
  ATTENDANCE_STATUS,
  CHECKOUT_STATUS,
  LEAVE_TYPE,
  LEAVE_STATUS,
  DAY_TYPE,
  USER_STATUS,
  NOTIFICATION_TYPE,
};
