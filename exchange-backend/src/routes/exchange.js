import express from 'express';
import { requireAuth, extractToken, verifyToken } from '../middleware/auth.js';
import { ok } from '../utils/responses.js';
import {
  listMarkets,
  ticker,
  orderbook,
  trades,
  wallets,
  openOrders,
  placeSpotOrder,
  cancelSpotOrder,
  exchangeSnapshot,
} from '../services/exchangeService.js';

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Exchange
 *     description: Spot exchange market data & order routing
 */

/**
 * @openapi
 * /api/exchange/markets:
 *   get:
 *     summary: List tradable spot markets
 *     tags: [Exchange]
 *     parameters:
 *       - in: query
 *         name: quote
 *         schema:
 *           type: string
 *           example: USDT
 *     responses:
 *       200:
 *         description: Market definitions and filters
 */

router.get('/markets', async (req, res) => {
  const quote = req.query.quote ? String(req.query.quote) : undefined;
  ok(res, await listMarkets({ quote }));
});

/**
 * @openapi
 * /api/exchange/ticker/{symbol}:
 *   get:
 *     summary: Latest ticker snapshot
 *     tags: [Exchange]
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *           example: BTCUSDT
 *     responses:
 *       200:
 *         description: Ticker statistics
 */
router.get('/ticker/:symbol', async (req, res) => {
  try {
    ok(res, await ticker(req.params.symbol));
  } catch (err) {
    res.status(404).json({ message: 'Ticker not available', code: err.message || 'TICKER_UNAVAILABLE' });
  }
});

/**
 * @openapi
 * /api/exchange/orderbook/{symbol}:
 *   get:
 *     summary: Order book snapshot
 *     tags: [Exchange]
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: depth
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Bids and asks
 */
router.get('/orderbook/:symbol', async (req, res) => {
  const depth = Number(req.query.depth);
  const limit = Number.isFinite(depth) && depth > 0 ? Math.min(Math.floor(depth), 500) : 100;
  try {
    ok(res, await orderbook(req.params.symbol, { depth: limit }));
  } catch (err) {
    res.status(404).json({ message: 'Orderbook not available', code: err.message || 'ORDERBOOK_UNAVAILABLE' });
  }
});

/**
 * @openapi
 * /api/exchange/trades/{symbol}:
 *   get:
 *     summary: Recent public trades
 *     tags: [Exchange]
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *     responses:
 *       200:
 *         description: Trade list
 */
router.get('/trades/:symbol', async (req, res) => {
  const limitParam = Number(req.query.limit);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 500) : 100;
  ok(res, await trades(req.params.symbol, { limit }));
});

/**
 * @openapi
 * /api/exchange/wallets:
 *   get:
 *     summary: Spot wallet balances
 *     tags: [Exchange]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet balances
 */
router.get('/wallets', requireAuth, async (req, res) => {
  ok(res, await wallets(req.user.id));
});

/**
 * @openapi
 * /api/exchange/orders/open:
 *   get:
 *     summary: Open spot orders
 *     tags: [Exchange]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Active user orders
 */
router.get('/orders/open', requireAuth, async (req, res) => {
  ok(res, await openOrders(req.user.id));
});

/**
 * @openapi
 * /api/exchange/orders:
 *   post:
 *     summary: Place a spot order
 *     tags: [Exchange]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [symbol, side, type, quantity]
 *             properties:
 *               symbol:
 *                 type: string
 *                 example: BTCUSDT
 *               side:
 *                 type: string
 *                 example: BUY
 *               type:
 *                 type: string
 *                 example: LIMIT
 *               price:
 *                 type: number
 *                 example: 68000
 *               quantity:
 *                 type: number
 *                 example: 0.01
 *     responses:
 *       201:
 *         description: Order accepted
 */
router.post('/orders', requireAuth, async (req, res) => {
  try {
    ok(res, await placeSpotOrder(req.user.id, req.body), 201);
  } catch (err) {
    console.error('[exchange] Failed to place spot order', {
      userId: req.user.id,
      body: req.body,
      error: err?.stack || err?.message || err,
    });
    const errorCode = err.code || err.message || 'ORDER_FAILED';
    const status =
      err.status ||
      (['UNKNOWN_SYMBOL', 'SYMBOL_UNAVAILABLE', 'INVALID_SIDE', 'INVALID_PRICE', 'INVALID_QUANTITY', 'NOTIONAL_TOO_LOW'].includes(errorCode)
        ? 400
        : 502);
    const message = err.message || 'Order placement failed';
    const payload = { message, code: errorCode };
    if (err.details) payload.details = err.details;
    res.status(status).json(payload);
  }
});

/**
 * @openapi
 * /api/exchange/orders/cancel:
 *   post:
 *     summary: Cancel a spot order
 *     tags: [Exchange]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [symbol]
 *             properties:
 *               symbol:
 *                 type: string
 *               orderId:
 *                 type: integer
 *               clientOrderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Order cancelled
 */
router.post('/orders/cancel', requireAuth, async (req, res) => {
  try {
    ok(res, await cancelSpotOrder(req.user.id, req.body));
  } catch (err) {
    const errorCode = err.code || err.message || 'CANCEL_FAILED';
    const status = err.status || 502;
    const message = err.message || 'Cancel failed';
    res.status(status).json({ message, code: errorCode });
  }
});

/**
 * @openapi
 * /api/exchange/snapshot:
 *   get:
 *     summary: Combined exchange snapshot for the active symbol
 *     tags: [Exchange]
 *     parameters:
 *       - in: query
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *           example: ETHBTC
 *     responses:
 *       200:
 *         description: Snapshot payload including ticker, orderbook, trades, wallets, orders, and history
 */
router.get('/snapshot', async (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
  if (!symbol) {
    return res.status(400).json({ message: 'symbol is required', code: 'BAD_REQUEST' });
  }
  let userId = null;
  try {
    const token = extractToken(req);
    if (token) {
      const payload = verifyToken(token);
      userId = payload?.id ?? null;
    }
  } catch (err) {
    // ignore invalid tokens; snapshot falls back to public data
  }

  try {
    const payload = await exchangeSnapshot(symbol, userId);
    res.json(payload);
  } catch (err) {
    const code = err.message === 'SYMBOL_REQUIRED' ? 'BAD_REQUEST' : 'SNAPSHOT_FAILED';
    const status = code === 'BAD_REQUEST' ? 400 : 502;
    res.status(status).json({ message: 'Snapshot unavailable', code });
  }
});

export default router;
