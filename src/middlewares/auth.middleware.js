const { verifyAccessToken } = require('../utils/jwt');
const { failure } = require('../utils/response');
const { User } = require('../models');

/**
 * Memverifikasi JWT pada header Authorization: Bearer <token>
 * dan melampirkan data pengguna (tanpa password) ke req.user
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return failure(res, {
        statusCode: 401,
        message: 'Token autentikasi tidak ditemukan. Silakan login terlebih dahulu.',
      });
    }

    const decoded = verifyAccessToken(token);
    const user = await User.findByPk(decoded.id);

    if (!user || user.status !== 'active') {
      return failure(res, {
        statusCode: 401,
        message: 'Akun tidak ditemukan atau sudah dinonaktifkan.',
      });
    }

    req.user = user.toSafeJSON();
    next();
  } catch (err) {
    return failure(res, {
      statusCode: 401,
      message: 'Token tidak valid atau sudah kedaluwarsa.',
    });
  }
}

/**
 * Membatasi akses endpoint hanya untuk role tertentu.
 * Contoh: authorize('admin'), authorize('admin', 'pimpinan')
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return failure(res, { statusCode: 401, message: 'Belum terautentikasi.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return failure(res, {
        statusCode: 403,
        message: 'Anda tidak memiliki akses untuk melakukan aksi ini.',
      });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
