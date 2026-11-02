const ApiResponse = require("../utils/response");
const dictRepo = require("../../repositories/dictionaries");
const { parseDictionaryText, matchDictionaryAnswer } = require("../../utils/dictionary");
const {
  parseDictionaryTextWithAi,
  gradeDictionaryAnswerWithAi,
  hasOpenAi,
} = require("../../services/openai-service");

async function extractEntriesFromPayload({ entries, rawText }) {
  if (Array.isArray(entries) && entries.length > 0) {
    return entries
      .filter((e) => e && (e.german || e.german_text) && (e.uzbek || e.uzbek_text))
      .map((e) => ({
        german: String(e.german || e.german_text).trim(),
        uzbek: String(e.uzbek || e.uzbek_text).trim(),
      }));
  }

  if (rawText && String(rawText).trim()) {
    const parsed = parseDictionaryText(rawText);
    if (parsed.entries.length > 0) {
      return parsed.entries;
    }

    if (hasOpenAi()) {
      return await parseDictionaryTextWithAi(rawText);
    }
  }

  return [];
}

/**
 * @desc    Get all dictionaries
 * @route   GET /api/v1/dictionaries
 * @access  Private
 */
exports.getDictionaries = async (req, res) => {
  try {
    const dictionaries = await dictRepo.listAllDictionaries();
    return ApiResponse.success(res, dictionaries);
  } catch (error) {
    console.error("[Dictionary Controller - getDictionaries]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Create new dictionary
 * @route   POST /api/v1/dictionaries
 * @access  Private (Staff only)
 */
exports.createDictionary = async (req, res) => {
  try {
    const { title, entries, rawText } = req.body;

    if (!title || !String(title).trim()) {
      return ApiResponse.error(res, "Lug'at bo'limi nomi kiritilishi shart", 400);
    }

    const parsedEntries = await extractEntriesFromPayload({ entries, rawText });

    const dictionary = await dictRepo.createDictionary({
      employeeUserId: req.user.id,
      title: String(title).trim(),
      entries: parsedEntries,
    });

    const allEntries = await dictRepo.listDictionaryEntries(dictionary.id);

    return ApiResponse.success(
      res,
      { ...dictionary, entries: allEntries },
      "Lug'at bo'limi yaratildi",
      201,
    );
  } catch (error) {
    console.error("[Dictionary Controller - createDictionary]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Get single dictionary with entries
 * @route   GET /api/v1/dictionaries/:id
 * @access  Private
 */
exports.getDictionary = async (req, res) => {
  try {
    const dictionaryId = req.params.id;
    const dictionary = await dictRepo.getDictionaryById(dictionaryId);

    if (!dictionary) {
      return ApiResponse.error(res, "Lug'at bo'limi topilmadi", 404);
    }

    const entries = await dictRepo.listDictionaryEntries(dictionaryId);

    return ApiResponse.success(res, {
      ...dictionary,
      entries,
    });
  } catch (error) {
    console.error("[Dictionary Controller - getDictionary]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Update dictionary title and/or entries (Add or Replace)
 * @route   PATCH /api/v1/dictionaries/:id
 * @access  Private (Staff only)
 */
exports.updateEntries = async (req, res) => {
  try {
    const dictionaryId = req.params.id;
    const { title, entries, rawText, mode = "add" } = req.body;

    const dictionary = await dictRepo.getDictionaryByIdForEmployee(
      dictionaryId,
      req.user.id,
    );
    if (!dictionary) {
      return ApiResponse.error(res, "Lug'at topilmadi", 404);
    }

    if (title && String(title).trim()) {
      await dictRepo.updateDictionaryTitle(dictionaryId, String(title).trim());
    }

    const parsedEntries = await extractEntriesFromPayload({ entries, rawText });

    let result = dictionary;
    if (parsedEntries.length > 0) {
      if (mode === "replace") {
        result = await dictRepo.replaceDictionaryEntries({
          dictionaryId,
          entries: parsedEntries,
        });
      } else {
        result = await dictRepo.addDictionaryEntries({
          dictionaryId,
          entries: parsedEntries,
        });
      }
    } else {
      result = await dictRepo.getDictionaryById(dictionaryId);
    }

    const updatedEntries = await dictRepo.listDictionaryEntries(dictionaryId);

    return ApiResponse.success(
      res,
      { ...result, entries: updatedEntries },
      "Lug'at muvaffaqiyatli yangilandi",
    );
  } catch (error) {
    console.error("[Dictionary Controller - updateEntries]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Delete dictionary
 * @route   DELETE /api/v1/dictionaries/:id
 * @access  Private (Staff only)
 */
exports.deleteDictionary = async (req, res) => {
  try {
    const dictionaryId = req.params.id;

    const dictionary = await dictRepo.getDictionaryByIdForEmployee(
      dictionaryId,
      req.user.id,
    );
    if (!dictionary) {
      return ApiResponse.error(res, "Lug'at topilmadi", 404);
    }

    await dictRepo.deleteDictionary(dictionaryId);
    return ApiResponse.success(res, null, "Lug'at o'chirildi");
  } catch (error) {
    console.error("[Dictionary Controller - deleteDictionary]", error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Check student's vocabulary answer (exact/articleless match + AI synonym fallback)
 * @route   POST /api/v1/dictionaries/:id/check-answer
 * @access  Private
 */
exports.checkAnswer = async (req, res) => {
  try {
    const { entryId, direction = "de_to_uz", answer } = req.body;

    if (!entryId || answer === undefined) {
      return ApiResponse.error(res, "entryId va answer kiritilishi shart", 400);
    }

    const entry = await dictRepo.getDictionaryEntryById(entryId);
    if (!entry) {
      return ApiResponse.error(res, "So'z topilmadi", 404);
    }

    const promptWord =
      direction === "de_to_uz" ? entry.german_text : entry.uzbek_text;
    const expectedAnswer =
      direction === "de_to_uz" ? entry.uzbek_text : entry.german_text;

    let isCorrect = matchDictionaryAnswer(expectedAnswer, answer);
    let feedback = isCorrect ? "To'g'ri!" : `To'g'ri javob: ${expectedAnswer}`;

    if (!isCorrect && String(answer).trim().length > 1) {
      const aiCheck = await gradeDictionaryAnswerWithAi({
        originalWord: promptWord,
        expectedAnswer,
        studentAnswer: String(answer).trim(),
      });
      if (aiCheck.correct) {
        isCorrect = true;
        feedback = aiCheck.feedback || `To'g'ri! (${expectedAnswer})`;
      }
    }

    return ApiResponse.success(res, {
      entryId: entry.id,
      direction,
      promptWord,
      expectedAnswer,
      studentAnswer: answer,
      isCorrect,
      feedback,
    });
  } catch (error) {
    console.error("[Dictionary Controller - checkAnswer]", error);
    return ApiResponse.error(res, error.message);
  }
};
