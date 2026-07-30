const router = require('express').Router();
const asyncHandler = require('../middlewares/asyncHandler');
const { authenticate } = require('../middlewares/auth.middleware');
const ctrl = require('../controllers/auth.controller');

router.post('/login', asyncHandler(ctrl.login));
router.post('/refresh-token', asyncHandler(ctrl.refreshToken));
router.post('/change-password', authenticate, asyncHandler(ctrl.changePassword));
router.get('/me', authenticate, asyncHandler(ctrl.me));
router.post('/logout', authenticate, asyncHandler(ctrl.logout));

module.exports = router;
