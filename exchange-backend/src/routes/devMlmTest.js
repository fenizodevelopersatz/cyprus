import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roles.js';
import { ok, fail } from '../utils/responses.js';
import {
  generateDummyDeposits,
  generateTestRun,
  getTestRunResults,
  recalculateTestRun,
  rebuildTestTree,
  resetTestRuns,
} from '../services/mlmTestToolService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

router.use((req, res, next) => {
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    return fail(res, 'Dev MLM test tool is disabled in production', 404);
  }
  next();
});

router.post('/generate-users', guard, async (req, res) => {
  try {
    ok(res, await generateTestRun(req.body || {}));
  } catch (err) {
    fail(res, err.message || 'Failed to generate MLM test users', 400);
  }
});

router.post('/generate-deposits', guard, async (req, res) => {
  try {
    ok(res, await generateDummyDeposits(Number(req.body?.runId), req.body || {}));
  } catch (err) {
    fail(res, err.message || 'Failed to generate dummy deposits', 400);
  }
});

router.post('/rebuild-tree', guard, async (req, res) => {
  try {
    ok(res, await rebuildTestTree(Number(req.body?.runId), req.body || {}));
  } catch (err) {
    fail(res, err.message || 'Failed to rebuild tree', 400);
  }
});

router.post('/recalculate-levels', guard, async (req, res) => {
  try {
    ok(res, await recalculateTestRun(Number(req.body?.runId), req.body || {}));
  } catch (err) {
    fail(res, err.message || 'Failed to recalculate levels', 400);
  }
});

router.get('/results', guard, async (req, res) => {
  try {
    ok(res, await getTestRunResults(req.query?.runId ? Number(req.query.runId) : null));
  } catch (err) {
    fail(res, err.message || 'Failed to load MLM test results', 400);
  }
});

router.post('/reset', guard, async (_req, res) => {
  try {
    ok(res, await resetTestRuns());
  } catch (err) {
    fail(res, err.message || 'Failed to reset MLM test data', 400);
  }
});

export default router;
