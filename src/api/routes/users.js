const express = require('express');
const router = express.Router();
const { getUsers, getUser, manageEmployee } = require('../controllers/users');
const { protect, authorize } = require('../middlewares/auth');

router.use(protect);
router.use(authorize('employee', 'superadmin'));

router.get('/', getUsers);
router.get('/:id', getUser);
router.post('/employee', authorize('superadmin'), manageEmployee);

module.exports = router;
