import Binance from 'binance-api-node';
import { EventEmitter } from 'events';
import { db } from '../db.js';
import { cfg } from '../config.js';
import { isSpotSymbolAllowed, allowedSpotSymbols, symbolMeta } from '../utils/symbols.js';

const MARKET_STREAM_STATE = {
  miniTicker: null,
  candles: null,
  started: false,
};

const tickerCache = new Map();
const lastTickPersist = new Map();
const userStreams = new Map();
const keepAliveTimers = new Map();
const candleCache = new Map();
const candleCacheMeta = new Map();
const restCandleCache = new Map();
const depthCache = new Map();
const depthStreams = new Map();
const tradeCache = new Map();
const tradeStreams = new Map();
const exchangeInfoCache = { fetchedAt: 0, raw: null, symbolMap: new Map() };
export const exchangeEmitter = new EventEmitter();
exchangeEmitter.setMaxListeners(100);

const BINANCE_CACHE_RETENTION_MS = 60 * 1000;
const LISTEN_KEY_REFRESH_MS = 30 * 60 * 1000;
const CANDLE_CACHE_LIMIT = 600;
const CANDLE_REST_TTL_MS = 5 * 1000;
const DAILY_STATS_TTL_MS = 10 * 1000;
let exchangeTableChecked = false;
let exchangeTableAvailable = false;
let dailyStatsCache = { fetchedAt: 0, data: null };
const QUOTE_ASSET_CANDIDATES = [
  'USDT',
  'BUSD',
  'USDC',
  'FDUSD',
  'TUSD',
  'BTC',
  'ETH',
  'BNB',
  'EUR',
  'TRY',
  'BRL',
  'AUD',
  'GBP',
  'JPY',
  'RUB',
];

const INTERVAL_MS = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

function intervalToMs(interval) {
  return INTERVAL_MS[interval] || 60_000;
}

function demoBasePrice(symbol) {
  if (!symbol) return 100;
  const upper = symbol.toUpperCase();
  let seed = 0;
  for (let i = 0; i < upper.length; i += 1) {
    seed += upper.charCodeAt(i);
  }
  return Number((50 + (seed % 700) + (seed % 13) / 10).toFixed(2));
}

function buildDemoCandles(symbol, interval = '1m', limit = 120) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 500);
  const step = intervalToMs(interval);
  const base = demoBasePrice(symbol);
  const now = Date.now();
  const candles = [];
  for (let i = safeLimit - 1; i >= 0; i -= 1) {
    const openTime = now - i * step;
    const closeTime = openTime + step;
    const wave = Math.sin((openTime / step) * 0.1);
    const drift = Math.cos(i * 0.3);
    const open = base + wave;
    const close = open + drift * 0.5;
    const high = Math.max(open, close) + Math.abs(wave) * 0.2;
    const low = Math.min(open, close) - Math.abs(wave) * 0.2;
    candles.push({
      symbol,
      interval,
      openTime,
      closeTime,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Number((Math.abs(drift) * 100 + 50).toFixed(2)),
      trades: Math.floor(50 + Math.abs(wave) * 25),
      eventTime: closeTime,
    });
  }
  return candles;
}

function buildDemoTicker(symbol) {
  const price = demoBasePrice(symbol);
  const change = Math.sin(Date.now() / 60000) * 5;
  return {
    symbol,
    last: price,
    change,
    priceChange: change,
    open: Number((price - change).toFixed(2)),
    high: Number((price + Math.abs(change)).toFixed(2)),
    low: Number((price - Math.abs(change)).toFixed(2)),
    volume: 100000,
    volumeQuote: 100000 * price,
    eventTime: Date.now(),
  };
}

function buildDemoDepth(symbol, limit = 100) {
  const price = demoBasePrice(symbol);
  const levels = Math.min(Math.max(limit, 10), 200);
  const bids = [];
  const asks = [];
  for (let i = 1; i <= levels; i += 1) {
    bids.push([Number((price - i * 0.05).toFixed(2)), Number((5 + i * 0.1).toFixed(2))]);
    asks.push([Number((price + i * 0.05).toFixed(2)), Number((5 + i * 0.1).toFixed(2))]);
  }
  return { bids, asks, lastUpdateId: Date.now(), updatedAt: new Date() };
}

function buildDemoTrades(symbol, limit = 100) {
  const price = demoBasePrice(symbol);
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const trades = [];
  for (let i = 0; i < safeLimit; i += 1) {
    trades.push({
      id: Date.now() - i,
      price: Number((price + Math.sin(i / 3) * 0.5).toFixed(2)),
      qty: Number((1 + (i % 5) * 0.1).toFixed(3)),
      quoteQty: Number((price + Math.sin(i / 3) * 0.5).toFixed(2) * (1 + (i % 5) * 0.1)),
      side: i % 2 === 0 ? 'buy' : 'sell',
      time: Date.now() - i * 1000,
    });
  }
  return trades;
}

function buildDemoDailyStats() {
  return allowedSpotSymbols.map((symbol, idx) => ({
    symbol,
    lastPrice: demoBasePrice(symbol),
    close: demoBasePrice(symbol),
    priceChangePercent: ((idx % 10) - 5).toFixed(2),
    quoteVolume: 100000 + idx * 5000,
    volume: 5000 + idx * 100,
  }));
}

function buildDemoExchangeInfoPayload() {
  const symbols = allowedSpotSymbols.map((symbol) => {
    const meta = symbolMeta[symbol] || { base: symbol.replace('USDT', ''), quote: 'USDT' };
    return {
      symbol,
      status: 'TRADING',
      baseAsset: meta.base,
      quoteAsset: meta.quote,
      baseAssetPrecision: 8,
      quoteAssetPrecision: 8,
      quotePrecision: 8,
      orderTypes: ['LIMIT', 'MARKET'],
      permissions: ['SPOT'],
      filters: [
        {
          filterType: 'PRICE_FILTER',
          tickSize: meta.tick || 0.01,
          minPrice: meta.tick || 0.01,
          maxPrice: null,
        },
        {
          filterType: 'LOT_SIZE',
          stepSize: meta.lot || 0.001,
          minQty: meta.min || meta.lot || 0.001,
          maxQty: meta.max || null,
        },
        {
          filterType: 'MIN_NOTIONAL',
          minNotional: meta.min || 10,
        },
      ],
    };
  });
  return {
    timezone: 'UTC',
    serverTime: Date.now(),
    symbols,
  };
}

const ENABLE_BINANCE =
  String(process.env.ENABLE_BINANCE || '').toLowerCase() === 'true' ||
  String(process.env.BINANCE_ENABLED || '').toLowerCase() === 'true';

const spotHttpBase =
  cfg.binance?.spotBaseRest ||
  (cfg.binance?.spotTestnet ? 'https://testnet.binance.vision' : undefined);
const spotWsBase =
  cfg.binance?.spotBaseWs ||
  (cfg.binance?.spotTestnet ? 'wss://testnet.binance.vision/ws' : undefined);

function resolveBinanceFactory() {
  if (typeof Binance === 'function') return Binance;
  if (Binance && typeof Binance.default === 'function') return Binance.default;
  return null;
}

const BinanceFactory = resolveBinanceFactory();
const baseClientOptions = {};
if (spotHttpBase) baseClientOptions.httpBase = spotHttpBase;
if (spotWsBase) baseClientOptions.wsBase = spotWsBase;

const guardSymbol = Symbol.for('novax.binance.wsGuard');
if (!global[guardSymbol]) {
  process.on('uncaughtException', (err) => {
    if (err?.message?.includes('WebSocket was closed before the connection was established')) {
      warn('suppressed websocket handshake failure', err.message);
      return;
    }
    throw err;
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.includes('WebSocket was closed before the connection was established')) {
      warn('suppressed websocket handshake rejection', message);
      return;
    }
    console.error('[binance] unhandled rejection', reason);
  });

  global[guardSymbol] = true;
}

function log(...args) {
  if (process.env.NODE_ENV === 'test') return;
  console.log('[binance]', ...args);
}

function warn(...args) {
  if (process.env.NODE_ENV === 'test') return;
  console.warn('[binance]', ...args);
}

function attachStreamGuards(stream, label) {
  if (!stream) return stream;
  const onError = (err) => {
    warn(`${label} stream error`, err?.message || err);
  };
  const onClose = (code, reason) => {
    const reasonMsg =
      typeof reason === 'string'
        ? reason
        : Buffer.isBuffer(reason)
        ? reason.toString('utf8')
        : undefined;
    warn(`${label} stream closed`, code, reasonMsg);
  };
  const onUnexpectedResponse = (_req, res) => {
    warn(`${label} stream unexpected response`, res?.statusCode);
  };

  if (typeof stream.on === 'function') {
    stream.on('error', onError);
    stream.on('close', onClose);
    stream.on('unexpected-response', onUnexpectedResponse);
  } else if (typeof stream.addEventListener === 'function') {
    stream.addEventListener('error', onError);
    stream.addEventListener('close', onClose);
  }

  return stream;
}

function safeClose(stream) {
  if (!stream) return;
  try {
    if (typeof stream.close === 'function') {
      stream.close();
    } else if (typeof stream.terminate === 'function') {
      stream.terminate();
    }
  } catch (err) {
    warn('error while closing stream', err?.message || err);
  }
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function splitSymbolParts(symbol) {
  if (!symbol) return { base: '', quote: '' };
  const upper = symbol.toUpperCase();
  for (const quote of QUOTE_ASSET_CANDIDATES) {
    if (upper.endsWith(quote)) {
      return { base: upper.slice(0, -quote.length), quote };
    }
  }
  return { base: upper.slice(0, Math.max(upper.length - 4, 1)), quote: upper.slice(-4) };
}

function candleKey(symbol, interval) {
  return `${symbol.toUpperCase()}:${interval}`;
}

function normalizeCandle(symbol, interval, candle) {
  const openTime = Number(
    candle.openTime ?? candle.startTime ?? candle.klineStartTime ?? candle.t ?? Date.now()
  );
  const closeTime = Number(
    candle.closeTime ?? candle.klineCloseTime ?? (openTime ? openTime + (candle.intervalMs ?? 0) : openTime)
  );
  return {
    symbol,
    interval,
    openTime,
    closeTime,
    open: parseNumber(candle.open),
    high: parseNumber(candle.high),
    low: parseNumber(candle.low),
    close: parseNumber(candle.close),
    volume: parseNumber(candle.volume),
    trades: candle.trades ?? null,
    eventTime: candle.eventTime ?? Date.now(),
  };
}

function upsertCandleCache(symbol, interval, candle) {
  const key = candleKey(symbol, interval);
  const list = candleCache.get(key) || [];
  const normalized = normalizeCandle(symbol, interval, candle);
  const existingIndex = list.findIndex((c) => c.openTime === normalized.openTime);
  if (existingIndex >= 0) {
    list[existingIndex] = normalized;
  } else {
    list.push(normalized);
    if (list.length > CANDLE_CACHE_LIMIT) list.shift();
  }
  candleCache.set(key, list);
  candleCacheMeta.set(key, { updatedAt: new Date(normalized.eventTime || Date.now()) });
}

function getCachedCandles(symbol, interval, limit) {
  const key = candleKey(symbol, interval);
  const list = candleCache.get(key);
  if (!list?.length) return null;
  if (limit && Number.isFinite(limit)) {
    return list.slice(-Math.max(1, Math.floor(limit)));
  }
  return list.slice();
}

function getCandleMeta(symbol, interval) {
  return candleCacheMeta.get(candleKey(symbol, interval));
}

async function fetchCandlesRest(symbol, interval, limit) {
  if (!ENABLE_BINANCE || !publicClient) {
    const candles = buildDemoCandles(symbol, interval, limit);
    const meta = { updatedAt: new Date() };
    return { candles, meta };
  }
  const key = candleKey(symbol, interval);
  const cached = restCandleCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_REST_TTL_MS && (!limit || cached.limit >= limit)) {
    const slice = limit ? cached.data.slice(-limit) : cached.data.slice();
    return { candles: slice, meta: { updatedAt: cached.updatedAt } };
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 500);
  let series;
  try {
    series = await publicClient.candles({
      symbol,
      interval,
      limit: safeLimit,
    });
  } catch (err) {
    warn('candles fetch failed', symbol, err?.message || err);
    const candles = buildDemoCandles(symbol, interval, safeLimit);
    const meta = { updatedAt: new Date() };
    return { candles, meta };
  }

  const normalized = series.map((row) => ({
    symbol,
    interval,
    openTime: Number(row.openTime),
    closeTime: Number(row.closeTime),
    open: parseNumber(row.open),
    high: parseNumber(row.high),
    low: parseNumber(row.low),
    close: parseNumber(row.close),
    volume: parseNumber(row.volume),
    trades: row.trades ?? null,
    eventTime: Number(row.closeTime),
  }));

  normalized.forEach((candle) => upsertCandleCache(symbol, interval, candle));

  const meta = { updatedAt: new Date() };
  restCandleCache.set(key, { data: normalized, fetchedAt: Date.now(), updatedAt: meta.updatedAt, limit: safeLimit });
  const slice = limit ? normalized.slice(-limit) : normalized.slice();
  return { candles: slice, meta };
}

function createClient(apiKey, apiSecret) {
  try {
    if (!BinanceFactory) {
      throw new Error('Binance SDK unavailable');
    }
    const options = { ...baseClientOptions };
    if (apiKey && apiSecret) {
      options.apiKey = apiKey;
      options.apiSecret = apiSecret;
    }
    return BinanceFactory(options);
  } catch (err) {
    log('failed to create client', err.message);
    return null;
  }
}

const publicClient = ENABLE_BINANCE
  ? createClient(cfg.binance?.apiKey, cfg.binance?.apiSecret) || createClient()
  : null;

function getSpotRestBaseCandidates() {
  const candidates = [
    cfg.binance?.spotBaseRest,
    cfg.binance?.spotTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com',
    cfg.binance?.spotTestnet ? null : 'https://api1.binance.com',
    cfg.binance?.spotTestnet ? null : 'https://api2.binance.com',
    cfg.binance?.spotTestnet ? null : 'https://api3.binance.com',
    cfg.binance?.spotTestnet ? 'https://testnet.binance.vision' : 'https://data-api.binance.vision',
  ];

  return Array.from(
    new Set(
      candidates
        .map((value) => String(value || '').trim().replace(/\/+$/, ''))
        .filter(Boolean)
    )
  );
}

async function fetchSpotJson(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });

  const bases = getSpotRestBaseCandidates();
  let lastError = null;

  for (const base of bases) {
    const url = `${base}${path}${query.size ? `?${query.toString()}` : ''}`;
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText}${body ? ` ${body}` : ''}`.trim());
      }
      return await response.json();
    } catch (err) {
      lastError = new Error(`${base}: ${err?.message || err}`);
    }
  }

  throw lastError || new Error('Spot REST fetch failed');
}

async function ensureExchangeConnectionsTable() {
  if (exchangeTableChecked) return exchangeTableAvailable;
  try {
    exchangeTableAvailable = await db.schema.hasTable('exchange_connections');
    if (!exchangeTableAvailable) {
      log('exchange_connections table missing - apply migrations to enable Binance sync');
    }
  } catch (err) {
    log('failed verifying exchange_connections table', err.message);
    exchangeTableAvailable = false;
  }
  exchangeTableChecked = true;
  return exchangeTableAvailable;
}

async function refreshExchangeInfo(force = false) {
  const maxAge = cfg.binance?.spotTestnet ? 2 * 60 * 1000 : 5 * 60 * 1000;
  if (!force && exchangeInfoCache.raw && Date.now() - exchangeInfoCache.fetchedAt < maxAge) {
    return exchangeInfoCache;
  }
  if (!ENABLE_BINANCE || !publicClient) {
    const info = buildDemoExchangeInfoPayload();
    const map = new Map(info.symbols.map((symbolInfo) => [symbolInfo.symbol, symbolInfo]));
    exchangeInfoCache.raw = info;
    exchangeInfoCache.symbolMap = map;
    exchangeInfoCache.fetchedAt = Date.now();
    return exchangeInfoCache;
  }
  try {
    const info = await publicClient.exchangeInfo();
    const map = new Map();
    if (info?.symbols) {
      for (const symbolInfo of info.symbols) {
        map.set(symbolInfo.symbol, symbolInfo);
      }
    }
    exchangeInfoCache.raw = info;
    exchangeInfoCache.symbolMap = map;
    exchangeInfoCache.fetchedAt = Date.now();
    return exchangeInfoCache;
  } catch (err) {
    warn('exchange info fetch failed', err?.message || err);
    if (exchangeInfoCache.raw) return exchangeInfoCache;
    const info = buildDemoExchangeInfoPayload();
    const map = new Map(info.symbols.map((symbolInfo) => [symbolInfo.symbol, symbolInfo]));
    exchangeInfoCache.raw = info;
    exchangeInfoCache.symbolMap = map;
    exchangeInfoCache.fetchedAt = Date.now();
    return exchangeInfoCache;
  }
}

export async function getExchangeInfo(symbol) {
  await refreshExchangeInfo();
  if (!symbol) return exchangeInfoCache.raw;
  return exchangeInfoCache.symbolMap.get(symbol.toUpperCase()) || null;
}

async function updateMarketSymbols(symbol, price) {
  if (!isSpotSymbolAllowed(symbol)) return;
  try {
    const updated = await db('market_symbols').where({ symbol }).first();
    if (!updated) return;
    await db('market_symbols').where({ symbol }).update({ last_price: price });
  } catch (err) {
    log('failed to update market symbol', symbol, err.message);
  }
}

async function insertPriceTick(symbol, price, timestamp) {
  if (!isSpotSymbolAllowed(symbol)) return;
  const last = lastTickPersist.get(symbol) || 0;
  if (Date.now() - last < BINANCE_CACHE_RETENTION_MS) return;
  lastTickPersist.set(symbol, Date.now());
  try {
    await db('futures_price_ticks').insert({
      symbol,
      price,
      timestamp: new Date(timestamp),
    });
  } catch (err) {
    log('failed to insert price tick', symbol, err.message);
  }
}

async function handleMiniTickerUpdate(update) {
  const symbol = update.s;
  if (!isSpotSymbolAllowed(symbol)) return;
  const lastPrice = parseNumber(update.c);
  tickerCache.set(symbol, {
    symbol,
    last: lastPrice,
    change: parseNumber(update.p),
    changePct: parseNumber(update.P),
    priceChange: parseNumber(update.p),
    open: parseNumber(update.o),
    high: parseNumber(update.h),
    low: parseNumber(update.l),
    volume: parseNumber(update.v),
    volumeQuote: parseNumber(update.q),
    eventTime: update.E,
  });
  await updateMarketSymbols(symbol, lastPrice);
  await insertPriceTick(symbol, lastPrice, update.E);
  exchangeEmitter.emit('ticker', {
    symbol,
    last: lastPrice,
    change: parseNumber(update.p),
    changePct: parseNumber(update.P),
    open: parseNumber(update.o),
    high: parseNumber(update.h),
    low: parseNumber(update.l),
    volume: parseNumber(update.v),
    volumeQuote: parseNumber(update.q),
    eventTime: update.E,
  });
}

function ensureDepthStream(symbol) {
  const upper = symbol.toUpperCase();
  if (!isSpotSymbolAllowed(upper)) return;
  if (depthStreams.has(upper)) return;
  const stream = publicClient?.ws?.depth?.(upper, (update) => {
    handleDepthUpdate(upper, update);
  });
  if (stream) {
    attachStreamGuards(stream, `depth:${upper}`);
    depthStreams.set(upper, stream);
    seedDepth(upper).catch((err) => warn('depth seed error', upper, err?.message || err));
  }
}

function ensureTradeStream(symbol) {
  const upper = symbol.toUpperCase();
  if (!isSpotSymbolAllowed(upper)) return;
  if (tradeStreams.has(upper)) return;
  const stream = publicClient?.ws?.trades?.(upper, (trade) => {
    handleTradeUpdate(upper, trade);
  });
  if (stream) {
    attachStreamGuards(stream, `trade:${upper}`);
    tradeStreams.set(upper, stream);
  }
}

export function trackSpotSymbol(symbol) {
  if (!ENABLE_BINANCE) return;
  const upper = symbol.toUpperCase();
  if (!isSpotSymbolAllowed(upper)) return;
  ensureDepthCache(upper);
  ensureTradeCache(upper);
  ensureDepthStream(upper);
  ensureTradeStream(upper);
}

function ensureDepthCache(symbol) {
  const upper = symbol.toUpperCase();
  if (!depthCache.has(upper)) {
    depthCache.set(upper, {
      bids: new Map(),
      asks: new Map(),
      lastUpdateId: 0,
      updatedAt: null,
    });
  }
  return depthCache.get(upper);
}

function normalizeDepthEntry(entry) {
  if (!entry) return null;
  if (Array.isArray(entry)) {
    const [price, qty] = entry;
    return { price: Number(price), qty: Number(qty) };
  }
  if (typeof entry === 'object') {
    const price = entry.price ?? entry.p ?? entry[0];
    const qty = entry.quantity ?? entry.qty ?? entry.q ?? entry[1];
    if (price === undefined || qty === undefined) return null;
    return { price: Number(price), qty: Number(qty) };
  }
  if (typeof entry === 'string') {
    const parts = entry.split(',');
    if (parts.length >= 2) {
      return { price: Number(parts[0]), qty: Number(parts[1]) };
    }
  }
  return null;
}

function applyDepthLevels(map, updates) {
  if (!updates || !updates[Symbol.iterator]) return;
  for (const entry of updates) {
    const normalized = normalizeDepthEntry(entry);
    if (!normalized) continue;
    const { price, qty } = normalized;
    if (!Number.isFinite(price)) continue;
    if (!Number.isFinite(qty) || qty <= 0) {
      map.delete(price);
    } else {
      map.set(price, qty);
    }
  }
}

function sortDepth(map, direction = 'desc', limit = 100) {
  const entries = Array.from(map.entries()).map(([price, qty]) => [Number(price), Number(qty)]);
  entries.sort((a, b) => (direction === 'desc' ? b[0] - a[0] : a[0] - b[0]));
  return entries.slice(0, limit);
}

async function seedDepth(symbol, limit = 200) {
  if (!isSpotSymbolAllowed(symbol)) return;
  if (!publicClient) return;
  try {
    const depthFn = publicClient.depth || publicClient.book;
    if (!depthFn) throw new Error('depth API not available');
    let raw;
    try {
      raw = await depthFn.call(publicClient, { symbol, limit: Math.min(limit, 500) });
    } catch (sdkErr) {
      raw = await fetchSpotJson('/api/v3/depth', {
        symbol,
        limit: Math.min(limit, 500),
      }).catch((restErr) => {
        throw new Error(
          `sdk=${sdkErr?.message || sdkErr}; fallback=${restErr?.message || restErr}`
        );
      });
    }
    const snapshot = Array.isArray(raw)
      ? {
          bids: raw[0] || [],
          asks: raw[1] || [],
          lastUpdateId: raw.lastUpdateId || 0,
        }
      : raw;
    const cache = ensureDepthCache(symbol);
    cache.bids.clear();
    cache.asks.clear();
    applyDepthLevels(cache.bids, snapshot.bids || snapshot.bidDepth || snapshot.b || []);
    applyDepthLevels(cache.asks, snapshot.asks || snapshot.askDepth || snapshot.a || []);
    cache.lastUpdateId = snapshot.lastUpdateId || 0;
    cache.updatedAt = new Date();
  } catch (err) {
    warn('depth snapshot failed', symbol, err?.message || err);
  }
}

function handleDepthUpdate(symbol, update) {
  if (!isSpotSymbolAllowed(symbol)) return;
  const cache = ensureDepthCache(symbol);
  applyDepthLevels(cache.bids, update.bidDepth || update.bids || update.b || []);
  applyDepthLevels(cache.asks, update.askDepth || update.asks || update.a || []);
  cache.lastUpdateId =
    update.lastUpdateId || update.finalUpdateId || update.u || cache.lastUpdateId;
  cache.updatedAt = new Date();
  exchangeEmitter.emit('orderbook', {
    symbol,
    bids: sortDepth(cache.bids, 'desc', 100),
    asks: sortDepth(cache.asks, 'asc', 100),
    lastUpdateId: cache.lastUpdateId,
    updatedAt: cache.updatedAt,
  });
}

function ensureTradeCache(symbol) {
  const upper = symbol.toUpperCase();
  if (!tradeCache.has(upper)) {
    tradeCache.set(upper, []);
  }
  return tradeCache.get(upper);
}

function handleTradeUpdate(symbol, trade) {
  if (!isSpotSymbolAllowed(symbol)) return;
  const cache = ensureTradeCache(symbol);
  const normalized = {
    id: trade.id ?? trade.t ?? Date.now(),
    price: parseNumber(trade.price ?? trade.p),
    qty: parseNumber(trade.quantity ?? trade.q),
    quoteQty: parseNumber(trade.quoteQuantity ?? trade.Q),
    side: trade.isBuyerMaker === undefined ? (trade.m ? 'sell' : 'buy') : trade.isBuyerMaker ? 'sell' : 'buy',
    time: trade.tradeTime ?? trade.T ?? Date.now(),
  };
  cache.push(normalized);
  if (cache.length > 500) cache.splice(0, cache.length - 500);
  exchangeEmitter.emit('trade', { symbol, trade: normalized });
}

function startMiniTickerStream() {
  if (!ENABLE_BINANCE) return;
  if (!publicClient || MARKET_STREAM_STATE.miniTicker) return;
  try {
    if (!publicClient.ws || !publicClient.ws.ticker) {
      throw new Error('ticker stream unavailable on client');
    }
    const stream = publicClient.ws.ticker('!miniTicker@arr', async (payload) => {
      const batch = Array.isArray(payload) ? payload : [payload];
      for (const update of batch) {
        await handleMiniTickerUpdate(update);
      }
    });
    attachStreamGuards(stream, 'miniTicker');
    MARKET_STREAM_STATE.miniTicker = stream;
    log('mini ticker stream started');
  } catch (err) {
    log('mini ticker stream failed to start', err.message);
  }
}

async function startCandleStream() {
  if (!ENABLE_BINANCE) return;
  if (!publicClient || MARKET_STREAM_STATE.candles) return;
  const symbols = await db('market_symbols').pluck('symbol');
  const allowed = symbols.filter((symbol) => isSpotSymbolAllowed(symbol));
  if (!allowed.length) return;
  try {
    if (!publicClient.ws || !publicClient.ws.candles) {
      throw new Error('candles stream unavailable on client');
    }
    const stream = publicClient.ws.candles(allowed, '1m', async (candle) => {
      const price = parseNumber(candle.close);
      const previous = tickerCache.get(candle.symbol) || {};
      tickerCache.set(candle.symbol, {
        ...previous,
        symbol: candle.symbol,
        last: price,
        interval: candle.interval,
        eventTime: candle.eventTime,
      });
      upsertCandleCache(candle.symbol, candle.interval || '1m', candle);
      await updateMarketSymbols(candle.symbol, price);
      await insertPriceTick(candle.symbol, price, candle.eventTime);
    });
    attachStreamGuards(stream, 'candles');
    MARKET_STREAM_STATE.candles = stream;
    log('candle stream started for', allowed.length, 'symbols');
  } catch (err) {
    log('candle stream failed to start', err.message);
  }
}

export function startMarketStreams() {
  if (!ENABLE_BINANCE) return;
  if (MARKET_STREAM_STATE.started) return;
  MARKET_STREAM_STATE.started = true;
  startMiniTickerStream();
  startCandleStream();
}

function mapOrderStatus(status) {
  if (!status) return 'NEW';
  const normalized = status.toUpperCase();
  if (['NEW', 'FILLED', 'CANCELED', 'PARTIALLY_FILLED'].includes(normalized)) return normalized;
  if (normalized === 'PENDING_CANCEL') return 'CANCELED';
  if (normalized === 'EXPIRED') return 'CANCELED';
  return normalized;
}

function mapOrderSide(side) {
  const normalized = (side || 'BUY').toUpperCase();
  return normalized === 'SELL' ? 'SELL' : 'BUY';
}

function mapOrderType(type) {
  const normalized = (type || 'LIMIT').toUpperCase();
  if (normalized === 'MARKET') return 'MARKET';
  return 'LIMIT';
}

async function upsertSpotOrder(userId, order) {
  const payload = {
    user_id: userId,
    symbol: order.symbol,
    side: mapOrderSide(order.side),
    type: mapOrderType(order.type),
    price: parseNumber(order.price),
    size: parseNumber(order.origQty ?? order.quantity),
    filled: parseNumber(order.executedQty ?? order.cumulativeFilledQuantity ?? order.cumQuantity),
    status: mapOrderStatus(order.status ?? order.orderStatus),
    exchange: 'binance',
    exchange_order_id: String(
      order.orderId ??
        order.clientOrderId ??
        order.c ??
        order.id ??
        `${order.symbol}-${order.transactionTime ?? Date.now()}`
    ),
    updated_at: new Date(order.updateTime ?? order.transactionTime ?? Date.now()),
  };

  const createdAt = new Date(order.time ?? order.orderCreationTime ?? Date.now());

  try {
    const existing = await db('spot_orders')
      .where({ exchange_order_id: payload.exchange_order_id })
      .first();
    if (existing) {
      await db('spot_orders')
        .where({ id: existing.id })
        .update({
          ...payload,
          created_at: existing.created_at,
        });
    } else {
      await db('spot_orders').insert({
        ...payload,
        created_at: createdAt,
      });
    }
  } catch (err) {
    log('failed to upsert spot order', payload.exchange_order_id, err.message);
  }
}

async function syncSpotBalances(userId, balances) {
  if (!Array.isArray(balances) || !balances.length) return;

  const walletRows = balances
    .map((bal) => ({
      asset: bal.asset || bal.a,
      free: parseNumber(bal.free ?? bal.f),
      locked: parseNumber(bal.locked ?? bal.l),
    }))
    .filter((bal) => bal.asset && (bal.free > 0 || bal.locked > 0));

  if (!walletRows.length) return;

  const trx = await db.transaction();
  try {
    await trx('wallets').where({ user_id: userId, type: 'spot' }).del();
    for (const row of walletRows) {
      await trx('wallets').insert({
        user_id: userId,
        type: 'spot',
        asset: row.asset,
        balance: row.free + row.locked,
      });
    }
    await trx.commit();
  } catch (err) {
    await trx.rollback();
    log('failed to sync spot balances', userId, err.message);
  }
}

async function computeExposure(userId) {
  try {
    const rows = await db('spot_orders')
      .where({ user_id: userId })
      .whereIn('status', ['NEW', 'PARTIALLY_FILLED']);
    return rows.reduce((sum, row) => {
      const remaining = Math.max(parseNumber(row.size) - parseNumber(row.filled), 0);
      const price = parseNumber(row.price);
      if (!price) return sum;
      return sum + remaining * price;
    }, 0);
  } catch (err) {
    log('failed to compute exposure', userId, err.message);
    return 0;
  }
}

async function assetPriceMap(assets) {
  const map = { USDT: 1 };
  const targets = assets.filter((a) => a && a.toUpperCase() !== 'USDT');
  if (!targets.length) return map;
  try {
    const query = db('market_symbols')
      .whereIn('base_asset', targets)
      .andWhere('quote_asset', 'USDT');
    if (allowedSpotSymbols.length) {
      query.whereIn('symbol', allowedSpotSymbols);
    }
    const markets = await query;
    for (const market of markets) {
      map[market.base_asset] = parseNumber(market.last_price);
    }
  } catch (err) {
    log('failed building asset price map', err.message);
  }
  return map;
}

async function updateDashboardSummary(userId) {
  try {
    const wallets = await db('wallets')
      .where({ user_id: userId, type: 'spot' });
    if (!wallets.length) return;
    const assets = wallets.map((w) => w.asset);
    const prices = await assetPriceMap(assets);
    const balanceUsdt = wallets.reduce((sum, wallet) => {
      const price = prices[wallet.asset] || 1;
      return sum + parseNumber(wallet.balance) * price;
    }, 0);
    const exposure = await computeExposure(userId);

    const payload = {
      balance_usdt: Number(balanceUsdt.toFixed(2)),
      exposure: Number(exposure.toFixed(2)),
      updated_at: new Date(),
    };

    const existing = await db('dashboard_summary').where({ user_id: userId }).first();
    if (existing) {
      await db('dashboard_summary')
        .where({ user_id: userId })
        .update({
          ...payload,
          pnl_24h: existing.pnl_24h ?? 0,
        });
    } else {
      await db('dashboard_summary').insert({
        user_id: userId,
        pnl_24h: 0,
        ...payload,
        created_at: new Date(),
      });
    }
  } catch (err) {
    log('failed to update dashboard summary', userId, err.message);
  }
}

async function handleAccountEvent(userId, event) {
  const balances = event?.balances || event?.B || [];
  if (balances.length) {
    await syncSpotBalances(userId, balances);
    await updateDashboardSummary(userId);
    exchangeEmitter.emit('wallet', { userId, balances });
  }
}

async function handleExecutionReport(userId, report) {
  await upsertSpotOrder(userId, report);
  await updateDashboardSummary(userId);
  exchangeEmitter.emit('order', { userId, report });
}

function scheduleKeepAlive(connectionId, client, listenKey) {
  if (keepAliveTimers.has(connectionId)) clearInterval(keepAliveTimers.get(connectionId));
  const timer = setInterval(async () => {
    try {
      if (client.keepAliveUserDataStream) {
        await client.keepAliveUserDataStream({ listenKey });
      }
      await db('exchange_connections')
        .where({ id: connectionId })
        .update({ listen_key_expires_at: new Date(Date.now() + LISTEN_KEY_REFRESH_MS) });
    } catch (err) {
      log('keep alive failed', connectionId, err.message);
    }
  }, LISTEN_KEY_REFRESH_MS - 5 * 60 * 1000);
  keepAliveTimers.set(connectionId, timer);
}

async function startUserStream(connection) {
  const client = createClient(connection.api_key, connection.api_secret);
  if (!client) return;

  let listenKey = connection.listen_key;
  const expiresAt = connection.listen_key_expires_at ? new Date(connection.listen_key_expires_at) : null;
  if (!listenKey || !expiresAt || Date.now() > expiresAt.getTime() - 5 * 60 * 1000) {
    try {
      const response = await client.createListenKey();
      listenKey = response.listenKey;
      await db('exchange_connections')
        .where({ id: connection.id })
        .update({
          listen_key: listenKey,
          listen_key_expires_at: new Date(Date.now() + LISTEN_KEY_REFRESH_MS),
        });
    } catch (err) {
      log('failed to create listen key', err.message);
      return;
    }
  }

  const ws = client.ws.user(listenKey, {
    executionReport: async (report) => {
      await handleExecutionReport(connection.user_id, report);
    },
    account: async (account) => {
      await handleAccountEvent(connection.user_id, account);
    },
  });
  attachStreamGuards(ws, `user:${connection.user_id}`);

  userStreams.set(connection.user_id, { close: () => safeClose(ws), client });
  scheduleKeepAlive(connection.id, client, listenKey);
  log('user data stream started for user', connection.user_id);
}

export async function bootstrapUserStreams() {
  if (!ENABLE_BINANCE) {
    log('binance integration disabled - skipping user streams');
    return;
  }
  try {
    if (!(await ensureExchangeConnectionsTable())) return;
    const connections = await db('exchange_connections').where({ exchange: 'binance' });
    if (!connections.length) {
      log('no binance exchange connections configured');
      return;
    }
    for (const connection of connections) {
      await syncUserSnapshot(connection.user_id, connection);
      await startUserStream(connection);
    }
  } catch (err) {
    log('failed to bootstrap user streams', err.message);
  }
}

export async function syncUserSnapshot(userId, connectionOverride) {
  if (!ENABLE_BINANCE) {
    log('binance integration disabled - skipping user snapshot for', userId);
    return;
  }
  try {
    if (!(await ensureExchangeConnectionsTable())) return;
    const connection =
      connectionOverride ||
      (await db('exchange_connections')
        .where({ user_id: userId, exchange: 'binance' })
        .first());
    if (!connection) {
      log('no binance credentials for user', userId);
      return;
    }
    const client = createClient(connection.api_key, connection.api_secret);
    if (!client) return;
    const [accountInfo, openOrders] = await Promise.all([
      client.accountInfo(),
      client.openOrders(),
    ]);
    await syncSpotBalances(userId, accountInfo.balances);
    if (Array.isArray(openOrders)) {
      for (const order of openOrders) {
        await upsertSpotOrder(userId, order);
      }
    }
    await updateDashboardSummary(userId);
  } catch (err) {
    log('failed to sync user snapshot', userId, err.message);
  }
}

export function shutdownUserStreams() {
  for (const [userId, stream] of userStreams.entries()) {
    try {
      if (typeof stream.close === 'function') stream.close();
    } catch (err) {
      log('failed to close stream', userId, err.message);
    }
  }
  for (const timer of keepAliveTimers.values()) clearInterval(timer);
  userStreams.clear();
  keepAliveTimers.clear();
  MARKET_STREAM_STATE.started = false;
}

export function getTickerCache() {
  return tickerCache;
}

export async function getCandleSeries(symbol, { interval = '1m', limit = 120 } = {}) {
  const safeSymbol = (symbol || '').toUpperCase();
  if (!safeSymbol) throw new Error('SYMBOL_REQUIRED');
  const safeInterval = interval || '1m';
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 500);

  let candles = getCachedCandles(safeSymbol, safeInterval, safeLimit);
  let meta = getCandleMeta(safeSymbol, safeInterval);

  if (!candles || candles.length < Math.min(10, safeLimit)) {
    const fetched = await fetchCandlesRest(safeSymbol, safeInterval, safeLimit);
    candles = fetched.candles;
    meta = fetched.meta;
  }

  if (!candles?.length) {
    throw new Error('NO_CANDLES');
  }

  const last = candles.at(-1)?.close ?? 0;
  const updatedAt = meta?.updatedAt ? new Date(meta.updatedAt) : new Date();
  const staleAt =
    updatedAt && Date.now() - updatedAt.getTime() > 60 * 1000
      ? new Date(updatedAt.getTime() + 60 * 1000)
      : null;

  return {
    symbol: safeSymbol,
    interval: safeInterval,
    candles,
    last,
    updatedAt: updatedAt.toISOString(),
    staleAt: staleAt ? staleAt.toISOString() : undefined,
  };
}

async function fetchDailyStatsSnapshot() {
  if (dailyStatsCache.data && Date.now() - dailyStatsCache.fetchedAt < DAILY_STATS_TTL_MS) {
    return dailyStatsCache;
  }
  if (!ENABLE_BINANCE || !publicClient) {
    const data = buildDemoDailyStats();
    dailyStatsCache = { data, fetchedAt: Date.now() };
    return dailyStatsCache;
  }
  try {
    const stats = await publicClient.dailyStats();
    const normalized = Array.isArray(stats) ? stats : stats ? [stats] : [];
    dailyStatsCache = { data: normalized, fetchedAt: Date.now() };
    return dailyStatsCache;
  } catch (err) {
    warn('daily stats fetch failed', err?.message || err);
    const data = buildDemoDailyStats();
    dailyStatsCache = { data, fetchedAt: Date.now() };
    return dailyStatsCache;
  }
}

function filterByUniverse(stat, universe) {
  const normalized = (universe || 'spot').toLowerCase();
  const { quote } = splitSymbolParts(stat.symbol);
  const usdLike = ['USDT', 'BUSD', 'USDC', 'FDUSD', 'TUSD'];
  if (normalized === 'spot') {
    return usdLike.includes(quote);
  }
  if (normalized === 'perpetual' || normalized === 'perp' || normalized === 'futures') {
    return usdLike.includes(quote);
  }
  return true;
}

export async function getTopMoversSnapshot({
  window = '24h',
  limit = 3,
  universe = 'spot',
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 20);
  const effectiveWindow = (window || '24h').toLowerCase();

  const { data, fetchedAt } = await fetchDailyStatsSnapshot();
  if (!Array.isArray(data)) throw new Error('NO_DAILY_STATS');

  const candidates = data
    .filter((stat) => filterByUniverse(stat, universe))
    .map((stat) => {
      const { base, quote } = splitSymbolParts(stat.symbol);
      const last = parseNumber(stat.lastPrice ?? stat.close);
      const changePct = parseNumber(stat.priceChangePercent ?? stat.P);
      const quoteVolume = parseNumber(stat.quoteVolume ?? 0);
      const volumeUsd = quoteVolume || parseNumber(stat.volume ?? 0) * (last || 0);
      return {
        symbol: stat.symbol,
        base,
        quote,
        last,
        changePct,
        volumeUsd,
      };
    })
    .filter((item) => Number.isFinite(item.changePct) && Number.isFinite(item.last));

  candidates.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

  const updatedAt = new Date(fetchedAt || Date.now());
  const staleAt =
    updatedAt && Date.now() - updatedAt.getTime() > 60 * 1000
      ? new Date(updatedAt.getTime() + 60 * 1000)
      : null;

  return {
    window: effectiveWindow || '24h',
    limit: safeLimit,
    movers: candidates.slice(0, safeLimit),
    updatedAt: updatedAt.toISOString(),
    staleAt: staleAt ? staleAt.toISOString() : undefined,
  };
}

export function getTickerSnapshot(symbol) {
  const entry = tickerCache.get(symbol.toUpperCase());
  if (!entry) return null;
  return {
    symbol: entry.symbol,
    last: entry.last,
    change: entry.change,
    changePct: entry.changePct,
    priceChange: entry.priceChange,
    open: entry.open,
    high: entry.high,
    low: entry.low,
    volume: entry.volume,
    volumeQuote: entry.volumeQuote,
    eventTime: entry.eventTime,
  };
}

export function getOrderbookSnapshot(symbol, limit = 100) {
  const cache = depthCache.get(symbol.toUpperCase());
  if (!cache || cache.bids.size === 0 || cache.asks.size === 0) {
    if (!ENABLE_BINANCE) {
      const demo = buildDemoDepth(symbol, limit);
      return demo;
    }
    return { bids: [], asks: [], lastUpdateId: 0, updatedAt: null };
  }
  return {
    bids: sortDepth(cache.bids, 'desc', limit),
    asks: sortDepth(cache.asks, 'asc', limit),
    lastUpdateId: cache.lastUpdateId,
    updatedAt: cache.updatedAt,
  };
}

export function getTradeSnapshot(symbol, limit = 100) {
  const cache = tradeCache.get(symbol.toUpperCase()) || [];
  if (!cache.length && !ENABLE_BINANCE) {
    return buildDemoTrades(symbol, limit);
  }
  const slice = limit ? cache.slice(-limit) : cache.slice();
  return slice.map((trade) => ({ ...trade }));
}

export async function fetchTickerRest(symbol) {
  const upper = symbol.toUpperCase();
  if (!isSpotSymbolAllowed(upper)) {
    throw new Error('SYMBOL_NOT_ALLOWED');
  }
  if (!ENABLE_BINANCE || !publicClient) {
    const demo = buildDemoTicker(upper);
    return {
      symbol: demo.symbol,
      last: demo.last,
      change: demo.change,
      changePct: demo.change,
      open: demo.open,
      high: demo.high,
      low: demo.low,
      volume: demo.volume,
      quoteVolume: demo.volumeQuote,
      eventTime: demo.eventTime,
    };
  }
  try {
    const stat = await publicClient.dailyStats({ symbol: upper });
    return {
      symbol: stat.symbol,
      last: parseNumber(stat.lastPrice),
      change: parseNumber(stat.priceChange),
      changePct: parseNumber(stat.priceChangePercent),
      open: parseNumber(stat.openPrice),
      high: parseNumber(stat.highPrice),
      low: parseNumber(stat.lowPrice),
      volume: parseNumber(stat.volume),
      quoteVolume: parseNumber(stat.quoteVolume),
      eventTime: stat.closeTime || Date.now(),
    };
  } catch (err) {
    warn('ticker fetch failed', upper, err?.message || err);
    const demo = buildDemoTicker(upper);
    return {
      symbol: demo.symbol,
      last: demo.last,
      change: demo.change,
      changePct: demo.change,
      open: demo.open,
      high: demo.high,
      low: demo.low,
      volume: demo.volume,
      quoteVolume: demo.volumeQuote,
      eventTime: demo.eventTime,
    };
  }
}

export async function fetchDepthRest(symbol, limit = 100) {
  const upper = symbol.toUpperCase();
  if (!isSpotSymbolAllowed(upper)) {
    throw new Error('SYMBOL_NOT_ALLOWED');
  }
  if (!ENABLE_BINANCE || !publicClient) {
    return buildDemoDepth(upper, limit);
  }
  const depthFn = publicClient.depth || publicClient.book;
  if (!depthFn) throw new Error('depth API not available');
  let depth;
  try {
    depth = await depthFn.call(publicClient, { symbol: upper, limit: Math.min(limit, 500) });
  } catch (err) {
    warn('depth fetch failed', upper, err?.message || err);
    return buildDemoDepth(upper, limit);
  }

  const normalizeList = (entries = []) =>
    (entries || []).reduce((acc, entry) => {
      const normalized = normalizeDepthEntry(entry);
      if (!normalized) return acc;
      const { price, qty } = normalized;
      if (!Number.isFinite(price) || !Number.isFinite(qty)) return acc;
      acc.push([price, qty]);
      return acc;
    }, []);

  return {
    bids: normalizeList(depth.bids || depth.bidDepth || depth.b),
    asks: normalizeList(depth.asks || depth.askDepth || depth.a),
    lastUpdateId: depth.lastUpdateId,
    updatedAt: new Date(),
  };
}

export async function fetchTradesRest(symbol, limit = 100) {
  const upper = symbol.toUpperCase();
  if (!isSpotSymbolAllowed(upper)) {
    throw new Error('SYMBOL_NOT_ALLOWED');
  }
  if (!ENABLE_BINANCE || !publicClient) {
    return buildDemoTrades(upper, limit);
  }
  try {
    const trades = await publicClient.trades({ symbol: upper, limit: Math.min(limit, 1000) });
    return trades.map((trade) => ({
      id: trade.id,
      price: parseNumber(trade.price),
      qty: parseNumber(trade.qty ?? trade.quantity),
      quoteQty: parseNumber(trade.quoteQty ?? trade.quoteQuantity),
      side: trade.isBuyerMaker ? 'sell' : 'buy',
      time: trade.time,
    }));
  } catch (err) {
    warn('trades fetch failed', upper, err?.message || err);
    return buildDemoTrades(upper, limit);
  }
}

export function createSignedSpotClient(apiKey, apiSecret) {
  return createClient(apiKey, apiSecret);
}
