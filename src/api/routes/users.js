const express = require("express");
const router = express.Router();
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
} = require("../controllers/users");
const { protect, authorize } = require("../middlewares/auth");

router.use(protect);
router.use(authorize("employee", "superadmin"));

router.route("/").get(getUsers).post(createUser);
router.post("/employee", createUser);

router.route("/:id").get(getUser).patch(updateUser).delete(deleteUser);

module.exports = router;
