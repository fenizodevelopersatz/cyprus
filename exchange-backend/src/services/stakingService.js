import { parseUnits, formatUnits } from 'ethers';
import { db, withTx } from '../db.js';
import { journal, getAccountBalance } from './ledgerService.js';
import { audit } from './auditService.js';
import { allowedSpotSymbols } from '../utils/symbols.js';
import * as marketService from './marketService.js';

const SPOT_NAMESPACE = 'spot:available';
const LOCK_NAMESPACE = 'staking:locked';
const REWARD_POOL_NAMESPACE = 'staking:rewards_pool';
const MS_PER_DAY = 86_400_000;
const DEFAULT_REWARD_INTERVAL_HOURS = 12;
const DEFAULT_EARNINGS_RANGE_DAYS = 30;
const MAX_EARNINGS_RANGE_DAYS = 90;
const MAX_ADMIN_EARNINGS_RANGE_DAYS = 180;

const USD_DECIMALS = 4;

function toNumberSafe(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatUsdValue(value) {
  const numeric = toNumberSafe(value);
  return Number(Number.isFinite(numeric) ? numeric.toFixed(USD_DECIMALS) : 0);
}

function assetKey(asset) {
  return String(asset || '').trim().toUpperCase() || 'UNKNOWN';
}

function normalizeRangeDays(
  value,
  { fallback = DEFAULT_EARNINGS_RANGE_DAYS, max = MAX_EARNINGS_RANGE_DAYS } = {}
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  const normalized = Math.floor(parsed);
  return Math.max(1, Math.min(normalized, max));
}

function usdFromAmount(amount, asset, priceMap) {
  const price = priceMap[assetKey(asset)] ?? 1;
  return formatUsdValue(toNumberSafe(amount) * price);
}

function buildEarningsSummary(positions, priceMap, { includeParticipants = false } = {}) {
  let totalLockedUsd = 0;
  let realizedRewardsUsd = 0;
  let pendingRewardsUsd = 0;
  let dailyRewardsUsd = 0;
  let weightedApr = 0;
  let activePrincipalUsd = 0;
  let activePositions = 0;
  let completedPositions = 0;
  const participants = new Set();

  for (const position of positions) {
    const asset = assetKey(position.asset);
    const price = priceMap[asset] ?? 1;
    const amount = toNumberSafe(position.amount);
    const valueUsd = amount * price;
    const aprPercent = toNumberSafe(position.aprPercent);
    const estimatedRewards = toNumberSafe(position.estimatedRewards);
    const rewardsPaid = toNumberSafe(position.rewardsPaid);
    const dailyReward = toNumberSafe(position.dailyReward);

    if (position.status === 'ACTIVE') {
      activePositions += 1;
      activePrincipalUsd += valueUsd;
      totalLockedUsd += valueUsd;
      pendingRewardsUsd += estimatedRewards * price;
      dailyRewardsUsd += dailyReward * price;
      weightedApr += valueUsd * aprPercent;
    } else if (position.status === 'COMPLETED') {
      completedPositions += 1;
      realizedRewardsUsd += rewardsPaid * price;
    }

    if (includeParticipants && position.userId) {
      participants.add(position.userId);
    }
  }

  const summary = {
    totalLockedUsd: formatUsdValue(totalLockedUsd),
    realizedRewardsUsd: formatUsdValue(realizedRewardsUsd),
    pendingRewardsUsd: formatUsdValue(pendingRewardsUsd),
    dailyRewardsUsd: formatUsdValue(dailyRewardsUsd),
    projected30dUsd: formatUsdValue(dailyRewardsUsd * 30),
    activePositions,
    completedPositions,
    averageApr:
      activePrincipalUsd > 0 ? formatUsdValue(weightedApr / activePrincipalUsd) : 0,
    nextRewardCycle: nextRewardCycle(),
  };

  if (includeParticipants) {
    summary.participants = participants.size;
  }

  summary.totalPositions = positions.length;
  return summary;
}

function buildAssetBreakdown(positions, priceMap) {
  const buckets = new Map();

  for (const position of positions) {
    const asset = assetKey(position.asset);
    if (!buckets.has(asset)) {
      buckets.set(asset, {
        asset,
        principal: 0,
        principalUsd: 0,
        activePositions: 0,
        completedPositions: 0,
        pendingRewards: 0,
        pendingRewardsUsd: 0,
        realizedRewards: 0,
        realizedRewardsUsd: 0,
        dailyRewardsUsd: 0,
        weightedApr: 0,
      });
    }

    const bucket = buckets.get(asset);
    const price = priceMap[asset] ?? 1;
    const amount = toNumberSafe(position.amount);
    const valueUsd = amount * price;

    if (position.status === 'ACTIVE') {
      bucket.activePositions += 1;
      bucket.principal += amount;
      bucket.principalUsd += valueUsd;
      bucket.pendingRewards += toNumberSafe(position.estimatedRewards);
      bucket.pendingRewardsUsd += toNumberSafe(position.estimatedRewards) * price;
      bucket.dailyRewardsUsd += toNumberSafe(position.dailyReward) * price;
      bucket.weightedApr += valueUsd * toNumberSafe(position.aprPercent);
    } else if (position.status === 'COMPLETED') {
      bucket.completedPositions += 1;
      bucket.realizedRewards += toNumberSafe(position.rewardsPaid);
      bucket.realizedRewardsUsd += toNumberSafe(position.rewardsPaid) * price;
    }
  }

  return Array.from(buckets.values()).map((bucket) => ({
    asset: bucket.asset,
    principal: cleanDecimal(bucket.principal),
    principalUsd: formatUsdValue(bucket.principalUsd),
    averageApr:
      bucket.principalUsd > 0
        ? formatUsdValue(bucket.weightedApr / bucket.principalUsd)
        : 0,
    activePositions: bucket.activePositions,
    completedPositions: bucket.completedPositions,
    pendingRewards: cleanDecimal(bucket.pendingRewards),
    pendingRewardsUsd: formatUsdValue(bucket.pendingRewardsUsd),
    realizedRewards: cleanDecimal(bucket.realizedRewards),
    realizedRewardsUsd: formatUsdValue(bucket.realizedRewardsUsd),
    dailyRewardsUsd: formatUsdValue(bucket.dailyRewardsUsd),
  }));
}

function buildRealizedHistory(
  positions,
  priceMap,
  rangeDays,
  { fallback = DEFAULT_EARNINGS_RANGE_DAYS, maxRange = MAX_EARNINGS_RANGE_DAYS } = {}
) {
  const normalizedRange = normalizeRangeDays(rangeDays, {
    fallback,
    max: maxRange,
  });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setTime(start.getTime() - (normalizedRange - 1) * MS_PER_DAY);

  const points = [];
  const indexByDate = new Map();
  for (let i = 0; i < normalizedRange; i += 1) {
    const day = new Date(start.getTime() + i * MS_PER_DAY);
    const key = day.toISOString().slice(0, 10);
    points.push({ date: key, realizedRewardsUsd: 0 });
    indexByDate.set(key, i);
  }

  for (const position of positions) {
    if (position.status !== 'COMPLETED' || !position.unstakedAt) continue;
    const completedAt = new Date(position.unstakedAt);
    if (completedAt < start) continue;
    const key = completedAt.toISOString().slice(0, 10);
    if (!indexByDate.has(key)) continue;
    const asset = assetKey(position.asset);
    const rewardUsd = usdFromAmount(position.rewardsPaid, asset, priceMap);
    const idx = indexByDate.get(key);
    points[idx].realizedRewardsUsd = formatUsdValue(
      points[idx].realizedRewardsUsd + rewardUsd
    );
  }

  return {
    rangeDays: normalizedRange,
    points,
  };
}

function buildRecentPayouts(positions, priceMap, limit = 10) {
  const payouts = positions
    .filter(
      (pos) =>
        pos.status === 'COMPLETED' &&
        pos.unstakedAt &&
        toNumberSafe(pos.rewardsPaid) > 0
    )
    .sort((a, b) => new Date(b.unstakedAt) - new Date(a.unstakedAt))
    .slice(0, limit)
    .map((pos) => ({
      positionId: pos.id,
      asset: pos.asset,
      rewardsPaid: pos.rewardsPaid,
      rewardsPaidUsd: usdFromAmount(pos.rewardsPaid, pos.asset, priceMap),
      aprPercent: pos.aprPercent,
      stakedAt: pos.stakedAt,
      unstakedAt: pos.unstakedAt,
      user: pos.user
        ? { id: pos.user.id, email: pos.user.email, fullName: pos.user.fullName || null }
        : undefined,
      package: pos.package ? { id: pos.package.id, label: pos.package.label } : undefined,
    }));
  return payouts;
}

function buildTopUsers(positions, priceMap, limit = 5) {
  const aggregates = new Map();
  for (const pos of positions) {
    const userId = pos.user?.id ?? pos.userId;
    if (!userId) continue;
    if (!aggregates.has(userId)) {
      aggregates.set(userId, {
        userId,
        email: pos.user?.email || null,
        fullName: pos.user?.fullName || null,
        positions: 0,
        totalLockedUsd: 0,
        realizedRewardsUsd: 0,
        pendingRewardsUsd: 0,
      });
    }
    const entry = aggregates.get(userId);
    entry.positions += 1;
    const asset = assetKey(pos.asset);
    if (pos.status === 'ACTIVE') {
      entry.totalLockedUsd += usdFromAmount(pos.amount, asset, priceMap);
      entry.pendingRewardsUsd += usdFromAmount(pos.estimatedRewards, asset, priceMap);
    } else if (pos.status === 'COMPLETED') {
      entry.realizedRewardsUsd += usdFromAmount(pos.rewardsPaid, asset, priceMap);
    }
  }

  return Array.from(aggregates.values())
    .sort(
      (a, b) =>
        b.realizedRewardsUsd +
        b.pendingRewardsUsd -
        (a.realizedRewardsUsd + a.pendingRewardsUsd)
    )
    .slice(0, limit)
    .map((entry) => ({
      userId: entry.userId,
      email: entry.email,
      fullName: entry.fullName,
      positions: entry.positions,
      totalLockedUsd: formatUsdValue(entry.totalLockedUsd),
      realizedRewardsUsd: formatUsdValue(entry.realizedRewardsUsd),
      pendingRewardsUsd: formatUsdValue(entry.pendingRewardsUsd),
    }));
}

function toAmountBig(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid amount');
    return parseUnits(value.toString(), 18);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) throw new Error('Invalid amount');
    return parseUnits(trimmed, 18);
  }
  throw new Error('Invalid amount');
}

function fromDecimalToBig(value) {
  if (value === null || value === undefined) return 0n;
  return parseUnits(String(value), 18);
}

function toAmountString(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value.toString();
  if (typeof value === 'bigint') return formatUnits(value, 18);
  return '0';
}

function cleanDecimal(value) {
  if (value === null || value === undefined) return '0';
  const str = String(value);
  if (!str.includes('.')) return str;
  return str.replace(/\.?0+$/, '') || '0';
}

function normalizeApr(value) {
  if (value === null || value === undefined) return '0.0000';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new Error('APR_INVALID');
  return numeric.toFixed(4);
}

function normalizeStatus(value, { fallback = 'ACTIVE' } = {}) {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return fallback;
  return normalized;
}

function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'object') return meta;
  try {
    return JSON.parse(meta);
  } catch (err) {
    return {};
  }
}

function encodeMeta(meta) {
  if (meta === null || meta === undefined) return null;
  if (typeof meta === 'string') return meta;
  return JSON.stringify(meta);
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

function formatDecimal(value, decimals = 8) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric === 0) return '0';
  return numeric.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

function computePositionRewards(row, now = new Date()) {
  const amount = Number(row.amount || 0);
  const aprPercent = Number(row.apr_percent || 0);
  if (amount <= 0 || aprPercent <= 0) {
    return {
      estimatedReward: 0,
      estimatedRewardString: '0',
      dailyReward: 0,
      dailyRewardString: '0',
      progressPercent: row.lock_days ? 0 : 100,
    };
  }

  const start = row.staked_at ? new Date(row.staked_at) : now;
  const unlock = row.unlock_at ? new Date(row.unlock_at) : null;
  const totalDuration = unlock ? unlock.getTime() - start.getTime() : null;
  const elapsedMs = Math.max(0, now.getTime() - start.getTime());
  const cappedElapsed =
    totalDuration && totalDuration > 0 ? Math.min(elapsedMs, totalDuration) : elapsedMs;

  const yearlyReward = amount * (aprPercent / 100);
  const reward = yearlyReward * (cappedElapsed / (365 * MS_PER_DAY));
  const dailyReward = yearlyReward / 365;
  const progress =
    totalDuration && totalDuration > 0
      ? Math.min(100, Math.max(0, (cappedElapsed / totalDuration) * 100))
      : 100;

  return {
    estimatedReward: reward,
    estimatedRewardString: formatDecimal(reward),
    dailyReward,
    dailyRewardString: formatDecimal(dailyReward),
    progressPercent: Number(progress.toFixed(2)),
  };
}

function calculateRewardDelta(row, now = new Date()) {
  const rewardStats = computePositionRewards(row, now);
  const totalEarnedBig =
    rewardStats.estimatedReward > 0
      ? toAmountBig(rewardStats.estimatedRewardString || rewardStats.estimatedReward)
      : 0n;
  const alreadyPaidBig = fromDecimalToBig(row.rewards_paid || '0');
  const dueBig = totalEarnedBig > alreadyPaidBig ? totalEarnedBig - alreadyPaidBig : 0n;
  return {
    rewardStats,
    totalEarnedBig,
    alreadyPaidBig,
    dueBig,
    accruedString: formatUnits(totalEarnedBig, 18),
  };
}

function hydratePackage(row, stats = null) {
  if (!row) return null;
  const payload = {
    id: row.id,
    label: row.label,
    asset: row.asset,
    aprPercent: Number(row.apr_percent || 0),
    lockDays: row.lock_days || 0,
    minAmount: cleanDecimal(row.min_amount || '0'),
    maxAmount: row.max_amount != null ? cleanDecimal(row.max_amount) : null,
    isFeatured: !!row.is_featured,
    status: row.status,
    sortOrder: row.sort_order || 0,
    description: row.description || null,
    meta: parseMeta(row.meta),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (stats) {
    payload.stats = {
      activePositions: stats.activePositions || 0,
      totalLocked: cleanDecimal(stats.totalLocked || '0'),
      totalLockedUsd: Number(stats.totalLockedUsd || 0),
    };
  }
  return payload;
}

function hydratePosition(row, now = new Date()) {
  if (!row) return null;
  const rewardStats = computePositionRewards(row, now);
  const unlockAt = row.unlock_at ? new Date(row.unlock_at) : null;
  const matured = unlockAt ? now >= unlockAt : true;
  return {
    id: row.id,
    userId: row.user_id,
    packageId: row.package_id,
    asset: row.asset,
    amount: cleanDecimal(row.amount || '0'),
    aprPercent: Number(row.apr_percent || 0),
    lockDays: row.lock_days || 0,
    autoCompound: !!row.auto_compound,
    status: row.status,
    stakedAt: row.staked_at,
    unlockAt,
    matured,
    canUnstake: row.status === 'ACTIVE' && (matured || !unlockAt),
    rewardsAccrued: cleanDecimal(row.rewards_accrued || '0'),
    rewardsPaid: cleanDecimal(row.rewards_paid || '0'),
    estimatedRewards: rewardStats.estimatedRewardString,
    dailyReward: rewardStats.dailyRewardString,
    progressPercent: rewardStats.progressPercent,
    metadata: parseMeta(row.meta),
    updatedAt: row.updated_at,
    unstakedAt: row.unstaked_at || null,
  };
}

function nextRewardCycle(intervalHours = DEFAULT_REWARD_INTERVAL_HOURS) {
  const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;
  const now = Date.now();
  const nextTick = Math.ceil(now / intervalMs) * intervalMs;
  const remaining = Math.max(0, nextTick - now);
  return {
    nextAt: new Date(nextTick).toISOString(),
    secondsUntil: Math.floor(remaining / 1000),
    intervalHours,
  };
}

async function assetPriceMap(assets = []) {
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

  const snapshots = await marketService.tickers({
    symbols: markets.map((market) => market.symbol),
  });
  const latestBySymbol = new Map();
  for (const snap of snapshots) {
    if (snap?.symbol && Number.isFinite(snap.last)) {
      latestBySymbol.set(snap.symbol, snap.last);
    }
  }

  for (const market of markets) {
    const last =
      latestBySymbol.get(market.symbol) ??
      (Number.isFinite(Number(market.last_price)) ? Number(market.last_price) : null);
    if (Number.isFinite(last) && last > 0) {
      map[market.base_asset] = last;
    }
  }

  return map;
}

function aggregateUsdMetrics(rows, priceMap) {
  let totalUsd = 0;
  let weightedApr = 0;
  for (const row of rows) {
    const amount = Number(row.amount || 0);
    if (!amount) continue;
    const price = priceMap[row.asset?.toUpperCase()] || 1;
    const valueUsd = amount * price;
    totalUsd += valueUsd;
    weightedApr += valueUsd * Number(row.apr_percent || 0);
  }
  return {
    totalValueUsd: Number(totalUsd.toFixed(2)),
    averageApr: totalUsd > 0 ? Number((weightedApr / totalUsd).toFixed(2)) : 0,
    activeLockups: rows.length,
  };
}

export async function listPackages({
  includeInactive = false,
  status = null,
  withStats = false,
} = {}) {
  const query = db('staking_packages')
    .orderBy('sort_order', 'desc')
    .orderBy('apr_percent', 'desc')
    .orderBy('id', 'asc');
  const normalizedStatus = status ? normalizeStatus(status, { fallback: status }) : null;
  if (normalizedStatus) {
    query.where({ status: normalizedStatus });
  } else if (!includeInactive) {
    query.where({ status: 'ACTIVE' });
  }

  const rows = await query;
  if (!rows.length) return [];
  if (!withStats) {
    return rows.map((row) => hydratePackage(row));
  }

  const statsMap = rows.reduce((acc, row) => {
    acc[row.id] = { activePositions: 0, totalLocked: '0', totalLockedUsd: 0 };
    return acc;
  }, {});

  const statsRows = await db('staking_positions')
    .select('package_id')
    .count({ positions: 'id' })
    .sum({ totalLocked: 'amount' })
    .where('status', 'ACTIVE')
    .whereIn(
      'package_id',
      rows.map((row) => row.id)
    )
    .groupBy('package_id');

  for (const stat of statsRows) {
    if (!statsMap[stat.package_id]) {
      statsMap[stat.package_id] = { activePositions: 0, totalLocked: '0', totalLockedUsd: 0 };
    }
    statsMap[stat.package_id].activePositions = Number(stat.positions || stat.count || 0);
    statsMap[stat.package_id].totalLocked = stat.totalLocked || '0';
  }

  const priceMap = await assetPriceMap(rows.map((row) => row.asset));
  for (const pkg of rows) {
    const stats = statsMap[pkg.id];
    if (!stats) continue;
    const rawAmount = Number(stats.totalLocked || 0);
    const price = priceMap[pkg.asset?.toUpperCase()] || 1;
    stats.totalLockedUsd = Number((rawAmount * price).toFixed(2));
  }

  return rows.map((row) => hydratePackage(row, statsMap[row.id]));
}

export async function getPackageById(id) {
  if (!id) return null;
  const row = await db('staking_packages').where({ id }).first();
  return hydratePackage(row);
}

export async function createPackage(input, { actorId } = {}) {
  const now = new Date();
  const payload = {
    label: String(input.label || '').trim(),
    asset: String(input.asset || '').trim().toUpperCase(),
    apr_percent: normalizeApr(input.aprPercent || input.apr_percent || 0),
    lock_days: Math.max(0, Number.isFinite(Number(input.lockDays)) ? Number(input.lockDays) : 0),
    min_amount: cleanDecimal(toAmountString(toAmountBig(input.minAmount ?? input.min_amount ?? 0))),
    max_amount:
      input.maxAmount !== undefined || input.max_amount !== undefined
        ? cleanDecimal(
            toAmountString(
              toAmountBig(
                input.maxAmount !== undefined ? input.maxAmount : input.max_amount ?? 0
              )
            )
          )
        : null,
    is_featured: Boolean(input.isFeatured ?? input.is_featured ?? false),
    status: normalizeStatus(input.status || 'ACTIVE'),
    sort_order: Number.isFinite(Number(input.sortOrder ?? input.sort_order))
      ? Number(input.sortOrder ?? input.sort_order)
      : 0,
    description: input.description || null,
    meta: encodeMeta(input.meta),
    created_at: now,
    updated_at: now,
  };

  if (!payload.label) {
    const err = new Error('LABEL_REQUIRED');
    err.status = 400;
    throw err;
  }
  if (!payload.asset) {
    const err = new Error('ASSET_REQUIRED');
    err.status = 400;
    throw err;
  }

  const inserted = await db('staking_packages').insert(payload);
  const id = resolveInsertId(inserted);

  if (actorId) {
    await audit(actorId, 'staking.package.create', { packageId: id, label: payload.label });
  }

  return getPackageById(id);
}

export async function updatePackage(id, patch = {}, { actorId } = {}) {
  if (!id) throw new Error('PACKAGE_ID_REQUIRED');
  const existing = await db('staking_packages').where({ id }).first();
  if (!existing) {
    const err = new Error('PACKAGE_NOT_FOUND');
    err.status = 404;
    throw err;
  }

  const update = {};
  if (patch.label !== undefined) update.label = String(patch.label || '').trim();
  if (patch.asset !== undefined) update.asset = String(patch.asset || '').trim().toUpperCase();
  if (patch.aprPercent !== undefined || patch.apr_percent !== undefined) {
    update.apr_percent = normalizeApr(patch.aprPercent ?? patch.apr_percent);
  }
  if (patch.lockDays !== undefined || patch.lock_days !== undefined) {
    update.lock_days = Math.max(
      0,
      Number.isFinite(Number(patch.lockDays ?? patch.lock_days))
        ? Number(patch.lockDays ?? patch.lock_days)
        : 0
    );
  }
  if (patch.minAmount !== undefined || patch.min_amount !== undefined) {
    update.min_amount = cleanDecimal(
      toAmountString(toAmountBig(patch.minAmount ?? patch.min_amount ?? 0))
    );
  }
  if (patch.maxAmount !== undefined || patch.max_amount !== undefined) {
    const raw = patch.maxAmount ?? patch.max_amount;
    update.max_amount =
      raw === null
        ? null
        : cleanDecimal(toAmountString(toAmountBig(raw ?? existing.max_amount ?? 0)));
  }
  if (patch.isFeatured !== undefined || patch.is_featured !== undefined) {
    update.is_featured = Boolean(patch.isFeatured ?? patch.is_featured);
  }
  if (patch.status !== undefined) {
    update.status = normalizeStatus(patch.status, { fallback: existing.status });
  }
  if (patch.sortOrder !== undefined || patch.sort_order !== undefined) {
    update.sort_order = Number.isFinite(Number(patch.sortOrder ?? patch.sort_order))
      ? Number(patch.sortOrder ?? patch.sort_order)
      : existing.sort_order;
  }
  if (patch.description !== undefined) {
    update.description = patch.description || null;
  }
  if (patch.meta !== undefined) {
    update.meta = encodeMeta(patch.meta);
  }
  if (!Object.keys(update).length) {
    return hydratePackage(existing);
  }
  update.updated_at = new Date();

  await db('staking_packages').where({ id }).update(update);
  if (actorId) {
    await audit(actorId, 'staking.package.update', { packageId: id, patch: update });
  }
  return getPackageById(id);
}

export async function listUserPositions(userId, { status } = {}) {
  if (!userId) throw new Error('USER_REQUIRED');
  const query = db('staking_positions').where({ user_id: userId }).orderBy('created_at', 'desc');
  if (status) {
    query.where({ status: normalizeStatus(status, { fallback: status }) });
  }
  const rows = await query;
  const now = new Date();
  return rows.map((row) => hydratePosition(row, now));
}

export async function stakePosition({ userId, packageId, amount, autoCompound = false }) {
  if (!userId) throw new Error('USER_REQUIRED');
  if (!packageId) throw new Error('PACKAGE_REQUIRED');
  const pkg = await db('staking_packages').where({ id: packageId }).first();
  if (!pkg) {
    const err = new Error('PACKAGE_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  if (pkg.status !== 'ACTIVE') {
    const err = new Error('PACKAGE_NOT_ACTIVE');
    err.status = 400;
    throw err;
  }
  const amountBig = toAmountBig(amount);
  if (amountBig <= 0n) {
    const err = new Error('AMOUNT_REQUIRED');
    err.status = 400;
    throw err;
  }

  const minBig = fromDecimalToBig(pkg.min_amount || '0');
  if (amountBig < minBig) {
    const err = new Error('AMOUNT_BELOW_MINIMUM');
    err.status = 400;
    throw err;
  }
  const maxBig = pkg.max_amount ? fromDecimalToBig(pkg.max_amount) : null;
  if (maxBig && amountBig > maxBig) {
    const err = new Error('AMOUNT_ABOVE_MAXIMUM');
    err.status = 400;
    throw err;
  }

  const now = new Date();
  const unlockAt =
    pkg.lock_days && pkg.lock_days > 0 ? new Date(now.getTime() + pkg.lock_days * MS_PER_DAY) : null;
  let positionId;

  await withTx(async (trx) => {
    const balance = await getAccountBalance(
      { userId, namespace: SPOT_NAMESPACE, asset: pkg.asset },
      trx
    );
    if (balance < amountBig) {
      const err = new Error('INSUFFICIENT_FUNDS');
      err.status = 400;
      throw err;
    }

    await journal(
      trx,
      [
        {
          account: { userId, namespace: SPOT_NAMESPACE, asset: pkg.asset },
          amount: -amountBig,
          meta: { reason: 'staking_lock', packageId: pkg.id },
        },
        {
          account: { userId, namespace: LOCK_NAMESPACE, asset: pkg.asset },
          amount: amountBig,
          meta: { reason: 'staking_lock', packageId: pkg.id },
        },
      ],
      {
        description: `Stake ${pkg.asset}`,
        meta: { userId, packageId: pkg.id, amount: formatUnits(amountBig, 18) },
      }
    );

    const insertPayload = {
      user_id: userId,
      package_id: pkg.id,
      asset: pkg.asset,
      amount: formatUnits(amountBig, 18),
      apr_percent: pkg.apr_percent,
      lock_days: pkg.lock_days,
      auto_compound: Boolean(autoCompound),
      status: 'ACTIVE',
      rewards_accrued: '0',
      rewards_paid: '0',
      staked_at: now,
      unlock_at: unlockAt,
      created_at: now,
      updated_at: now,
    };

    const inserted = await trx('staking_positions').insert(insertPayload);
    positionId = resolveInsertId(inserted);
  });

  const row = await db('staking_positions').where({ id: positionId }).first();
  return hydratePosition(row);
}

export async function unstakePosition({ userId, positionId }) {
  if (!userId) throw new Error('USER_REQUIRED');
  const position = await db('staking_positions').where({ id: positionId }).first();
  if (!position) {
    const err = new Error('POSITION_NOT_FOUND');
    err.status = 404;
    throw err;
  }
  if (position.user_id !== userId) {
    const err = new Error('POSITION_FORBIDDEN');
    err.status = 403;
    throw err;
  }
  if (position.status !== 'ACTIVE') {
    const err = new Error('POSITION_NOT_ACTIVE');
    err.status = 400;
    throw err;
  }
  if (position.unlock_at) {
    const nowDate = new Date();
    if (nowDate < new Date(position.unlock_at)) {
      const err = new Error('POSITION_LOCKED');
      err.status = 400;
      throw err;
    }
  }

  const now = new Date();
  const { rewardStats, totalEarnedBig, alreadyPaidBig, dueBig, accruedString } =
    calculateRewardDelta(position, now);
  const rewardBig = dueBig;
  const principalBig = toAmountBig(position.amount);

  await withTx(async (trx) => {
    await journal(
      trx,
      [
        {
          account: { userId, namespace: LOCK_NAMESPACE, asset: position.asset },
          amount: -principalBig,
          meta: { reason: 'staking_unlock', positionId },
        },
        {
          account: { userId, namespace: SPOT_NAMESPACE, asset: position.asset },
          amount: principalBig,
          meta: { reason: 'staking_unlock', positionId },
        },
      ],
      {
        description: `Unstake ${position.asset}`,
        meta: { userId, positionId },
      }
    );

    if (rewardBig > 0n) {
      await journal(
        trx,
        [
          {
            account: { userId: null, namespace: REWARD_POOL_NAMESPACE, asset: position.asset },
            amount: -rewardBig,
            meta: { reason: 'staking_reward', positionId },
          },
          {
            account: { userId, namespace: SPOT_NAMESPACE, asset: position.asset },
            amount: rewardBig,
            meta: { reason: 'staking_reward', positionId },
          },
        ],
        {
          description: `Staking rewards ${position.asset}`,
          meta: { userId, positionId },
        }
      );
    }

    await trx('staking_positions')
      .where({ id: position.id })
      .update({
        status: 'COMPLETED',
        rewards_accrued: accruedString,
        rewards_paid: formatUnits(alreadyPaidBig + rewardBig, 18),
        unstaked_at: now,
        updated_at: now,
      });
  });

  const row = await db('staking_positions').where({ id: position.id }).first();
  return hydratePosition(row);
}

export async function payoutPositionRewards({ positionId, actorId, now = new Date() } = {}) {
  if (!positionId) throw new Error('POSITION_ID_REQUIRED');
  const result = await withTx(async (trx) => {
    const row = await trx('staking_positions').where({ id: positionId }).forUpdate().first();
    if (!row) {
      const err = new Error('POSITION_NOT_FOUND');
      err.status = 404;
      throw err;
    }
    if (row.status !== 'ACTIVE') {
      const err = new Error('POSITION_NOT_ACTIVE');
      err.status = 400;
      throw err;
    }

    const rewardState = calculateRewardDelta(row, now);
    if (rewardState.dueBig <= 0n) {
      await trx('staking_positions')
        .where({ id: row.id })
        .update({
          rewards_accrued: rewardState.accruedString,
          updated_at: now,
        });
      const fresh = await trx('staking_positions').where({ id: row.id }).first();
      return { row: fresh, payoutBig: 0n };
    }

    await journal(
      trx,
      [
        {
          account: { userId: null, namespace: REWARD_POOL_NAMESPACE, asset: row.asset },
          amount: -rewardState.dueBig,
          meta: { reason: 'staking_reward_payout', positionId: row.id },
        },
        {
          account: { userId: row.user_id, namespace: SPOT_NAMESPACE, asset: row.asset },
          amount: rewardState.dueBig,
          meta: { reason: 'staking_reward_payout', positionId: row.id },
        },
      ],
      {
        description: `Staking reward payout ${row.asset}`,
        meta: { userId: row.user_id, positionId: row.id, actorId: actorId || null },
      }
    );

    const newPaidBig = rewardState.alreadyPaidBig + rewardState.dueBig;
    await trx('staking_positions')
      .where({ id: row.id })
      .update({
        rewards_paid: formatUnits(newPaidBig, 18),
        rewards_accrued: rewardState.accruedString,
        updated_at: now,
      });

    const fresh = await trx('staking_positions').where({ id: row.id }).first();
    return { row: fresh, payoutBig: rewardState.dueBig };
  });

  const position = hydratePosition(result.row, now);
  return {
    position,
    payout: {
      amount: formatUnits(result.payoutBig, 18),
      asset: position.asset,
      executed: result.payoutBig > 0n,
    },
  };
}

export async function processRewardPayouts({ limit = 50, actorId } = {}) {
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 500));
  const now = new Date();
  const candidates = await db('staking_positions')
    .select('id')
    .where({ status: 'ACTIVE' })
    .orderBy('updated_at', 'asc')
    .limit(normalizedLimit);

  const payouts = [];
  for (const candidate of candidates) {
    const result = await payoutPositionRewards({ positionId: candidate.id, actorId, now });
    if (result.payout.executed) {
      payouts.push({
        positionId: result.position.id,
        userId: result.position.userId,
        asset: result.position.asset,
        amount: result.payout.amount,
      });
    }
  }

  return {
    checked: candidates.length,
    payouts,
  };
}

export async function getUserOverview(userId) {
  if (!userId) throw new Error('USER_REQUIRED');
  const [positions, pools] = await Promise.all([
    listUserPositions(userId, {}),
    listPackages({ includeInactive: false, withStats: true }),
  ]);
  const activePositions = positions.filter((pos) => pos.status === 'ACTIVE');
  const assets = Array.from(new Set(activePositions.map((pos) => pos.asset)));
  const priceMap = await assetPriceMap(assets);
  const metrics = aggregateUsdMetrics(
    activePositions.map((pos) => ({
      amount: pos.amount,
      asset: pos.asset,
      apr_percent: pos.aprPercent,
    })),
    priceMap
  );
  const activity = positions.slice(0, 10).map((pos) => ({
    id: pos.id,
    asset: pos.asset,
    amount: pos.amount,
    status: pos.status,
    action: pos.status === 'COMPLETED' ? 'unstake' : 'stake',
    rewards: pos.estimatedRewards,
    timestamp: pos.updatedAt || pos.stakedAt,
  }));

  return {
    summary: {
      totalValueUsd: metrics.totalValueUsd,
      averageApr: metrics.averageApr,
      activeLockups: metrics.activeLockups,
      nextRewardCycle: nextRewardCycle(),
    },
    pools,
    positions,
    activity,
  };
}

export async function adminListPositions({ status, userId, packageId } = {}) {
  const query = db('staking_positions as p')
    .select(
      'p.*',
      'u.email as user_email',
      'pkg.label as package_label',
      'pkg.asset as package_asset'
    )
    .leftJoin('users as u', 'p.user_id', 'u.id')
    .leftJoin('staking_packages as pkg', 'p.package_id', 'pkg.id')
    .orderBy('p.created_at', 'desc');

  if (status) {
    query.where('p.status', normalizeStatus(status, { fallback: status }));
  }
  if (userId) {
    query.where('p.user_id', Number(userId));
  }
  if (packageId) {
    query.where('p.package_id', Number(packageId));
  }

  const rows = await query;
  const now = new Date();
  return rows.map((row) => {
    const position = hydratePosition(row, now);
    return {
      ...position,
      user: { id: row.user_id, email: row.user_email },
      package: { id: row.package_id, label: row.package_label, asset: row.package_asset },
    };
  });
}

export async function getProgramOverview() {
  const [pools, activeRows, recentRows] = await Promise.all([
    listPackages({ includeInactive: true, withStats: true }),
    db('staking_positions').where({ status: 'ACTIVE' }),
    db('staking_positions').orderBy('created_at', 'desc').limit(15),
  ]);
  const priceMap = await assetPriceMap(activeRows.map((row) => row.asset));
  const metrics = aggregateUsdMetrics(activeRows, priceMap);
  const recent = recentRows.map((row) => hydratePosition(row));

  return {
    summary: {
      totalValueUsd: metrics.totalValueUsd,
      averageApr: metrics.averageApr,
      activeLockups: metrics.activeLockups,
      nextRewardCycle: nextRewardCycle(),
    },
    pools,
    recentPositions: recent,
  };
}

export async function getUserEarningsReport(userId, { rangeDays } = {}) {
  if (!userId) throw new Error('USER_REQUIRED');
  const positions = await listUserPositions(userId, {});
  const priceMap = await assetPriceMap(positions.map((pos) => pos.asset));
  const summary = buildEarningsSummary(positions, priceMap);
  const breakdown = buildAssetBreakdown(positions, priceMap);
  const realizedHistory = buildRealizedHistory(positions, priceMap, rangeDays);
  const recentPayouts = buildRecentPayouts(positions, priceMap, 10);

  return {
    summary,
    breakdown,
    realizedHistory,
    recentPayouts,
    priceMap,
  };
}

export async function getNetworkEarningsReport({
  rangeDays,
  asset,
  userId,
  status,
} = {}) {
  const normalizedAsset = String(asset || '').trim().toUpperCase();
  const query = db('staking_positions as p')
    .select(
      'p.*',
      'u.email as user_email',
      'up.display_name as user_full_name',
      'pkg.label as package_label'
    )
    .leftJoin('users as u', 'p.user_id', 'u.id')
    .leftJoin('user_profiles as up', 'u.id', 'up.user_id')
    .leftJoin('staking_packages as pkg', 'p.package_id', 'pkg.id')
    .orderBy('p.created_at', 'desc');

  if (normalizedAsset) {
    query.where('p.asset', normalizedAsset);
  }
  if (userId) {
    query.where('p.user_id', Number(userId));
  }
  if (status) {
    query.where('p.status', normalizeStatus(status, { fallback: status }));
  }

  const rows = await query;
  const positions = rows.map((row) => {
    const hydrated = hydratePosition(row);
    return {
      ...hydrated,
      user: {
        id: row.user_id,
        email: row.user_email,
        fullName: row.user_full_name || null,
      },
      package: {
        id: row.package_id,
        label: row.package_label || null,
      },
    };
  });
  const priceMap = await assetPriceMap(rows.map((row) => row.asset));
  const summary = buildEarningsSummary(positions, priceMap, { includeParticipants: true });
  const breakdown = buildAssetBreakdown(positions, priceMap);
  const realizedHistory = buildRealizedHistory(positions, priceMap, rangeDays, {
    maxRange: MAX_ADMIN_EARNINGS_RANGE_DAYS,
  });
  const recentPayouts = buildRecentPayouts(positions, priceMap, 20);
  const topUsers = buildTopUsers(positions, priceMap, 5);

  return {
    summary,
    breakdown,
    realizedHistory,
    recentPayouts,
    topUsers,
    priceMap,
    filters: {
      rangeDays:
        realizedHistory?.rangeDays ??
        normalizeRangeDays(rangeDays, { max: MAX_ADMIN_EARNINGS_RANGE_DAYS }),
      asset: normalizedAsset || null,
      userId: userId ? Number(userId) : null,
      status: status ? normalizeStatus(status, { fallback: status }) : null,
    },
  };
}
