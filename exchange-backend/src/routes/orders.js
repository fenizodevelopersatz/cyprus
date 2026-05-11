/**
 * @openapi
 * tags:
 *   - name: Orders
 *     description: Spot order queries
 */

/**
 * @openapi
 * /orders:
 *   get:
 *     summary: List orders for the signed-in user
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           example: open
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Filtered order list
 */

/**
 * @openapi
 * /orders/recent:
 *   get:
 *     summary: Recent filled trades for the signed-in user
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Recent trades feed
 */

/**
 * @openapi
 * /orders/snapshot:
 *   get:
 *     summary: Order page snapshot with open orders, history, and trades
 *     security:
 *       - bearerAuth: []
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: openLimit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: historyLimit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: tradeLimit
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       200:
 *         description: Order snapshot payload
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../utils/responses.js';
import {
  getOrderSnapshot,
  getOpenOrders,
  getOrderHistory,
  getRecentTrades,
} from '../services/orderService.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
  const parsed = Number(req.query.limit);
  const limit =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(200, Math.floor(parsed))
      : undefined;
  if (status === 'OPEN') {
    ok(res, await getOpenOrders(req.user.id, limit));
  } else if (status) {
    const history = await getOrderHistory(req.user.id, limit);
    ok(
      res,
      history.filter((order) => order.status?.toUpperCase() === status)
    );
  } else {
    ok(res, await getOrderHistory(req.user.id, limit));
  }
});

router.get('/recent', requireAuth, async (req, res) => {
  const parsed = Number(req.query.limit);
  const limit =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(50, Math.floor(parsed))
      : 10;
  ok(res, await getRecentTrades(req.user.id, limit));
});

router.get('/snapshot', requireAuth, async (req, res) => {
  const openLimit = Number(req.query.openLimit);
  const historyLimit = Number(req.query.historyLimit);
  const tradeLimit = Number(req.query.tradeLimit);
  ok(
    res,
    await getOrderSnapshot(req.user.id, {
      openLimit: Number.isFinite(openLimit) && openLimit > 0 ? Math.floor(openLimit) : undefined,
      historyLimit:
        Number.isFinite(historyLimit) && historyLimit > 0 ? Math.floor(historyLimit) : undefined,
      tradeLimit:
        Number.isFinite(tradeLimit) && tradeLimit > 0 ? Math.floor(tradeLimit) : undefined,
    })
  );
});

export default router;
