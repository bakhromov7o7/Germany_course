const express = require('express');
const router = express.Router();
const { telegramLogin, getMe } = require('../controllers/auth');
const { protect } = require('../middlewares/auth');

router.post('/telegram', telegramLogin);
router.get('/me', protect, getMe);

module.exports = router;
