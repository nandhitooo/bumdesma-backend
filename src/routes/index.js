const router = require('express').Router();

router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/attendance', require('./attendance.routes'));
router.use('/leaves', require('./leave.routes'));
router.use('/piket', require('./piket.routes'));
router.use('/reports', require('./report.routes'));
router.use('/settings', require('./setting.routes'));
router.use('/activity-logs', require('./activityLog.routes'));
router.use('/notifications', require('./notification.routes'));

router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Sistem Manajemen Absensi Karyawan Berbasis QR Code - BUMDESMA Podo Rukun LKD API',
    version: '1.0.0',
  });
});

module.exports = router;
