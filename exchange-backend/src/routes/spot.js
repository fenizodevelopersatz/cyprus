// =============================
// src/routes/spot.js
// =============================

/**
 * @openapi
 * tags:
 *   - name: Spot
 *     description: Spot trading endpoints
 */

/**
 * @openapi
 * /spot/orders:
 *   post:
 *     summary: Place a new spot order
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Spot
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - symbol
 *               - side
 *               - type
 *               - size
 *             properties:
 *               symbol:
 *                 type: string
 *                 example: "BTC-USDT"
 *               side:
 *                 type: string
 *                 enum: [BUY, SELL]
 *                 example: "BUY"
 *               type:
 *                 type: string
 *                 enum: [MARKET, LIMIT]
 *                 example: "LIMIT"
 *               price:
 *                 type: number
 *                 example: 30000
 *               size:
 *                 type: number
 *                 example: 0.01
 *     responses:
 *       200:
 *         description: Order successfully created
 */

/**
 * @openapi
 * /spot/orders:
 *   get:
 *     summary: List open spot orders
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Spot
 *     responses:
 *       200:
 *         description: List of open spot orders
 */

/**
 * @openapi
 * /spot/orders/history:
 *   get:
 *     summary: Get spot order history
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Spot
 *     responses:
 *       200:
 *         description: Historical spot orders
 */

/**
 * @openapi
 * /spot/orders/{id}:
 *   delete:
 *     summary: Cancel a specific spot order
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Spot
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Order ID to cancel
 *     responses:
 *       200:
 *         description: Order canceled successfully
 */

/**
 * @openapi
 * /spot/positions:
 *   get:
 *     summary: List current spot positions
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Spot
 *     responses:
 *       200:
 *         description: List of current spot positions
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/responses.js';
import * as svc from '../services/spotService.js';

const r = express.Router();

r.post('/orders', requireAuth, async (req, res) => {
  try {
    ok(res, await svc.placeOrder(req.user.id, req.body));
  } catch (e) {
    fail(res, e.message, 400);
  }
});

r.get('/orders', requireAuth, async (req, res) =>
  ok(res, await svc.listOpen(req.user.id))
);

r.get('/orders/history', requireAuth, async (req, res) =>
  ok(res, await svc.listHistory(req.user.id))
);

r.delete('/orders/:id', requireAuth, async (req, res) => {
  try {
    await svc.cancelOrder(req.user.id, req.params.id);
    ok(res, { canceled: true });
  } catch (e) {
    fail(res, e.message, 400);
  }
});

r.get('/positions', requireAuth, async (req, res) => ok(res, []));

export default r;
