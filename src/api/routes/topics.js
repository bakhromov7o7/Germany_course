const express = require('express');
const router = express.Router();
const { getTopics, createTopic, getTopic, addTextMaterial } = require('../controllers/topics');
const { protect, authorize } = require('../middlewares/auth');

router.use(protect);

router.route('/')
  .get(getTopics)
  .post(authorize('employee', 'superadmin'), createTopic);

router.route('/:id')
  .get(getTopic);

router.post('/:id/materials/text', authorize('employee', 'superadmin'), addTextMaterial);

module.exports = router;
