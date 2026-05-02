const express = require('express');
const router = express.Router();
const { 
  getDictionaries, 
  createDictionary, 
  getDictionary, 
  updateEntries, 
  deleteDictionary 
} = require('../controllers/dictionaries');
const { protect, authorize } = require('../middlewares/auth');

router.use(protect);

router.route('/')
  .get(getDictionaries)
  .post(authorize('employee', 'superadmin'), createDictionary);

router.route('/:id')
  .get(getDictionary)
  .patch(authorize('employee', 'superadmin'), updateEntries)
  .delete(authorize('employee', 'superadmin'), deleteDictionary);

module.exports = router;
