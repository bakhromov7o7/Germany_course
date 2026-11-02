const express = require("express");
const router = express.Router();
const {
  login,
  register,
  getMe,
  updateProfile,
} = require("../controllers/auth");
const { protect } = require("../middlewares/auth");

router.post("/login", login);
router.post("/register", register);
router.get("/me", protect, getMe);
router.patch("/profile", protect, updateProfile);

module.exports = router;
