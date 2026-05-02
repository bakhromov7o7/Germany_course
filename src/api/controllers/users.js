const ApiResponse = require('../utils/response');
const userRepo = require('../../repositories/users');

/**
 * @desc    Get all users (Staff only)
 * @route   GET /api/v1/users
 * @access  Private (Staff only)
 */
exports.getUsers = async (req, res) => {
  try {
    const { role } = req.query;
    
    let users;
    if (role) {
      users = await userRepo.listManagedUsersByRole({ 
        createdByUserId: req.user.id, 
        role 
      });
    } else {
      // Superadmins can see staff
      if (req.user.role === 'superadmin') {
        users = await userRepo.listStaffMembers();
      } else {
        // Employees see students
        users = await userRepo.listAccessibleStudentsForEmployee(req.user.id);
      }
    }
    
    return ApiResponse.success(res, users);
  } catch (error) {
    console.error('[User Controller]', error);
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
      return ApiResponse.error(res, 'User not found', 404);
    }
    return ApiResponse.success(res, user);
  } catch (error) {
    console.error('[User Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Create/Update employee (Superadmin only)
 * @route   POST /api/v1/users/employee
 * @access  Private (Superadmin only)
 */
exports.manageEmployee = async (req, res) => {
  try {
    const { telegramUserId, fullName, username } = req.body;

    if (!telegramUserId || !fullName) {
      return ApiResponse.error(res, 'Telegram ID and Full Name are required', 400);
    }

    const employee = await userRepo.createManagedUser({
      telegramUserId,
      fullName,
      username,
      role: 'employee',
      createdByUserId: req.user.id
    });

    return ApiResponse.success(res, employee, 'Employee managed successfully');
  } catch (error) {
    console.error('[User Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};
