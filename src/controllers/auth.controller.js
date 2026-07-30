const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { success, failure } = require('../utils/response');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { logActivity } = require('../utils/activityLogger');

// POST /api/auth/login
// Login universal untuk Admin, Karyawan, dan Pimpinan menggunakan NIP + password
const login = async (req, res) => {
  const { nip, password } = req.body;

  if (!nip || !password) {
    return failure(res, { statusCode: 422, message: 'NIP dan password wajib diisi.' });
  }

  const user = await User.findOne({ where: { nip } });
  if (!user) {
    return failure(res, { statusCode: 401, message: 'NIP atau password salah.' });
  }

  if (user.status !== 'active') {
    return failure(res, {
      statusCode: 403,
      message: 'Akun Anda telah dinonaktifkan. Silakan hubungi Admin.',
    });
  }

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    await logActivity(req, 'LOGIN_FAILED', `Percobaan login gagal untuk NIP ${nip}`, user.id);
    return failure(res, { statusCode: 401, message: 'NIP atau password salah.' });
  }

  user.last_login_at = new Date();
  await user.save();

  const payload = { id: user.id, role: user.role, nip: user.nip };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  await logActivity(req, 'LOGIN', `${user.name} (${user.role}) berhasil login`, user.id);

  return success(res, {
    message: 'Login berhasil.',
    data: {
      user: user.toSafeJSON(),
      accessToken,
      refreshToken,
      mustChangePassword: user.is_first_login,
    },
  });
};

// POST /api/auth/refresh-token
const refreshToken = async (req, res) => {
  const { refreshToken: token } = req.body;
  if (!token) {
    return failure(res, { statusCode: 422, message: 'refreshToken wajib diisi.' });
  }

  try {
    const decoded = verifyRefreshToken(token);
    const user = await User.findByPk(decoded.id);
    if (!user || user.status !== 'active') {
      return failure(res, { statusCode: 401, message: 'Sesi tidak valid.' });
    }
    const payload = { id: user.id, role: user.role, nip: user.nip };
    return success(res, {
      message: 'Token berhasil diperbarui.',
      data: { accessToken: signAccessToken(payload) },
    });
  } catch (err) {
    return failure(res, { statusCode: 401, message: 'Refresh token tidak valid atau kedaluwarsa.' });
  }
};

// POST /api/auth/change-password
// Dipakai untuk mekanisme wajib ganti password pada login pertama karyawan,
// maupun ganti password mandiri oleh pengguna yang sudah login.
const changePassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return failure(res, {
      statusCode: 422,
      message: 'Password baru minimal 8 karakter.',
    });
  }

  const user = await User.findByPk(req.user.id);

  const isOldPasswordValid = await bcrypt.compare(oldPassword || '', user.password);
  if (!isOldPasswordValid) {
    return failure(res, { statusCode: 401, message: 'Password lama tidak sesuai.' });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.is_first_login = false;
  await user.save();

  await logActivity(req, 'CHANGE_PASSWORD', 'Pengguna mengganti password sendiri');

  return success(res, { message: 'Password berhasil diperbarui.' });
};

// GET /api/auth/me
const me = async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (!user) {
    return failure(res, { statusCode: 404, message: 'Pengguna tidak ditemukan.' });
  }
  return success(res, { data: user.toSafeJSON() });
};

// POST /api/auth/logout
const logout = async (req, res) => {
  await logActivity(req, 'LOGOUT', `${req.user.name} logout`);
  return success(res, { message: 'Logout berhasil.' });
};

module.exports = { login, refreshToken, changePassword, me, logout };
