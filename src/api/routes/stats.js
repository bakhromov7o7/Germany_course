const express = require("express");
const router = express.Router();
const {
  getSummary,
  getStudentPerformance,
  getStudentDetailStats,
  getQuizDetails,
} = require("../controllers/stats");
const { protect, authorize } = require("../middlewares/auth");

router.use(protect);

router.get("/summary", authorize("employee", "superadmin"), getSummary);
router.get("/students", authorize("employee", "superadmin"), getStudentPerformance);
router.get("/student/:id", authorize("employee", "superadmin"), getStudentDetailStats);
router.get("/quiz/:id", getQuizDetails);

module.exports = router;
