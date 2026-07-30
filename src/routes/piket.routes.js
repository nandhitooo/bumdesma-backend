const router = require('express').Router();
const asyncHandler = require('../middlewares/asyncHandler');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const { ROLES } = require('../utils/constants');
const ctrl = require('../controllers/piket.controller');

router.use(authenticate);

router.get('/', authorize(ROLES.ADMIN, ROLES.PIMPINAN), asyncHandler(ctrl.getAll));
router.get('/me', authorize(ROLES.KARYAWAN), asyncHandler(ctrl.myPiket));
router.post('/', authorize(ROLES.ADMIN), asyncHandler(ctrl.assign));
router.delete('/:id', authorize(ROLES.ADMIN), asyncHandler(ctrl.remove));

module.exports = router;
