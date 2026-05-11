import { db, withTx } from '../db.js';
import { creditBonus } from './ledgerService.js';
import { generateGlobalTxnId } from '../utils/generateGlobalTxnId.js';
import { getLevelManagementSettings } from './adminLevelManagement.service.js';
import { up as ensureMlmLevelMigration } from '../../db/migrations/028_mlm_level_engine.js';
import { up as ensureRecurringBonusStatusMigration } from '../../db/migrations/039_recurring_bonus_status.js';
import { cronLogger } from '../logging/loggers.js';
import { cfg } from '../config.js';
import { canGiveLevelIncome } from './incomeValidator.js';

const DEFAULT_MLM_MINIMUM_BALANCE = 300;
const DEFAULT_BONUS_INTERVAL_DAYS = 10;
const RECURRING_SKIP_REASONS = {
  USER_NOT_ACTIVE: 'USER_NOT_ACTIVE',
  NO_ELIGIBLE_LEVEL: 'NO_ELIGIBLE_LEVEL',
  BONUS_NOT_DUE: 'BONUS_NOT_DUE',
  INVALID_BASE_AMOUNT: 'INVALID_BASE_AMOUNT',
  WALLET_CREDIT_FAILED: 'WALLET_CREDIT_FAILED',
};
const LEVEL_BONUS_PAYOUT_UNIQUE_KEY = 'mlm_level_bonus_payouts_user_level_period_unique';
const toAbsoluteProfilePhotoUrl = (value) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(String(value))) return String(value);
  const baseUrl = cfg.api?.baseUrl || 'http://localhost:4000';
  return `${baseUrl}${String(value).startsWith('/') ? String(value) : `/${String(value)}`}`;
};

const DEFAULT_LEVEL_RULES = {
  Lv1: { directEligibleCount: 5, requiredDirectLevelCode: null, requiredDirectLevelCount: 0, teamEligibleCount: 0, bonusBase: 'direct' },
  Lv2: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 2, teamEligibleCount: 25, bonusBase: 'team' },
  Lv3: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 3, teamEligibleCount: 125, bonusBase: 'team' },
  Lv4: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 4, teamEligibleCount: 500, bonusBase: 'team' },
  Lv5: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 5, teamEligibleCount: 1000, bonusBase: 'team' },
  Lv6: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 6, teamEligibleCount: 2000, bonusBase: 'team' },
  Lv7: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 7, teamEligibleCount: 5000, bonusBase: 'team' },
  Lv8: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv7', requiredDirectLevelCount: 3, teamEligibleCount: 20000, bonusBase: 'team' },
  Lv9: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv7', requiredDirectLevelCount: 4, teamEligibleCount: 50000, bonusBase: 'team' },
  Lv10: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv8', requiredDirectLevelCount: 3, teamEligibleCount: 100000, bonusBase: 'team' },
  Lv11: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv8', requiredDirectLevelCount: 4, teamEligibleCount: 200000, bonusBase: 'team' },
  Lv12: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv9', requiredDirectLevelCount: 5, teamEligibleCount: 300000, bonusBase: 'team' },
};

function isLevelBonusPayoutDuplicate(error) {
  return error?.code === 'ER_DUP_ENTRY'
    && String(error?.sqlMessage || error?.message || '').includes(LEVEL_BONUS_PAYOUT_UNIQUE_KEY);
}

function getLevelBonusPayoutQuery(trx, userId, levelCode, periodStartedAt) {
  return trx('mlm_level_bonus_payouts')
    .where({ user_id: userId, level_code: levelCode, period_started_at: new Date(periodStartedAt) });
}

async function loadLevelConfigFromDb(trx = db) {
  await ensureMlmSchema();

  const [configRows, settingsRows] = await Promise.all([
    trx('admin_level_management_config').select('*').first(),
    trx('admin_level_settings').select('*').orderBy('sort_order', 'asc'),
  ]);

  // Get minimum balance from config
  const MLM_MINIMUM_BALANCE = toNumber(
    configRows?.minimum_balance || configRows?.mlm_minimum_balance || DEFAULT_MLM_MINIMUM_BALANCE,
    DEFAULT_MLM_MINIMUM_BALANCE
  );
  const BONUS_INTERVAL_DAYS = toNumber(
    configRows?.bonus_interval_days || DEFAULT_BONUS_INTERVAL_DAYS,
    DEFAULT_BONUS_INTERVAL_DAYS
  );

  // Build LEVEL_RULES from settings
  const LEVEL_RULES = { ...DEFAULT_LEVEL_RULES };
  for (const level of settingsRows) {
    const levelCode = level.level_code || level.levelCode;
    if (!levelCode) continue;

    LEVEL_RULES[levelCode] = {
      directEligibleCount: toNumber(
        level.direct_eligible_count || level.directEligibleCount,
        DEFAULT_LEVEL_RULES[levelCode]?.directEligibleCount || 0
      ),
      requiredDirectLevelCode:
        level.required_direct_level_code || level.requiredDirectLevelCode || DEFAULT_LEVEL_RULES[levelCode]?.requiredDirectLevelCode || null,
      requiredDirectLevelCount: toNumber(
        level.required_direct_level_count || level.requiredDirectLevelCount,
        DEFAULT_LEVEL_RULES[levelCode]?.requiredDirectLevelCount || 0
      ),
      teamEligibleCount: toNumber(
        level.team_eligible_count || level.teamEligibleCount,
        DEFAULT_LEVEL_RULES[levelCode]?.teamEligibleCount || 0
      ),
      bonusBase: level.bonus_base || level.bonusBase || DEFAULT_LEVEL_RULES[levelCode]?.bonusBase || 'team',
    };
  }

  return { MLM_MINIMUM_BALANCE, BONUS_INTERVAL_DAYS, LEVEL_RULES };
}

// Cache for level config
let levelConfigCache = null;

async function getLevelConfig(forceRefresh = false) {
  if (!levelConfigCache || forceRefresh) {
    levelConfigCache = await loadLevelConfigFromDb();
  }
  return levelConfigCache;
}

export async function refreshLevelConfig() {
  return getLevelConfig(true);
}

// Export functions to get config values
export async function getMlmMinimumBalance() {
  const config = await getLevelConfig();
  return config.MLM_MINIMUM_BALANCE;
}

export async function getBonusIntervalDays() {
  const config = await getLevelConfig();
  return config.BONUS_INTERVAL_DAYS;
}

export async function getLevelRules() {
  const config = await getLevelConfig();
  return config.LEVEL_RULES;
}

// Legacy exports for backward compatibility
// const MLM_MINIMUM_BALANCE = 300;
// const BONUS_INTERVAL_DAYS = 10;

// const LEVEL_RULES = {
//   Lv1: { directEligibleCount: 5, requiredDirectLevelCode: null, requiredDirectLevelCount: 0, teamEligibleCount: 0, bonusBase: 'direct' },
//   Lv2: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 2, teamEligibleCount: 25, bonusBase: 'team' },
//   Lv3: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 3, teamEligibleCount: 125, bonusBase: 'team' },
//   Lv4: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 4, teamEligibleCount: 500, bonusBase: 'team' },
//   Lv5: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 5, teamEligibleCount: 1000, bonusBase: 'team' },
//   Lv6: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 6, teamEligibleCount: 2000, bonusBase: 'team' },
//   Lv7: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv1', requiredDirectLevelCount: 7, teamEligibleCount: 5000, bonusBase: 'team' },
//   Lv8: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv7', requiredDirectLevelCount: 3, teamEligibleCount: 20000, bonusBase: 'team' },
//   Lv9: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv7', requiredDirectLevelCount: 4, teamEligibleCount: 50000, bonusBase: 'team' },
//   Lv10: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv8', requiredDirectLevelCount: 3, teamEligibleCount: 100000, bonusBase: 'team' },
//   Lv11: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv8', requiredDirectLevelCount: 4, teamEligibleCount: 200000, bonusBase: 'team' },
//   Lv12: { directEligibleCount: 0, requiredDirectLevelCode: 'Lv9', requiredDirectLevelCount: 5, teamEligibleCount: 300000, bonusBase: 'team' },
// };

let schemaReadyPromise = null;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toAmount(value) {
  return toNumber(value, 0).toFixed(18);
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase() === 'active' ? 'active' : 'inactive';
}

function isEligibleUser(user, minimumBalance = DEFAULT_MLM_MINIMUM_BALANCE) {
  return normalizeStatus(user.status) === 'active' && toNumber(user.main_wallet_balance) >= minimumBalance;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function getRule(levelCode, levelRules = {}) {
  return levelRules[String(levelCode || '').trim()] || null;
}

async function ensureMlmSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await ensureMlmLevelMigration(db);
      await ensureRecurringBonusStatusMigration(db);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

export async function ensureMlmLevelSchema() {
  await ensureMlmSchema();
}

async function loadContext(trx = db) {
  await ensureMlmSchema();
  const [mlmConfig, { levels }, users] = await Promise.all([
    getLevelConfig(),
    getLevelManagementSettings(),
    trx('users')
      .select('id', 'sponsor_id', 'status', 'main_wallet_balance', 'current_level_code', 'current_level_rank')
      .orderBy('id', 'asc'),
  ]);

  return {
    mlmConfig,
    levels: levels.filter((level) => level.isEnabled).sort((a, b) => toNumber(a.sortOrder) - toNumber(b.sortOrder)),
    users,
  };
}

function buildChildrenMap(users) {
  const childrenMap = new Map();
  for (const user of users) {
    const sponsorId = user.sponsor_id ? Number(user.sponsor_id) : null;
    if (!sponsorId) continue;
    if (!childrenMap.has(sponsorId)) childrenMap.set(sponsorId, []);
    childrenMap.get(sponsorId).push(user);
  }
  return childrenMap;
}

async function getUserTreePreview(userId, minimumBalance) {
  const rows = await db('users as u')
    .leftJoin('user_profiles as profile', 'profile.user_id', 'u.id')
    .select(
      'u.id',
      'u.sponsor_id',
      'u.email',
      'u.status',
      'u.main_wallet_balance',
      'u.current_level_code',
      'u.current_level_rank',
      'profile.display_name',
      'profile.profile_photo'
    )
    .orderBy('u.id', 'asc');

  const userMap = new Map(rows.map((row) => [Number(row.id), row]));
  const root = userMap.get(Number(userId));
  if (!root) {
    return {
      rootUserId: null,
      totalNodes: 0,
      maxDepth: 0,
      nodes: [],
    };
  }

  const childrenMap = buildChildrenMap(rows);
  const queue = [{ id: Number(userId), depth: 0 }];
  const visited = new Set();
  const orderedIds = [];
  const depthById = new Map([[Number(userId), 0]]);

  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) continue;
    visited.add(current.id);
    orderedIds.push(current.id);

    const children = childrenMap.get(current.id) || [];
    for (const child of children) {
      const childId = Number(child.id);
      if (visited.has(childId)) continue;
      const nextDepth = current.depth + 1;
      depthById.set(childId, nextDepth);
      queue.push({ id: childId, depth: nextDepth });
    }
  }

  const maxDepth = orderedIds.reduce((max, id) => Math.max(max, depthById.get(id) || 0), 0);
  const nodes = orderedIds.map((id) => {
    const row = userMap.get(id);
    const directChildren = childrenMap.get(id) || [];
    const email = String(row?.email || '');
    const fallbackName = email.includes('@') ? email.split('@')[0] : `User ${id}`;
    const displayName = String(row?.display_name || '').trim() || fallbackName;
    const walletBalance = toNumber(row?.main_wallet_balance);
    const eligible = isEligibleUser(row, minimumBalance);
    const sponsorId = row?.sponsor_id ? Number(row.sponsor_id) : null;

    return {
      id,
      pid: sponsorId && visited.has(sponsorId) ? sponsorId : undefined,
      name: displayName,
      email,
      profile_photo: toAbsoluteProfilePhotoUrl(row?.profile_photo),
      levelCode: row?.current_level_code || null,
      levelRank: toNumber(row?.current_level_rank),
      status: normalizeStatus(row?.status),
      walletBalance: walletBalance.toFixed(2),
      directCount: directChildren.length,
      depth: depthById.get(id) || 0,
      eligible,
      isRoot: id === Number(userId),
    };
  });

  return {
    rootUserId: Number(userId),
    totalNodes: nodes.length,
    maxDepth,
    nodes,
  };
}

function computeMetrics(userId, childrenMap, minimumBalance, memo = new Map()) {
  if (memo.has(userId)) return memo.get(userId);
  const children = childrenMap.get(userId) || [];
  const metrics = {
    directTotalMembers: children.length,
    directEligibleMembers: 0,
    directTotalBalance: 0,
    directEligibleBalance: 0,
    teamTotalMembers: 0,
    teamEligibleMembers: 0,
    teamTotalBalance: 0,
    teamEligibleBalance: 0,
  };

  for (const child of children) {
    const balance = toNumber(child.main_wallet_balance);
    const eligible = isEligibleUser(child, minimumBalance);
    metrics.directTotalBalance += balance;
    metrics.teamTotalMembers += 1;
    metrics.teamTotalBalance += balance;
    if (eligible) {
      metrics.directEligibleMembers += 1;
      metrics.directEligibleBalance += balance;
      metrics.teamEligibleMembers += 1;
      metrics.teamEligibleBalance += balance;
    }

    const subtree = computeMetrics(Number(child.id), childrenMap, minimumBalance, memo);
    metrics.teamTotalMembers += subtree.teamTotalMembers;
    metrics.teamEligibleMembers += subtree.teamEligibleMembers;
    metrics.teamTotalBalance += subtree.teamTotalBalance;
    metrics.teamEligibleBalance += subtree.teamEligibleBalance;
  }

  memo.set(userId, metrics);
  return metrics;
}

function countQualifiedDirects(children, requiredRank) {
  return children.filter((child) => toNumber(child.current_level_rank) >= requiredRank).length;
}

function countQualifiedDirectsByCode(children, levelCode) {
  return children.filter((child) => String(child.current_level_code || '').trim() === String(levelCode || '').trim()).length;
}

function getEligibleBalanceDetails(levelCode, metrics, minimumBalance, levelRules) {
  const eligibleMembers = metrics.teamEligibleMembers;
  const actualEligibleBalance = metrics.teamEligibleBalance;
  const minimumEligibleBalance = 0;
  return {
    eligibleMembers,
    actualEligibleBalance,
    minimumEligibleBalance,
    payoutEligibleBalance: actualEligibleBalance,
    usesDirectBase: false,
  };
}

async function upsertSummary(trx, userId, metrics) {
  const now = new Date();
  const payload = {
    user_id: userId,
    direct_total_members: metrics.directTotalMembers,
    direct_eligible_members: metrics.directEligibleMembers,
    direct_total_balance: toAmount(metrics.directTotalBalance),
    direct_eligible_balance: toAmount(metrics.directEligibleBalance),
    team_total_members: metrics.teamTotalMembers,
    team_eligible_members: metrics.teamEligibleMembers,
    team_total_balance: toAmount(metrics.teamTotalBalance),
    team_eligible_balance: toAmount(metrics.teamEligibleBalance),
    last_calculated_at: now,
    updated_at: now,
  };

  const existing = await trx('user_team_wallet_summary').where({ user_id: userId }).first();
  if (existing) {
    await trx('user_team_wallet_summary').where({ user_id: userId }).update(payload);
  } else {
    await trx('user_team_wallet_summary').insert({ ...payload, created_at: now });
  }
}

async function ensurePromotionReward(trx, userId, level, metrics) {
  const existing = await trx('mlm_level_achievements').where({ user_id: userId, level_code: level.levelCode }).first();
  if (existing) return existing;

  const now = new Date();
  const inserted = await trx('mlm_level_achievements').insert({
    user_id: userId,
    level_code: level.levelCode,
    level_rank: toNumber(level.sortOrder),
    promotion_reward_amount: toAmount(level.promotionRewardUsdt),
    bonus_percent: toNumber(level.bonusPercent).toFixed(4),
    achieved_at: now,
    meta: JSON.stringify(metrics),
    created_at: now,
    updated_at: now,
  });
  const achievementId = Array.isArray(inserted) ? inserted[0] : inserted;
  await trx('mlm_level_achievements').where({ id: achievementId }).update({
    txn_id: await generateGlobalTxnId(trx, 'LVL'),
    updated_at: now,
  });

  const levelHistoryRow = {
    user_id: userId,
    level: toNumber(level.sortOrder),
    achieved_at: now,
    is_reward_given: false,
    created_at: now,
    updated_at: now,
  };
  const existingLevelHistory = await trx('user_level_history').where({ user_id: userId, level: toNumber(level.sortOrder) }).first();
  if (!existingLevelHistory) {
    await trx('user_level_history').insert(levelHistoryRow);
  }

  if (toNumber(level.promotionRewardUsdt) > 0) {
    await creditBonus(userId, 'USDT', String(level.promotionRewardUsdt), { reason: 'mlm_level_promotion_reward' }, trx);
    await trx('user_level_history')
      .where({ user_id: userId, level: toNumber(level.sortOrder) })
      .update({ is_reward_given: true, updated_at: now });
  }

  return trx('mlm_level_achievements').where({ user_id: userId, level_code: level.levelCode }).first();
}

async function ensureRecurringBonus(trx, userId, level, metrics, qualifiedDirectMembers, mlmConfig) {
  const userRow = await trx('users').select('level_last_paid_at', 'status').where({ id: userId }).first();
  if (!canGiveLevelIncome(userRow)) return null;
  const achievement = await trx('mlm_level_achievements').where({ user_id: userId, level_code: level.levelCode }).first();
  if (!achievement) return null;

  const lastPayout = await trx('mlm_level_bonus_payouts')
    .where({ user_id: userId, level_code: level.levelCode, status: 'SUCCESS' })
    .orderBy('period_ended_at', 'desc')
    .first();

  const periodStart = lastPayout?.period_ended_at || achievement.achieved_at;
  if (Date.now() < addDays(periodStart, mlmConfig.BONUS_INTERVAL_DAYS).getTime()) return null;

  const eligible = getEligibleBalanceDetails(
    level.levelCode,
    metrics,
    mlmConfig.MLM_MINIMUM_BALANCE,
    mlmConfig.LEVEL_RULES
  );
  const eligibleBalance = eligible.payoutEligibleBalance;
  const eligibleMembers = eligible.eligibleMembers;
  const payoutAmount = (eligibleBalance * toNumber(level.bonusPercent)) / 100;
  if (payoutAmount <= 0) return null;

  const existingPeriod = await getLevelBonusPayoutQuery(trx, userId, level.levelCode, periodStart).first();
  if (existingPeriod) return existingPeriod;

  const now = new Date();
  let inserted;
  try {
    inserted = await trx('mlm_level_bonus_payouts').insert({
      user_id: userId,
      level_code: level.levelCode,
      level_rank: toNumber(level.sortOrder),
      bonus_percent: toNumber(level.bonusPercent).toFixed(4),
      eligible_balance: toAmount(eligibleBalance),
      eligible_members: eligibleMembers,
      qualified_direct_members: qualifiedDirectMembers,
      payout_amount: toAmount(payoutAmount),
      period_started_at: new Date(periodStart),
      period_ended_at: now,
      status: 'SUCCESS',
      meta: JSON.stringify({
        ...metrics,
        minimumEligibleBalance: toAmount(eligible.minimumEligibleBalance),
        actualEligibleBalance: toAmount(eligible.actualEligibleBalance),
        payoutEligibleBalance: toAmount(eligible.payoutEligibleBalance),
        bonusBase: eligible.usesDirectBase ? 'direct' : 'team',
      }),
      created_at: now,
      updated_at: now,
    });
  } catch (error) {
    if (isLevelBonusPayoutDuplicate(error)) {
      return getLevelBonusPayoutQuery(trx, userId, level.levelCode, periodStart).first();
    }
    throw error;
  }
  const payoutId = Array.isArray(inserted) ? inserted[0] : inserted;
  await trx('mlm_level_bonus_payouts').where({ id: payoutId }).update({
    txn_id: await generateGlobalTxnId(trx, 'BON'),
    updated_at: now,
  });

  await creditBonus(userId, 'USDT', payoutAmount.toFixed(18), { reason: 'mlm_level_bonus' }, trx);
  await trx('users').where({ id: userId }).update({ last_level_bonus_at: now, level_last_paid_at: now, updated_at: now });

  return trx('mlm_level_bonus_payouts')
    .where({ user_id: userId, level_code: level.levelCode, period_started_at: new Date(periodStart) })
    .first();
}

async function getUserPositionStatus(trx, userId) {
  return trx('user_position_status').where({ user_id: userId }).first();
}

async function upsertUserPositionStatus(trx, userId, payload) {
  const now = new Date();
  const existing = await getUserPositionStatus(trx, userId);
  const nextPayload = {
    ...payload,
    last_checked_at: payload.last_checked_at || now,
    updated_at: now,
  };

  if (existing) {
    await trx('user_position_status').where({ user_id: userId }).update(nextPayload);
  } else {
    await trx('user_position_status').insert({
      user_id: userId,
      created_at: now,
      ...nextPayload,
    });
  }

  return getUserPositionStatus(trx, userId);
}

function buildPositionStatusPayload({ statusRow, matched, metrics, levelRules, bonusIntervalDays, checkedAt = new Date() }) {
  const level = matched?.level || null;
  const levelCode = level?.levelCode || null;
  const levelOrder = level ? toNumber(level.sortOrder) : 0;
  const wasQualified = Boolean(statusRow?.is_currently_qualified);
  const isQualified = Boolean(levelCode);
  const directLv1Count = countQualifiedDirectsByCode(metrics.children || [], 'Lv1');
  const directLv7Count = countQualifiedDirectsByCode(metrics.children || [], 'Lv7');
  const directLv8Count = countQualifiedDirectsByCode(metrics.children || [], 'Lv8');
  const directLv9Count = countQualifiedDirectsByCode(metrics.children || [], 'Lv9');
  const qualifiedAt = isQualified
    ? wasQualified && statusRow?.qualified_at
      ? statusRow.qualified_at
      : checkedAt
    : null;
  const nextBonusDueAt = isQualified
    ? wasQualified && statusRow?.next_bonus_due_at
      ? statusRow.next_bonus_due_at
      : addDays(checkedAt, bonusIntervalDays)
    : null;

  return {
    current_eligible_level_code: levelCode,
    current_eligible_level_order: levelOrder,
    active_direct_count: toNumber(metrics.directEligibleMembers),
    active_team_count: toNumber(metrics.teamEligibleMembers),
    direct_lv1_count: directLv1Count,
    direct_lv7_count: directLv7Count,
    direct_lv8_count: directLv8Count,
    direct_lv9_count: directLv9Count,
    is_currently_qualified: isQualified,
    qualified_at: qualifiedAt,
    next_bonus_due_at: nextBonusDueAt,
    last_checked_at: checkedAt,
  };
}

async function recordRecurringBonusHistory(trx, payload) {
  const now = new Date();
  return trx('recurring_bonus_history').insert({
    created_at: now,
    updated_at: now,
    meta: payload.meta ? JSON.stringify(payload.meta) : null,
    ...payload,
  });
}

function getCycleBounds(statusRow, dueAt, bonusIntervalDays) {
  const cycleTo = dueAt ? new Date(dueAt) : new Date();
  const qualifiedAt = statusRow?.qualified_at ? new Date(statusRow.qualified_at) : null;
  const cycleFrom = qualifiedAt
    ? new Date(Math.max(addDays(cycleTo, -bonusIntervalDays).getTime(), qualifiedAt.getTime()))
    : addDays(cycleTo, -bonusIntervalDays);
  return { cycleFrom, cycleTo };
}

async function processRecurringBonusPayment(trx, user, matched, metrics, statusRow, context) {
  const refreshedStatusPayload = buildPositionStatusPayload({
    statusRow,
    matched,
    metrics,
    levelRules: context.mlmConfig.LEVEL_RULES,
    bonusIntervalDays: context.mlmConfig.BONUS_INTERVAL_DAYS,
    checkedAt: new Date(),
  });
  await upsertUserPositionStatus(trx, user.id, refreshedStatusPayload);
  const dueAt = statusRow?.next_bonus_due_at ? new Date(statusRow.next_bonus_due_at) : null;
  if (!dueAt || dueAt.getTime() > Date.now()) {
    return { skipped: true, reason: RECURRING_SKIP_REASONS.BONUS_NOT_DUE };
  }

  if (!canGiveLevelIncome(user)) {
    await recordRecurringBonusHistory(trx, {
      user_id: user.id,
      level_code: null,
      percent: '0.0000',
      base_amount: toAmount(0),
      bonus_amount: toAmount(0),
      due_at: dueAt,
      status: 'skipped',
      skip_reason: RECURRING_SKIP_REASONS.USER_NOT_ACTIVE,
    });
    await upsertUserPositionStatus(trx, user.id, {
      current_eligible_level_code: null,
      current_eligible_level_order: 0,
      active_direct_count: toNumber(metrics.directEligibleMembers),
      active_team_count: toNumber(metrics.teamEligibleMembers),
      direct_lv1_count: countQualifiedDirectsByCode(metrics.children || [], 'Lv1'),
      direct_lv7_count: countQualifiedDirectsByCode(metrics.children || [], 'Lv7'),
      direct_lv8_count: countQualifiedDirectsByCode(metrics.children || [], 'Lv8'),
      direct_lv9_count: countQualifiedDirectsByCode(metrics.children || [], 'Lv9'),
      is_currently_qualified: false,
      qualified_at: null,
      next_bonus_due_at: null,
      last_checked_at: new Date(),
    });
    return { skipped: true, reason: RECURRING_SKIP_REASONS.USER_NOT_ACTIVE };
  }

  const level = matched?.level || null;
  if (!level) {
    await recordRecurringBonusHistory(trx, {
      user_id: user.id,
      level_code: null,
      percent: '0.0000',
      base_amount: toAmount(0),
      bonus_amount: toAmount(0),
      due_at: dueAt,
      status: 'skipped',
      skip_reason: RECURRING_SKIP_REASONS.NO_ELIGIBLE_LEVEL,
    });
    await upsertUserPositionStatus(trx, user.id, {
      current_eligible_level_code: null,
      current_eligible_level_order: 0,
      active_direct_count: toNumber(metrics.directEligibleMembers),
      active_team_count: toNumber(metrics.teamEligibleMembers),
      direct_lv1_count: countQualifiedDirectsByCode(metrics.children || [], 'Lv1'),
      direct_lv7_count: countQualifiedDirectsByCode(metrics.children || [], 'Lv7'),
      direct_lv8_count: countQualifiedDirectsByCode(metrics.children || [], 'Lv8'),
      direct_lv9_count: countQualifiedDirectsByCode(metrics.children || [], 'Lv9'),
      is_currently_qualified: false,
      qualified_at: null,
      next_bonus_due_at: null,
      last_checked_at: new Date(),
    });
    return { skipped: true, reason: RECURRING_SKIP_REASONS.NO_ELIGIBLE_LEVEL };
  }

  const bonusDetails = getEligibleBalanceDetails(
    level.levelCode,
    metrics,
    context.mlmConfig.MLM_MINIMUM_BALANCE,
    context.mlmConfig.LEVEL_RULES
  );
  const baseAmount = toNumber(bonusDetails.payoutEligibleBalance);
  if (baseAmount <= 0) {
    await recordRecurringBonusHistory(trx, {
      user_id: user.id,
      level_code: level.levelCode,
      percent: toNumber(level.bonusPercent).toFixed(4),
      base_amount: toAmount(baseAmount),
      bonus_amount: toAmount(0),
      due_at: dueAt,
      status: 'skipped',
      skip_reason: RECURRING_SKIP_REASONS.INVALID_BASE_AMOUNT,
    });
    return { skipped: true, reason: RECURRING_SKIP_REASONS.INVALID_BASE_AMOUNT };
  }

  const bonusAmount = (baseAmount * toNumber(level.bonusPercent)) / 100;
  const { cycleFrom, cycleTo } = getCycleBounds(statusRow, dueAt, context.mlmConfig.BONUS_INTERVAL_DAYS);
  const paidAt = new Date();

  const existingPayout = await getLevelBonusPayoutQuery(trx, user.id, level.levelCode, cycleFrom).first();
  if (existingPayout) {
    return {
      skipped: false,
      duplicate: true,
      payoutId: existingPayout.id,
      levelCode: existingPayout.level_code,
      bonusAmount: existingPayout.payout_amount,
    };
  }

  let inserted;
  try {
    inserted = await trx('mlm_level_bonus_payouts').insert({
      user_id: user.id,
      level_code: level.levelCode,
      level_rank: toNumber(level.sortOrder),
      bonus_percent: toNumber(level.bonusPercent).toFixed(4),
      eligible_balance: toAmount(baseAmount),
      eligible_members: bonusDetails.eligibleMembers,
      qualified_direct_members: matched?.qualifiedDirectMembers || 0,
      payout_amount: toAmount(bonusAmount),
      period_started_at: cycleFrom,
      period_ended_at: paidAt,
      status: 'SUCCESS',
      meta: JSON.stringify({
        actualEligibleBalance: toAmount(bonusDetails.actualEligibleBalance),
        minimumEligibleBalance: toAmount(bonusDetails.minimumEligibleBalance),
        payoutEligibleBalance: toAmount(bonusDetails.payoutEligibleBalance),
        bonusBase: bonusDetails.usesDirectBase ? 'direct' : 'team',
        recurringBonusDueAt: dueAt,
      }),
      created_at: paidAt,
      updated_at: paidAt,
    });
  } catch (error) {
    if (isLevelBonusPayoutDuplicate(error)) {
      const duplicatePayout = await getLevelBonusPayoutQuery(trx, user.id, level.levelCode, cycleFrom).first();
      return {
        skipped: false,
        duplicate: true,
        payoutId: duplicatePayout?.id || null,
        levelCode: duplicatePayout?.level_code || level.levelCode,
        bonusAmount: duplicatePayout?.payout_amount || toAmount(bonusAmount),
      };
    }
    throw error;
  }
  const payoutId = Array.isArray(inserted) ? inserted[0] : inserted;
  await trx('mlm_level_bonus_payouts').where({ id: payoutId }).update({
    txn_id: await generateGlobalTxnId(trx, 'BON'),
    updated_at: paidAt,
  });

  try {
    await creditBonus(user.id, 'USDT', bonusAmount.toFixed(18), { reason: 'mlm_level_bonus' }, trx);
  } catch (error) {
    await trx('mlm_level_bonus_payouts').where({ id: payoutId }).del();
    await recordRecurringBonusHistory(trx, {
      user_id: user.id,
      level_code: level.levelCode,
      percent: toNumber(level.bonusPercent).toFixed(4),
      base_amount: toAmount(baseAmount),
      bonus_amount: toAmount(bonusAmount),
      cycle_from: cycleFrom,
      cycle_to: cycleTo,
      due_at: dueAt,
      status: 'skipped',
      skip_reason: RECURRING_SKIP_REASONS.WALLET_CREDIT_FAILED,
      meta: { error: error?.message || 'wallet_credit_failed' },
    });
    return { skipped: true, reason: RECURRING_SKIP_REASONS.WALLET_CREDIT_FAILED };
  }

  await recordRecurringBonusHistory(trx, {
    user_id: user.id,
    level_code: level.levelCode,
    percent: toNumber(level.bonusPercent).toFixed(4),
    base_amount: toAmount(baseAmount),
    bonus_amount: toAmount(bonusAmount),
    cycle_from: cycleFrom,
    cycle_to: cycleTo,
    due_at: dueAt,
    paid_at: paidAt,
    status: 'paid',
    skip_reason: null,
    meta: {
      currentEligibleLevel: level.levelCode,
      qualifiedDirectMembers: matched?.qualifiedDirectMembers || 0,
      eligibleMembers: bonusDetails.eligibleMembers,
      bonusBase: bonusDetails.usesDirectBase ? 'direct' : 'team',
    },
  });

  const nextDueAt = addDays(dueAt, context.mlmConfig.BONUS_INTERVAL_DAYS);
  await trx('users').where({ id: user.id }).update({ last_level_bonus_at: paidAt, level_last_paid_at: paidAt, updated_at: paidAt });
  await upsertUserPositionStatus(trx, user.id, {
    ...buildPositionStatusPayload({
      statusRow,
      matched,
      metrics,
      levelRules: context.mlmConfig.LEVEL_RULES,
      bonusIntervalDays: context.mlmConfig.BONUS_INTERVAL_DAYS,
      checkedAt: paidAt,
    }),
    qualified_at: statusRow?.qualified_at || paidAt,
    next_bonus_due_at: nextDueAt,
  });

  return {
    skipped: false,
    payoutId,
    levelCode: level.levelCode,
    bonusAmount: toAmount(bonusAmount),
    dueAt,
    nextDueAt,
  };
}

function selectMatchedLevel(levels, children, metrics, levelRules) {
  const rankMap = new Map(levels.map((level) => [level.levelCode, toNumber(level.sortOrder)]));
  let matched = null;

  for (const level of levels) {
    const rule = getRule(level.levelCode, levelRules);
    if (!rule) continue;
    const qualifiedDirectMembers = rule.requiredDirectLevelCode
      ? countQualifiedDirects(children, rankMap.get(rule.requiredDirectLevelCode) || 0)
      : metrics.directEligibleMembers;
    const directOk = rule.requiredDirectLevelCode
      ? qualifiedDirectMembers >= rule.requiredDirectLevelCount
      : metrics.directEligibleMembers >= rule.directEligibleCount;
    const teamOk = metrics.teamEligibleMembers >= rule.teamEligibleCount;

    if (directOk && teamOk) {
      matched = { level, qualifiedDirectMembers };
    }
  }

  return matched;
}

async function getAncestorIds(trx, userId) {
  const ids = [];
  let currentId = Number(userId);
  const seen = new Set();

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    ids.push(currentId);
    const row = await trx('users').select('sponsor_id').where({ id: currentId }).first();
    currentId = row?.sponsor_id ? Number(row.sponsor_id) : 0;
  }

  return ids;
}

async function recalculateOne(trx, userId, context) {
  const children = context.childrenMap.get(Number(userId)) || [];
  const metrics = computeMetrics(
    Number(userId),
    context.childrenMap,
    context.mlmConfig.MLM_MINIMUM_BALANCE,
    context.memo
  );
  await upsertSummary(trx, userId, metrics);

  const matched = selectMatchedLevel(context.levels, children, metrics, context.mlmConfig.LEVEL_RULES);
  const level = matched?.level || null;
  const levelCode = level?.levelCode || null;
  const levelRank = level ? toNumber(level.sortOrder) : 0;
  const statusRow = await getUserPositionStatus(trx, userId);
  const statusPayload = buildPositionStatusPayload({
    statusRow,
    matched,
    metrics: { ...metrics, children },
    levelRules: context.mlmConfig.LEVEL_RULES,
    bonusIntervalDays: context.mlmConfig.BONUS_INTERVAL_DAYS,
    checkedAt: new Date(),
  });

  await trx('users').where({ id: userId }).update({
    current_level_code: levelCode,
    current_level_rank: levelRank,
    updated_at: new Date(),
  });

  const user = context.userMap.get(Number(userId));
  if (user) {
    user.current_level_code = levelCode;
    user.current_level_rank = levelRank;
  }

  if (level) {
    await ensurePromotionReward(trx, userId, level, metrics);
  }

  await upsertUserPositionStatus(trx, userId, statusPayload);

  return { userId: Number(userId), levelCode, levelRank };
}

function parseClockTime(value) {
  const match = String(value || '')
    .trim()
    .match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]), label: `${match[1].padStart(2, '0')}:${match[2]}` };
}

function getDailyScheduleDelayMs(targetHour, targetMinute) {
  const now = new Date();
  const next = new Date(now);
  next.setHours(targetHour, targetMinute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function scheduleDailyRun(timeLabel, task) {
  const parsed = parseClockTime(timeLabel);
  if (!parsed) {
    cronLogger.warn({ event: 'schedule_skipped', job: task.jobName, time: timeLabel }, 'schedule_skipped');
    return () => {};
  }

  let timeoutHandle = null;
  let intervalHandle = null;

  const runSafely = async () => {
    try {
      await task.run();
    } catch (err) {
      cronLogger.error({ err, event: 'run_failed', job: task.jobName, scheduledTime: parsed.label }, 'run_failed');
    }
  };

  const armNext = () => {
    const delay = getDailyScheduleDelayMs(parsed.hour, parsed.minute);
    timeoutHandle = setTimeout(() => {
      runSafely().catch(() => {});
      intervalHandle = setInterval(() => {
        runSafely().catch(() => {});
      }, 24 * 60 * 60 * 1000);
    }, delay);
    timeoutHandle.unref?.();
  };

  cronLogger.info({ event: 'schedule_armed', job: task.jobName, scheduledTime: parsed.label }, 'schedule_armed');
  armNext();

  return () => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (intervalHandle) clearInterval(intervalHandle);
  };
}

async function runAllDueMlmBonusPayouts() {
  return withTx(async (trx) => {
    const base = await loadContext(trx);
    const context = {
      ...base,
      userMap: new Map(base.users.map((user) => [Number(user.id), user])),
      childrenMap: buildChildrenMap(base.users),
      memo: new Map(),
    };
    const results = [];

    for (const user of base.users) {
      const userId = Number(user.id);
      const children = context.childrenMap.get(userId) || [];
      const metrics = computeMetrics(
        userId,
        context.childrenMap,
        context.mlmConfig.MLM_MINIMUM_BALANCE,
        context.memo
      );
      const matched = selectMatchedLevel(context.levels, children, metrics, context.mlmConfig.LEVEL_RULES);
      const statusRow = await getUserPositionStatus(trx, userId);
      const dueAt = statusRow?.next_bonus_due_at ? new Date(statusRow.next_bonus_due_at) : null;
      if (!statusRow?.is_currently_qualified || !dueAt || dueAt.getTime() > Date.now()) {
        continue;
      }

      const payout = await processRecurringBonusPayment(
        trx,
        { ...user, id: userId },
        matched,
        { ...metrics, children },
        statusRow,
        context
      );

      if (payout && !payout.skipped) {
        results.push({
          userId,
          levelCode: payout.levelCode,
          payoutId: payout.payoutId,
          payoutAmount: payout.bonusAmount,
        });
      }
    }

    return results;
  });
}

export async function recalculateMlmForUser(userId, { trx = null, relatedUserIds = [] } = {}) {
  if (!userId) return [];
  const execute = async (conn) => {
    const base = await loadContext(conn);
    const context = {
      ...base,
      userMap: new Map(base.users.map((user) => [Number(user.id), user])),
      childrenMap: buildChildrenMap(base.users),
      memo: new Map(),
    };

    const orderedIds = [];
    const seen = new Set();
    for (const id of await getAncestorIds(conn, userId)) {
      if (!seen.has(id)) {
        seen.add(id);
        orderedIds.push(id);
      }
    }
    for (const relatedId of relatedUserIds) {
      for (const id of await getAncestorIds(conn, relatedId)) {
        if (!seen.has(id)) {
          seen.add(id);
          orderedIds.push(id);
        }
      }
    }

    const results = [];
    for (const targetId of orderedIds) {
      results.push(await recalculateOne(conn, targetId, context));
    }
    return results;
  };

  return trx ? execute(trx) : withTx((innerTrx) => execute(innerTrx));
}

export async function recalculateAllMlmSummaries() {
  return withTx(async (trx) => {
    const base = await loadContext(trx);
    const context = {
      ...base,
      userMap: new Map(base.users.map((user) => [Number(user.id), user])),
      childrenMap: buildChildrenMap(base.users),
      memo: new Map(),
    };
    const depthMemo = new Map();
    const getDepth = (userId) => {
      if (depthMemo.has(userId)) return depthMemo.get(userId);
      const user = context.userMap.get(userId);
      const sponsorId = user?.sponsor_id ? Number(user.sponsor_id) : 0;
      const depth = sponsorId ? getDepth(sponsorId) + 1 : 0;
      depthMemo.set(userId, depth);
      return depth;
    };
    const ordered = [...base.users]
      .map((user) => Number(user.id))
      .sort((a, b) => getDepth(b) - getDepth(a));
    const results = [];
    for (const userId of ordered) {
      results.push(await recalculateOne(trx, userId, context));
    }
    return results;
  });
}

export async function rebuildUserEligibleLevelsDaily() {
  return recalculateAllMlmSummaries();
}

export async function processDailyRecurringBonusCron() {
  return runAllDueMlmBonusPayouts();
}

export async function getUserMlmDashboard(userId) {
  await ensureMlmSchema();
  const [mlmConfig, levelManagementSettings, user, summary, achievements, payouts, statusRow, recurringHistory] = await Promise.all([
    getLevelConfig(),
    getLevelManagementSettings(),
    db('users')
      .select('id', 'status', 'main_wallet_balance', 'current_level_code', 'current_level_rank')
      .where({ id: userId })
      .first(),
    db('user_team_wallet_summary').where({ user_id: userId }).first(),
    db('mlm_level_achievements').where({ user_id: userId }).orderBy('level_rank', 'asc'),
    db('mlm_level_bonus_payouts').where({ user_id: userId }).orderBy('created_at', 'desc').limit(50),
    db('user_position_status').where({ user_id: userId }).first(),
    db('recurring_bonus_history').where({ user_id: userId }).orderBy('created_at', 'desc').limit(50),
  ]);
  const tree = await getUserTreePreview(userId, mlmConfig.MLM_MINIMUM_BALANCE);
  const levelSettings = (levelManagementSettings?.levels || [])
    .map((level) => {
      const rule = getRule(level.levelCode, mlmConfig.LEVEL_RULES) || {};
      return {
        levelCode: level.levelCode,
        qualificationText: level.qualificationText || '',
        directRequirement: toNumber(rule.requiredDirectLevelCode ? rule.requiredDirectLevelCount : rule.directEligibleCount),
        directLevelCode: rule.requiredDirectLevelCode || null,
        teamRequirement: toNumber(rule.teamEligibleCount),
        bonusPercent: toNumber(level.bonusPercent),
        promotionRewardUsdt: toNumber(level.promotionRewardUsdt),
        bonusBase: rule.bonusBase || 'team',
        isEnabled: Boolean(level.isEnabled),
        sortOrder: toNumber(level.sortOrder),
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    currentLevel: user?.current_level_code || null,
    currentLevelRank: toNumber(user?.current_level_rank),
    status: normalizeStatus(user?.status),
    mainWalletBalance: String(user?.main_wallet_balance || '0'),
    minimumEligibleBalance: mlmConfig.MLM_MINIMUM_BALANCE,
    rewardApplicable: normalizeStatus(user?.status) === 'active' && toNumber(user?.current_level_rank) > 0,
    currentEligibleLevel: statusRow?.current_eligible_level_code || user?.current_level_code || null,
    currentEligibleLevelOrder: toNumber(statusRow?.current_eligible_level_order),
    nextBonusDueAt: statusRow?.next_bonus_due_at || null,
    qualifiedAt: statusRow?.qualified_at || null,
    isCurrentlyQualified: Boolean(statusRow?.is_currently_qualified),
    positionStatus: {
      activeDirectCount: toNumber(statusRow?.active_direct_count),
      activeTeamCount: toNumber(statusRow?.active_team_count),
      directLv1Count: toNumber(statusRow?.direct_lv1_count),
      directLv7Count: toNumber(statusRow?.direct_lv7_count),
      directLv8Count: toNumber(statusRow?.direct_lv8_count),
      directLv9Count: toNumber(statusRow?.direct_lv9_count),
      lastCheckedAt: statusRow?.last_checked_at || null,
    },
    summary: {
      directTotalMembers: toNumber(summary?.direct_total_members),
      directEligibleMembers: toNumber(summary?.direct_eligible_members),
      directTotalBalance: String(summary?.direct_total_balance || '0'),
      directEligibleBalance: String(summary?.direct_eligible_balance || '0'),
      teamTotalMembers: toNumber(summary?.team_total_members),
      teamEligibleMembers: toNumber(summary?.team_eligible_members),
      teamTotalBalance: String(summary?.team_total_balance || '0'),
      teamEligibleBalance: String(summary?.team_eligible_balance || '0'),
      minimumEligibleTeamBalance: toAmount(
        toNumber(summary?.team_eligible_members) * toNumber(mlmConfig.MLM_MINIMUM_BALANCE, DEFAULT_MLM_MINIMUM_BALANCE)
      ),
      lastCalculatedAt: summary?.last_calculated_at || null,
    },
    levelSettings,
    tree,
    promotionHistory: achievements.map((row) => ({
      id: row.id,
      levelCode: row.level_code,
      levelRank: toNumber(row.level_rank),
      rewardAmount: String(row.promotion_reward_amount || '0'),
      bonusPercent: String(row.bonus_percent || '0'),
      achievedAt: row.achieved_at,
      createdAt: row.created_at,
    })),
    bonusPayoutHistory: payouts.map((row) => ({
      id: row.id,
      levelCode: row.level_code,
      levelRank: toNumber(row.level_rank),
      bonusPercent: String(row.bonus_percent || '0'),
      eligibleBalance: String(row.eligible_balance || '0'),
      eligibleMembers: toNumber(row.eligible_members),
      qualifiedDirectMembers: toNumber(row.qualified_direct_members),
      payoutAmount: String(row.payout_amount || '0'),
      periodStartedAt: row.period_started_at,
      periodEndedAt: row.period_ended_at,
      status: row.status,
      createdAt: row.created_at,
    })),
    recurringBonusHistory: recurringHistory.map((row) => ({
      id: row.id,
      levelCode: row.level_code,
      percent: String(row.percent || '0'),
      baseAmount: String(row.base_amount || '0'),
      bonusAmount: String(row.bonus_amount || '0'),
      cycleFrom: row.cycle_from,
      cycleTo: row.cycle_to,
      dueAt: row.due_at,
      paidAt: row.paid_at,
      status: row.status,
      skipReason: row.skip_reason || null,
      createdAt: row.created_at,
    })),
  };
}

export function startMlmBackupCronWorker() {
  if (!cfg?.mlm?.backupCronEnabled) {
    cronLogger.info({ event: 'worker_disabled', job: 'mlm_backup_rebuild' }, 'worker_disabled');
    return [];
  }

  const scheduledTimes = (cfg?.mlm?.backupCronTimes || [])
    .map((value) => parseClockTime(value))
    .filter(Boolean);

  const run = async () => {
    try {
      cronLogger.info({ event: 'backup_started', job: 'mlm_backup_rebuild' }, 'backup_started');
      const results = await rebuildUserEligibleLevelsDaily();
      cronLogger.info(
        { event: 'backup_completed', job: 'mlm_backup_rebuild', processedUsers: results.length },
        'backup_completed'
      );
    } catch (err) {
      cronLogger.error({ err, event: 'backup_failed', job: 'mlm_backup_rebuild' }, 'backup_failed');
    }
  };

  if (!scheduledTimes.length) {
    cronLogger.warn({ event: 'worker_disabled', job: 'mlm_backup_rebuild', reason: 'no_valid_times' }, 'worker_disabled');
    return [];
  }

  return scheduledTimes.map((entry) => scheduleDailyRun(entry.label, { jobName: 'mlm_backup_rebuild', run }));
}

export function startMlmLevelBonusPayoutWorker() {
  if (!cfg?.mlm?.bonusPayoutCronEnabled) {
    cronLogger.info({ event: 'worker_disabled', job: 'mlm_level_bonus_payout' }, 'worker_disabled');
    return null;
  }
  const intervalMinutes = Math.max(Number(cfg?.mlm?.bonusPayoutIntervalMinutes) || 30, 1);
  const intervalMs = intervalMinutes * 60 * 1000;

  const run = async () => {
    try {
      cronLogger.info({ event: 'payout_scan_started', job: 'mlm_level_bonus_payout' }, 'payout_scan_started');
      const results = await processDailyRecurringBonusCron();
      cronLogger.info(
        { event: 'payout_scan_completed', job: 'mlm_level_bonus_payout', processedPayouts: results.length },
        'payout_scan_completed'
      );
    } catch (err) {
      cronLogger.error({ err, event: 'payout_scan_failed', job: 'mlm_level_bonus_payout' }, 'payout_scan_failed');
    }
  };

  run().catch((err) => {
    cronLogger.error({ err, event: 'bootstrap_failed', job: 'mlm_level_bonus_payout' }, 'bootstrap_failed');
  });

  const timer = setInterval(() => {
    run().catch((err) => {
      cronLogger.error({ err, event: 'interval_failed', job: 'mlm_level_bonus_payout' }, 'interval_failed');
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
}
