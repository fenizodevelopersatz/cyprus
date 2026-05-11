import { db } from '../db.js';
import { getBalancesByNamespace } from './ledgerService.js';
import * as futuresService from './futuresService.js';
import * as marketService from './marketService.js';
import { listOrders as listSipOrders, getUserSipLiabilities } from './sipService.js';

const BALANCE_NAMESPACES = [
  'spot:available',
  'spot:locked',
  'spot:pending_withdrawal',
  'futures:available',
  'futures:margin',
];

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
}

async function fetchAssetPrices(assets) {
  const result = {};
  const unique = Array.from(
    new Set(
      assets
        .map((asset) => String(asset || '').toUpperCase())
        .filter((asset) => asset && asset !== 'USDT')
    )
  );

  if (!unique.length) {
    return { USDT: 1, ...result };
  }

  const markets = await db('market_symbols')
    .whereIn('base_asset', unique)
    .andWhere('quote_asset', 'USDT');

  if (!markets.length) {
    return { USDT: 1, ...result };
  }

  const symbols = markets.map((row) => row.symbol);
  const snapshots = await marketService.tickers({ symbols }).catch(() => []);
  for (const market of markets) {
    const matching = snapshots.find((snap) => snap.symbol === market.symbol);
    const price = matching?.last ?? Number(market.last_price || 0);
    if (price && price > 0) {
      result[market.base_asset] = price;
    }
  }

  return { USDT: 1, ...result };
}

function aggregateBalances(rows) {
  const map = new Map();
  for (const row of rows) {
    const asset = String(row.asset || '').toUpperCase();
    if (!asset) continue;
    const amount = toNumber(row.amount);
    if (!amount) continue;
    const entry =
      map.get(asset) ||
      {
        asset,
        total: 0,
        available: 0,
        locked: 0,
      };
    entry.total += amount;
    if (row.namespace === 'spot:available' || row.namespace === 'futures:available') {
      entry.available += amount;
    } else {
      entry.locked += amount;
    }
    map.set(asset, entry);
  }
  return Array.from(map.values());
}

export async function getRecentActivity(userId, limit = 16) {
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 16;

  const [spotOrders, futuresTrades, sipOrders] = await Promise.all([
    db('spot_orders')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(safeLimit)
      .catch(() => []),
    db('futures_trades')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(safeLimit)
      .catch(() => []),
    listSipOrders({ userId, limit: safeLimit }).catch(() => []),
  ]);

  const activities = [];

  for (const order of spotOrders) {
    activities.push({
      id: `spot-${order.id}`,
      symbol: order.symbol,
      side: order.side,
      type: `spot:${order.type}`,
      qty: toNumber(order.size),
      price: order.price ? toNumber(order.price) : undefined,
      status: order.status,
      createdAt: toIso(order.created_at),
      updatedAt: toIso(order.updated_at),
    });
  }

  for (const trade of futuresTrades) {
    activities.push({
      id: `futures-${trade.id}`,
      symbol: `${trade.symbol}-PERP`,
      side: trade.side,
      type: 'futures:trade',
      qty: toNumber(trade.size),
      price: trade.price ? toNumber(trade.price) : undefined,
      status: trade.status || 'CLOSE',
      createdAt: toIso(trade.created_at),
      updatedAt: toIso(trade.updated_at),
    });
  }

  for (const order of sipOrders) {
    activities.push({
      id: `sip-${order.id}`,
      symbol: order.asset,
      side: order.status,
      type: 'sip:order',
      qty: Number(order.scheduledAmountAsset || order.executedAmountAsset || 0),
      price: order.priceUsed ? toNumber(order.priceUsed) : undefined,
      status: order.status,
      createdAt: toIso(order.scheduledFor),
      updatedAt: toIso(order.executedAt || order.createdAt),
    });
  }

  activities.sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  return activities.slice(0, safeLimit);
}

export async function getEquityHistory(userId, { limit = 120 } = {}) {
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 120;
  try {
    const rows = await db('portfolio_equity_history')
      .where({ user_id: userId })
      .orderBy('timestamp', 'desc')
      .limit(safeLimit);
    if (rows.length) {
      return rows
        .map((row) => ({
          timestamp: toIso(row.timestamp) || row.timestamp,
          value: toNumber(row.value),
        }))
        .reverse();
    }
  } catch (err) {
    // fall through to synthetic timeline
  }
  return synthesizeEquityHistory(userId, safeLimit);
}

export async function getPortfolioSnapshot(userId) {
  const [balanceRows, futuresPositions, activity, history, sipLiabilities] = await Promise.all([
    getBalancesByNamespace(userId, BALANCE_NAMESPACES).catch(() => []),
    futuresService.positions(userId, { status: 'OPEN' }).catch(() => []),
    getRecentActivity(userId, 16),
    getEquityHistory(userId, { limit: 60 }),
    getUserSipLiabilities(userId).catch(() => []),
  ]);

  const balances = aggregateBalances(balanceRows);
  const assets = balances.map((entry) => entry.asset);
  const prices = await fetchAssetPrices(assets);

  let totalBalanceValue = 0;
  for (const balance of balances) {
    const price = prices[balance.asset] ?? 0;
    const usdValue = price * balance.total;
    balance.usdValue = Number(usdValue.toFixed(2));
    balance.available = Number(balance.available.toFixed(8));
    balance.locked = Number(balance.locked.toFixed(8));
    balance.total = Number(balance.total.toFixed(8));
    totalBalanceValue += usdValue;
  }

  const positions = futuresPositions.map((position) => {
    const notional = Number(position.notional ?? 0);
    const unrealized = Number(position.unrealizedPnl || 0);
    return {
      symbol: position.symbol,
      qty: Number(position.size || 0),
      avgPrice: Number(position.entryPrice || 0),
      markPrice: Number(position.markPrice || 0),
      usdValue: Number(notional.toFixed(2)),
      unrealizedPnl: Number(unrealized.toFixed(2)),
    };
  });

  const unrealizedTotal = positions.reduce(
    (sum, position) => sum + toNumber(position.unrealizedPnl),
    0
  );

  const equity = totalBalanceValue + unrealizedTotal;

  const allocationEntries = [];
  for (const balance of balances) {
    if (balance.usdValue && balance.usdValue > 0) {
      allocationEntries.push({
        symbol: balance.asset,
        value: balance.usdValue,
      });
    }
  }
  for (const position of positions) {
    const value = Math.abs(position.usdValue || 0);
    if (value > 0) {
      allocationEntries.push({
        symbol: position.symbol,
        value,
      });
    }
  }

  const allocationTotal = allocationEntries.reduce((sum, item) => sum + item.value, 0);
  const allocation =
    allocationTotal > 0
      ? allocationEntries.map((item) => ({
          symbol: item.symbol,
          value: Number(item.value.toFixed(2)),
          pct: Number((item.value / allocationTotal).toFixed(4)),
        }))
      : [];

  return {
    equity: Number(equity.toFixed(2)),
    unrealizedPnl: Number(unrealizedTotal.toFixed(2)),
    balances,
    positions,
    allocation,
    activity,
    timeline: history,
    sipLiabilities,
    updatedAt: new Date().toISOString(),
  };
}

const ONE_MINUTE = 60 * 1000;

function buildFlatSeries(value, points) {
  const safePoints =
    Number.isFinite(points) && points > 1 ? Math.min(Math.floor(points), 500) : 2;
  const now = Date.now();
  const rounded = Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
  const series = [];
  for (let idx = safePoints - 1; idx >= 0; idx -= 1) {
    const ts = new Date(now - idx * ONE_MINUTE).toISOString();
    series.push({ timestamp: ts, value: rounded });
  }
  return series;
}

async function synthesizeEquityHistory(userId, limit) {
  const [balanceRows, positionRows] = await Promise.all([
    getBalancesByNamespace(userId, BALANCE_NAMESPACES).catch(() => []),
    db('futures_positions')
      .where({ user_id: userId, status: 'OPEN' })
      .select('symbol', 'side', 'size', 'entry_price')
      .catch(() => []),
  ]);

  const balances = aggregateBalances(balanceRows);
  const priceAwareAssets = [];
  let staticValue = 0;

  for (const balance of balances) {
    const amount = Number(balance.total || 0);
    if (!amount) continue;
    const asset = String(balance.asset || '').toUpperCase();
    if (!asset) continue;
    if (asset === 'USDT') {
      staticValue += amount;
    } else {
      priceAwareAssets.push({
        asset,
        amount,
        symbol: `${asset}USDT`,
      });
    }
  }

  const positions = positionRows
    .map((row) => ({
      symbol: String(row.symbol || '').toUpperCase(),
      entry: Number(row.entry_price || 0),
      qty: Number(row.size || 0),
      direction: row.side === 'LONG' ? 1 : -1,
    }))
    .filter((pos) => pos.symbol && Number.isFinite(pos.qty) && pos.qty > 0);

  const trackedSymbols = new Set([
    ...priceAwareAssets.map((entry) => entry.symbol),
    ...positions.map((pos) => pos.symbol),
  ]);

  if (!trackedSymbols.size) {
    return buildFlatSeries(staticValue, limit);
  }

  const marketRows = await db('market_symbols')
    .whereIn('symbol', Array.from(trackedSymbols))
    .select('symbol', 'last_price');
  const fallbackPrice = new Map();
  for (const row of marketRows) {
    const price = Number(row.last_price || 0);
    if (Number.isFinite(price) && price > 0) {
      fallbackPrice.set(row.symbol.toUpperCase(), price);
    }
  }

  for (const pos of positions) {
    if (!fallbackPrice.has(pos.symbol) && Number.isFinite(pos.entry) && pos.entry > 0) {
      fallbackPrice.set(pos.symbol, pos.entry);
    }
  }
  for (const asset of priceAwareAssets) {
    if (!fallbackPrice.has(asset.symbol)) {
      fallbackPrice.set(asset.symbol, 0);
    }
  }

  const computeBaseline = () => {
    let total = staticValue;
    for (const asset of priceAwareAssets) {
      const marker = fallbackPrice.get(asset.symbol);
      if (!Number.isFinite(marker)) continue;
      total += asset.amount * marker;
    }
    for (const pos of positions) {
      const marker = fallbackPrice.get(pos.symbol) ?? pos.entry;
      total += (marker - pos.entry) * pos.qty * pos.direction;
    }
    return total;
  };

  const priceHistories = new Map();
  await Promise.all(
    Array.from(trackedSymbols).map(async (symbol) => {
      const rows = await db('futures_price_ticks')
        .where({ symbol })
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .catch(() => []);
      const normalized = rows
        .map((row) => ({
          ts: new Date(row.timestamp).getTime(),
          price: Number(row.price),
        }))
        .filter((point) => Number.isFinite(point.price))
        .sort((a, b) => a.ts - b.ts);
      priceHistories.set(symbol, normalized);
    })
  );

  const bucketMap = new Map();
  for (const [symbol, history] of priceHistories.entries()) {
    for (const point of history) {
      const bucket = Math.floor(point.ts / ONE_MINUTE) * ONE_MINUTE;
      if (!bucketMap.has(bucket)) bucketMap.set(bucket, new Map());
      bucketMap.get(bucket).set(symbol, point.price);
    }
  }

  let buckets = Array.from(bucketMap.keys()).sort((a, b) => a - b);
  if (!buckets.length) {
    const fallbackValue = computeBaseline();
    return buildFlatSeries(fallbackValue, limit);
  }

  buckets = buckets.slice(-limit);
  const lastPrice = new Map();
  for (const symbol of trackedSymbols) {
    if (fallbackPrice.has(symbol)) lastPrice.set(symbol, fallbackPrice.get(symbol));
  }

  const fallbackValue = computeBaseline();
  const series = [];

  for (const bucket of buckets) {
    const updates = bucketMap.get(bucket);
    if (updates) {
      for (const [symbol, price] of updates.entries()) {
        if (Number.isFinite(price)) lastPrice.set(symbol, price);
      }
    }

    let total = staticValue;
    for (const asset of priceAwareAssets) {
      const marker = lastPrice.get(asset.symbol);
      if (!Number.isFinite(marker)) continue;
      total += asset.amount * marker;
    }
    for (const pos of positions) {
      const marker = lastPrice.get(pos.symbol);
      if (!Number.isFinite(marker)) continue;
      total += (marker - pos.entry) * pos.qty * pos.direction;
    }
    const value = Number.isFinite(total) ? Number(total.toFixed(2)) : Number(fallbackValue.toFixed(2));
    series.push({ timestamp: new Date(bucket).toISOString(), value });
  }

  if (!series.length) {
    return buildFlatSeries(fallbackValue, limit);
  }
  return series;
}
