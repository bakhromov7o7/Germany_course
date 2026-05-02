const ApiResponse = require('../utils/response');
const topicRepo = require('../../repositories/topics');
const materialRepo = require('../../repositories/materials');
const { chunkText } = require('../../utils/chunking');

/**
 * @desc    Get all topics
 * @route   GET /api/v1/topics
 * @access  Private
 */
exports.getTopics = async (req, res) => {
  try {
    let topics;
    if (req.user.role === 'student') {
      topics = await topicRepo.listTopicsForStudent();
    } else {
      // Employees/Superadmins see all their topics with stats
      topics = await topicRepo.listTopicsByEmployeeWithStats(req.user.id);
    }
    
    return ApiResponse.success(res, topics);
  } catch (error) {
    console.error('[Topic Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Create new topic
 * @route   POST /api/v1/topics
 * @access  Private (Staff only)
 */
exports.createTopic = async (req, res) => {
  try {
    const { title, description } = req.body;
    
    if (!title) {
      return ApiResponse.error(res, 'Title is required', 400);
    }

    const topic = await topicRepo.createTopic({
      employeeUserId: req.user.id,
      title,
      description
    });

    return ApiResponse.success(res, topic, 'Topic created successfully', 201);
  } catch (error) {
    console.error('[Topic Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get single topic with materials
 * @route   GET /api/v1/topics/:id
 * @access  Private
 */
exports.getTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const topic = await topicRepo.getTopicById(topicId);

    if (!topic) {
      return ApiResponse.error(res, 'Topic not found', 404);
    }

    // Check access
    if (req.user.role === 'student') {
      const hasAccess = await topicRepo.studentHasTopicAccess(req.user.id, topicId);
      if (!hasAccess) {
        return ApiResponse.error(res, 'Not authorized to access this topic', 403);
      }
    }

    const videos = await materialRepo.getTopicVideos(topicId);
    const chunks = await materialRepo.getKnowledgeChunks(topicId);

    return ApiResponse.success(res, {
      ...topic,
      videos,
      chunks
    });
  } catch (error) {
    console.error('[Topic Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Add text material to topic
 * @route   POST /api/v1/topics/:id/materials/text
 * @access  Private (Staff only)
 */
exports.addTextMaterial = async (req, res) => {
  try {
    const topicId = req.params.id;
    const { title, content } = req.body;

    if (!content) {
      return ApiResponse.error(res, 'Content is required', 400);
    }

    const topic = await topicRepo.getTopicByIdForEmployee(topicId, req.user.id);
    if (!topic) {
      return ApiResponse.error(res, 'Topic not found or access denied', 404);
    }

    const chunks = chunkText(content);
    const material = await materialRepo.saveTextMaterial({
      topicId,
      uploadedByUserId: req.user.id,
      title,
      rawText: content,
      processedText: content, // For now we use raw as processed
      chunks
    });

    return ApiResponse.success(res, material, 'Material added successfully', 201);
  } catch (error) {
    console.error('[Topic Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};
