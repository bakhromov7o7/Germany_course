const jwt = require("jsonwebtoken");
const ApiResponse = require("../utils/response");
const { findById } = require("../../repositories/users");
const { config } = require("../../config");

/**
 * Protect routes with JWT
 */
const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return ApiResponse.error(res, "Tizimga kirish talab etiladi", 401);
    }

    const decoded = jwt.verify(token, config.jwtSecret);

    const user = await findById(decoded.id);
    if (!user) {
      return ApiResponse.error(res, "Foydalanuvchi topilmadi", 401);
    }

    if (!user.is_active) {
      return ApiResponse.error(res, "Foydalanuvchi hisobi faol emas", 403);
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("[Auth Middleware]", error.message);
    return ApiResponse.error(res, "Avtorizatsiya xatosi", 401);
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
        `Sizning rolingiz (${req.user.role}) bu amal uchun ruxsatga ega emas`,
        403,
      );
    }
    next();
  };
};

module.exports = { protect, authorize };
