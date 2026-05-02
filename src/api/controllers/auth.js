const jwt = require('jsonwebtoken');
const ApiResponse = require('../utils/response');
const { findByTelegramUserId } = require('../../repositories/users');

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });
};

/**
 * @desc    Login via Telegram data
 * @route   POST /api/v1/auth/telegram
 * @access  Public
 */
exports.telegramLogin = async (req, res) => {
  try {
    const { id, first_name, last_name, username, photo_url, auth_date, hash } = req.body;

    // TODO: Implement Telegram Hash Verification
    // For now, we trust the ID if it's a dev environment or we'll implement the check later
    
    if (!id) {
      return ApiResponse.error(res, 'Invalid Telegram data', 400);
    }

    let user = await findByTelegramUserId(id);

    if (!user) {
      return ApiResponse.error(res, 'User not found. Please start the bot first.', 404);
    }

    const token = signToken(user.id);

    return ApiResponse.success(res, {
      token,
      user: {
        id: user.id,
        telegram_id: user.telegram_user_id,
        full_name: user.full_name,
        role: user.role,
      }
    });
  } catch (error) {
    console.error('[Auth Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/v1/auth/me
 * @access  Private
 */
exports.getMe = async (req, res) => {
  return ApiResponse.success(res, { user: req.user });
};
