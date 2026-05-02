const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const topicRoutes = require('./topics');
const statsRoutes = require('./stats');
const userRoutes = require('./users');
const dictionaryRoutes = require('./dictionaries');
const chatRoutes = require('./chat');
const quizRoutes = require('./quiz');

router.use('/auth', authRoutes);
router.use('/topics', topicRoutes);
router.use('/stats', statsRoutes);
router.use('/users', userRoutes);
router.use('/dictionaries', dictionaryRoutes);
router.use('/chat', chatRoutes);
router.use('/quiz', quizRoutes);

module.exports = router;
