/**
 * @openapi
 * tags:
 *   - name: Dashboard
 *     description: Home widgets & summaries
 */

/**
 * @openapi
 * /api/dashboard/summary:
 *   get:
 *     summary: Wallet and exposure summary for the current user
 *     security:
 *       - bearerAuth: []
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Aggregated balances and counts
 */

/**
 * @openapi
 * /api/dashboard/positions:
 *   get:
 *     summary: Active or historical futures positions for the current user
 *     security:
 *       - bearerAuth: []
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           example: OPEN
 *     responses:
 *       200:
 *         description: Position list
 */

/**
 * @openapi
 * /api/dashboard/orders:
 *   get:
 *     summary: Recent spot orders for the current user
 *     security:
 *       - bearerAuth: []
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           example: OPEN
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Spot order list
 */

/**
 * @openapi
 * /api/dashboard/tickers:
 *   get:
 *     summary: Latest ticker snapshots
 *     security:
 *       - bearerAuth: []
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: symbols
 *         schema:
 *           type: string
 *           example: BTCUSDT,ETHUSDT
 *     responses:
 *       200:
 *         description: Array of ticker snapshots
 */

/**
 * @openapi
 * /api/dashboard/market-pulse:
 *   get:
 *     summary: Market pulse candle series
 *     security:
 *       - bearerAuth: []
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *           example: BTCUSDT
 *       - in: query
 *         name: interval
 *         schema:
 *           type: string
 *           default: 1m
 *           example: 5m
 *       - in: query
 *         name: candles
 *         schema:
 *           type: integer
 *           default: 120
 *     responses:
 *       200:
 *         description: Candle snapshot for charting
 */

/**
 * @openapi
 * /api/dashboard/top-movers:
 *   get:
 *     summary: Absolute top movers over a window
 *     security:
 *       - bearerAuth: []
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: window
 *         schema:
 *           type: string
 *           default: 24h
 *           example: 12h
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 3
 *           maximum: 20
 *       - in: query
 *         name: universe
 *         schema:
 *           type: string
 *           default: spot
 *           example: perpetual
 *     responses:
 *       200:
 *         description: Movers with change statistics
 */

/**
 * @openapi
 * /api/dashboard/promotions:
 *   get:
 *     summary: Active dashboard promotions
 *     security:
 *       - bearerAuth: []
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: placement
 *         schema:
 *           type: string
 *           example: dashboard
 *     responses:
 *       200:
 *         description: Promotion list
 */

/**
 * @openapi
 * /api/dashboard/news:
 *   get:
 *     summary: Dashboard news feed
 *     security:
 *       - bearerAuth: []
 *     tags: [Dashboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: News items
 */

import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { ok } from '../utils/responses.js';
import {
  getWalletSummary,
  getPositions,
  listOrders,
  getTickerSnapshots,
  getPromotions,
  getNews,
  getTopMovers,
  marketPulse,
  getTopMoversDetailed,
} from '../services/dashboardService.js';

const router = express.Router();

router.get('/summary', requireAuth, async (req, res) => {
  ok(res, await getWalletSummary(req.user.id));
});

router.get('/positions', requireAuth, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  ok(res, await getPositions(req.user.id, { status }));
});

router.get('/orders', requireAuth, async (req, res) => {
  const limit = Number(req.query.limit);
  const status = req.query.status ? String(req.query.status) : undefined;
  const normalizedLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : undefined;
  ok(res, await listOrders(req.user.id, { status, limit: normalizedLimit }));
});

router.get('/tickers', requireAuth, async (req, res) => {
  const raw = req.query.symbols ? String(req.query.symbols) : undefined;
  const symbols = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  ok(res, await getTickerSnapshots(symbols));
});

router.get('/market-pulse', requireAuth, async (req, res) => {
  const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : null;
  if (!symbol) {
    return res.status(400).json({ message: 'symbol is required', code: 'BAD_REQUEST' });
  }
  const interval = req.query.interval ? String(req.query.interval) : '1m';
  const requestedCandles = Number(req.query.candles);
  const candles =
    Number.isFinite(requestedCandles) && requestedCandles > 0
      ? Math.min(Math.floor(requestedCandles), 500)
      : 120;
  try {
    const data = await marketPulse(symbol, { interval, points: candles });
    ok(res, data);
  } catch (err) {
    console.error('[dashboard] market-pulse error', err.message);
    if (err.message === 'SYMBOL_REQUIRED') {
      return res.status(400).json({ message: 'symbol is required', code: 'BAD_REQUEST' });
    }
    if (err.message === 'NO_CANDLES') {
      return res.status(404).json({ message: 'Unable to load market pulse data', code: 'MARKET_DATA_EMPTY' });
    }
    const fallback = {
      symbol,
      interval,
      points: candles,
      error: err.message || 'MARKET_PULSE_FAILED',
      candles: [],
      updatedAt: new Date().toISOString(),
    };
    ok(res, fallback);
  }
});

router.get('/movers', requireAuth, async (req, res) => {
  const limit = Number(req.query.limit);
  const normalized =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 20) : 3;
  const windowParam = req.query.window ? String(req.query.window) : undefined;
  const universe = req.query.universe ? String(req.query.universe) : undefined;
  try {
    const snapshot = await getTopMoversDetailed({
      limit: normalized,
      window: windowParam,
      universe,
    });
    ok(res, snapshot.movers);
  } catch (err) {
    console.error('[dashboard] movers error', err.message);
    ok(res, []);
  }
});

router.get('/top-movers', requireAuth, async (req, res) => {
  const limit = Number(req.query.limit);
  const normalized =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 20) : 3;
  const windowParam = req.query.window ? String(req.query.window) : undefined;
  const universe = req.query.universe ? String(req.query.universe) : undefined;
  try {
    const snapshot = await getTopMoversDetailed({
      limit: normalized,
      window: windowParam,
      universe,
    });
    ok(res, snapshot);
  } catch (err) {
    console.error('[dashboard] top-movers error', err.message);
    const fallback = {
      window: windowParam || '24h',
      limit: normalized,
      movers: [],
      updatedAt: new Date().toISOString(),
      staleAt: null,
      error: err.message || 'TOP_MOVERS_FAILED',
    };
    ok(res, fallback);
  }
});

router.get('/promotions', requireAuth, async (req, res) => {
  const placement = req.query.placement ? String(req.query.placement) : 'dashboard';
  ok(res, await getPromotions({ placement }));
});

router.get('/news', requireAuth, async (req, res) => {
  const limit = Number(req.query.limit);
  const normalized =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 50) : 10;
  ok(res, await getNews(normalized));
});

export default router;
