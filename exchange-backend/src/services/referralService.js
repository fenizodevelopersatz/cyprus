import { db } from '../db.js';
import { uid } from '../utils/id.js';
import { cfg } from '../config.js';
import { getUserMlmDashboard, recalculateMlmForUser } from './mlmLevelService.js';
import { getUserMlmIncomeHistory } from './walletAccountingService.js';

const INVITE_BASE_URL = (cfg.referrals?.baseUrl || 'https://novax.exchange/invite').replace(
  /\/$/,
  ''
);
const DEFAULT_INVITE_MESSAGE =
  cfg.referrals?.defaultMessage || 'Join NovaX via my invite...';

function getConn(trx) {
  return trx || db;
}

export function generateReferralCode() {
  return `Primerica-${uid().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function toNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toDateISOString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildInviteUrl(code) {
  return `${INVITE_BASE_URL}/${code}`;
}

export async function ensureReferralProfile(
  userId,
  { trx, promoActive = false, promoUpdatedAt } = {}
) {
  const conn = getConn(trx);
  let profile = await conn('referral_profiles').where({ user_id: userId }).first();
  if (profile) {
    const expectedUrl = buildInviteUrl(profile.code);
    if (profile.url !== expectedUrl) {
      await conn('referral_profiles')
        .where({ user_id: userId })
        .update({
          url: expectedUrl,
          updated_at: new Date(),
        });
      profile = await conn('referral_profiles').where({ user_id: userId }).first();
    }
    return profile;
  }

  const now = new Date();
  const timestamp = promoUpdatedAt || now;
  let attempts = 0;
  while (!profile) {
    const code = generateReferralCode();
    try {
      await conn('referral_profiles').insert({
        user_id: userId,
        code,
        message: DEFAULT_INVITE_MESSAGE,
        url: buildInviteUrl(code),
        promo_active: promoActive,
        promo_updated_at: timestamp,
        created_at: now,
        updated_at: now,
      });
      profile = await conn('referral_profiles').where({ user_id: userId }).first();
    } catch (err) {
      const duplicate =
        err?.code && ['ER_DUP_ENTRY', '23505', 'SQLITE_CONSTRAINT'].includes(err.code);
      if (duplicate && attempts < 5) {
        attempts += 1;
        continue;
      }
      throw err;
    }
  }
  return profile;
}

export async function ensureReferralStats(userId, { trx } = {}) {
  const conn = getConn(trx);
  let stats = await conn('referral_stats').where({ user_id: userId }).first();
  if (stats) return stats;
  const now = new Date();
  await conn('referral_stats').insert({
    user_id: userId,
    total_invites: 0,
    total_invites_delta: 0,
    verified_traders: 0,
    verified_traders_delta: 0,
    rewards_earned: 0,
    rewards_earned_delta: 0,
    pending_payout: 0,
    created_at: now,
    updated_at: now,
  });
  stats = await conn('referral_stats').where({ user_id: userId }).first();
  return stats;
}

export async function recordReferralSignup({
  inviterUserId,
  email,
  status = 'joined',
  joinedAt = new Date(),
  trx,
}) {
  if (!inviterUserId || !email) return null;
  const conn = getConn(trx);
  const now = new Date();
  const existing = await conn('referral_referrals')
    .where({ user_id: inviterUserId, email })
    .first();

  if (existing) {
    await conn('referral_referrals')
      .where({ id: existing.id })
      .update({
        status,
        joined_at: joinedAt,
        updated_at: now,
      });
    return existing.id;
  }

  await conn('referral_referrals').insert({
    user_id: inviterUserId,
    email,
    status,
    joined_at: joinedAt,
    volume: 0,
    reward_earned: 0,
    created_at: now,
    updated_at: now,
  });

  await ensureReferralStats(inviterUserId, { trx });
  await conn('referral_stats')
    .where({ user_id: inviterUserId })
    .update({
      total_invites: conn.raw('COALESCE(total_invites, 0) + 1'),
      total_invites_delta: conn.raw('COALESCE(total_invites_delta, 0) + 1'),
      updated_at: now,
    });
  return null;
}

function formatStats(row = {}) {
  return {
    totalInvites: {
      value: toNumber(row.total_invites),
      delta: toNumber(row.total_invites_delta, null),
      deltaLabel: row.total_invites_delta_label || null,
    },
    verifiedTraders: {
      value: toNumber(row.verified_traders),
      delta: toNumber(row.verified_traders_delta, null),
      deltaLabel: row.verified_traders_delta_label || null,
    },
    rewardsEarned: {
      value: toNumber(row.rewards_earned),
      delta: toNumber(row.rewards_earned_delta, null),
      deltaLabel: row.rewards_earned_delta_label || null,
    },
    pendingPayout: {
      value: toNumber(row.pending_payout),
      deltaLabel: row.pending_payout_delta_label || null,
    },
  };
}

function formatPrimary(row) {
  if (!row) {
    return {
      code: null,
      message: null,
      url: null,
      promoActive: false,
      updatedAt: null,
    };
  }
  return {
    code: row.code,
    message: row.message,
    url: row.url,
    promoActive: !!row.promo_active,
    updatedAt: toDateISOString(row.promo_updated_at || row.updated_at),
  };
}

function formatTiers(rows = []) {
  return rows
    .filter((row) => row.active !== false)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((row) => ({
      tier: row.tier,
      requirementLabel: row.requirement_label,
      rewardLabel: row.reward_label,
    }));
}

function formatReferrals(rows = []) {
  return rows.map((row) => ({
    id: String(row.id),
    email: row.email,
    status: row.status,
    joinedAt: toDateISOString(row.joined_at),
    volume: toNumber(row.volume),
    rewardEarned: toNumber(row.reward_earned),
  }));
}

export async function getReferralDashboard(userId) {
  await recalculateMlmForUser(userId);
  const [profile, stats, tiers, referrals, mlm] = await Promise.all([
    ensureReferralProfile(userId),
    db('referral_stats').where({ user_id: userId }).first(),
    db('referral_tiers').select('*'),
    db('referral_referrals').where({ user_id: userId }).orderBy('created_at', 'desc'),
    getUserMlmDashboard(userId),
  ]);

  return {
    stats: formatStats(stats),
    primary: formatPrimary(profile),
    tiers: formatTiers(tiers),
    referrals: formatReferrals(referrals),
    mlm,
  };
}

export async function getReferralIncomeHistory(userId, { page = 1, limit = 10 } = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const rows = await getUserMlmIncomeHistory(userId, { limit: 1000 });
  const total = rows.length;
  const start = (safePage - 1) * safeLimit;
  const items = rows.slice(start, start + safeLimit).map((row) => ({
    id: row.id,
    txnId: row.txnId,
    date: row.date,
    incomeType: row.incomeType,
    sourceUser: row.sourceUser,
    sourceUserEmail: row.sourceUserEmail || null,
    sourceUserName: row.sourceUserName || null,
    sourceUserLabel: row.sourceUserLabel || row.sourceUser || null,
    previousBalance: row.previousBalance,
    amount: row.mlmEarned,
    newBalance: row.newBalance,
    status: row.status,
    remark: row.remark,
  }));

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

export async function setPromoState(userId, active) {
  const nextState = !!active;
  const now = new Date();
  await ensureReferralProfile(userId, { promoActive: nextState, promoUpdatedAt: now });
  await db('referral_profiles')
    .where({ user_id: userId })
    .update({ promo_active: nextState, promo_updated_at: now, updated_at: now });

  return { promoActive: nextState };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  if (str.includes(',') || str.includes('\n')) {
    return `"${str}"`;
  }
  return str;
}

export async function getReferralExportRows(userId) {
  return db('referral_referrals').where({ user_id: userId }).orderBy('created_at', 'desc');
}

export async function generateReferralCsv(userId) {
  const rows = await getReferralExportRows(userId);
  const header = [
    'Referral ID',
    'Email',
    'Status',
    'Joined At',
    'Trading Volume',
    'Reward Earned',
  ].join(',');

  const body = rows
    .map((row) =>
      [
        csvEscape(row.id),
        csvEscape(row.email),
        csvEscape(row.status),
        csvEscape(toDateISOString(row.joined_at) || ''),
        csvEscape(toNumber(row.volume)),
        csvEscape(toNumber(row.reward_earned)),
      ].join(',')
    )
    .join('\n');

  return body ? `${header}\n${body}` : `${header}\n`;
}
