const ApiResponse = require("../utils/response");
const quizRepo = require("../../repositories/quiz");
const topicRepo = require("../../repositories/topics");
const dictRepo = require("../../repositories/dictionaries");
const userRepo = require("../../repositories/users");
const { config } = require("../../config");

/**
 * @desc    Get comprehensive dashboard summary stats for Teacher & Admin
 * @route   GET /api/v1/stats/summary
 * @access  Private (Employee & Superadmin)
 */
exports.getSummary = async (req, res) => {
  try {
    const [
      recentResults,
      studentStats,
      topics,
      dictionaries,
      allUsers,
      recentMistakes,
    ] = await Promise.all([
      quizRepo.listRecentQuizResultsForEmployee(req.user.id, 25),
      quizRepo.listEmployeeStudentStats(req.user.id),
      topicRepo.listTopicsByEmployeeWithStats(req.user.id),
      dictRepo.listAllDictionaries(),
      userRepo.listUsers(),
      quizRepo.listRecentMistakesForStaff(20),
    ]);

    const totalStudents = studentStats.length;
    const totalTeachers = allUsers.filter(
      (u) => u.role === "employee" || u.role === "superadmin",
    ).length;
    const testedStudents = studentStats.filter(
      (s) => Number(s.attempt_count) > 0,
    ).length;
    const inactiveStudents = Math.max(0, totalStudents - testedStudents);

    const totalAttempts = studentStats.reduce(
      (sum, s) => sum + Number(s.attempt_count),
      0,
    );
    const overallCorrect = studentStats.reduce(
      (sum, s) => sum + Number(s.correct_answers),
      0,
    );
    const overallTotal = studentStats.reduce(
      (sum, s) => sum + Number(s.total_answers),
      0,
    );
    const overallWrong = Math.max(0, overallTotal - overallCorrect);

    const overallAccuracy =
      overallTotal > 0
        ? Number(((overallCorrect / overallTotal) * 100).toFixed(1))
        : 0;

    const totalMaterials = topics.reduce(
      (sum, t) => sum + Number(t.material_count || 0),
      0,
    );
    const totalChunks = topics.reduce(
      (sum, t) => sum + Number(t.chunk_count || 0),
      0,
    );
    const totalWords = dictionaries.reduce(
      (sum, d) => sum + Number(d.entry_count || 0),
      0,
    );

    const threshold = config.weakStudentThresholdPercent || 70;
    const weakStudents = studentStats.filter(
      (s) => Number(s.attempt_count) > 0 && Number(s.avg_percent) < threshold,
    );
    const topStudents = studentStats
      .filter((s) => Number(s.attempt_count) > 0 && Number(s.avg_percent) >= 80)
      .sort((a, b) => Number(b.avg_percent) - Number(a.avg_percent));

    return ApiResponse.success(res, {
      overview: {
        totalStudents,
        testedStudents,
        inactiveStudents,
        totalTeachers,
        totalTopics: topics.length,
        totalMaterials,
        totalChunks,
        totalDictionaries: dictionaries.length,
        totalWords,
        totalAttempts,
        totalQuestionsAnswered: overallTotal,
        totalCorrectAnswers: overallCorrect,
        totalWrongAnswers: overallWrong,
        overallAccuracy: `${overallAccuracy}%`,
        overallAccuracyValue: overallAccuracy,
        weakStudentsCount: weakStudents.length,
        topStudentsCount: topStudents.length,
      },
      topicBreakdown: topics,
      recentResults,
      recentMistakes,
      weakStudents,
      topStudents,
      studentPerformance: studentStats,
    });
  } catch (error) {
    console.error("[Stats Controller - getSummary]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get detailed performance for all students
 * @route   GET /api/v1/stats/students
 * @access  Private (Employee & Superadmin)
 */
exports.getStudentPerformance = async (req, res) => {
  try {
    const { weakOnly } = req.query;
    const stats = await quizRepo.listEmployeeStudentStats(req.user.id);
    if (weakOnly === "true") {
      const threshold = config.weakStudentThresholdPercent || 70;
      return ApiResponse.success(
        res,
        stats.filter(
          (s) => Number(s.attempt_count) > 0 && Number(s.avg_percent) < threshold,
        ),
      );
    }
    return ApiResponse.success(res, stats);
  } catch (error) {
    console.error("[Stats Controller - getStudentPerformance]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get full individual student profile, attempts, and mistakes
 * @route   GET /api/v1/stats/student/:id
 * @access  Private (Employee & Superadmin)
 */
exports.getStudentDetailStats = async (req, res) => {
  try {
    const studentId = Number(req.params.id);
    const [student, attempts, mistakes] = await Promise.all([
      userRepo.findById(studentId),
      quizRepo.listStudentAttempts(studentId, 50),
      quizRepo.listStudentMistakes({ studentUserId: studentId, limit: 50 }),
    ]);

    if (!student) {
      return ApiResponse.error(res, "O'quvchi topilmadi", 404);
    }

    const totalAttempts = attempts.length;
    const totalCorrect = attempts.reduce(
      (sum, a) => sum + Number(a.correct_answers || 0),
      0,
    );
    const totalQuestions = attempts.reduce(
      (sum, a) => sum + Number(a.total_questions || 0),
      0,
    );
    const avgPercent =
      totalQuestions > 0
        ? Number(((totalCorrect / totalQuestions) * 100).toFixed(1))
        : 0;

    return ApiResponse.success(res, {
      student,
      summary: {
        totalAttempts,
        totalCorrect,
        totalQuestions,
        totalMistakes: mistakes.length,
        avgPercent,
      },
      attempts,
      mistakes,
    });
  } catch (error) {
    console.error("[Stats Controller - getStudentDetailStats]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get specific quiz attempt details
 * @route   GET /api/v1/stats/quiz/:id
 * @access  Private (Authenticated user)
 */
exports.getQuizDetails = async (req, res) => {
  try {
    const summary = await quizRepo.getAttemptSummary(req.params.id);
    if (!summary.attempt) {
      return ApiResponse.error(res, "Test natijasi topilmadi", 404);
    }
    return ApiResponse.success(res, summary);
  } catch (error) {
    console.error("[Stats Controller - getQuizDetails]", error);
    return ApiResponse.error(res, error.message);
  }
};
