const ApiResponse = require("../utils/response");
const topicRepo = require("../../repositories/topics");
const materialRepo = require("../../repositories/materials");
const openaiService = require("../../services/openai-service");
const { chunkText, selectRelevantChunks } = require("../../utils/chunking");
const { shortText } = require("../../utils/text");
const { config } = require("../../config");

/**
 * @desc    Get all topics
 * @route   GET /api/v1/topics
 * @access  Private
 */
exports.getTopics = async (req, res) => {
  try {
    let topics;
    if (req.user.role === "student") {
      topics = await topicRepo.listTopicsForStudent();
    } else {
      topics = await topicRepo.listTopicsByEmployeeWithStats(req.user.id);
    }

    return ApiResponse.success(res, topics);
  } catch (error) {
    console.error("[Topic Controller - getTopics]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Create new topic (optionally with initial text material)
 * @route   POST /api/v1/topics
 * @access  Private (Employee / Superadmin)
 */
exports.createTopic = async (req, res) => {
  try {
    const { title, description, content, status } = req.body;

    if (!title) {
      return ApiResponse.error(res, "Mavzu nomi kiritilishi shart", 400);
    }

    const topic = await topicRepo.createTopic({
      employeeUserId: req.user.id,
      title,
      description,
      status: status || "active",
    });

    if (content && String(content).trim()) {
      const chunks = chunkText(content);
      await materialRepo.saveTextMaterial({
        topicId: topic.id,
        uploadedByUserId: req.user.id,
        title: `${title} - Asosiy darslik`,
        rawText: content,
        processedText: content,
        chunks,
      });
    }

    return ApiResponse.success(res, topic, "Mavzu muvaffaqiyatli yaratildi", 201);
  } catch (error) {
    console.error("[Topic Controller - createTopic]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Update topic
 * @route   PATCH /api/v1/topics/:id
 * @access  Private (Employee / Superadmin)
 */
exports.updateTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const { title, description, status } = req.body;

    const existing = await topicRepo.getTopicById(topicId);
    if (!existing) {
      return ApiResponse.error(res, "Mavzu topilmadi", 404);
    }

    const updated = await topicRepo.updateTopic(topicId, {
      title,
      description,
      status,
    });

    return ApiResponse.success(res, updated, "Mavzu yangilandi");
  } catch (error) {
    console.error("[Topic Controller - updateTopic]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Delete topic
 * @route   DELETE /api/v1/topics/:id
 * @access  Private (Employee / Superadmin)
 */
exports.deleteTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const existing = await topicRepo.getTopicById(topicId);
    if (!existing) {
      return ApiResponse.error(res, "Mavzu topilmadi", 404);
    }

    await topicRepo.deleteTopic(topicId);
    return ApiResponse.success(res, null, "Mavzu o'chirildi");
  } catch (error) {
    console.error("[Topic Controller - deleteTopic]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get single topic with materials and chunks
 * @route   GET /api/v1/topics/:id
 * @access  Private
 */
exports.getTopic = async (req, res) => {
  try {
    const topicId = req.params.id;
    const topic = await topicRepo.getTopicById(topicId);

    if (!topic) {
      return ApiResponse.error(res, "Mavzu topilmadi", 404);
    }

    if (req.user.role === "student") {
      const hasAccess = await topicRepo.studentHasTopicAccess(req.user.id, topicId);
      if (!hasAccess) {
        return ApiResponse.error(res, "Bu mavzuga ruxsat yo'q", 403);
      }
    }

    const materials = await materialRepo.getTopicMaterials(topicId);
    const videos = await materialRepo.getTopicVideos(topicId);
    const chunks = await materialRepo.getKnowledgeChunks(topicId);

    return ApiResponse.success(res, {
      ...topic,
      materials,
      videos,
      chunks,
    });
  } catch (error) {
    console.error("[Topic Controller - getTopic]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Add text material to topic
 * @route   POST /api/v1/topics/:id/materials/text
 * @access  Private (Employee / Superadmin)
 */
exports.addTextMaterial = async (req, res) => {
  try {
    const topicId = req.params.id;
    const { title, content } = req.body;

    if (!content || !String(content).trim()) {
      return ApiResponse.error(res, "Darslik matni kiritilishi shart", 400);
    }

    const topic = await topicRepo.getTopicByIdForEmployee(topicId, req.user.id);
    if (!topic) {
      return ApiResponse.error(res, "Mavzu topilmadi", 404);
    }

    const chunks = chunkText(content);
    const material = await materialRepo.saveTextMaterial({
      topicId,
      uploadedByUserId: req.user.id,
      title: title || "Darslik matni",
      rawText: content,
      processedText: content,
      chunks,
    });

    return ApiResponse.success(res, material, "Material muvaffaqiyatli qo'shildi", 201);
  } catch (error) {
    console.error("[Topic Controller - addTextMaterial]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Delete material from topic
 * @route   DELETE /api/v1/topics/:id/materials/:materialId
 * @access  Private (Employee / Superadmin)
 */
exports.deleteMaterial = async (req, res) => {
  try {
    const { id: topicId, materialId } = req.params;
    const deleted = await materialRepo.deleteMaterial(materialId, topicId);
    if (!deleted) {
      return ApiResponse.error(res, "Material topilmadi", 404);
    }
    return ApiResponse.success(res, deleted, "Material o'chirildi");
  } catch (error) {
    console.error("[Topic Controller - deleteMaterial]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Ask Ustoz AI a question about the topic (or get summary/simple/example explanation)
 * @route   POST /api/v1/topics/:id/ask
 * @access  Private
 */
exports.askTopicQuestion = async (req, res) => {
  try {
    const topicId = req.params.id;
    const {
      question,
      mode = "normal",
      language = "uz",
    } = req.body;

    const topic = await topicRepo.getTopicById(topicId);
    if (!topic) {
      return ApiResponse.error(res, "Mavzu topilmadi", 404);
    }

    const chunks = await materialRepo.getKnowledgeChunks(topicId);
    const effectiveQuestion =
      question && String(question).trim()
        ? String(question).trim()
        : mode === "summary"
          ? `${topic.title} mavzusini qisqacha va tushunarli tushuntirib ber.`
          : mode === "simple"
            ? `${topic.title} mavzusini juda sodda tilda tushuntirib ber.`
            : mode === "example"
              ? `${topic.title} mavzusini hayotiy misollar bilan tushuntirib ber.`
              : `${topic.title} haqida ma'lumot ber.`;

    const answer = await openaiService.answerTopicQuestion({
      topic,
      chunks,
      question: effectiveQuestion,
      languageCode: language,
      teachingMode: mode,
    });

    const relevantChunks = selectRelevantChunks(
      effectiveQuestion,
      chunks,
      config.topicSourceSnippetLimit,
    ).map((c) => shortText(c, 240));

    return ApiResponse.success(res, {
      answer,
      question: effectiveQuestion,
      mode,
      language,
      sources: relevantChunks,
    });
  } catch (error) {
    console.error("[Topic Controller - askTopicQuestion]", error);
    return ApiResponse.error(res, error.message);
  }
};
