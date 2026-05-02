const jwt = require('jsonwebtoken');
const ApiResponse = require('../utils/response');
const { findById } = require('../../repositories/users');

/**
 * Protect routes with JWT
 */
const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return ApiResponse.error(res, 'Not authorized to access this route', 401);
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from DB
    const user = await findById(decoded.id);
    if (!user) {
      return ApiResponse.error(res, 'User no longer exists', 401);
    }

    if (!user.is_active) {
      return ApiResponse.error(res, 'User account is deactivated', 403);
    }

    // Add user to request
    req.user = user;
    next();
  } catch (error) {
    console.error('[Auth Middleware]', error);
    return ApiResponse.error(res, 'Not authorized', 401);
  }
};

/**
 * Restrict access to specific roles
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return ApiResponse.error(
        res,
        `User role ${req.user.role} is not authorized to access this route`,
        403
      );
    }
    next();
  };
};

module.exports = { protect, authorize };
