import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { fail, ok } from '../../utils/responses.js';
import {
  getControlSettings,
  getDayWiseSignalHistory,
  getSignalHistoryByBatchToken,
  previewTradeSlotBatchToken,
  regenerateTradeSlotBatchToken,
  updateControlSettings,
} from '../../services/adminControlService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

router.get('/control-settings', guard, async (_req, res) => {
  ok(res, await getControlSettings());
});

router.put('/control-settings', guard, async (req, res) => {
  try {
    ok(res, await updateControlSettings(req.body, req.user?.id ?? null));
  } catch (error) {
    if (error?.code === 'VALIDATION_FAILED') {
      const errors = error.errors || {};
      return res.status(400).json({ status: false, code: 400, message: 'Validation failed', errors, meta: errors });
    }
    throw error;
  }
});

router.get('/control-system/signal-history/day-wise', guard, async (_req, res) => {
  ok(res, await getDayWiseSignalHistory());
});

router.post('/control-system/trade-slots/:slotId/generate-token', guard, async (req, res) => {
  try {
    const previewOnly = Boolean(req.body?.previewOnly);
    ok(
      res,
      previewOnly
        ? await previewTradeSlotBatchToken(req.params.slotId, req.body?.slotDate ?? null)
        : await regenerateTradeSlotBatchToken(req.params.slotId, req.body?.slotDate ?? null)
    );
  } catch (error) {
    if (error?.code === 'VALIDATION_FAILED') {
      const errors = error.errors || {};
      return res.status(400).json({ status: false, code: 400, message: 'Validation failed', errors, meta: errors });
    }
    if (error?.status) {
      return fail(res, error.message || 'Failed to generate trade slot token', error.status);
    }
    throw error;
  }
});

router.get('/control-system/signal-history/token/:batchToken', guard, async (req, res) => {
  try {
    ok(res, await getSignalHistoryByBatchToken(req.params.batchToken));
  } catch (error) {
    if (error?.code === 'VALIDATION_FAILED') {
      const errors = error.errors || {};
      return res.status(400).json({ status: false, code: 400, message: 'Validation failed', errors, meta: errors });
    }
    if (error?.status) {
      return fail(res, error.message || 'Failed to fetch signal history', error.status);
    }
    throw error;
  }
});

export default router;
