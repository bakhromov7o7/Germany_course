const express = require("express");
const router = express.Router();
const {
  startQuiz,
  getQuestion,
  submitAnswer,
  getMyAttempts,
  getMistakes,
} = require("../controllers/quiz");
const { protect } = require("../middlewares/auth");

router.use(protect);

router.post("/start", startQuiz);
router.get("/my-attempts", getMyAttempts);
router.get("/mistakes", getMistakes);
router.get("/:id/question", getQuestion);
router.post("/answer", submitAnswer);

module.exports = router;
