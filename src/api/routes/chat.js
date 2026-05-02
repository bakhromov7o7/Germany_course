const express = require('express');
const router = express.Router();
const { getChatHistory, sendMessage, clearHistory } = require('../controllers/chat');
const { protect } = require('../middlewares/auth');

router.use(protect);

router.get('/history', getChatHistory);
router.post('/message', sendMessage);
router.delete('/history', clearHistory);

module.exports = router;
