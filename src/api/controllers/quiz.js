const ApiResponse = require('../utils/response');
const quizRepo = require('../../repositories/quiz');
const topicRepo = require('../../repositories/topics');
const materialRepo = require('../../repositories/materials');
const openaiService = require('../../services/openai-service');

/**
 * @desc    Start a quiz for a topic
 * @route   POST /api/v1/quiz/start
 * @access  Private
 */
exports.startQuiz = async (req, res) => {
  try {
    const { topicId } = req.body;
    if (!topicId) {
      return ApiResponse.error(res, 'Topic ID is required', 400);
    }

    const topic = await topicRepo.getTopicById(topicId);
    if (!topic) {
      return ApiResponse.error(res, 'Topic not found', 404);
    }

    // Check student access
    if (req.user.role === 'student') {
      const hasAccess = await topicRepo.studentHasTopicAccess(req.user.id, topicId);
      if (!hasAccess) {
        return ApiResponse.error(res, 'Not authorized to access this topic', 403);
      }
    }

    const chunks = await materialRepo.getKnowledgeChunks(topicId);
    if (!chunks.length) {
      return ApiResponse.error(res, 'No material available for this topic yet', 400);
    }

    // Generate questions via AI
    const questionCount = 5; // Default
    const questions = await openaiService.generateQuiz({
      topic,
      chunks,
      count: questionCount
    });

    const attempt = await quizRepo.createQuizAttempt({
      studentUserId: req.user.id,
      topicId,
      employeeUserId: topic.employee_user_id,
      questions
    });

    return ApiResponse.success(res, {
      attemptId: attempt.id,
      totalQuestions: questions.length
    }, 'Quiz started');
  } catch (error) {
    console.error('[Quiz Controller]', error);
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

    if (!attempt || attempt.student_user_id !== req.user.id) {
      return ApiResponse.error(res, 'Quiz attempt not found', 404);
    }

    if (attempt.finished_at) {
      return ApiResponse.error(res, 'Quiz already finished', 400);
    }

    const question = await quizRepo.getNextUnansweredQuestion(attemptId);
    if (!question) {
      // If no more questions, finalize
      const finalized = await quizRepo.finalizeAttempt(attemptId);
      return ApiResponse.success(res, { finished: true, result: finalized }, 'Quiz completed');
    }

    return ApiResponse.success(res, {
      id: question.id,
      order: question.question_order,
      text: question.question_text
    });
  } catch (error) {
    console.error('[Quiz Controller]', error);
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
    const { questionId, answer } = req.body;
    if (!questionId || !answer) {
      return ApiResponse.error(res, 'Question ID and answer are required', 400);
    }

    // Get question details to know the attempt and topic
    // We might need a repo function to get question with attempt context
    const questionResult = await quizRepo.getAttemptSummaryByQuestionId(questionId); // Need to implement this or similar
    if (!questionResult) {
      return ApiResponse.error(res, 'Question not found', 404);
    }

    const { question, attempt } = questionResult;

    if (attempt.student_user_id !== req.user.id) {
      return ApiResponse.error(res, 'Not authorized', 403);
    }

    const grade = await openaiService.gradeQuizAnswer({
      topicTitle: attempt.topic_title,
      question: question.question_text,
      expectedAnswer: question.expected_answer,
      studentAnswer: answer
    });

    const updatedQuestion = await quizRepo.saveQuestionAnswer({
      questionId,
      studentAnswer: answer,
      isCorrect: grade.correct,
      feedbackText: grade.feedback
    });

    return ApiResponse.success(res, updatedQuestion, 'Answer submitted');
  } catch (error) {
    console.error('[Quiz Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};
