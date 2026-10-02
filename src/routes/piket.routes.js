const router = require('express').Router();
const asyncHandler = require('../middlewares/asyncHandler');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { ROLES } = require('../utils/constants');
const ctrl = require('../controllers/piket.controller');
const swapCtrl = require('../controllers/piketSwap.controller');

router.use(authenticate);

router.get('/', authorize(ROLES.ADMIN, ROLES.PIMPINAN), asyncHandler(ctrl.getAll));
router.get('/me', authorize(ROLES.PEGAWAI), asyncHandler(ctrl.myPiket));

// Tukar jadwal piket (admin-mediated, tanpa pengajuan dari app mobile).
// Rute /swaps didaftarkan sebelum /:id agar tidak tertangkap sebagai id.
router.get('/swaps', authorize(ROLES.ADMIN, ROLES.PIMPINAN), asyncHandler(swapCtrl.getAll));
router.post('/:id/swap', authorize(ROLES.ADMIN), asyncHandler(swapCtrl.requestSwap));
router.put('/swaps/:swapId/agree', authorize(ROLES.ADMIN), asyncHandler(swapCtrl.markAgreed));
router.put('/swaps/:swapId/decision', authorize(ROLES.ADMIN), asyncHandler(swapCtrl.decide));
router.delete('/swaps/:swapId', authorize(ROLES.ADMIN), asyncHandler(swapCtrl.cancel));

router.post('/', authorize(ROLES.ADMIN), asyncHandler(ctrl.assign));
router.post('/:id/notify', authorize(ROLES.ADMIN), asyncHandler(ctrl.notify));
router.delete('/:id', authorize(ROLES.ADMIN), asyncHandler(ctrl.remove));

module.exports = router;
