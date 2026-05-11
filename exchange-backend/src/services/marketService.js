import { db } from '../db.js';
import { allowedSpotSymbols, isSpotSymbolAllowed } from '../utils/symbols.js';
import { fetchTickerRest, getCandleSeries } from './binanceSync.js';

const WINDOW_MS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

function normalizeSymbolStrict(symbol) {
  const upper = String(symbol || '').trim().toUpperCase();
  if (!upper) throw new Error('SYMBOL_REQUIRED');
  if (!isSpotSymbolAllowed(upper)) throw new Error('SYMBOL_NOT_ALLOWED');
  return upper;
}

function normalizeSymbols(input) {
  if (!input) return null;
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string'
    ? input.split(',')
    : [];
  const normalized = list
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean)
    .filter((symbol) => isSpotSymbolAllowed(symbol));
  if (!normalized.length) return [];
  return Array.from(new Set(normalized));
}

function normalizeWindow(window) {
  const key = String(window || '24h').trim().toLowerCase();
  return WINDOW_MS[key] ? key : '24h';
}

async function resolveWindowChange(symbol, ticker24h, effectiveWindow) {
  if (effectiveWindow === '24h') {
    return {
      open: Number(ticker24h.open || 0),
      change: Number(ticker24h.change || 0),
      changePct: Number(ticker24h.changePct || 0),
    };
  }

  const series = await getCandleSeries(symbol, { interval: '1m', limit: 90 });
  const candles = Array.isArray(series?.candles) ? series.candles : [];
  const latest = candles.at(-1);
  if (!latest) {
    return {
      open: Number(ticker24h.open || 0),
      change: Number(ticker24h.change || 0),
      changePct: Number(ticker24h.changePct || 0),
    };
  }

  const cutoff = Date.now() - WINDOW_MS[effectiveWindow];
  const referenceCandle =
    candles.find((candle) => Number(candle.openTime || 0) <= cutoff && Number(candle.closeTime || 0) >= cutoff) ||
    [...candles].reverse().find((candle) => Number(candle.openTime || 0) <= cutoff) ||
    candles[0];
  const referenceOpen = Number(referenceCandle?.open || 0);
  const last = Number(latest.close || ticker24h.last || 0);
  const change = last - referenceOpen;
  const changePct = referenceOpen > 0 ? (change / referenceOpen) * 100 : 0;

  return {
    open: Number(referenceOpen.toFixed(8)),
    change: Number(change.toFixed(8)),
    changePct: Number(changePct.toFixed(2)),
  };
}

export async function tickers({ symbols, window } = {}) {
  const hasFilter = Array.isArray(symbols)
    ? symbols.length > 0
    : typeof symbols === 'string'
    ? symbols.trim().length > 0
    : false;
  const normalized = normalizeSymbols(symbols);
  const effectiveWindow = normalizeWindow(window);
  const marketQuery = db('market_symbols');
  if (hasFilter) {
    if (!normalized?.length) return [];
    marketQuery.whereIn('symbol', normalized);
  } else if (allowedSpotSymbols.length) {
    marketQuery.whereIn('symbol', allowedSpotSymbols);
  }
  const markets = await marketQuery.select('*');
  if (!markets.length) return [];

  return Promise.all(markets.map(async (market) => {
    const ticker24h = await fetchTickerRest(market.symbol);
    const windowStats = await resolveWindowChange(market.symbol, ticker24h, effectiveWindow);
    return {
      symbol: market.symbol,
      baseAsset: market.base_asset,
      quoteAsset: market.quote_asset,
      last: Number(ticker24h.last || 0),
      open: windowStats.open,
      high: Number(ticker24h.high || 0),
      low: Number(ticker24h.low || 0),
      change: windowStats.change,
      changePct: windowStats.changePct,
      volume: Number(ticker24h.volume || 0),
      volumeQuote: Number(ticker24h.quoteVolume || 0),
      updatedAt: ticker24h.eventTime ? new Date(ticker24h.eventTime).toISOString() : new Date().toISOString(),
      window: effectiveWindow,
    };
  }));
}

export async function topMovers(limit = 3) {
  const snapshots = await tickers();
  return snapshots
    .filter((snap) => Number.isFinite(snap.changePct))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, limit);
}

export async function priceHistory(symbol, { interval = '1m', points = 60 } = {}) {
  const upper = normalizeSymbolStrict(symbol);
  const limit = Math.min(Math.max(points || 0, 1), 1000);
  const rows = await db('futures_price_ticks')
    .where({ symbol: upper })
    .orderBy('timestamp', 'desc')
    .limit(limit);

  return rows
    .map((row) => ({
      timestamp: row.timestamp,
      price: Number(row.price),
    }))
    .reverse();
}

export async function latestPrice(symbol) {
  const upper = normalizeSymbolStrict(symbol);
  const lastTick = await db('futures_price_ticks')
    .where({ symbol: upper })
    .orderBy('timestamp', 'desc')
    .first();
  if (lastTick) return Number(lastTick.price);
  const market = await db('market_symbols').where({ symbol: upper }).first();
  return Number(market?.last_price || 0);
}

export async function orderbook(symbol) {
  const upper = normalizeSymbolStrict(symbol);
  const bids = await db('spot_orders')
    .where({ symbol: upper, side: 'BUY', status: 'NEW' })
    .orderBy('price', 'desc');
  const asks = await db('spot_orders')
    .where({ symbol: upper, side: 'SELL', status: 'NEW' })
    .orderBy('price', 'asc');
  const top = (rows) =>
    rows
      .map((r) => [Number(r.price), Number(r.size) - Number(r.filled)])
      .filter((x) => x[1] > 0);
  return { bids: top(bids), asks: top(asks) };
}

export async function trades(symbol, limit = 50) {
  const upper = normalizeSymbolStrict(symbol);
  return db('spot_trades as t')
    .join('spot_orders as o', 't.order_id', 'o.id')
    .where('o.symbol', upper)
    .orderBy('t.created_at', 'desc')
    .limit(limit)
    .select('t.*');
}
