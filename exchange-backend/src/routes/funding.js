import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { v } from '../middleware/validate.js';
import { fail, ok } from '../utils/responses.js';
import { getFundingSummary } from '../services/fundingSummary.service.js';
import { refreshFundingDeposits } from '../services/fundingRefresh.service.js';
import { getFundingDepositHistory } from '../services/fundingDepositHistory.service.js';
import { getFundingWithdrawHistory } from '../services/fundingWithdrawHistory.service.js';

const router = express.Router();

router.get('/summary', requireAuth, async (req, res) => {
  try {
    ok(res, await getFundingSummary(req.user.id));
  } catch (err) {
    fail(res, err.message || 'Failed to load funding summary', err.status || 400);
  }
});

router.post(
  '/refresh-deposits',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      network: v.Joi.string().valid('ethereum', 'bsc', 'tron').optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await refreshFundingDeposits(req.user.id, req.body));
    } catch (err) {
      fail(res, err.message || 'Failed to refresh deposits', err.status || 400);
    }
  }
);

router.get(
  '/deposit-history',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      network: v.Joi.string().valid('ethereum', 'bsc', 'tron').optional(),
      page: v.Joi.number().integer().min(1).default(1),
      limit: v.Joi.number().integer().min(1).max(100).default(10),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await getFundingDepositHistory(req.user.id, req.query));
    } catch (err) {
      fail(res, err.message || 'Failed to load deposit history', err.status || 400);
    }
  }
);

router.get(
  '/withdraw-history',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      page: v.Joi.number().integer().min(1).default(1),
      limit: v.Joi.number().integer().min(1).max(100).default(10),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await getFundingWithdrawHistory(req.user.id, req.query));
    } catch (err) {
      fail(res, err.message || 'Failed to load withdraw history', err.status || 400);
    }
  }
);

export default router;
