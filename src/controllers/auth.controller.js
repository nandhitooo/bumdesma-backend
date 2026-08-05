const bcrypt = require('bcryptjs');
const { User, AdminAccount } = require('../models');
const { success, failure } = require('../utils/response');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { logActivity } = require('../utils/activityLogger');
const { ROLES } = require('../utils/constants');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/login
// Login Karyawan lewat app mobile, pakai NIP + password sementara yang
// diinput Admin di Website. Wajib ganti password saat pertama kali login.
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
    await logActivity(req, 'LOGIN_FAILED', `Percobaan login gagal untuk NIP ${nip}`, {
      userId: user.id,
    });
    return failure(res, { statusCode: 401, message: 'NIP atau password salah.' });
  }

  user.last_login_at = new Date();
  await user.save();

  const payload = { id: user.id, actorType: ROLES.KARYAWAN, nip: user.nip };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  await logActivity(req, 'LOGIN', `${user.name} (karyawan) berhasil login`, { userId: user.id });

  return success(res, {
    message: 'Login berhasil.',
    data: {
      user: { ...user.toSafeJSON(), role: ROLES.KARYAWAN },
      accessToken,
      refreshToken,
      mustChangePassword: user.is_first_login,
      // Email pemulihan wajib dimiliki setiap akun karyawan. Kalau belum
      // ada (mis. akun lama dari sebelum fitur ini ada, atau is_first_login
      // sudah false tapi entah kenapa email tetap kosong), mobile app akan
      // mengarahkan ke layar "Lengkapi Email" yang tidak bisa dilewati.
      mustAddEmail: !user.email,
    },
  });
};

// POST /api/auth/admin-login
// Login Admin & Pimpinan lewat Website, pakai username + password.
const adminLogin = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return failure(res, { statusCode: 422, message: 'Username dan password wajib diisi.' });
  }

  const admin = await AdminAccount.findOne({ where: { username } });
  if (!admin) {
    return failure(res, { statusCode: 401, message: 'Username atau password salah.' });
  }

  if (admin.status !== 'active') {
    return failure(res, {
      statusCode: 403,
      message: 'Akun Anda telah dinonaktifkan.',
    });
  }

  const isPasswordValid = await bcrypt.compare(password, admin.password);
  if (!isPasswordValid) {
    await logActivity(req, 'LOGIN_FAILED', `Percobaan login gagal untuk username ${username}`, {
      adminId: admin.id,
    });
    return failure(res, { statusCode: 401, message: 'Username atau password salah.' });
  }

  admin.last_login_at = new Date();
  await admin.save();

  const payload = { id: admin.id, actorType: 'admin', role: admin.role, username: admin.username };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  await logActivity(req, 'LOGIN', `${admin.name} (${admin.role}) berhasil login`, {
    adminId: admin.id,
  });

  return success(res, {
    message: 'Login berhasil.',
    data: {
      user: admin.toSafeJSON(),
      accessToken,
      refreshToken,
      mustChangePassword: admin.is_first_login,
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

    if (decoded.actorType === 'admin') {
      const admin = await AdminAccount.findByPk(decoded.id);
      if (!admin || admin.status !== 'active') {
        return failure(res, { statusCode: 401, message: 'Sesi tidak valid.' });
      }
      const payload = { id: admin.id, actorType: 'admin', role: admin.role, username: admin.username };
      return success(res, {
        message: 'Token berhasil diperbarui.',
        data: { accessToken: signAccessToken(payload) },
      });
    }

    const user = await User.findByPk(decoded.id);
    if (!user || user.status !== 'active') {
      return failure(res, { statusCode: 401, message: 'Sesi tidak valid.' });
    }
    const payload = { id: user.id, actorType: ROLES.KARYAWAN, nip: user.nip };
    return success(res, {
      message: 'Token berhasil diperbarui.',
      data: { accessToken: signAccessToken(payload) },
    });
  } catch (err) {
    return failure(res, { statusCode: 401, message: 'Refresh token tidak valid atau kedaluwarsa.' });
  }
};

// POST /api/auth/change-password
// Dipakai untuk mekanisme wajib ganti password pada login pertama karyawan
// (sekaligus mengumpulkan email untuk verifikasi lupa password di kemudian
// hari), maupun ganti password mandiri oleh Admin/Pimpinan yang sudah login.
const changePassword = async (req, res) => {
  const { oldPassword, newPassword, email } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return failure(res, {
      statusCode: 422,
      message: 'Password baru minimal 8 karakter.',
    });
  }

  const isKaryawan = req.actorType === ROLES.KARYAWAN;
  const account = isKaryawan
    ? await User.findByPk(req.user.id)
    : await AdminAccount.findByPk(req.user.id);

  if (!account) {
    return failure(res, { statusCode: 404, message: 'Akun tidak ditemukan.' });
  }

  const isOldPasswordValid = await bcrypt.compare(oldPassword || '', account.password);
  if (!isOldPasswordValid) {
    return failure(res, { statusCode: 401, message: 'Password lama tidak sesuai.' });
  }

  // Email pemulihan WAJIB dimiliki setiap akun karyawan. Kalau request ini
  // menyertakan email baru, pakai itu; kalau tidak, akun harus sudah
  // punya email tercatat sebelumnya — kalau dua-duanya kosong, tolak.
  if (isKaryawan) {
    const nextEmail = email !== undefined && email !== null && email !== '' ? email : account.email;
    if (!nextEmail) {
      return failure(res, {
        statusCode: 422,
        message: 'Email wajib diisi untuk keperluan pemulihan password.',
      });
    }
    if (!EMAIL_REGEX.test(nextEmail)) {
      return failure(res, { statusCode: 422, message: 'Format email tidak valid.' });
    }
    account.email = nextEmail;
  }

  account.password = await bcrypt.hash(newPassword, 10);
  account.is_first_login = false;
  await account.save();

  await logActivity(req, 'CHANGE_PASSWORD', 'Pengguna mengganti password sendiri');

  return success(res, {
    message: 'Password berhasil diperbarui.',
    data: { email: isKaryawan ? account.email : undefined },
  });
};

// POST /api/auth/email
// Melengkapi/memperbarui email pemulihan TANPA mengganti password.
// Dipakai untuk karyawan yang is_first_login-nya sudah false (jadi tidak
// lagi melewati layar ganti password) tapi akunnya masih belum punya email
// tercatat — misalnya akun lama dari sebelum fitur ini ditambahkan.
const updateEmail = async (req, res) => {
  if (req.actorType !== ROLES.KARYAWAN) {
    return failure(res, {
      statusCode: 403,
      message: 'Hanya akun karyawan yang memerlukan email pemulihan.',
    });
  }

  const { email } = req.body;
  if (!email || !EMAIL_REGEX.test(email)) {
    return failure(res, { statusCode: 422, message: 'Format email tidak valid.' });
  }

  const user = await User.findByPk(req.user.id);
  if (!user) return failure(res, { statusCode: 404, message: 'Akun tidak ditemukan.' });

  user.email = email;
  await user.save();

  await logActivity(req, 'UPDATE_EMAIL', 'Karyawan memperbarui email pemulihan password');

  return success(res, { message: 'Email berhasil disimpan.', data: { email: user.email } });
};

// GET /api/auth/me
const me = async (req, res) => {
  const isKaryawan = req.actorType === ROLES.KARYAWAN;
  const account = isKaryawan
    ? await User.findByPk(req.user.id)
    : await AdminAccount.findByPk(req.user.id);

  if (!account) {
    return failure(res, { statusCode: 404, message: 'Pengguna tidak ditemukan.' });
  }
  const safe = account.toSafeJSON();
  return success(res, { data: isKaryawan ? { ...safe, role: ROLES.KARYAWAN } : safe });
};

// POST /api/auth/logout
const logout = async (req, res) => {
  await logActivity(req, 'LOGOUT', `${req.user.name} logout`);
  return success(res, { message: 'Logout berhasil.' });
};

module.exports = { login, adminLogin, refreshToken, changePassword, updateEmail, me, logout };
