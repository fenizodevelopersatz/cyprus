import {
  getLevelManagementSettings,
  updateLevelManagementSettings,
} from '../services/adminLevelManagement.service.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';

export async function fetchAdminLevelManagementSettings(_req, res) {
  const data = await getLevelManagementSettings();
  return sendSuccess(res, 'Level management settings fetched successfully', data);
}

export async function saveAdminLevelManagementSettings(req, res) {
  try {
    const data = await updateLevelManagementSettings(req.body, req.user?.id ?? null);
    return sendSuccess(res, 'Level management settings updated successfully', data);
  } catch (error) {
    if (error?.code === 'VALIDATION_FAILED') {
      return sendError(res, 'Validation failed', 400, error.errors || {});
    }
    throw error;
  }
}
