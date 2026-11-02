const express = require("express");
const router = express.Router();
const {
  getTopics,
  createTopic,
  updateTopic,
  deleteTopic,
  getTopic,
  addTextMaterial,
  deleteMaterial,
  askTopicQuestion,
} = require("../controllers/topics");
const { protect, authorize } = require("../middlewares/auth");

router.use(protect);

router
  .route("/")
  .get(getTopics)
  .post(authorize("employee", "superadmin"), createTopic);

router
  .route("/:id")
  .get(getTopic)
  .patch(authorize("employee", "superadmin"), updateTopic)
  .delete(authorize("employee", "superadmin"), deleteTopic);

router.post(
  "/:id/materials/text",
  authorize("employee", "superadmin"),
  addTextMaterial,
);

router.delete(
  "/:id/materials/:materialId",
  authorize("employee", "superadmin"),
  deleteMaterial,
);

router.post("/:id/ask", askTopicQuestion);

module.exports = router;
