import { db } from '../db.js';
import { symbols as symbolMeta, allowedSpotSymbols } from '../utils/symbols.js';
import * as marketService from './marketService.js';
import { getBalancesByNamespace } from './ledgerService.js';
import { getCandleSeries, getTopMoversSnapshot } from './binanceSync.js';
import { getControlSettings } from './adminControlService.js';

const OPEN_ORDER_STATUSES = ['NEW', 'PARTIALLY_FILLED'];

function parseCount(row) {
  if (!row) return 0;
  const values = Object.values(row);
  if (!values.length) return 0;
  const raw = values[0];
  return typeof raw === 'number' ? raw : Number(raw || 0);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMaxAmount(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'unlimited') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getUserTelegramAccess(userId) {
  const [user, controlSettings] = await Promise.all([
    db('users').select('id', 'main_wallet_balance').where({ id: userId }).first(),
    getControlSettings(),
  ]);

  const telegramChannelUrl = String(controlSettings?.globalRules?.telegramChannelUrl || '').trim();
  if (!user || !telegramChannelUrl) {
    return {
      isEligible: false,
      matchedPackageTier: null,
      telegramChannelUrl: null,
    };
  }

  const balance = toNumber(user.main_wallet_balance);
  const matchedPackageTier =
    (controlSettings?.packageTiers || [])
      .filter((tier) => Boolean(tier?.isEnabled))
      .sort((a, b) => toNumber(a.minAmount) - toNumber(b.minAmount))
      .find((tier) => {
        const minAmount = toNumber(tier.minAmount);
        const maxAmount = normalizeMaxAmount(tier.maxAmount);
        return balance >= minAmount && (maxAmount === null || balance <= maxAmount);
      }) || null;

  if (!matchedPackageTier) {
    return {
      isEligible: false,
      matchedPackageTier: null,
      telegramChannelUrl: null,
    };
  }

  return {
    isEligible: true,
    matchedPackageTier: {
      id: matchedPackageTier.id,
      packageName: matchedPackageTier.packageName,
      minAmount: toNumber(matchedPackageTier.minAmount),
      maxAmount: matchedPackageTier.maxAmount,
      signalsPerDay: toNumber(matchedPackageTier.signalsPerDay),
    },
    telegramChannelUrl,
  };
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
async function assetPriceMap(assets) {
  const map = { USDT: 1 };
  const targets = assets.filter((a) => a && a.toUpperCase() !== 'USDT');
  if (!targets.length) return map;

  const marketsQuery = db('market_symbols')
    .whereIn('base_asset', targets)
    .andWhere('quote_asset', 'USDT');
  if (allowedSpotSymbols.length) {
    marketsQuery.whereIn('symbol', allowedSpotSymbols);
  }
  const markets = await marketsQuery;

  if (!markets.length) return map;

  const snapshots = await marketService.tickers({
    symbols: markets.map((m) => m.symbol),
  });

  for (const snap of snapshots) {
    map[snap.baseAsset] = snap.last;
  }
  return map;
}

export async function getCurrentUser(userId) {
  if (!userId) {
    const error = new Error('AUTH_USER_ID_REQUIRED');
    error.status = 401;
    throw error;
  }

  const user = await db('users').where({ id: userId }).first();
  if (!user) {
    const error = new Error('USER_NOT_FOUND');
    error.status = 404;
    throw error;
  }

  const profile = await db('user_profiles').where({ user_id: userId }).first();

  return {
    id: user.id,
    email: user.email,
    name: profile?.display_name || user.email.split('@')[0],
    displayName: profile?.display_name || user.email.split('@')[0],
    currentLevelCode: user.current_level_code || null,
    currentLevelRank: toNumber(user.current_level_rank),
    twoFactorEnabled: profile?.two_factor_enabled === undefined || profile?.two_factor_enabled === null ? true : Boolean(profile.two_factor_enabled),
    kycStatus: {
      level: user.kyc_level || 0,
      verified: !!user.kyc_verified,
    },
  };
}

export async function getWalletSummary(userId) {
  const safeTopMoverPromise = getTopMovers(1).catch((err) => {
    console.warn('[dashboard] top mover snapshot failed', err?.message || err);
    return [];
  });

  const [userRow, balanceRows, positionsCountRow, openOrdersCountRow, mover, telegramAccess] = await Promise.all([
    db('users').select('main_wallet_balance').where({ id: userId }).first(),
    getBalancesByNamespace(userId, ['spot:available', 'spot:pending_withdrawal', 'spot:locked']),
    db('futures_positions')
      .where({ user_id: userId, status: 'OPEN' })
      .count({ count: 'id' })
      .first(),
    db('spot_orders')
      .where({ user_id: userId })
      .whereIn('status', OPEN_ORDER_STATUSES)
      .count({ count: 'id' })
      .first(),
    safeTopMoverPromise,
    getUserTelegramAccess(userId),
  ]);

    const freeMap = {};
  const lockedMap = {};
  for (const row of balanceRows) {
    const asset = row.asset;
    if (!asset) continue;
    const amount = Number(row.amount || 0);
    if (!amount) continue;
    if (row.namespace === 'spot:available') {
      freeMap[asset] = (freeMap[asset] || 0) + amount;
    } else {
      lockedMap[asset] = (lockedMap[asset] || 0) + amount;
    }
  }

  const assets = Array.from(new Set([...Object.keys(freeMap), ...Object.keys(lockedMap)]));
  const totals = {};
  const priceLookup = await assetPriceMap(assets);

    const balances = assets.map((asset) => {
    const free = freeMap[asset] || 0;
    const lockedAmount = lockedMap[asset] || 0;
    totals[asset] = free + lockedAmount;
    return {
      asset,
      free: Number(free.toFixed(8)),
      locked: Number(lockedAmount.toFixed(8)),
    };
  });

  const totalEquity = assets.reduce((sum, asset) => {
    const price = priceLookup[asset] || 1;
    return sum + totals[asset] * price;
  }, 0);

  return {
    mainWalletBalance: toNumber(userRow?.main_wallet_balance),
    totalEquity,
    balances,
    positionsCount: parseCount(positionsCountRow),
    openOrdersCount: parseCount(openOrdersCountRow),
    topMover: mover[0] || null,
    telegramAccess,
  };
}

export async function getPositions(userId, { status } = {}) {
  const rows = await db('futures_positions')
    .where({ user_id: userId })
    .modify((q) => {
      if (status) q.where({ status: status.toUpperCase() });
    })
    .orderBy('updated_at', 'desc');

  if (!rows.length) return [];

  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const snapshots = await marketService.tickers({ symbols });
  const priceMap = snapshots.reduce((acc, snap) => {
    acc[snap.symbol] = snap.last;
    return acc;
  }, {});

  return rows.map((row) => {
    const rawQty = Number(row.size ?? row.qty ?? row.quantity ?? 0);
    const qty = Number.isFinite(rawQty) ? rawQty : 0;
    const avgPrice = Number(row.entry_price || 0);
    const markPrice = priceMap[row.symbol] ?? avgPrice;
    const direction = row.side === 'LONG' ? 1 : -1;
    const pnl = (markPrice - avgPrice) * qty * direction;
    return {
      symbol: row.symbol,
      side: row.side,
      qty,
      quantity: qty,
      avgPrice,
      markPrice,
      unrealizedPnl: Number(pnl.toFixed(8)),
      leverage: row.leverage ? Number(row.leverage) : null,
      updatedAt: row.updated_at,
    };
  });
}

function normalizeOrder(row) {
  const rawQty = Number(row.size ?? row.quantity ?? row.qty ?? 0);
  const qty = Number.isFinite(rawQty) ? rawQty : 0;
  const rawFilled = Number(row.filled ?? row.executed ?? 0);
  const filled = Number.isFinite(rawFilled) ? rawFilled : 0;
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    price: row.price ? Number(row.price) : null,
    qty,
    quantity: qty,
    filled,
    status: row.status,
    exchange: row.exchange || null,
    exchangeOrderId: row.exchange_order_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listOrders(userId, { status, limit } = {}) {
  const query = db('spot_orders')
    .where({ user_id: userId })
    .orderBy('created_at', 'desc');

  if (status) {
    if (status.toLowerCase() === 'open') {
      query.whereIn('status', OPEN_ORDER_STATUSES);
    } else {
      query.where({ status: status.toUpperCase() });
    }
  }

  const safeLimit =
    typeof limit === 'number' && !Number.isNaN(limit)
      ? Math.min(Math.max(Math.floor(limit), 1), 200)
      : undefined;
  if (safeLimit) query.limit(safeLimit);

  const rows = await query;
  return rows.map(normalizeOrder);
}

export async function listRecentOrders(userId, limit = 10) {
  return listOrders(userId, { limit });
}

export async function marketPulse(symbol, { interval = '1m', points = 60 } = {}) {
  const limit = Math.min(Math.max(points || 0, 1), 500);
  const snapshot = await getCandleSeries(symbol, { interval, limit });
  const candles = snapshot.candles.map((candle) => ({
    openTime: candle.openTime,
    closeTime: candle.closeTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
  return {
    symbol: snapshot.symbol,
    interval: snapshot.interval,
    last: snapshot.last,
    candles,
    updatedAt: snapshot.updatedAt,
    staleAt: snapshot.staleAt,
  };
}

export async function getTickerSnapshots(symbols) {
  return marketService.tickers({ symbols });
}

export async function getTopMovers(limit = 3, { window, universe } = {}) {
  const snapshot = await getTopMoversSnapshot({ limit, window, universe });
  return snapshot.movers.map((item) => ({
    symbol: item.symbol,
    baseAsset: item.base,
    quoteAsset: item.quote,
    last: item.last,
    changePct: Number(item.changePct?.toFixed?.(2) ?? item.changePct ?? 0),
    volumeUsd: item.volumeUsd,
  }));
}

export async function getTopMoversDetailed(options) {
  return getTopMoversSnapshot(options);
}

export async function getPromotions({ placement } = {}) {
  const query = db('dashboard_promotions').where({ active: true });
  if (placement) query.andWhere({ placement });
  const rows = await query.orderBy([{ column: 'pinned', order: 'desc' }, { column: 'published_at', order: 'desc' }]).select('*').catch(() => []);

  if (!rows.length) {
    return [
      {
        id: 'promo-pro-trading',
        title: 'Unlock Pro Trading Tools',
        subtitle:
          'Upgrade to Pro tier and access advanced order types & analytics.',
        cta: 'Upgrade Now',
        route: '/settings/subscriptions',
        accentGradient: ['#1a237e', '#0d47a1'],
      },
      {
        id: 'promo-stake',
        title: 'Earn Yield on Idle USDT',
        subtitle: 'Stake stablecoins with flexible redemption and daily rewards.',
        cta: 'Start Staking',
        route: '/earn/usdt',
        accentGradient: ['#00695c', '#26a69a'],
      },
    ];
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    cta: row.cta_label,
    route: row.cta_url,
    placement: row.placement,
    accentGradient: [row.accent_start, row.accent_end].filter(Boolean),
    publishedAt: row.published_at,
    meta: row.meta ?? undefined,
  }));
}

export async function getNews(limit = 10) {
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 100) : 10;

  const rows = await db('dashboard_news')
    .orderBy([{ column: 'pinned', order: 'desc' }, { column: 'published_at', order: 'desc' }])
    .limit(safeLimit)
    .select('*')
    .catch(() => []);

  if (!rows.length) {
    return [
      {
        id: 'news-bitcoin-cpi',
        title: 'Bitcoin steadies as markets digest latest CPI print',
        summary:
          'BTC held above key support after US inflation data signalled cooling price pressures.',
        source: 'NovaX Research Desk',
        tag: 'Markets',
        publishedAt: new Date(Date.now() - 1000 * 60 * 30),
      },
      {
        id: 'news-eth-upgrade',
        title: 'Ethereum developers schedule Dencun upgrade on testnets',
        summary:
          'Core contributors confirmed a phased rollout starting with Goerli ahead of mainnet activation.',
        source: 'ChainWire',
        tag: 'Technology',
        publishedAt: new Date(Date.now() - 1000 * 60 * 90),
      },
      {
        id: 'news-regulation',
        title: 'Asia-Pacific regulators publish joint crypto compliance guidance',
        summary:
          'Regulators emphasised customer protection, stablecoin oversight, and robust AML controls.',
        source: 'Global Finance Watch',
        tag: 'Regulation',
        publishedAt: new Date(Date.now() - 1000 * 60 * 180),
      },
    ].slice(0, safeLimit);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.headline,
    summary: row.summary,
    source: row.source,
    tag: row.tag,
    url: row.url,
    publishedAt: row.published_at,
    pinned: !!row.pinned,
  }));
}




