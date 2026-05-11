import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import {
  fetchAdminLevelManagementSettings,
  saveAdminLevelManagementSettings,
} from '../controllers/adminLevelManagement.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

router.get('/level-management-settings', guard, asyncHandler(fetchAdminLevelManagementSettings));
router.put('/level-management-settings', guard, asyncHandler(saveAdminLevelManagementSettings));

export default router;
