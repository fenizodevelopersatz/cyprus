// =============================
// src/routes/markets.js
// =============================

/**
 * @openapi
 * tags:
 *   - name: Markets
 *     description: Market data endpoints
 */

/**
 * @openapi
 * /markets/tickers:
 *   get:
 *     summary: List all market tickers
 *     tags:
 *       - Markets
 *     responses:
 *       200:
 *         description: Array of market tickers with prices and stats
 */

/**
 * @openapi
 * /markets/{symbol}/orderbook:
 *   get:
 *     summary: Get order book snapshot for a specific market
 *     tags:
 *       - Markets
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: Market symbol (e.g., BTC-USDT)
 *     responses:
 *       200:
 *         description: Current bids and asks for the market
 */

/**
 * @openapi
 * /markets/{symbol}/trades:
 *   get:
 *     summary: Get recent trades for a specific market
 *     tags:
 *       - Markets
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: Market symbol (e.g., BTC-USDT)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 500
 *         description: Maximum number of recent trades to return
 *     responses:
 *       200:
 *         description: List of recent trades
 */

/**
 * @openapi
 * /markets/{symbol}/candles:
 *   get:
 *     summary: Get candle (OHLCV) data for a specific market
 *     tags:
 *       - Markets
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *         description: Market symbol (e.g., BTC-USDT)
 *       - in: query
 *         name: interval
 *         schema:
 *           type: string
 *           example: "1m"
 *         description: Candle interval (e.g., 1m, 5m, 1h, 1d)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Number of candles to return
 *     responses:
 *       200:
 *         description: List of OHLCV candle data
 */

/**
 * @openapi
 * /markets/top-movers:
 *   get:
 *     summary: Get top movers by percentage change
 *     tags:
 *       - Markets
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 3
 *     responses:
 *       200:
 *         description: List of movers
 */

/**
 * @openapi
 * /markets/{symbol}/history:
 *   get:
 *     summary: Get mid-price history series
 *     tags:
 *       - Markets
 *     parameters:
 *       - in: path
 *         name: symbol
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: interval
 *         schema:
 *           type: string
 *           default: 1m
 *       - in: query
 *         name: points
 *         schema:
 *           type: integer
 *           default: 60
 *     responses:
 *       200:
 *         description: Mid price series
 */

import express from 'express';
import { ok, fail } from '../utils/responses.js';
import * as svc from '../services/marketService.js';

const r = express.Router();

r.get('/tickers', async (req, res) => {
  const symbols = req.query.symbols;
  const window = req.query.window ? String(req.query.window) : undefined;
  ok(res, await svc.tickers({ symbols, window }));
});

r.get('/top-movers', async (req, res) => {
  const raw = Number(req.query.limit);
  const limit =
    Number.isFinite(raw) && raw > 0 ? Math.min(50, Math.floor(raw)) : 3;
  ok(res, await svc.topMovers(limit));
});

r.get('/:symbol/history', async (req, res) => {
  const interval = req.query.interval ? String(req.query.interval) : '1m';
  const rawPoints = Number(req.query.points);
  const points =
    Number.isFinite(rawPoints) && rawPoints > 0
      ? Math.min(1000, Math.floor(rawPoints))
      : 60;
  ok(res, await svc.priceHistory(req.params.symbol, { interval, points }));
});

r.get('/:symbol/orderbook', async (req, res) => {
  try {
    ok(res, await svc.orderbook(req.params.symbol));
  } catch (e) {
    fail(res, e.message, 400);
  }
});

r.get('/:symbol/trades', async (req, res) => {
  const raw = Number(req.query.limit);
  const limit =
    Number.isFinite(raw) && raw > 0 ? Math.min(500, Math.floor(raw)) : 50;
  ok(res, await svc.trades(req.params.symbol, limit));
});

r.get('/:symbol/candles', async (req, res) => {
  ok(res, []);
});

export default r;
