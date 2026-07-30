// Enum / konstanta yang dipakai bersama di seluruh sistem

const ROLES = Object.freeze({
  ADMIN: 'admin',
  KARYAWAN: 'karyawan',
  PIMPINAN: 'pimpinan',
});

const ATTENDANCE_STATUS = Object.freeze({
  TEPAT_WAKTU: 'tepat_waktu',
  TERLAMBAT: 'terlambat',
  ALPA: 'alpa',
  IZIN_CUTI: 'izin_cuti',
});

const CHECKOUT_STATUS = Object.freeze({
  NORMAL: 'normal',
  LEMBUR: 'lembur',
  BELUM_PULANG: 'belum_pulang',
});

const LEAVE_TYPE = Object.freeze({
  IZIN: 'izin',
  CUTI: 'cuti',
});

// Status pengajuan izin/cuti mengikuti alur: pengajuan -> ditinjau Admin -> keputusan Pimpinan
const LEAVE_STATUS = Object.freeze({
  PENDING: 'pending', // Menunggu tinjauan Admin
  DITERUSKAN: 'diteruskan', // Admin sudah meneruskan ke Pimpinan
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

const DAY_TYPE = Object.freeze({
  REGULER: 'reguler', // Senin - Jumat
  SABTU: 'sabtu',
});

const USER_STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
});

module.exports = {
  ROLES,
  ATTENDANCE_STATUS,
  CHECKOUT_STATUS,
  LEAVE_TYPE,
  LEAVE_STATUS,
  DAY_TYPE,
  USER_STATUS,
};
