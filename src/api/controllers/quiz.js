const ApiResponse = require("../utils/response");
const quizRepo = require("../../repositories/quiz");
const topicRepo = require("../../repositories/topics");
const materialRepo = require("../../repositories/materials");
const openaiService = require("../../services/openai-service");
const { config } = require("../../config");

/**
 * @desc    Start a quiz for a topic
 * @route   POST /api/v1/quiz/start
 * @access  Private
 */
exports.startQuiz = async (req, res) => {
  try {
    const { topicId, count, language = "uz" } = req.body;
    if (!topicId) {
      return ApiResponse.error(res, "Mavzu ID kiritilishi shart", 400);
    }

    const topic = await topicRepo.getTopicById(topicId);
    if (!topic) {
      return ApiResponse.error(res, "Mavzu topilmadi", 404);
    }

    const chunks = await materialRepo.getKnowledgeChunks(topicId);
    const effectiveChunks = chunks.length
      ? chunks
      : [
          `${topic.title}. ${topic.description || "Nemis tili grammatikasi va amaliyot mavzusi."}`,
        ];

    const questionCount = Number(count) || config.quizQuestionCount || 5;
    const questions = await openaiService.generateQuiz({
      topic,
      chunks: effectiveChunks,
      count: questionCount,
      languageCode: language,
    });

    if (!questions.length) {
      return ApiResponse.error(res, "Savollar generatsiya qilib bo'lmadi", 400);
    }

    const attempt = await quizRepo.createQuizAttempt({
      studentUserId: req.user.id,
      topicId,
      employeeUserId: topic.employee_user_id || req.user.id,
      questions,
    });

    const firstQuestion = await quizRepo.getNextUnansweredQuestion(attempt.id);

    return ApiResponse.success(
      res,
      {
        attemptId: attempt.id,
        topicId: topic.id,
        topicTitle: topic.title,
        totalQuestions: questions.length,
        question: firstQuestion
          ? {
              id: firstQuestion.id,
              order: firstQuestion.question_order,
              text: firstQuestion.question_text,
            }
          : null,
      },
      "Test boshlandi",
    );
  } catch (error) {
    console.error("[Quiz Controller - startQuiz]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get next unanswered question
 * @route   GET /api/v1/quiz/:id/question
 * @access  Private
 */
exports.getQuestion = async (req, res) => {
  try {
    const attemptId = req.params.id;
    const attempt = await quizRepo.getAttemptById(attemptId);

    if (!attempt) {
      return ApiResponse.error(res, "Test urinishi topilmadi", 404);
    }

    if (attempt.finished_at) {
      const summary = await quizRepo.getAttemptSummary(attemptId);
      return ApiResponse.success(
        res,
        { finished: true, result: summary.attempt, questions: summary.questions },
        "Test yakunlangan",
      );
    }

    const question = await quizRepo.getNextUnansweredQuestion(attemptId);
    if (!question) {
      const finalized = await quizRepo.finalizeAttempt(attemptId);
      const summary = await quizRepo.getAttemptSummary(attemptId);
      return ApiResponse.success(
        res,
        { finished: true, result: finalized, questions: summary.questions },
        "Test yakunlandi",
      );
    }

    return ApiResponse.success(res, {
      finished: false,
      totalQuestions: attempt.total_questions,
      question: {
        id: question.id,
        order: question.question_order,
        text: question.question_text,
      },
    });
  } catch (error) {
    console.error("[Quiz Controller - getQuestion]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Submit answer for a question
 * @route   POST /api/v1/quiz/answer
 * @access  Private
 */
exports.submitAnswer = async (req, res) => {
  try {
    const { questionId, answer, language = "uz" } = req.body;
    if (!questionId || answer === undefined) {
      return ApiResponse.error(res, "Savol ID va javob kiritilishi shart", 400);
    }

    const questionResult = await quizRepo.getAttemptSummaryByQuestionId(questionId);
    if (!questionResult || !questionResult.question || !questionResult.attempt) {
      return ApiResponse.error(res, "Savol topilmadi", 404);
    }

    const { question, attempt } = questionResult;

    const grade = await openaiService.gradeQuizAnswer({
      topicTitle: attempt.topic_title,
      question: question.question_text,
      expectedAnswer: question.expected_answer,
      studentAnswer: String(answer).trim(),
      languageCode: language,
    });

    const updatedQuestion = await quizRepo.saveQuestionAnswer({
      questionId,
      studentAnswer: String(answer).trim(),
      isCorrect: grade.correct,
      feedbackText: grade.feedback,
    });

    let recovery = null;
    if (!grade.correct) {
      try {
        const topic = await topicRepo.getTopicById(attempt.topic_id);
        const chunks = await materialRepo.getKnowledgeChunks(attempt.topic_id);
        recovery = await openaiService.generateQuizRecovery({
          topic: topic || { title: attempt.topic_title },
          chunks,
          question: question.question_text,
          expectedAnswer: question.expected_answer,
          languageCode: language,
        });
      } catch (recErr) {
        console.error("[Quiz Recovery Error]", recErr);
      }
    }

    const nextQuestion = await quizRepo.getNextUnansweredQuestion(attempt.id);
    let finalizedResult = null;
    let allQuestions = null;

    if (!nextQuestion) {
      finalizedResult = await quizRepo.finalizeAttempt(attempt.id);
      const summary = await quizRepo.getAttemptSummary(attempt.id);
      allQuestions = summary.questions;
    }

    return ApiResponse.success(
      res,
      {
        question: updatedQuestion,
        isCorrect: grade.correct,
        feedback: grade.feedback,
        expectedAnswer: question.expected_answer,
        recovery,
        finished: !nextQuestion,
        nextQuestion: nextQuestion
          ? {
              id: nextQuestion.id,
              order: nextQuestion.question_order,
              text: nextQuestion.question_text,
            }
          : null,
        result: finalizedResult,
        questions: allQuestions,
      },
      "Javob tekshirildi",
    );
  } catch (error) {
    console.error("[Quiz Controller - submitAnswer]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get current user's quiz attempts
 * @route   GET /api/v1/quiz/my-attempts
 * @access  Private
 */
exports.getMyAttempts = async (req, res) => {
  try {
    const attempts = await quizRepo.listStudentAttempts(req.user.id, 30);
    return ApiResponse.success(res, attempts);
  } catch (error) {
    console.error("[Quiz Controller - getMyAttempts]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get current user's quiz mistakes
 * @route   GET /api/v1/quiz/mistakes
 * @access  Private
 */
exports.getMistakes = async (req, res) => {
  try {
    const topicId = req.query.topicId ? Number(req.query.topicId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 25;
    const mistakes = await quizRepo.listStudentMistakes({
      studentUserId: req.user.id,
      topicId,
      limit,
    });
    return ApiResponse.success(res, mistakes);
  } catch (error) {
    console.error("[Quiz Controller - getMistakes]", error);
    return ApiResponse.error(res, error.message);
  }
};
