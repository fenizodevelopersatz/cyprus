import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok, fail } from '../../utils/responses.js';
import {
  generateReferralCsv,
  getReferralDashboard,
  getReferralIncomeHistory,
} from '../../services/referralService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

function parseUserId(rawValue) {
  const userId = Number(rawValue);
  return Number.isFinite(userId) && userId > 0 ? userId : null;
}

router.get('/:userId/dashboard', guard, async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) return fail(res, 'Invalid user ID', 400);

  try {
    ok(res, await getReferralDashboard(userId));
  } catch (err) {
    fail(res, err.message || 'Failed to load admin referral dashboard', err.status || 500);
  }
});

router.get('/:userId/history', guard, async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) return fail(res, 'Invalid user ID', 400);

  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    ok(res, await getReferralIncomeHistory(userId, { page, limit }));
  } catch (err) {
    fail(res, err.message || 'Failed to load admin referral income history', err.status || 500);
  }
});

router.get('/:userId/export', guard, async (req, res) => {
  const userId = parseUserId(req.params.userId);
  if (!userId) return fail(res, 'Invalid user ID', 400);

  try {
    const csv = await generateReferralCsv(userId);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="admin-referrals-${userId}-${date}.csv"`);
    return res.send(csv);
  } catch (err) {
    return fail(res, err.message || 'Failed to export admin referral data', err.status || 500);
  }
});

export default router;
