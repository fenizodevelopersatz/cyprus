import { db } from '../db.js';
import { allowedSpotSymbols } from '../utils/symbols.js';
import * as marketService from './marketService.js';
import { getProgramOverview } from './stakingService.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RANGE_DAYS = 7;
const MAX_RANGE_DAYS = 90;
const DEFAULT_RANGE_DAYS = 30;
const PENDING_FIAT_STATUSES = ['requires_payment', 'pending_review'];
const WITHDRAWAL_DONE_STATUSES = ['confirmed', 'completed', 'broadcasted'];
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function clampRangeDays(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) return DEFAULT_RANGE_DAYS;
  return Math.min(Math.max(Math.floor(value), MIN_RANGE_DAYS), MAX_RANGE_DAYS);
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseCount(row, field = 'count') {
  if (!row) return 0;
  if (field in row) return toNumber(row[field]);
  const first = Object.values(row)[0];
  return toNumber(first);
}

function toDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function initDailyBuckets(rangeDays, since) {
  const buckets = new Map();
  for (let i = 0; i <= rangeDays; i += 1) {
    const date = new Date(since.getTime() + i * DAY_MS);
    const key = toDateKey(date);
    if (!key || buckets.has(key)) continue;
    buckets.set(key, {
      date: key,
      cryptoIn: 0,
      cryptoOut: 0,
      fiatIn: 0,
    });
  }
  return buckets;
}

function initUserBuckets(rangeDays, since) {
  const buckets = new Map();
  for (let i = 0; i <= rangeDays; i += 1) {
    const date = new Date(since.getTime() + i * DAY_MS);
    const key = toDateKey(date);
    if (!key || buckets.has(key)) continue;
    buckets.set(key, { date: key, new: 0, active: 0, total: 0 });
  }
  return buckets;
}

function applySeries(buckets, rows, targetKey, valueKey = 'total_amount') {
  for (const row of rows || []) {
    const key = toDateKey(row.day);
    if (!key || !buckets.has(key)) continue;
    buckets.get(key)[targetKey] = toNumber(row[valueKey] ?? row.total);
  }
}

function applyUserSeries(buckets, rows, field) {
  for (const row of rows || []) {
    const key = toDateKey(row.day);
    if (!key) continue;
    if (!buckets.has(key)) {
      buckets.set(key, { date: key, new: 0, active: 0, total: 0 });
    }
    buckets.get(key)[field] = parseCount(row, field);
  }
}

async function buildAssetPriceMap(assets = []) {
  const map = { USDT: 1 };
  const unique = Array.from(
    new Set(
      assets
        .map((asset) => String(asset || '').trim().toUpperCase())
        .filter((asset) => asset && asset !== 'USDT')
    )
  );
  if (!unique.length) return map;

  const marketsQuery = db('market_symbols')
    .whereIn('base_asset', unique)
    .andWhere('quote_asset', 'USDT');
  if (allowedSpotSymbols.length) {
    marketsQuery.whereIn('symbol', allowedSpotSymbols);
  }
  const markets = await marketsQuery.select('symbol', 'base_asset', 'last_price');
  if (!markets.length) return map;

  let snapshots = [];
  try {
    snapshots = await marketService.tickers({
      symbols: markets.map((market) => market.symbol),
    });
  } catch (err) {
    console.warn('[adminDashboard] ticker snapshot failed', err.message);
  }
  const latest = snapshots.reduce((acc, snap) => {
    if (snap?.symbol && Number.isFinite(snap.last)) {
      acc[snap.symbol] = snap.last;
    }
    return acc;
  }, {});

  for (const market of markets) {
    const price =
      latest[market.symbol] ??
      (Number.isFinite(Number(market.last_price)) ? Number(market.last_price) : null);
    if (!price || price <= 0) continue;
    map[market.base_asset] = price;
  }
  return map;
}

function formatQueue(rows, mapper) {
  return (rows || []).map((row) => mapper(row));
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatAmount(amount, decimals = 2) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return '0';
  if (Math.abs(numeric) >= 1) return numeric.toFixed(decimals).replace(/\.?0+$/, '');
  return numeric.toPrecision(3);
}

function formatTimeAgo(value, nowTs = Date.now()) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return null;
  const diff = Math.max(0, nowTs - ts);
  if (diff < MINUTE_MS) return 'just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  return `${Math.floor(diff / DAY_MS)}d ago`;
}

function describeActivity(item) {
  switch (item.type) {
    case 'CRYPTO_DEPOSIT':
      return `Crypto deposit ${formatAmount(item.amount, 4)} ${item.asset || ''}${
        item.chain ? ` on ${item.chain}` : ''
      }`;
    case 'CRYPTO_WITHDRAWAL':
      return `Crypto withdrawal ${formatAmount(item.amount, 4)} ${item.asset || ''} (${
        item.status || 'pending'
      })`;
    case 'FIAT_DEPOSIT':
      return `Fiat deposit ${formatAmount(item.amount, 2)} ${item.currency || ''} via ${
        item.method || 'manual'
      } (${item.status || 'pending'})`;
    case 'STAKING_EVENT': {
      const prefix =
        item.status === 'COMPLETED'
          ? 'Staking completed'
          : item.status === 'ACTIVE'
          ? 'Staking started'
          : 'Staking update';
      const pkgLabel = item.packageLabel ? ` • ${item.packageLabel}` : '';
      return `${prefix} ${formatAmount(item.amount, 4)} ${item.asset || ''}${pkgLabel}`;
    }
    case 'KYC_EVENT':
      return `KYC ${String(item.status || 'update').toUpperCase()}`;
    default:
      return item.type || 'activity';
  }
}

function activityAmount(item) {
  if (item.amount !== undefined) return toNumber(item.amount);
  if (item.rewards !== undefined) return toNumber(item.rewards);
  if (item.currencyAmount !== undefined) return toNumber(item.currencyAmount);
  return null;
}

function buildActivityDescription(item) {
  const userLabel = item.email ? ` by ${item.email}` : '';
  const ts = item.occurredAt ? new Date(item.occurredAt).toLocaleString() : '';
  switch (item.type) {
    case 'CRYPTO_DEPOSIT':
      return `On-chain credit${userLabel}${item.asset ? ` (${item.asset})` : ''}${ts ? ` at ${ts}` : ''}`;
    case 'CRYPTO_WITHDRAWAL':
      return `Crypto withdrawal${userLabel} ${item.status ? `(${item.status})` : ''}${ts ? ` at ${ts}` : ''}`;
    case 'FIAT_DEPOSIT':
      return `Fiat funding${userLabel}${item.method ? ` via ${item.method}` : ''}${ts ? ` at ${ts}` : ''}`;
    case 'STAKING_EVENT':
      return `Staking position${userLabel}${item.packageLabel ? ` • ${item.packageLabel}` : ''}${
        ts ? ` at ${ts}` : ''
      }`;
    case 'KYC_EVENT':
      return `KYC update${userLabel}${item.status ? ` (${item.status})` : ''}${ts ? ` at ${ts}` : ''}`;
    default:
      return `${item.type || 'Activity'}${userLabel}${ts ? ` at ${ts}` : ''}`;
  }
}

async function buildSpotLeaders(sinceDate, limit = 5) {
  const since = sinceDate instanceof Date ? sinceDate : new Date(sinceDate);
  const volumeRows = await db('spot_trades as t')
    .leftJoin('spot_orders as o', 't.order_id', 'o.id')
    .where('t.created_at', '>=', since)
    .whereNotNull('o.symbol')
    .select('o.symbol')
    .select(db.raw('SUM(t.price * t.size) as usd_volume'))
    .select(db.raw('SUM(t.size) as amount'))
    .groupBy('o.symbol')
    .orderBy('usd_volume', 'desc')
    .limit(limit);
  if (volumeRows.length) {
    const tickers = await marketService.tickers({
      symbols: volumeRows.map((row) => row.symbol),
    });
    const tickerMap = new Map(tickers.map((snap) => [snap.symbol, snap]));
    return volumeRows.map((row) => {
      const snap = tickerMap.get(row.symbol);
      return {
        symbol: row.symbol,
        baseAsset: snap?.baseAsset || null,
        quoteAsset: snap?.quoteAsset || null,
        lastPrice: snap?.last ?? null,
        changePct: snap?.changePct ?? null,
        volume24h: toNumber(row.usd_volume),
        tradedAmount: toNumber(row.amount),
      };
    });
  }
  const snapshots = await marketService.tickers();
  return snapshots
    .slice()
    .sort((a, b) => Math.abs(b.changePct || 0) - Math.abs(a.changePct || 0))
    .slice(0, limit)
    .map((snap) => ({
      symbol: snap.symbol,
      baseAsset: snap.baseAsset,
      quoteAsset: snap.quoteAsset,
      lastPrice: snap.last,
      changePct: snap.changePct,
      volume24h: 0,
      tradedAmount: 0,
    }));
}

async function buildStakingParticipants(limit = 5) {
  const rows = await db('staking_positions as p')
    .leftJoin('users as u', 'p.user_id', 'u.id')
    .select('p.user_id', 'u.email as user_email', 'p.asset', 'p.amount', 'p.status')
    .whereIn('p.status', ['ACTIVE', 'COMPLETED']);
  if (!rows.length) return [];
  const priceMap = await buildAssetPriceMap(rows.map((row) => row.asset));
  const aggregates = new Map();
  for (const row of rows) {
    const entry =
      aggregates.get(row.user_id) || {
        userId: row.user_id,
        email: row.user_email,
        activePositions: 0,
        completedPositions: 0,
        lockedUsd: 0,
      };
    const asset = String(row.asset || '').toUpperCase();
    const price = priceMap[asset] || 1;
    const amount = toNumber(row.amount);
    const valueUsd = amount * price;
    if (row.status === 'ACTIVE') {
      entry.activePositions += 1;
      entry.lockedUsd += valueUsd;
    } else if (row.status === 'COMPLETED') {
      entry.completedPositions += 1;
    }
    aggregates.set(row.user_id, entry);
  }
  return Array.from(aggregates.values())
    .sort((a, b) => b.lockedUsd - a.lockedUsd)
    .slice(0, limit)
    .map((entry) => ({
      userId: entry.userId,
      email: entry.email,
      activePositions: entry.activePositions,
      completedPositions: entry.completedPositions,
      lockedUsd: Number(entry.lockedUsd.toFixed(2)),
    }));
}

export async function getOverviewSnapshot({ rangeDays } = {}) {
  const normalizedRange = clampRangeDays(rangeDays);
  const sinceRange = new Date(Date.now() - normalizedRange * DAY_MS);
  const since24h = new Date(Date.now() - DAY_MS);

  const [
    totalUsersRow,
    verifiedUsersRow,
    newUsers24hRow,
    activeUsers24hRow,
    kycPendingRow,
    marketCountRow,
    spotVolume24hRow,
    futuresOpenStatsRow,
    cryptoDeposits24hRow,
    cryptoWithdrawals24hRow,
    fiatDeposits24hRow,
    fiatPendingRow,
    baseUsersRow,
    dailyNewRows,
    dailyActiveRows,
    cryptoDepositSeriesRows,
    cryptoWithdrawalSeriesRows,
    fiatDepositSeriesRows,
    pendingWithdrawalRows,
    pendingFiatRows,
    kycQueueRows,
    stakingOverview,
    stakingActiveByAsset,
    spotLeaders,
    stakingParticipants,
  ] = await Promise.all([
    db('users').count({ count: '*' }).first(),
    db('users').where({ kyc_verified: true }).count({ count: '*' }).first(),
    db('users').where('created_at', '>=', since24h).count({ count: '*' }).first(),
    db('user_profiles').where('last_login', '>=', since24h).count({ count: '*' }).first(),
    db('kyc_requests')
      .where((qb) => qb.whereNull('status').orWhereNot('status', 'approved'))
      .count({ count: '*' })
      .first(),
    db('market_symbols').count({ count: '*' }).first(),
    db('spot_trades')
      .where('created_at', '>=', since24h)
      .select(db.raw('SUM(price * size) as notional'))
      .first(),
    db('futures_positions')
      .where({ status: 'OPEN' })
      .sum({ total_size: 'size' })
      .count({ total_positions: '*' })
      .first(),
    db('deposits').where('created_at', '>=', since24h).sum({ total: 'amount' }).first(),
    db('withdrawals')
      .whereIn('status', WITHDRAWAL_DONE_STATUSES)
      .andWhere('created_at', '>=', since24h)
      .sum({ total: 'amount' })
      .first(),
    db('fiat_deposits')
      .where('created_at', '>=', since24h)
      .whereNotIn('status', ['rejected', 'canceled'])
      .sum({ total: 'amount' })
      .first(),
    db('fiat_deposits')
      .whereIn('status', PENDING_FIAT_STATUSES)
      .count({ count: '*' })
      .first(),
    db('users').where('created_at', '<', sinceRange).count({ count: '*' }).first(),
    db('users')
      .where('created_at', '>=', sinceRange)
      .select(db.raw('DATE(created_at) as day'))
      .count({ new: '*' })
      .groupByRaw('DATE(created_at)')
      .orderBy('day', 'asc'),
    db('user_profiles')
      .where('last_login', '>=', sinceRange)
      .select(db.raw('DATE(last_login) as day'))
      .count({ active: '*' })
      .groupByRaw('DATE(last_login)')
      .orderBy('day', 'asc'),
    db('deposits')
      .where('created_at', '>=', sinceRange)
      .select(db.raw('DATE(created_at) as day'))
      .sum({ total_amount: 'amount' })
      .groupByRaw('DATE(created_at)')
      .orderBy('day', 'asc'),
    db('withdrawals')
      .where('created_at', '>=', sinceRange)
      .whereIn('status', WITHDRAWAL_DONE_STATUSES)
      .select(db.raw('DATE(created_at) as day'))
      .sum({ total_amount: 'amount' })
      .groupByRaw('DATE(created_at)')
      .orderBy('day', 'asc'),
    db('fiat_deposits')
      .where('created_at', '>=', sinceRange)
      .whereNotIn('status', ['rejected', 'canceled'])
      .select(db.raw('DATE(created_at) as day'))
      .sum({ total_amount: 'amount' })
      .groupByRaw('DATE(created_at)')
      .orderBy('day', 'asc'),
    db('withdrawals as w')
      .leftJoin('users as u', 'w.user_id', 'u.id')
      .select('w.id', 'w.user_id', 'w.asset', 'w.amount', 'w.created_at', 'u.email as user_email')
      .where('w.status', 'pending')
      .orderBy('w.created_at', 'asc')
      .limit(10),
    db('fiat_deposits as fd')
      .leftJoin('users as u', 'fd.user_id', 'u.id')
      .select(
        'fd.id',
        'fd.user_id',
        'fd.amount',
        'fd.currency',
        'fd.method',
        'fd.created_at',
        'fd.status',
        'u.email as user_email'
      )
      .whereIn('fd.status', PENDING_FIAT_STATUSES)
      .orderBy('fd.created_at', 'asc')
      .limit(10),
    db('kyc_requests as k')
      .leftJoin('users as u', 'k.user_id', 'u.id')
      .select('k.id', 'k.user_id', 'k.status', 'k.created_at', 'u.email as user_email')
      .where((qb) => qb.whereNull('k.status').orWhereNot('k.status', 'approved'))
      .orderBy('k.created_at', 'asc')
      .limit(10),
    getProgramOverview(),
    db('staking_positions')
      .where({ status: 'ACTIVE' })
      .select('asset')
      .sum({ total_amount: 'amount' })
      .groupBy('asset'),
    buildSpotLeaders(since24h),
    buildStakingParticipants(),
  ]);

  const totalUsers = parseCount(totalUsersRow);
  const verifiedUsers = parseCount(verifiedUsersRow);
  const newUsers24h = parseCount(newUsers24hRow);
  const activeUsers24h = parseCount(activeUsers24hRow);
  const kycPending = parseCount(kycPendingRow);
  const markets = parseCount(marketCountRow);
  const baseTotal = parseCount(baseUsersRow);
  const activePriceMap = await buildAssetPriceMap(
    (stakingActiveByAsset || []).map((row) => row.asset)
  );

  const fundingBuckets = initDailyBuckets(normalizedRange, sinceRange);
  applySeries(fundingBuckets, cryptoDepositSeriesRows, 'cryptoIn');
  applySeries(fundingBuckets, cryptoWithdrawalSeriesRows, 'cryptoOut');
  applySeries(fundingBuckets, fiatDepositSeriesRows, 'fiatIn');
  const fundingFlows = Array.from(fundingBuckets.values());

  const usersBuckets = initUserBuckets(normalizedRange, sinceRange);
  applyUserSeries(usersBuckets, dailyNewRows, 'new');
  applyUserSeries(usersBuckets, dailyActiveRows, 'active');
  const sortedUserKeys = Array.from(usersBuckets.keys()).sort();
  let runningTotal = baseTotal;
  const dailyUsers = sortedUserKeys.map((key) => {
    const bucket = usersBuckets.get(key);
    runningTotal += bucket.new || 0;
    return {
      date: key,
      new: bucket.new || 0,
      active: bucket.active || 0,
      total: runningTotal,
    };
  });

  const cryptoDeposits24h = toNumber(cryptoDeposits24hRow?.total);
  const cryptoWithdrawals24h = toNumber(cryptoWithdrawals24hRow?.total);
  const fiatDeposits24h = toNumber(fiatDeposits24hRow?.total);
  const fiatPending = parseCount(fiatPendingRow);
  const spotVolume24h = toNumber(spotVolume24hRow?.notional);
  const futuresOpenInterest = toNumber(futuresOpenStatsRow?.total_size);
  const futuresOpenPositions = parseCount(futuresOpenStatsRow, 'total_positions');

  const stakingSummary = stakingOverview?.summary || {
    totalValueUsd: 0,
    averageApr: 0,
    activeLockups: 0,
    nextRewardCycle: null,
  };
  const stakingLeaderboard = (stakingOverview?.pools || [])
    .map((pkg) => ({
      id: pkg.id,
      label: pkg.label,
      asset: pkg.asset,
      aprPercent: pkg.aprPercent,
      stats: pkg.stats || null,
    }))
    .sort((a, b) => (b.stats?.totalLockedUsd || 0) - (a.stats?.totalLockedUsd || 0))
    .slice(0, 5);

  const activeUsd = (stakingActiveByAsset || []).reduce((acc, row) => {
    const asset = String(row.asset || '').toUpperCase();
    const amount = toNumber(row.total_amount);
    const price = activePriceMap[asset] || 1;
    return acc + amount * price;
  }, 0);

  return {
    syncedAt: new Date().toISOString(),
    filters: {
      rangeDays: normalizedRange,
    },
    summary: {
      users: {
        total: totalUsers,
        verified: verifiedUsers,
        new24h: newUsers24h,
        active24h: activeUsers24h,
        retention24h: totalUsers > 0 ? Number((activeUsers24h / totalUsers).toFixed(3)) : 0,
        kycPending,
      },
      funding: {
        crypto: {
          inflow24h: cryptoDeposits24h,
          outflow24h: cryptoWithdrawals24h,
          net24h: cryptoDeposits24h - cryptoWithdrawals24h,
          pendingWithdrawals: pendingWithdrawalRows.length,
        },
        fiat: {
          inflow24h: fiatDeposits24h,
          pending: fiatPending,
          pendingAmount: pendingFiatRows.reduce((acc, row) => acc + toNumber(row.amount), 0),
        },
      },
      staking: {
        tvlUsd: Number((stakingSummary.totalValueUsd || activeUsd).toFixed(2)),
        averageApr: stakingSummary.averageApr || 0,
        activeLockups: stakingSummary.activeLockups || 0,
        nextRewardCycle: stakingSummary.nextRewardCycle || null,
        leaderboard: stakingLeaderboard,
      },
      markets: {
        listings: markets,
        spotVolume24h,
        futuresOpenInterest,
        futuresOpenPositions,
      },
    },
    charts: {
      dailyUsers,
      fundingFlows,
      stakingRecent: (stakingOverview?.recentPositions || []).map((pos) => ({
        id: pos.id,
        userId: pos.userId,
        asset: pos.asset,
        amount: toNumber(pos.amount),
        aprPercent: pos.aprPercent,
        status: pos.status,
        stakedAt: pos.stakedAt,
      })),
    },
    marketLeaders: {
      spot: spotLeaders,
      staking: {
        packages: stakingLeaderboard,
        participants: stakingParticipants,
      },
    },
    queues: {
      kyc: formatQueue(kycQueueRows, (row) => ({
        id: row.id,
        userId: row.user_id,
        email: row.user_email,
        status: row.status || 'pending',
        submittedAt: normalizeTimestamp(row.created_at),
      })),
      withdrawals: formatQueue(pendingWithdrawalRows, (row) => ({
        id: row.id,
        userId: row.user_id,
        email: row.user_email,
        asset: row.asset,
        amount: toNumber(row.amount),
        submittedAt: normalizeTimestamp(row.created_at),
      })),
      fiatDeposits: formatQueue(pendingFiatRows, (row) => ({
        id: row.id,
        userId: row.user_id,
        email: row.user_email,
        amount: toNumber(row.amount),
        currency: row.currency,
        method: row.method,
        status: row.status,
        submittedAt: normalizeTimestamp(row.created_at),
      })),
    },
  };
}

function hydrateActivityItem(payload) {
  if (!payload?.occurredAt) return null;
  return {
    ...payload,
    occurredAt: normalizeTimestamp(payload.occurredAt),
  };
}

export async function getActivityFeed({ limit } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 5), 100);
  const take = safeLimit * 2;

  const [cryptoDeposits, cryptoWithdrawals, fiatDeposits, stakingEvents, kycEvents] =
    await Promise.all([
      db('deposits as d')
        .leftJoin('users as u', 'd.user_id', 'u.id')
        .select(
          'd.id',
          'd.user_id',
          'd.asset',
          'd.chain',
          'd.amount',
          'd.created_at',
          'u.email as user_email'
        )
        .orderBy('d.created_at', 'desc')
        .limit(take),
      db('withdrawals as w')
        .leftJoin('users as u', 'w.user_id', 'u.id')
        .select(
          'w.id',
          'w.user_id',
          'w.asset',
          'w.amount',
          'w.status',
          'w.created_at',
          'w.updated_at',
          'u.email as user_email'
        )
        .orderBy('w.created_at', 'desc')
        .limit(take),
      db('fiat_deposits as fd')
        .leftJoin('users as u', 'fd.user_id', 'u.id')
        .select(
          'fd.id',
          'fd.user_id',
          'fd.amount',
          'fd.currency',
          'fd.status',
          'fd.method',
          'fd.created_at',
          'u.email as user_email'
        )
        .orderBy('fd.created_at', 'desc')
        .limit(take),
      db('staking_positions as p')
        .leftJoin('users as u', 'p.user_id', 'u.id')
        .leftJoin('staking_packages as pkg', 'p.package_id', 'pkg.id')
        .select(
          'p.id',
          'p.user_id',
          'p.amount',
          'p.asset',
          'p.status',
          'p.created_at',
          'p.unstaked_at',
          'pkg.label as package_label',
          'u.email as user_email'
        )
        .orderBy('p.created_at', 'desc')
        .limit(take),
      db('kyc_requests as k')
        .leftJoin('users as u', 'k.user_id', 'u.id')
        .select('k.id', 'k.user_id', 'k.status', 'k.created_at', 'k.updated_at', 'u.email as user_email')
        .orderBy('k.updated_at', 'desc')
        .limit(take),
    ]);

  const items = [];

  for (const row of cryptoDeposits) {
    items.push(
      hydrateActivityItem({
        type: 'CRYPTO_DEPOSIT',
        id: `deposit_${row.id}`,
        userId: row.user_id,
        email: row.user_email,
        asset: row.asset,
        amount: toNumber(row.amount),
        chain: row.chain,
        occurredAt: row.created_at,
        status: 'completed',
      })
    );
  }
  for (const row of cryptoWithdrawals) {
    items.push(
      hydrateActivityItem({
        type: 'CRYPTO_WITHDRAWAL',
        id: `withdrawal_${row.id}`,
        userId: row.user_id,
        email: row.user_email,
        asset: row.asset,
        amount: toNumber(row.amount),
        status: row.status,
        occurredAt: row.updated_at || row.created_at,
      })
    );
  }
  for (const row of fiatDeposits) {
    items.push(
      hydrateActivityItem({
        type: 'FIAT_DEPOSIT',
        id: `fiat_${row.id}`,
        userId: row.user_id,
        email: row.user_email,
        amount: toNumber(row.amount),
        currency: row.currency,
        method: row.method,
        status: row.status,
        occurredAt: row.created_at,
      })
    );
  }
  for (const row of stakingEvents) {
    items.push(
      hydrateActivityItem({
        type: 'STAKING_EVENT',
        id: `staking_${row.id}`,
        userId: row.user_id,
        email: row.user_email,
        asset: row.asset,
        amount: toNumber(row.amount),
        packageLabel: row.package_label,
        status: row.status,
        occurredAt: row.unstaked_at || row.created_at,
      })
    );
  }
  for (const row of kycEvents) {
    items.push(
      hydrateActivityItem({
        type: 'KYC_EVENT',
        id: `kyc_${row.id}`,
        userId: row.user_id,
        email: row.user_email,
        status: row.status || 'pending',
        occurredAt: row.updated_at || row.created_at,
      })
    );
  }

  const filtered = items
    .filter(Boolean)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const nowTs = Date.now();
  const hydrated = filtered.slice(0, safeLimit).map((item) => {
    const normalizedTs = normalizeTimestamp(item.occurredAt);
    const amount = activityAmount(item);
    const asset = item.asset || item.currency || null;
    return {
      id: item.id,
      type: item.type,
      summary: describeActivity(item),
      description: buildActivityDescription(item),
      subtitle: item.email || 'System',
      amount,
      asset,
      currency: item.currency || null,
      user: item.userId
        ? {
            id: item.userId,
            email: item.email || null,
          }
        : null,
      timeAgo: formatTimeAgo(item.occurredAt, nowTs),
      occurredAt: normalizedTs,
      occurredAtUnix: normalizedTs ? new Date(normalizedTs).getTime() : null,
      metadata: {
        status: item.status || null,
        method: item.method || null,
        chain: item.chain || null,
        packageLabel: item.packageLabel || null,
      },
    };
  });

  return {
    syncedAt: new Date().toISOString(),
    items: hydrated,
  };
}
