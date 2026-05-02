const ApiResponse = require('../utils/response');
const dictRepo = require('../../repositories/dictionaries');

/**
 * @desc    Get all dictionaries
 * @route   GET /api/v1/dictionaries
 * @access  Private
 */
exports.getDictionaries = async (req, res) => {
  try {
    let dictionaries;
    if (req.user.role === 'student') {
      dictionaries = await dictRepo.listDictionariesForStudent(req.user.id);
    } else {
      dictionaries = await dictRepo.listDictionariesByEmployee(req.user.id);
    }
    return ApiResponse.success(res, dictionaries);
  } catch (error) {
    console.error('[Dictionary Controller]', error);
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
    const { title, entries } = req.body;

    if (!title) {
      return ApiResponse.error(res, 'Title is required', 400);
    }

    const dictionary = await dictRepo.createDictionary({
      employeeUserId: req.user.id,
      title,
      entries: entries || []
    });

    return ApiResponse.success(res, dictionary, 'Dictionary created successfully', 201);
  } catch (error) {
    console.error('[Dictionary Controller]', error);
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
      return ApiResponse.error(res, 'Dictionary not found', 404);
    }

    const entries = await dictRepo.listDictionaryEntries(dictionaryId);

    return ApiResponse.success(res, {
      ...dictionary,
      entries
    });
  } catch (error) {
    console.error('[Dictionary Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};

/**
 * @desc    Update dictionary entries (Add or Replace)
 * @route   PATCH /api/v1/dictionaries/:id
 * @access  Private (Staff only)
 */
exports.updateEntries = async (req, res) => {
  try {
    const dictionaryId = req.params.id;
    const { entries, mode } = req.body; // mode: 'add' or 'replace'

    if (!entries || !Array.isArray(entries)) {
      return ApiResponse.error(res, 'Entries array is required', 400);
    }

    const dictionary = await dictRepo.getDictionaryByIdForEmployee(dictionaryId, req.user.id);
    if (!dictionary) {
      return ApiResponse.error(res, 'Dictionary not found or access denied', 404);
    }

    let result;
    if (mode === 'replace') {
      result = await dictRepo.replaceDictionaryEntries({ dictionaryId, entries });
    } else {
      result = await dictRepo.addDictionaryEntries({ dictionaryId, entries });
    }

    return ApiResponse.success(res, result, `Entries ${mode === 'replace' ? 'replaced' : 'added'} successfully`);
  } catch (error) {
    console.error('[Dictionary Controller]', error);
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
    
    const dictionary = await dictRepo.getDictionaryByIdForEmployee(dictionaryId, req.user.id);
    if (!dictionary) {
      return ApiResponse.error(res, 'Dictionary not found or access denied', 404);
    }

    await dictRepo.deleteDictionary(dictionaryId);
    return ApiResponse.success(res, null, 'Dictionary deleted successfully');
  } catch (error) {
    console.error('[Dictionary Controller]', error);
    return ApiResponse.error(res, error.message);
  }
};
