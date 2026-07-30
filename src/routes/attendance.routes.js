const router = require('express').Router();
const asyncHandler = require('../middlewares/asyncHandler');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { ROLES } = require('../utils/constants');
const ctrl = require('../controllers/attendance.controller');

router.use(authenticate);

// Karyawan - scan QR untuk absen masuk/pulang (mobile app)
router.post('/scan', authorize(ROLES.KARYAWAN), asyncHandler(ctrl.scan));
router.get('/me', authorize(ROLES.KARYAWAN), asyncHandler(ctrl.myAttendance));

// Admin & Pimpinan - monitoring
router.get('/', authorize(ROLES.ADMIN, ROLES.PIMPINAN), asyncHandler(ctrl.getAll));
router.get(
  '/dashboard-summary',
  authorize(ROLES.ADMIN, ROLES.PIMPINAN),
  asyncHandler(ctrl.dashboardSummary)
);

// Admin - koreksi manual
router.put('/:id', authorize(ROLES.ADMIN), asyncHandler(ctrl.correctManually));

module.exports = router;
