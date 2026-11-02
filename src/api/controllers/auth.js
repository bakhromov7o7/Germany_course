const jwt = require("jsonwebtoken");
const ApiResponse = require("../utils/response");
const {
  createUser,
  findByLogin,
  sanitizeUser,
  updateUser,
} = require("../../repositories/users");
const { getUserState, setPreferredLanguage } = require("../../repositories/state");
const { verifyPassword } = require("../../utils/password");
const { config } = require("../../config");

const signToken = (id) => {
  return jwt.sign({ id }, config.jwtSecret, {
    expiresIn: "30d",
  });
};

/**
 * @desc    Login via Username or Phone + Password
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
exports.login = async (req, res) => {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return ApiResponse.error(
        res,
        "Username/telefon va parol kiritilishi shart",
        400,
      );
    }

    const user = await findByLogin(login);
    if (!user) {
      return ApiResponse.error(
        res,
        "Bunday foydalanuvchi topilmadi",
        401,
      );
    }

    if (!user.is_active) {
      return ApiResponse.error(
        res,
        "Sizning hisobingiz faolsizlantirilgan",
        403,
      );
    }

    if (!verifyPassword(password, user.password_hash)) {
      return ApiResponse.error(res, "Parol noto'g'ri", 401);
    }

    const state = await getUserState(user.id);
    const token = signToken(user.id);

    return ApiResponse.success(
      res,
      {
        token,
        user: {
          ...sanitizeUser(user),
          preferred_language: state?.preferred_language || "uz",
        },
      },
      "Tizimga muvaffaqiyatli kirdingiz",
    );
  } catch (error) {
    console.error("[Auth Controller - Login]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Register a new Student account
 * @route   POST /api/v1/auth/register
 * @access  Public
 */
exports.register = async (req, res) => {
  try {
    const { fullName, username, phone, password } = req.body;

    if (!fullName || (!username && !phone) || !password) {
      return ApiResponse.error(
        res,
        "Ism-familiya, username yoki telefon raqam hamda parol kiritilishi shart",
        400,
      );
    }

    if (String(password).length < 4) {
      return ApiResponse.error(
        res,
        "Parol kamida 4 ta belgidan iborat bo'lishi kerak",
        400,
      );
    }

    if (username) {
      const existingUsername = await findByLogin(username);
      if (existingUsername) {
        return ApiResponse.error(res, "Bu username allaqachon band", 400);
      }
    }

    if (phone) {
      const existingPhone = await findByLogin(phone);
      if (existingPhone) {
        return ApiResponse.error(
          res,
          "Bu telefon raqam allaqachon ro'yxatdan o'tgan",
          400,
        );
      }
    }

    const user = await createUser({
      fullName,
      username,
      phone,
      password,
      role: "student",
    });

    await setPreferredLanguage(user.id, "uz");
    const token = signToken(user.id);

    return ApiResponse.success(
      res,
      {
        token,
        user: {
          ...user,
          preferred_language: "uz",
        },
      },
      "Ro'yxatdan muvaffaqiyatli o'tdingiz",
      201,
    );
  } catch (error) {
    console.error("[Auth Controller - Register]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/v1/auth/me
 * @access  Private
 */
exports.getMe = async (req, res) => {
  try {
    const state = await getUserState(req.user.id);
    return ApiResponse.success(res, {
      user: {
        ...req.user,
        preferred_language: state?.preferred_language || "uz",
      },
    });
  } catch (error) {
    console.error("[Auth Controller - GetMe]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Update current user profile & preferred language
 * @route   PATCH /api/v1/auth/profile
 * @access  Private
 */
exports.updateProfile = async (req, res) => {
  try {
    const { fullName, username, phone, password, preferredLanguage } = req.body;

    const updatedUser = await updateUser(req.user.id, {
      fullName,
      username,
      phone,
      password,
    });

    let prefLang = "uz";
    if (preferredLanguage && ["uz", "de"].includes(preferredLanguage)) {
      const state = await setPreferredLanguage(req.user.id, preferredLanguage);
      prefLang = state?.preferred_language || preferredLanguage;
    } else {
      const state = await getUserState(req.user.id);
      prefLang = state?.preferred_language || "uz";
    }

    return ApiResponse.success(
      res,
      {
        user: {
          ...updatedUser,
          preferred_language: prefLang,
        },
      },
      "Profil yangilandi",
    );
  } catch (error) {
    console.error("[Auth Controller - UpdateProfile]", error);
    return ApiResponse.error(res, error.message);
  }
};
