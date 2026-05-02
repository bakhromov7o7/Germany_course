const express = require('express');
const router = express.Router();
const { getSummary, getStudentPerformance, getQuizDetails } = require('../controllers/stats');
const { protect, authorize } = require('../middlewares/auth');

router.use(protect);
router.use(authorize('employee', 'superadmin'));

router.get('/summary', getSummary);
router.get('/students', getStudentPerformance);
router.get('/quiz/:id', getQuizDetails);

module.exports = router;
