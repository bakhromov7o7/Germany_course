const ApiResponse = require("../utils/response");
const userRepo = require("../../repositories/users");

/**
 * @desc    Get all users (Employee & Superadmin)
 * @route   GET /api/v1/users
 * @access  Private (Staff only)
 */
exports.getUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const users = await userRepo.listUsers({ role: role || null });
    return ApiResponse.success(res, users);
  } catch (error) {
    console.error("[User Controller - getUsers]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get single user details
 * @route   GET /api/v1/users/:id
 * @access  Private (Staff only)
 */
exports.getUser = async (req, res) => {
  try {
    const user = await userRepo.findById(req.params.id);
    if (!user) {
      return ApiResponse.error(res, "Foydalanuvchi topilmadi", 404);
    }
    return ApiResponse.success(res, user);
  } catch (error) {
    console.error("[User Controller - getUser]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Create new user (Student, Employee, or Superadmin)
 * @route   POST /api/v1/users
 * @access  Private (Employee & Superadmin)
 */
exports.createUser = async (req, res) => {
  try {
    const { fullName, username, phone, password, role = "student" } = req.body;

    if (!fullName || (!username && !phone) || !password) {
      return ApiResponse.error(
        res,
        "Ism-familiya, login (username yoki telefon) va parol kiritilishi shart",
        400,
      );
    }

    if (role === "superadmin" && req.user.role !== "superadmin") {
      return ApiResponse.error(
        res,
        "Faqat Superadmin yangi Superadmin qo'sha oladi",
        403,
      );
    }

    if (username) {
      const existing = await userRepo.findByLogin(username);
      if (existing) {
        return ApiResponse.error(res, "Bu username allaqachon mavjud", 400);
      }
    }

    if (phone) {
      const existing = await userRepo.findByLogin(phone);
      if (existing) {
        return ApiResponse.error(res, "Bu telefon raqam allaqachon mavjud", 400);
      }
    }

    const created = await userRepo.createUser({
      fullName,
      username,
      phone,
      password,
      role,
      createdByUserId: req.user.id,
    });

    return ApiResponse.success(res, created, "Foydalanuvchi qo'shildi", 201);
  } catch (error) {
    console.error("[User Controller - createUser]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Update user (Full name, login, password, role, active status)
 * @route   PATCH /api/v1/users/:id
 * @access  Private (Employee & Superadmin)
 */
exports.updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const { fullName, username, phone, password, role, isActive } = req.body;

    const target = await userRepo.findById(userId);
    if (!target) {
      return ApiResponse.error(res, "Foydalanuvchi topilmadi", 404);
    }

    if (target.role === "superadmin" && req.user.role !== "superadmin") {
      return ApiResponse.error(
        res,
        "Superadmin ma'lumotlarini faqat Superadmin o'zgartira oladi",
        403,
      );
    }

    const updated = await userRepo.updateUser(userId, {
      fullName,
      username,
      phone,
      password,
      role,
      isActive,
    });

    return ApiResponse.success(res, updated, "Foydalanuvchi yangilandi");
  } catch (error) {
    console.error("[User Controller - updateUser]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Delete user
 * @route   DELETE /api/v1/users/:id
 * @access  Private (Employee & Superadmin)
 */
exports.deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;
    if (String(userId) === String(req.user.id)) {
      return ApiResponse.error(res, "O'z hisobingizni o'chira olmaysiz", 400);
    }

    const target = await userRepo.findById(userId);
    if (!target) {
      return ApiResponse.error(res, "Foydalanuvchi topilmadi", 404);
    }

    if (target.role === "superadmin" && req.user.role !== "superadmin") {
      return ApiResponse.error(
        res,
        "Superadmin hisobini o'chirish mumkin emas",
        403,
      );
    }

    await userRepo.deleteUser(userId);
    return ApiResponse.success(res, null, "Foydalanuvchi o'chirildi");
  } catch (error) {
    console.error("[User Controller - deleteUser]", error);
    return ApiResponse.error(res, error.message);
  }
};
