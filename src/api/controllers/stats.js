const ApiResponse = require('../utils/response');
const quizRepo = require('../../repositories/quiz');

/**
 * @desc    Get dashboard summary stats
 * @route   GET /api/v1/stats/summary
 * @access  Private (Staff only)
 */
exports.getSummary = async (req, res) => {
  try {
    const recentResults = await quizRepo.listRecentQuizResultsForEmployee(req.user.id, 10);
    const studentStats = await quizRepo.listEmployeeStudentStats(req.user.id);
    
    // Calculate overview
    const totalStudents = studentStats.length;
    const testedStudents = studentStats.filter(s => parseInt(s.attempt_count) > 0).length;
    const totalAttempts = studentStats.reduce((sum, s) => sum + parseInt(s.attempt_count), 0);
    
    const overallCorrect = studentStats.reduce((sum, s) => sum + parseInt(s.correct_answers), 0);
    const overallTotal = studentStats.reduce((sum, s) => sum + parseInt(s.total_answers), 0);
    const overallAccuracy = overallTotal > 0 ? (overallCorrect / overallTotal * 100).toFixed(1) : 0;

    return ApiResponse.success(res, {
      overview: {
        totalStudents,
        testedStudents,
        totalAttempts,
        overallAccuracy: `${overallAccuracy}%`
      },
      recentResults,
      studentPerformance: studentStats.slice(0, 10) // Top 10 by default sorting (weakest first in repo)
    });
  } catch (error) {
    console.error('[Stats Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get detailed performance for all students
 * @route   GET /api/v1/stats/students
 * @access  Private (Staff only)
 */
exports.getStudentPerformance = async (req, res) => {
  try {
    const stats = await quizRepo.listEmployeeStudentStats(req.user.id);
    return ApiResponse.success(res, stats);
  } catch (error) {
    console.error('[Stats Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get specific quiz attempt details
 * @route   GET /api/v1/stats/quiz/:id
 * @access  Private (Staff only)
 */
exports.getQuizDetails = async (req, res) => {
  try {
    const summary = await quizRepo.getAttemptSummary(req.params.id);
    if (!summary.attempt) {
      return ApiResponse.error(res, 'Quiz attempt not found', 404);
    }
    return ApiResponse.success(res, summary);
  } catch (error) {
    console.error('[Stats Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};
