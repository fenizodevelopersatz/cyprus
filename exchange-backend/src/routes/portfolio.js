/**
 * @openapi
 * tags:
 *   - name: Portfolio
 *     description: Position and equity analytics
 */

/**
 * @openapi
 * /portfolio/positions:
 *   get:
 *     summary: List positions for the signed-in user
 *     security:
 *       - bearerAuth: []
 *     tags: [Portfolio]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           example: open
 *     responses:
 *       200:
 *         description: Position list
 */

/**
 * @openapi
 * /portfolio/snapshot:
 *   get:
 *     summary: Portfolio snapshot with balances, positions, allocation, and activity
 *     security:
 *       - bearerAuth: []
 *     tags: [Portfolio]
 *     responses:
 *       200:
 *         description: Portfolio snapshot
 */

/**
 * @openapi
 * /portfolio/activity:
 *   get:
 *     summary: Recent portfolio activity entries
 *     security:
 *       - bearerAuth: []
 *     tags: [Portfolio]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 16
 *     responses:
 *       200:
 *         description: Activity list
 */

/**
 * @openapi
 * /portfolio/equity-history:
 *   get:
 *     summary: Equity history timeline
 *     security:
 *       - bearerAuth: []
 *     tags: [Portfolio]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 120
 *     responses:
 *       200:
 *         description: Equity history data points
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../utils/responses.js';
import {
  getPortfolioSnapshot,
  getRecentActivity,
  getEquityHistory,
} from '../services/portfolioService.js';
import { positions as getFuturesPositions } from '../services/futuresService.js';

const router = express.Router();

router.get('/snapshot', requireAuth, async (req, res) => {
  ok(res, await getPortfolioSnapshot(req.user.id));
});

router.get('/activity', requireAuth, async (req, res) => {
  const limitParam = Number(req.query.limit);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 100) : 16;
  ok(res, await getRecentActivity(req.user.id, limit));
});

router.get('/equity-history', requireAuth, async (req, res) => {
  const limitParam = Number(req.query.limit);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 500) : 120;
  ok(res, await getEquityHistory(req.user.id, { limit }));
});

router.get('/positions', requireAuth, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  ok(res, await getFuturesPositions(req.user.id, { status }));
});

export default router;
