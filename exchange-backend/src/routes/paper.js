// =============================
// src/routes/paper.js
// =============================

/**
 * @openapi
 * tags:
 *   name: Paper
 *   description: Paper trading
 */

/**
 * @openapi
 * /paper/markets:
 *   get:
 *     summary: Simulated paper symbols
 *     tags: [Paper]
 *     responses:
 *       200:
 *         description: List of available simulated markets
 */

/**
 * @openapi
 * /paper/orders:
 *   post:
 *     summary: Place a paper order
 *     security:
 *       - bearerAuth: []
 *     tags: [Paper]
 *     responses:
 *       200:
 *         description: Order created
 *
 *   get:
 *     summary: List paper orders
 *     security:
 *       - bearerAuth: []
 *     tags: [Paper]
 *     responses:
 *       200:
 *         description: List of orders
 */

/**
 * @openapi
 * /paper/orders/{id}:
 *   delete:
 *     summary: Cancel a paper order
 *     security:
 *       - bearerAuth: []
 *     tags: [Paper]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Order canceled
 */

/**
 * @openapi
 * /paper/positions:
 *   get:
 *     summary: Get paper trading positions
 *     security:
 *       - bearerAuth: []
 *     tags: [Paper]
 *     responses:
 *       200:
 *         description: Current positions
 */

/**
 * @openapi
 * /paper/history:
 *   get:
 *     summary: Get paper trading history
 *     security:
 *       - bearerAuth: []
 *     tags: [Paper]
 *     responses:
 *       200:
 *         description: Trade history
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/responses.js';
import * as svc from '../services/paperService.js';

const r = express.Router();

/** =============================
 *  Routes
 *  ============================= */

// --- Public Routes ---
r.get('/markets', async (req, res) => {
  ok(res, await svc.markets());
});

// --- Authenticated Routes ---
r.post('/orders', requireAuth, async (req, res) => {
  try {
    ok(res, await svc.placeOrder(req.user.id, req.body));
  } catch (e) {
    fail(res, e.message, 400);
  }
});

r.get('/orders', requireAuth, async (req, res) => {
  ok(res, await svc.listOrders(req.user.id));
});

r.delete('/orders/:id', requireAuth, async (req, res) => {
  await svc.cancel(req.user.id, req.params.id);
  ok(res, { canceled: true });
});

r.get('/positions', requireAuth, async (req, res) => {
  ok(res, await svc.positions(req.user.id));
});

r.get('/history', requireAuth, async (req, res) => {
  ok(res, await svc.history(req.user.id));
});

export default r;
