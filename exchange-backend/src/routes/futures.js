// src/routes/futures.js

/**
 * @openapi
 * tags:
 *   - name: Futures
 *     description: Perp contracts & account
 */

/**
 * @openapi
 * /futures/contracts:
 *   get:
 *     summary: List futures contracts
 *     tags: [Futures]
 *     responses:
 *       200:
 *         description: Contracts
 */
 /**
  * @openapi
  * /futures/mark/{symbol}:
  *   get:
  *     summary: Current mark price
  *     tags: [Futures]
  *     parameters:
  *       - in: path
  *         name: symbol
  *         required: true
  *         schema:
  *           type: string
  *     responses:
  *       200:
  *         description: Mark price
  */
 /**
  * @openapi
  * /futures/funding/{symbol}:
  *   get:
  *     summary: Latest funding rate
  *     tags: [Futures]
  *     parameters:
  *       - in: path
  *         name: symbol
  *         required: true
  *         schema:
  *           type: string
  *     responses:
  *       200:
  *         description: Funding
  */
 /**
  * @openapi
  * /futures/history/{symbol}:
  *   get:
  *     summary: Price tick history
  *     tags: [Futures]
  *     parameters:
  *       - in: path
  *         name: symbol
  *         required: true
  *         schema:
  *           type: string
  *       - in: query
  *         name: limit
  *         schema:
  *           type: integer
  *           default: 200
  *     responses:
  *       200:
  *         description: History
  */
 /**
  * @openapi
  * /futures/account:
  *   get:
  *     summary: Futures account summary
  *     security:
  *       - bearerAuth: []
  *     tags: [Futures]
  *     responses:
  *       200:
  *         description: Account
  */
 /**
  * @openapi
  * /futures/position/open:
  *   post:
  *     summary: Open position
  *     security:
  *       - bearerAuth: []
  *     tags: [Futures]
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             required: [symbol, side, size, leverage]
  *             properties:
  *               symbol: { type: string }
  *               side: { type: string, enum: ['LONG','SHORT'] }
  *               size: { type: number }
  *               leverage: { type: integer }
  *               stopLoss: { type: number }
  *               takeProfit: { type: number }
  *     responses:
  *       200:
  *         description: Opened
  */
 /**
  * @openapi
  * /futures/position/update-triggers:
  *   post:
  *     summary: Update SL/TP
  *     security:
  *       - bearerAuth: []
  *     tags: [Futures]
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             required: [symbol]
  *             properties:
  *               symbol: { type: string }
  *               stopLoss: { type: number }
  *               takeProfit: { type: number }
  *     responses:
  *       200:
  *         description: Updated
  */
 /**
  * @openapi
  * /futures/position/close:
  *   post:
  *     summary: Close position
  *     security:
  *       - bearerAuth: []
  *     tags: [Futures]
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             required: [symbol]
  *             properties:
  *               symbol: { type: string }
  *     responses:
  *       200:
  *         description: Closed
  */
 /**
  * @openapi
  * /futures/positions:
  *   get:
  *     summary: Open positions
  *     security:
  *       - bearerAuth: []
  *     tags: [Futures]
  *     responses:
  *       200:
  *         description: Positions
  */
 /**
  * @openapi
  * /futures/trades:
  *   get:
    *     summary: Trade history
  *     security:
  *       - bearerAuth: []
  *     tags: [Futures]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 200
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: integer
 *           description: Trade ID for pagination
 *     responses:
  *       200:
  *         description: Trades
  */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/responses.js';
import { v } from '../middleware/validate.js';
import * as fut from '../services/futuresService.js';

const router = express.Router();

router.get('/contracts', async (req, res) => ok(res, await fut.contracts()));
router.get('/mark/:symbol', async (req, res) => ok(res, await fut.mark(req.params.symbol)));
router.get('/funding/:symbol', async (req, res) => ok(res, await fut.funding(req.params.symbol)));
router.get('/history/:symbol', async (req, res) => {
  const limit = Math.min(200, Number(req.query.limit || 200));
  ok(res, await fut.history(req.params.symbol, limit));
});

router.get('/account', requireAuth, async (req, res) => ok(res, await fut.account(req.user.id)));

router.post('/position/open', requireAuth, async (req, res) => {
  try { ok(res, await fut.openPosition(req.user.id, req.body)); }
  catch (e) { fail(res, e.message, 400); }
});

router.post('/position/update-triggers', requireAuth, async (req, res) => {
  try { await fut.updateTriggers(req.user.id, req.body); ok(res, { updated: true }); }
  catch (e) { fail(res, e.message, 400); }
});

router.post('/position/close', requireAuth, async (req, res) => {
  try { await fut.close(req.user.id, req.body); ok(res, { closed: true }); }
  catch (e) { fail(res, e.message, 400); }
});

router.get('/positions', requireAuth, async (req, res) => ok(res, await fut.positions(req.user.id)));
router.get(
  '/trades',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      limit: v.Joi.number().integer().min(1).max(200).default(20),
      cursor: v.Joi.number().integer().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    const { limit, cursor } = req.query;
    ok(
      res,
      await fut.trades(req.user.id, {
        limit,
        cursor,
      })
    );
  }
);

export default router;
