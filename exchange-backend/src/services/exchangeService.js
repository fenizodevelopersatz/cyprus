import { parseUnits, formatUnits } from 'ethers';
import { db, withTx } from '../db.js';
import { cfg } from '../config.js';
import { isSpotSymbolAllowed, allowedSpotSymbols, symbols as symbolMeta } from '../utils/symbols.js';
import {
  getExchangeInfo,
  getTickerSnapshot,
  fetchTickerRest,
  getOrderbookSnapshot,
  fetchDepthRest,
  getTradeSnapshot,
  fetchTradesRest,
  trackSpotSymbol,
  getCandleSeries,
} from './binanceSync.js';
import { getAssetMeta, getAssetDirectory } from '../utils/assets.js';
import { getBalancesByNamespace, getAccountBalance, journal } from './ledgerService.js';
import { getSettings } from './settingsService.js';
import { sendSpotTradeEmail } from './mailService.js';
import { getUserContact } from './userService.js';

const UNIT = 10n ** 18n;
const HOUSE_SPOT_NAMESPACE = 'spot:inventory';
const MARKET_CACHE_TTL_MS = 30_000;
const marketCache = new Map();

function buildFallbackSymbolInfo(symbol) {
  if (!symbol) return null;
  const meta = symbolMeta[symbol.toUpperCase()];
  if (!meta) return null;
  const filters = [];
  if (meta.tick != null) {
    filters.push({
      filterType: 'PRICE_FILTER',
      tickSize: meta.tick,
      minPrice: meta.tick,
      maxPrice: null,
    });
  }
  if (meta.lot != null) {
    filters.push({
      filterType: 'LOT_SIZE',
      stepSize: meta.lot,
      minQty: meta.min ?? meta.lot,
      maxQty: meta.max ?? null,
    });
  }
  if (meta.min != null) {
    filters.push({
      filterType: 'MIN_NOTIONAL',
      minNotional: meta.min,
    });
  }
  return {
    symbol: symbol.toUpperCase(),
    status: 'TRADING',
    baseAsset: meta.base,
    quoteAsset: meta.quote,
    filters,
    baseAssetPrecision: null,
    quoteAssetPrecision: null,
    quotePrecision: null,
    orderTypes: ['LIMIT', 'MARKET'],
    permissions: ['SPOT'],
    icebergAllowed: false,
    ocoAllowed: false,
    allowTrailingStop: false,
  };
}
function buildFallbackMarketPayload(targetQuote) {
  const candidates = allowedSpotSymbols
    .map((symbol) => {
      const meta = symbolMeta[symbol];
      const inferred = meta || {
        base: symbol.replace(targetQuote, '') || symbol,
        quote: targetQuote,
      };
      return { symbol, meta: inferred };
    })
    .filter(({ meta }) => (meta?.quote || targetQuote).toUpperCase() === targetQuote);

  const markets = candidates.map(({ symbol, meta }) => {
    const baseAsset = meta?.base || symbol.replace(targetQuote, '') || symbol;
    const quoteAsset = meta?.quote || targetQuote;
    const priceFilter =
      meta?.tick != null
        ? { filterType: 'PRICE_FILTER', tickSize: meta.tick, minPrice: meta.tick, maxPrice: null }
        : null;
    const lotFilter =
      meta?.lot != null
        ? {
          filterType: 'LOT_SIZE',
          stepSize: meta.lot,
          minQty: meta.min ?? meta.lot,
          maxQty: meta.max ?? null,
        }
        : null;
    const notionalFilter =
      meta?.min != null ? { filterType: 'MIN_NOTIONAL', minNotional: meta.min } : null;
    const room = `symbol:${symbol}`;
    const rawEndpoint = '/ws/exchange';
    const restBase = '/api/exchange';
    return {
      symbol,
      baseAsset,
      quoteAsset,
      status: 'TRADING',
      tickSize: meta?.tick ?? null,
      stepSize: meta?.lot ?? null,
      minQty: meta?.min ?? null,
      minNotional: meta?.min ?? null,
      makerCommission: null,
      takerCommission: null,
      filters: {
        price: priceFilter,
        quantity: lotFilter,
        notional: notionalFilter,
      },
      precision: {
        baseAsset: null,
        quoteAsset: null,
        quoteOrderQty: null,
        priceDecimals: null,
        quantityDecimals: null,
      },
      orderTypes: ['LIMIT', 'MARKET'],
      permissions: ['SPOT'],
      icebergAllowed: false,
      ocoAllowed: false,
      allowTrailingStop: false,
      display: {
        symbol: `${baseAsset} / ${quoteAsset}`,
        base: getAssetMeta(baseAsset),
        quote: getAssetMeta(quoteAsset),
      },
      stats: null,
      streams: {
        namespace: '/exchange',
        room,
        subscribe: {
          event: 'exchange:subscribe',
          payload: { symbol },
        },
        unsubscribe: {
          event: 'exchange:unsubscribe',
          payload: { symbol },
        },
        events: {
          snapshot: 'exchange:snapshot',
          ticker: 'exchange:ticker',
          orderbook: 'exchange:orderbook',
          trade: 'exchange:trade',
          wallet: 'exchange:wallet',
          order: 'exchange:order',
        },
        raw: {
          endpoint: rawEndpoint,
          example: `${rawEndpoint}?symbol=${symbol}`,
          query: {
            symbol,
            token: 'optional',
          },
        },
      },
      rest: {
        ticker: `${restBase}/ticker/${symbol}`,
        orderbook: `${restBase}/orderbook/${symbol}`,
        trades: `${restBase}/trades/${symbol}`,
        snapshot: `${restBase}/snapshot?symbol=${symbol}`,
      },
    };
  });

  const assets = getAssetDirectory(
    markets.flatMap((market) => [market.baseAsset, market.quoteAsset])
  );

  return {
    quote: targetQuote,
    markets,
    assets,
    streams: {
      namespace: '/exchange',
      subscribe: 'exchange:subscribe',
      unsubscribe: 'exchange:unsubscribe',
      events: {
        snapshot: 'exchange:snapshot',
        ticker: 'exchange:ticker',
        orderbook: 'exchange:orderbook',
        trade: 'exchange:trade',
        wallet: 'exchange:wallet',
        order: 'exchange:order',
      },
      roomPattern: 'symbol:{symbol}',
      rawEndpoint: '/ws/exchange',
      rawExample: '/ws/exchange?symbol={symbol}',
    },
    restBase: '/api/exchange',
    iconBase: cfg.ui?.assetIconBase || null,
    source: {
      timezone: null,
      serverTime: null,
      fallback: true,
    },
    updatedAt: new Date().toISOString(),
    fallback: true,
  };
}

function toBigDecimal(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return 0n;
  return parseUnits(num.toFixed(8), 18);
}

function resolveInsertId(result) {
  if (Array.isArray(result)) {
    const value = result[0];
    if (value && typeof value === 'object') {
      return value.id ?? value.ID ?? Object.values(value)[0];
    }
    return value;
  }
  if (result && typeof result === 'object') {
    return result.id ?? result.ID ?? Object.values(result)[0];
  }
  return result;
}


class ExchangeError extends Error {
  constructor(message, { status = 502, code = 'EXCHANGE_ERROR', details = null } = {}) {
    super(message || 'Exchange error');
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeSpotSymbol(symbol) {
  const upper = String(symbol || '').toUpperCase();
  if (!upper) throw new ExchangeError('Symbol required', { status: 400, code: 'SYMBOL_REQUIRED' });
  if (!isSpotSymbolAllowed(upper)) {
    throw new ExchangeError('Symbol not permitted', { status: 400, code: 'SYMBOL_NOT_ALLOWED' });
  }
  return upper;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function snapToStep(value, step, { mode = 'floor', precisionOffset = 2 } = {}) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  if (step === 1) return mode === 'ceil' ? Math.ceil(value) : Math.floor(value);
  const units = value / step;
  let snappedUnits;
  if (mode === 'ceil') {
    snappedUnits = Math.ceil(units - 1e-12);
  } else if (mode === 'round') {
    snappedUnits = Math.round(units);
  } else {
    snappedUnits = Math.floor(units + 1e-12);
  }
  const snapped = snappedUnits * step;
  const decimals = Math.max(0, -Math.floor(Math.log10(step))) + precisionOffset;
  return Number(snapped.toFixed(decimals));
}

function toDisplayAmount(valueBig, decimals = 18) {
  if (typeof valueBig !== 'bigint') return Number(valueBig || 0);
  return Number(formatUnits(valueBig, decimals));
}

function getFilter(symbolInfo, type) {
  return symbolInfo?.filters?.find((filter) => filter.filterType === type) || null;
}

function validateSymbol(symbolInfo) {
  if (!symbolInfo) throw new ExchangeError('UNKNOWN_SYMBOL', { status: 400, code: 'UNKNOWN_SYMBOL' });
  if (symbolInfo.status !== 'TRADING') throw new ExchangeError('SYMBOL_UNAVAILABLE', { status: 400, code: 'SYMBOL_UNAVAILABLE' });
}

async function resolveMarketPrice(symbolInfo) {
  const ticker = getTickerSnapshot(symbolInfo.symbol);
  if (ticker?.last && Number.isFinite(ticker.last) && ticker.last > 0) {
    return ticker.last;
  }
  try {
    const fresh = await fetchTickerRest(symbolInfo.symbol);
    if (fresh?.last && Number.isFinite(fresh.last) && fresh.last > 0) {
      return fresh.last;
    }
  } catch (err) {
    // ignore fallback errors; caller will throw INVALID_PRICE
  }
  return null;
}

function pickQuantity(payload) {
  const candidates = [
    payload.quantity,
    payload.qty,
    payload.amount,
    payload.size,
    payload.baseQuantity,
    payload.baseQty,
  ];
  for (const candidate of candidates) {
    const value = toNumber(candidate);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

async function validateOrderPayload(payload, symbolInfo) {
  const side = String(payload.side || '').toUpperCase();
  const type = String(payload.type || 'LIMIT').toUpperCase();
  if (!['BUY', 'SELL'].includes(side)) throw new ExchangeError('INVALID_SIDE', { status: 400, code: 'INVALID_SIDE' });
  if (!['LIMIT', 'MARKET'].includes(type)) throw new ExchangeError('UNSUPPORTED_TYPE', { status: 400, code: 'UNSUPPORTED_TYPE' });

  const quantity = pickQuantity(payload);
  let price = toNumber(payload.price);

  const lotFilter = getFilter(symbolInfo, 'LOT_SIZE');
  const priceFilter = getFilter(symbolInfo, 'PRICE_FILTER');
  const notionalFilter = getFilter(symbolInfo, 'MIN_NOTIONAL');
  const stepSize = toNumber(lotFilter?.stepSize);
  const tickSize = toNumber(priceFilter?.tickSize);

  if (type === 'MARKET' && !Number.isFinite(price)) {
    price = await resolveMarketPrice(symbolInfo);
  }

  let normalizedQuantity = quantity;
  let normalizedPrice = price;
  if (stepSize) {
    normalizedQuantity = snapToStep(quantity, stepSize, { mode: 'floor' });
  }
  if (tickSize && Number.isFinite(price)) {
    normalizedPrice = snapToStep(price, tickSize, { mode: 'round' });
  }

  if (!normalizedQuantity || normalizedQuantity <= 0) throw new ExchangeError('INVALID_QUANTITY', { status: 400, code: 'INVALID_QUANTITY' });
  if (!normalizedPrice || normalizedPrice <= 0) throw new ExchangeError('INVALID_PRICE', { status: 400, code: 'INVALID_PRICE' });

  if (lotFilter) {
    const minQty = toNumber(lotFilter.minQty);
    if (minQty && normalizedQuantity < minQty) throw new ExchangeError('QUANTITY_TOO_LOW', { status: 400, code: 'QUANTITY_TOO_LOW' });
  }
  if (priceFilter) {
    const minPrice = toNumber(priceFilter.minPrice);
    const maxPrice = toNumber(priceFilter.maxPrice);
    if (minPrice && normalizedPrice < minPrice) throw new ExchangeError('PRICE_TOO_LOW', { status: 400, code: 'PRICE_TOO_LOW' });
    if (maxPrice && normalizedPrice > maxPrice) throw new ExchangeError('PRICE_TOO_HIGH', { status: 400, code: 'PRICE_TOO_HIGH' });
  }
  const overrideMinNotional =
    cfg.exchange?.minNotionalOverride && cfg.exchange.minNotionalOverride > 0
      ? cfg.exchange.minNotionalOverride
      : null;
  const shouldEnforceMinNotional = cfg.exchange?.enforceMinNotional ?? false;

  const effectiveMinNotional =
    overrideMinNotional !== null
      ? overrideMinNotional
      : notionalFilter
        ? toNumber(notionalFilter.minNotional)
        : null;

  if (shouldEnforceMinNotional && effectiveMinNotional && normalizedPrice * normalizedQuantity < effectiveMinNotional) {
    throw new ExchangeError('NOTIONAL_TOO_LOW', { status: 400, code: 'NOTIONAL_TOO_LOW' });
  }

  return {
    side,
    type,
    quantity: normalizedQuantity,
    price: normalizedPrice,
  };
}

function tryParseJson(input) {
  if (!input || typeof input !== 'string') return null;
  try {
    return JSON.parse(input);
  } catch (err) {
    return null;
  }
}

function normalizeBinanceError(err, fallbackMessage) {
  let status = 502;
  let code = 'BINANCE_ERROR';
  let message = fallbackMessage || 'Binance rejected the request';

  if (err?.code && typeof err.code === 'number') {
    status = 400;
    code = `BINANCE_${err.code}`;
    message = err.msg || err.message || message;
  } else if (err?.response?.data) {
    const data = typeof err.response.data === 'string' ? tryParseJson(err.response.data) : err.response.data;
    if (data?.code) {
      status = 400;
      code = `BINANCE_${data.code}`;
      message = data.msg || message;
    }
  } else if (err?.body) {
    const parsed = tryParseJson(err.body);
    if (parsed?.code) {
      status = 400;
      code = `BINANCE_${parsed.code}`;
      message = parsed.msg || message;
    }
  } else if (err?.message) {
    message = err.message;
  }

  return new ExchangeError(message, { status, code });
}

export async function listMarkets({ quote } = {}) {
  const targetQuote = (quote || 'USDT').toUpperCase();
  const cached = marketCache.get(targetQuote);
  if (cached && Date.now() - cached.timestamp < MARKET_CACHE_TTL_MS) {
    return cached.payload;
  }

  let info;
  try {
    info = await getExchangeInfo();
  } catch (err) {
    console.error('[exchange] exchange info fetch failed', err?.message || err);
    if (cached) {
      return cached.payload;
    }
    const fallbackPayload = buildFallbackMarketPayload(targetQuote);
    marketCache.set(targetQuote, { timestamp: Date.now(), payload: fallbackPayload });
    return fallbackPayload;
  }
  const symbols = info?.symbols || [];
  const filtered = symbols.filter((symbol) => {
    if (symbol.status !== 'TRADING') return false;
    if (symbol.quoteAsset !== targetQuote) return false;
    if (!isSpotSymbolAllowed(symbol.symbol)) return false;
    return true;
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));

  const countDecimals = (value) => {
    if (value === undefined || value === null) return null;
    const str = String(value);
    if (!str.includes('.')) return 0;
    const fractional = str.split('.')[1] || '';
    const trimmed = fractional.replace(/0+$/, '');
    return trimmed.length;
  };

  const markets = await Promise.all(
    filtered.map(async (symbol) => {
      const priceFilter = getFilter(symbol, 'PRICE_FILTER');
      const lotFilter = getFilter(symbol, 'LOT_SIZE');
      const notionalFilter = getFilter(symbol, 'MIN_NOTIONAL');
      const stats = await ticker(symbol.symbol).catch(() => null);
      const baseMeta = getAssetMeta(symbol.baseAsset);
      const quoteMeta = getAssetMeta(symbol.quoteAsset);
      const room = `symbol:${symbol.symbol}`;
      const rawEndpoint = '/ws/exchange';
      const restBase = '/api/exchange';

      const tickSize = priceFilter?.tickSize ?? null;
      const stepSize = lotFilter?.stepSize ?? null;
      const minQty = lotFilter?.minQty ?? null;
      const minNotional = notionalFilter?.minNotional ?? null;

      return {
        symbol: symbol.symbol,
        baseAsset: symbol.baseAsset,
        quoteAsset: symbol.quoteAsset,
        status: symbol.status,
        tickSize,
        stepSize,
        minQty,
        minNotional,
        makerCommission: null,
        takerCommission: null,
        filters: {
          price: priceFilter || null,
          quantity: lotFilter || null,
          notional: notionalFilter || null,
        },
        precision: {
          baseAsset: symbol.baseAssetPrecision ?? null,
          quoteAsset: symbol.quoteAssetPrecision ?? null,
          quoteOrderQty: symbol.quotePrecision ?? null,
          priceDecimals: countDecimals(tickSize),
          quantityDecimals: countDecimals(stepSize),
        },
        orderTypes: symbol.orderTypes || [],
        permissions: symbol.permissions || [],
        icebergAllowed: symbol.icebergAllowed ?? null,
        ocoAllowed: symbol.ocoAllowed ?? null,
        allowTrailingStop: symbol.allowTrailingStop ?? null,
        display: {
          symbol: `${symbol.baseAsset} / ${symbol.quoteAsset}`,
          base: baseMeta,
          quote: quoteMeta,
        },
        stats: stats
          ? {
            last: stats.last ?? null,
            open: stats.open ?? null,
            high: stats.high ?? null,
            low: stats.low ?? null,
            change: stats.change ?? null,
            changePct: stats.changePct ?? null,
            volume: stats.volume ?? null,
            volumeQuote: stats.volumeQuote ?? null,
            updatedAt: stats.updatedAt ?? null,
          }
          : null,
        streams: {
          namespace: '/exchange',
          room,
          subscribe: {
            event: 'exchange:subscribe',
            payload: { symbol: symbol.symbol },
          },
          unsubscribe: {
            event: 'exchange:unsubscribe',
            payload: { symbol: symbol.symbol },
          },
          events: {
            snapshot: 'exchange:snapshot',
            ticker: 'exchange:ticker',
            orderbook: 'exchange:orderbook',
            trade: 'exchange:trade',
            wallet: 'exchange:wallet',
            order: 'exchange:order',
          },
          raw: {
            endpoint: rawEndpoint,
            example: `${rawEndpoint}?symbol=${symbol.symbol}`,
            query: {
              symbol: symbol.symbol,
              token: 'optional',
            },
          },
        },
        rest: {
          ticker: `${restBase}/ticker/${symbol.symbol}`,
          orderbook: `${restBase}/orderbook/${symbol.symbol}`,
          trades: `${restBase}/trades/${symbol.symbol}`,
          snapshot: `${restBase}/snapshot?symbol=${symbol.symbol}`,
        },
      };
    })
  );

  const assets = getAssetDirectory(
    markets.flatMap((market) => [market.baseAsset, market.quoteAsset])
  );

  const payload = {
    quote: targetQuote,
    markets,
    assets,
    streams: {
      namespace: '/exchange',
      subscribe: 'exchange:subscribe',
      unsubscribe: 'exchange:unsubscribe',
      events: {
        snapshot: 'exchange:snapshot',
        ticker: 'exchange:ticker',
        orderbook: 'exchange:orderbook',
        trade: 'exchange:trade',
        wallet: 'exchange:wallet',
        order: 'exchange:order',
      },
      roomPattern: 'symbol:{symbol}',
      rawEndpoint: '/ws/exchange',
      rawExample: '/ws/exchange?symbol={symbol}',
    },
    restBase: '/api/exchange',
    iconBase: cfg.ui?.assetIconBase || null,
    source: {
      timezone: info?.timezone || null,
      serverTime: info?.serverTime || null,
    },
    updatedAt: new Date().toISOString(),
  };

  marketCache.set(targetQuote, { timestamp: Date.now(), payload });
  return payload;
}

export async function ticker(symbol) {
  const upper = normalizeSpotSymbol(symbol);
  trackSpotSymbol(upper);
  const cache = getTickerSnapshot(upper);
  if (cache) {
    const changeAbs =
      cache.priceChange != null
        ? cache.priceChange
        : cache.open != null && cache.last != null
          ? cache.last - cache.open
          : null;
    return {
      symbol: cache.symbol,
      last: cache.last,
      open: cache.open ?? null,
      high: cache.high ?? null,
      low: cache.low ?? null,
      change: changeAbs,
      changePct: cache.changePct ?? cache.change ?? null,
      volume: cache.volume ?? null,
      volumeQuote: cache.volumeQuote ?? null,
      updatedAt: cache.eventTime ? new Date(cache.eventTime).toISOString() : new Date().toISOString(),
    };
  }

  const fresh = await fetchTickerRest(upper);
  return {
    symbol: fresh.symbol,
    last: fresh.last,
    open: fresh.open ?? null,
    high: fresh.high ?? null,
    low: fresh.low ?? null,
    change: fresh.change ?? null,
    changePct: fresh.changePct ?? null,
    volume: fresh.volume ?? null,
    volumeQuote: fresh.quoteVolume ?? null,
    updatedAt: new Date(fresh.eventTime).toISOString(),
  };
}

export async function orderbook(symbol, { depth = 100 } = {}) {
  const upper = normalizeSpotSymbol(symbol);
  trackSpotSymbol(upper);
  const snapshot = getOrderbookSnapshot(upper, depth);
  if (snapshot.bids.length || snapshot.asks.length) {
    return {
      symbol: upper,
      bids: snapshot.bids,
      asks: snapshot.asks,
      lastUpdateId: snapshot.lastUpdateId,
      updatedAt: snapshot.updatedAt ? snapshot.updatedAt.toISOString() : null,
      stale: snapshot.updatedAt ? Date.now() - snapshot.updatedAt.getTime() > 10_000 : true,
    };
  }
  const fresh = await fetchDepthRest(upper, depth);
  return {
    symbol: upper,
    bids: fresh.bids,
    asks: fresh.asks,
    lastUpdateId: fresh.lastUpdateId,
    updatedAt: fresh.updatedAt.toISOString(),
    stale: false,
  };
}

export async function trades(symbol, { limit = 100 } = {}) {
  const upper = normalizeSpotSymbol(symbol);
  trackSpotSymbol(upper);
  const cached = getTradeSnapshot(upper, limit);
  if (cached.length) return cached;
  return fetchTradesRest(upper, limit);
}

async function lockedBalances(userId) {
  const rows = await getBalancesByNamespace(userId, ['spot:pending_withdrawal', 'spot:locked']);
  const locked = {};
  for (const row of rows) {
    const amount = Number(row.amount || 0);
    if (!amount) continue;
    locked[row.asset] = (locked[row.asset] || 0) + amount;
  }
  return locked;
}

export async function wallets(userId) {
  const rows = await getBalancesByNamespace(userId, ['spot:available', 'spot:pending_withdrawal', 'spot:locked']);
  const map = new Map();
  for (const row of rows) {
    const asset = row.asset;
    if (!asset) continue;
    const amount = Number(row.amount || 0);
    const entry = map.get(asset) || { asset, free: 0, locked: 0 };
    if (row.namespace === 'spot:available') {
      entry.free += amount;
    } else {
      entry.locked += amount;
    }
    map.set(asset, entry);
  }

  return Array.from(map.values()).map((entry) => {
    const balance = entry.free + entry.locked;
    return {
      asset: entry.asset,
      free: Number(entry.free.toFixed(8)),
      locked: Number(entry.locked.toFixed(8)),
      balance: Number(balance.toFixed(8)),
    };
  });
}

export async function openOrders(userId) {
  const rows = await db('spot_orders')
    .where({ user_id: userId })
    .whereIn('status', ['NEW', 'PARTIALLY_FILLED'])
    .orderBy('created_at', 'desc');

  return rows.map((row) => ({
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    price: row.price ? Number(row.price) : null,
    qty: Number(row.size || 0),
    filled: Number(row.filled || 0),
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function placeSpotOrder(userId, body) {
  const symbol = normalizeSpotSymbol(body.symbol);
  trackSpotSymbol(symbol);
  let symbolInfo;
  try {
    symbolInfo = await getExchangeInfo(symbol);
  } catch (err) {
    console.error('[exchange] symbol info fetch failed', err?.message || err);
    symbolInfo = buildFallbackSymbolInfo(symbol);
  }
  validateSymbol(symbolInfo);
  const { side, type, quantity, price } = await validateOrderPayload(body, symbolInfo);
  const isMarket = type === 'MARKET';

  const meta = symbolMeta[symbol];
  if (!meta) throw new ExchangeError('Symbol not permitted', { status: 400, code: 'SYMBOL_NOT_ALLOWED' });
  const baseAsset = meta.base;
  const quoteAsset = meta.quote;

  const quantityBig = parseUnits(quantity.toString(), 18);
  const priceBig = parseUnits(price.toString(), 18);
  const notionalBig = (quantityBig * priceBig) / UNIT;
  const takerFeeFraction = isMarket ? await loadTakerFeeFraction() : 0;
  const quantityValue = Number(quantity);
  const priceValue = Number(price);
  const feeBaseValueMarket =
    isMarket && side === 'BUY' && takerFeeFraction > 0 ? quantityValue * takerFeeFraction : 0;
  const feeQuoteValueMarket =
    isMarket && takerFeeFraction > 0 ? quantityValue * priceValue * takerFeeFraction : 0;
  const feeBaseBigMarket = toBigDecimal(feeBaseValueMarket);
  const feeQuoteBigMarket = toBigDecimal(feeQuoteValueMarket);

  const { payload, notification } = await withTx(async (trx) => {
    let tradeNotification = null;
    if (side === 'BUY') {
      const quoteBalance = await getAccountBalance({ userId, namespace: 'spot:available', asset: quoteAsset }, trx);
      if (quoteBalance < notionalBig) {
        throw new ExchangeError(`Insufficient ${quoteAsset} balance.`, {
          status: 400,
          code: 'INSUFFICIENT_BALANCE',
          details: {
            asset: quoteAsset,
            available: toDisplayAmount(quoteBalance, 8),
            required: toDisplayAmount(notionalBig, 8),
          },
        });
      }
    } else {
      const baseBalance = await getAccountBalance({ userId, namespace: 'spot:available', asset: baseAsset }, trx);
      if (baseBalance < quantityBig) {
        throw new ExchangeError(`Insufficient ${baseAsset} balance..`, {
          status: 400,
          code: 'INSUFFICIENT_BALANCE',
          details: {
            asset: baseAsset,
            available: toDisplayAmount(baseBalance, 8),
            required: toDisplayAmount(quantityBig, 8),
          },
        });
      }
    }

    const now = new Date();
    const orderPayload = {
      user_id: userId,
      symbol,
      side,
      type,
      price: price.toFixed(8),
      size: quantity.toFixed(8),
      filled: isMarket ? quantity.toFixed(8) : '0.00000000',
      status: isMarket ? 'FILLED' : 'NEW',
      created_at: now,
      updated_at: now,
    };

    const inserted = await trx('spot_orders').insert(orderPayload);
    const orderId = resolveInsertId(inserted);

    if (!isMarket) {
      const entries =
        side === 'BUY'
          ? [
            {
              account: { userId, namespace: 'spot:available', asset: quoteAsset },
              amount: -notionalBig,
              meta: { orderId, symbol, action: 'lock', side },
            },
            {
              account: { userId, namespace: 'spot:locked', asset: quoteAsset },
              amount: notionalBig,
              meta: { orderId, symbol, action: 'lock', side },
            },
          ]
          : [
            {
              account: { userId, namespace: 'spot:available', asset: baseAsset },
              amount: -quantityBig,
              meta: { orderId, symbol, action: 'lock', side },
            },
            {
              account: { userId, namespace: 'spot:locked', asset: baseAsset },
              amount: quantityBig,
              meta: { orderId, symbol, action: 'lock', side },
            },
          ];

      await journal(
        trx,
        entries,
        {
          description: `Lock assets for ${type} ${symbol}`,
          meta: { userId, orderId, symbol, side, type },
        }
      );
    } else if (side === 'BUY') {
      await journal(
        trx,
        [
          {
            account: { userId, namespace: 'spot:available', asset: quoteAsset },
            amount: -notionalBig,
            meta: { orderId, symbol, action: 'buy' },
          },
          {
            account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: quoteAsset },
            amount: notionalBig,
            meta: { orderId, symbol, action: 'buy', counterparty: 'house' },
          },
          {
            account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: baseAsset },
            amount: -quantityBig,
            meta: { orderId, symbol, action: 'buy', counterparty: 'house' },
          },
          {
            account: { userId, namespace: 'spot:available', asset: baseAsset },
            amount: quantityBig,
            meta: { orderId, symbol, action: 'buy' },
          },
          ...(feeBaseBigMarket > 0n
            ? [
              {
                account: { userId, namespace: 'spot:available', asset: baseAsset },
                amount: -feeBaseBigMarket,
                meta: { orderId, symbol, action: 'taker_fee' },
              },
              {
                account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: baseAsset },
                amount: feeBaseBigMarket,
                meta: { orderId, symbol, action: 'taker_fee', counterparty: 'house' },
              },
            ]
            : []),
        ],
        { description: `Spot BUY ${symbol}`, meta: { userId, orderId } }
      );
      tradeNotification = {
        userId,
        symbol,
        side,
        fee: Number(feeBaseValueMarket || 0).toFixed(8),
        feeAsset: baseAsset,
      };
    } else if (isMarket && side === 'SELL') {
      await journal(
        trx,
        [
          {
            account: { userId, namespace: 'spot:available', asset: baseAsset },
            amount: -quantityBig,
            meta: { orderId, symbol, action: 'sell' },
          },
          {
            account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: baseAsset },
            amount: quantityBig,
            meta: { orderId, symbol, action: 'sell', counterparty: 'house' },
          },
          {
            account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: quoteAsset },
            amount: -notionalBig,
            meta: { orderId, symbol, action: 'sell', counterparty: 'house' },
          },
          {
            account: { userId, namespace: 'spot:available', asset: quoteAsset },
            amount: notionalBig,
            meta: { orderId, symbol, action: 'sell' },
          },
          ...(feeQuoteBigMarket > 0n
            ? [
              {
                account: { userId, namespace: 'spot:available', asset: quoteAsset },
                amount: -feeQuoteBigMarket,
                meta: { orderId, symbol, action: 'taker_fee' },
              },
              {
                account: { userId: null, namespace: HOUSE_SPOT_NAMESPACE, asset: quoteAsset },
                amount: feeQuoteBigMarket,
                meta: { orderId, symbol, action: 'taker_fee', counterparty: 'house' },
              },
            ]
            : []),
        ],
        { description: `Spot SELL ${symbol}`, meta: { userId, orderId } }
      );
      tradeNotification = {
        userId,
        symbol,
        side,
        fee: Number(feeQuoteValueMarket || 0).toFixed(8),
        feeAsset: quoteAsset,
      };
    }

    if (isMarket) {
      await trx('spot_trades').insert({
        order_id: orderId,
        match_id: null,
        price: price.toFixed(8),
        size: quantity.toFixed(8),
        fee: Number(feeQuoteValueMarket).toFixed(8),
        created_at: now,
        updated_at: now,
      });
    }

    const order = await trx('spot_orders').where({ id: orderId }).first();
    const payload = {
      id: String(order.id),
      clientOrderId: null,
      symbol,
      side,
      type,
      price: Number(order.price),
      qty: Number(order.size),
      filled: Number(order.filled),
      status: order.status,
      createdAt: order.created_at instanceof Date ? order.created_at.toISOString() : order.created_at,
    };
    if (tradeNotification) {
      tradeNotification.price = payload.price;
      tradeNotification.quantity = payload.qty;
    }
    return { payload, notification: tradeNotification };
  });

  if (notification) {
    try {
      const contact = await getUserContact(userId);
      if (contact?.email) {
        await sendSpotTradeEmail({
          to: contact.email,
          name: contact.name,
          symbol: notification.symbol,
          side: notification.side,
          price: notification.price,
          quantity: notification.quantity,
          fee: notification.fee,
          feeAsset: notification.feeAsset,
        });
      }
    } catch (err) {
      console.error('[mail] spot trade email failed', err.message);
    }
  }

  return payload;
}

export async function cancelSpotOrder(userId, body) {
  const symbol = normalizeSpotSymbol(body.symbol);
  const orderId = body.orderId ? Number(body.orderId) : undefined;
  if (!orderId) throw new ExchangeError('ORDER_ID_REQUIRED', { status: 400, code: 'ORDER_ID_REQUIRED' });

  const meta = symbolMeta[symbol];
  if (!meta) throw new ExchangeError('SYMBOL_NOT_ALLOWED', { status: 400, code: 'SYMBOL_NOT_ALLOWED' });
  const baseAsset = meta.base;
  const quoteAsset = meta.quote;

  return withTx(async (trx) => {
    const order = await trx('spot_orders').where({ id: orderId, user_id: userId, symbol }).first();
    if (!order) throw new ExchangeError('ORDER_NOT_FOUND', { status: 404, code: 'ORDER_NOT_FOUND' });
    if (order.status !== 'NEW') {
      throw new ExchangeError('ORDER_STATUS_FINAL', { status: 400, code: 'ORDER_STATUS_FINAL' });
    }

    const now = new Date();
    await trx('spot_orders').where({ id: order.id }).update({ status: 'CANCELED', updated_at: now });

    const quantityBig = parseUnits(String(order.size || 0), 18);
    const filledBig = parseUnits(String(order.filled || 0), 18);
    const remainingBig = quantityBig > filledBig ? quantityBig - filledBig : 0n;

    if (remainingBig > 0n) {
      if (order.side === 'BUY') {
        const priceBig = parseUnits(String(order.price || 0), 18);
        const remainingNotionalBig = (remainingBig * priceBig) / UNIT;
        if (remainingNotionalBig > 0n) {
          await journal(
            trx,
            [
              {
                account: { userId, namespace: 'spot:locked', asset: quoteAsset },
                amount: -remainingNotionalBig,
                meta: { orderId: order.id, symbol, action: 'release', side: 'BUY' },
              },
              {
                account: { userId, namespace: 'spot:available', asset: quoteAsset },
                amount: remainingNotionalBig,
                meta: { orderId: order.id, symbol, action: 'release', side: 'BUY' },
              },
            ],
            { description: `Release locked ${quoteAsset} for ${symbol}`, meta: { userId, orderId: order.id } }
          );
        }
      } else {
        await journal(
          trx,
          [
            {
              account: { userId, namespace: 'spot:locked', asset: baseAsset },
              amount: -remainingBig,
              meta: { orderId: order.id, symbol, action: 'release', side: 'SELL' },
            },
            {
              account: { userId, namespace: 'spot:available', asset: baseAsset },
              amount: remainingBig,
              meta: { orderId: order.id, symbol, action: 'release', side: 'SELL' },
            },
          ],
          { description: `Release locked ${baseAsset} for ${symbol}`, meta: { userId, orderId: order.id } }
        );
      }
    }

    return {
      symbol,
      orderId: order.id,
      status: 'CANCELED',
    };
  });
}

export async function marketHistory(symbol, { interval = '1m', limit = 60 } = {}) {
  const upper = normalizeSpotSymbol(symbol);
  trackSpotSymbol(upper);
  const series = await getCandleSeries(upper, { interval, limit }).catch(() => null);
  if (!series) return [];
  return series.candles.map((candle) => ({
    time: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

export async function exchangeSnapshot(symbol, userId) {
  const upper = normalizeSpotSymbol(symbol);
  trackSpotSymbol(upper);
  const [tickerData, orderbookData, tradesData, walletsData, openOrdersData, historyData] =
    await Promise.all([
      ticker(upper).catch(() => null),
      orderbook(upper, { depth: 100 }).catch(() => null),
      trades(upper, { limit: 100 }).catch(() => []),
      userId ? wallets(userId).catch(() => []) : [],
      userId ? openOrders(userId).catch(() => []) : [],
      marketHistory(upper, { interval: '1m', limit: 60 }).catch(() => []),
    ]);

  const normalizedTrades = tradesData.map((trade) => ({
    id: String(trade.id),
    price: trade.price,
    qty: trade.qty,
    side: trade.side,
    ts: trade.time ?? trade.ts ?? Date.now(),
  }));

  const normalizedOrders = openOrdersData.map((order) => ({
    id: String(order.id),
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    price: order.price,
    qty: order.qty,
    filled: order.filled,
    status: order.status,
    createdAt: order.created_at instanceof Date ? order.created_at.toISOString() : order.created_at,
  }));

  const walletsPayload = walletsData.map((wallet) => ({
    asset: wallet.asset,
    free: wallet.free ?? wallet.balance ?? 0,
    locked: wallet.locked ?? 0,
  }));

  return {
    symbol: upper,
    ticker: tickerData,
    orderbook: orderbookData
      ? {
        lastUpdateId: orderbookData.lastUpdateId,
        bids: orderbookData.bids,
        asks: orderbookData.asks,
      }
      : { lastUpdateId: 0, bids: [], asks: [] },
    trades: normalizedTrades,
    wallets: walletsPayload,
    openOrders: normalizedOrders,
    history: historyData,
  };
}

async function loadTakerFeeFraction() {
  try {
    const settings = await getSettings();
    const pct = Number(settings.tradeTakerFee || 0);
    if (!Number.isFinite(pct) || pct <= 0) return 0;
    return pct / 100;
  } catch {
    return 0;
  }
}


