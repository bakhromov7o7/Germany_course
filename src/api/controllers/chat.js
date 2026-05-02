const ApiResponse = require('../utils/response');
const stateRepo = require('../../repositories/state');
const openaiService = require('../../services/openai-service');

/**
 * @desc    Get chat history
 * @route   GET /api/v1/chat/history
 * @access  Private
 */
exports.getChatHistory = async (req, res) => {
  try {
    const state = await stateRepo.getUserState(req.user.id);
    return ApiResponse.success(res, state?.german_chat_history || []);
  } catch (error) {
    console.error('[Chat Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Send message and get AI response
 * @route   POST /api/v1/chat/message
 * @access  Private
 */
exports.sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return ApiResponse.error(res, 'Message is required', 400);
    }

    const state = await stateRepo.getUserState(req.user.id);
    const history = state?.german_chat_history || [];

    // Call OpenAI service
    const response = await openaiService.generateGermanChatResponse(message, history);

    // Update history
    const updatedHistory = [
      ...history,
      { role: 'user', content: message, timestamp: new Date() },
      { role: 'assistant', content: response, timestamp: new Date() }
    ].slice(-20); // Keep last 20 messages

    await stateRepo.setGermanChatHistory(req.user.id, updatedHistory);

    return ApiResponse.success(res, {
      response,
      history: updatedHistory
    });
  } catch (error) {
    console.error('[Chat Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Clear chat history
 * @route   DELETE /api/v1/chat/history
 * @access  Private
 */
exports.clearHistory = async (req, res) => {
  try {
    await stateRepo.setGermanChatHistory(req.user.id, []);
    return ApiResponse.success(res, null, 'Chat history cleared');
  } catch (error) {
    console.error('[Chat Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};
