import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok, fail } from '../../utils/responses.js';
import { db } from '../../db.js';
import { ensureMlmLevelSchema, recalculateMlmForUser } from '../../services/mlmLevelService.js';
import { buildInviteUrl, normalizeReferralCode } from '../../services/referralService.js';
import {
  approveUserTelegramAccess,
  ensureTelegramAccessHistorySchema,
  ensureTelegramAccessSchema,
  listTelegramAccessHistory,
  rejectUserTelegramAccess,
  seedTelegramHistoryFromProfile,
} from '../../services/dashboardService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

function normalizeStatus(user) {
  const normalized = String(user.status || '').trim().toLowerCase();
  if (['active', 'inactive', 'deleted'].includes(normalized)) return normalized;
  return 'inactive';
}

function normalizeTelegramAccessStatus(row) {
  const explicitStatus = String(row.telegram_access_status || '').trim().toLowerCase();
  if (explicitStatus) return explicitStatus;
  if (row.telegram_access_approved_at) return 'approved';
  if (String(row.telegram_username || '').trim() || row.telegram_access_requested_at) return 'pending';
  return 'not_submitted';
}

function toAbsoluteProfilePhotoUrl(req, value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(String(value))) return String(value);
  const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  if (!forwardedHost) return String(value);
  return `${forwardedProto}://${forwardedHost}${String(value).startsWith('/') ? value : `/${value}`}`;
}

function normalizeReferralIdentity(code, url) {
  const normalizedCode = normalizeReferralCode(code);
  return {
    referralCode: normalizedCode || null,
    referralUrl: normalizedCode ? buildInviteUrl(normalizedCode) : String(url || '').trim() || null,
  };
}

function mapAdminUserRow(req, row) {
  const referralIdentity = normalizeReferralIdentity(row.referral_code, row.referral_url);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || null,
    profilePhoto: toAbsoluteProfilePhotoUrl(req, row.profile_photo),
    country: row.country,
    kycLevel: row.kyc_level || 0,
    kycVerified: !!row.kyc_verified,
    status: normalizeStatus(row),
    mainWalletBalance: Number(row.main_wallet_balance || 0),
    hasPassword: Boolean(row.password_hash),
    currentLevelCode: row.current_level_code || null,
    currentLevelRank: Number(row.current_level_rank || 0),
    referralCode: referralIdentity.referralCode,
    referralUrl: referralIdentity.referralUrl,
    currentEligibleLevelCode: row.current_eligible_level_code || row.current_level_code || null,
    currentEligibleLevelOrder: Number(row.current_eligible_level_order || row.current_level_rank || 0),
    previousAchievedLevelCode: row.highest_achieved_level_code || row.current_level_code || null,
    previousAchievedLevelRank: Number(row.highest_achieved_level_rank || row.current_level_rank || 0),
    fallbackHappened:
      Boolean(row.highest_achieved_level_code) &&
      Boolean(row.current_eligible_level_code) &&
      String(row.highest_achieved_level_code) !== String(row.current_eligible_level_code),
    isCurrentlyQualified: Boolean(row.is_currently_qualified),
    activeDirectCount: Number(row.active_direct_count || 0),
    activeTeamCount: Number(row.active_team_count || 0),
    directLv1Count: Number(row.direct_lv1_count || 0),
    directLv7Count: Number(row.direct_lv7_count || 0),
    directLv8Count: Number(row.direct_lv8_count || 0),
    directLv9Count: Number(row.direct_lv9_count || 0),
    qualifiedAt: row.qualified_at || null,
    lastCheckedAt: row.last_checked_at || null,
    nextBonusDueAt: row.next_bonus_due_at || null,
    roles: (row.roles || 'user').split(','),
    createdAt: row.created_at,
    passwordChangedAt: row.updated_at || row.created_at,
    twoFactorEnabled: row.two_factor_enabled === undefined || row.two_factor_enabled === null ? true : Boolean(row.two_factor_enabled),
    googleAuthConfigured: Boolean(row.google_auth_secret),
    tier: row.tier || null,
    telegramUsername: row.telegram_username || null,
    telegramAccessStatus: normalizeTelegramAccessStatus(row),
    telegramAccessRequestedAt: row.telegram_access_requested_at || null,
    telegramAccessApprovedAt: row.telegram_access_approved_at || null,
    telegramAccessRejectedAt: row.telegram_access_rejected_at || null,
    telegramAccessRejectNote: row.telegram_access_reject_note || null,
    telegramHistory: [],
  };
}

const ADMIN_AUDIT_INCOME_TYPES = new Set([
  'signal_income',
  'direct_sponsor_commission',
  'joined_commission',
  'level_bonus_10day',
  'level_promotion_reward',
  'admin_adjustment_credit',
  'admin_adjustment_debit',
]);

const normalizeAuditText = (value) => String(value ?? '').trim().toLowerCase();
const formatAuditDateKey = (value) => new Date(value || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
const buildAuditTxnId = (prefix, eventAt, id) =>
  `${prefix}-${formatAuditDateKey(eventAt)}-${String(Number(id) || 0).padStart(6, '0')}`;

async function hasColumn(tableName, columnName) {
  const row = await db('information_schema.columns')
    .where({
      table_schema: db.raw('DATABASE()'),
      table_name: tableName,
      column_name: columnName,
    })
    .first('column_name');
  return !!row;
}

function buildAdminAuditTxnId(row) {
  if (row.txn_id) {
    if (row.kind === 'admin_adjustment_credit') return String(row.txn_id).replace(/^TXN-FEE-/i, 'TXN-ADEP-');
    if (row.kind === 'admin_adjustment_debit') return String(row.txn_id).replace(/^TXN-FEE-/i, 'TXN-AWDR-');
    return row.txn_id;
  }
  if (row.kind === 'signal_income') return buildAuditTxnId('SIG', row.createdAt, row.id);
  if (row.kind === 'direct_sponsor_commission') return buildAuditTxnId('DIR', row.createdAt, row.id);
  if (row.kind === 'joined_commission') return buildAuditTxnId('JIN', row.createdAt, row.id);
  if (row.kind === 'level_bonus_10day') return buildAuditTxnId('LVB', row.createdAt, row.id);
  if (row.kind === 'level_promotion_reward') return buildAuditTxnId('LVR', row.createdAt, row.id);
  if (row.kind === 'admin_adjustment_credit') return buildAuditTxnId('AVC', row.createdAt, row.id);
  if (row.kind === 'admin_adjustment_debit') return buildAuditTxnId('AVD', row.createdAt, row.id);
  return buildAuditTxnId('INC', row.createdAt, row.id);
}

function buildAdminAuditOrderRef(row) {
  if (row.kind === 'signal_income') return row.order_id || row.signal_token || row.batch_token || null;
  if (row.kind === 'direct_sponsor_commission' || row.kind === 'joined_commission') return row.reference_id || null;
  if (row.kind === 'level_bonus_10day' || row.kind === 'level_promotion_reward') return row.level_code || row.reference_id || null;
  if (row.kind === 'admin_adjustment_credit' || row.kind === 'admin_adjustment_debit') return row.reference_id || null;
  return row.reference_id || null;
}

function buildAdminAuditReferenceDetails(row) {
  if (row.kind === 'signal_income') {
    return `${row.symbol || 'BTCUSDT'} | signal code ${row.signal_token || row.batch_token || '-'}${row.order_id ? ` | order ${row.order_id}` : ''}`;
  }
  if (row.kind === 'direct_sponsor_commission') return `first deposit ref ${row.reference_id || '-'}`;
  if (row.kind === 'joined_commission') return `first deposit ref ${row.reference_id || '-'}`;
  if (row.kind === 'level_bonus_10day') return `level cycle ${row.level_code || row.reference_id || '-'}`;
  if (row.kind === 'level_promotion_reward') return `level reward ref ${row.reference_id || row.level_code || '-'}`;
  if (row.kind === 'admin_adjustment_credit') {
    return `admin virtual deposit${row.reference_id ? ` | order ${row.reference_id}` : ''}${row.asset ? ` | asset ${row.asset}` : ''}`;
  }
  if (row.kind === 'admin_adjustment_debit') {
    return `admin virtual withdrawal${row.reference_id ? ` | order ${row.reference_id}` : ''}${row.asset ? ` | asset ${row.asset}` : ''}`;
  }
  return row.reference_id ? String(row.reference_id) : '-';
}

function filterAdminAuditRows(rows, { incomeType, search, fromDate, toDate }) {
  return rows.filter((row) => {
    if (incomeType && row.incomeType !== incomeType) return false;
    if (search) {
      const haystack = [
        row.txn_id,
        row.order_id,
        row.orderRefId,
        row.signal_token,
        row.batch_token,
        row.sourceUser,
        row.sourceUserLabel,
        row.referenceDetails,
        row.level,
        row.reference_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (fromDate && new Date(row.timestamp) < new Date(fromDate)) return false;
    if (toDate && new Date(row.timestamp) > new Date(toDate)) return false;
    return true;
  });
}

async function loadAdminOrdersAuditRows(userId) {
  const [
    hasUserSignalTxnId,
    hasUserSignalOrderId,
    hasMlmIncomeTxnId,
    hasWalletTxnId,
    hasWalletSourceUserId,
    hasWalletAsset,
    hasWalletRemark,
    hasMlmAchievementTxnId,
    hasMlmBonusTxnId,
  ] = await Promise.all([
    hasColumn('user_signal_logs', 'txn_id'),
    hasColumn('user_signal_logs', 'order_id'),
    hasColumn('mlm_income_history', 'txn_id'),
    hasColumn('wallet_ledger', 'txn_id'),
    hasColumn('wallet_ledger', 'source_user_id'),
    hasColumn('wallet_ledger', 'asset'),
    hasColumn('wallet_ledger', 'remark'),
    hasColumn('mlm_level_achievements', 'txn_id'),
    hasColumn('mlm_level_bonus_payouts', 'txn_id'),
  ]);

  const [signals, directs, joins, levelBonuses, levelRewards, adminWalletAdjustments] = await Promise.all([
    db('user_signal_logs as usl')
      .select(
        'usl.id',
        hasUserSignalTxnId ? 'usl.txn_id' : db.raw('NULL as txn_id'),
        hasUserSignalOrderId ? 'usl.order_id' : db.raw('NULL as order_id'),
        'usl.batch_token',
        'usl.signal_token',
        'usl.symbol',
        'usl.trade_status',
        'usl.slot_time_snapshot',
        'usl.status',
        'usl.profit_amount',
        'usl.total_return_usdt',
        'usl.created_at as createdAt',
        db.raw("'signal_income' as kind"),
        db.raw('NULL as reference_id'),
        db.raw('NULL as source_user_email'),
        db.raw('NULL as source_user_name'),
        db.raw('NULL as source_user_id'),
        db.raw('NULL as level_code')
      )
      .where({ user_id: userId })
      .where('usl.trade_status', 'CLOSED'),
    db('mlm_income_history as m')
      .leftJoin('users as u', 'm.source_user_id', 'u.id')
      .leftJoin('user_profiles as up', 'u.id', 'up.user_id')
      .select(
        'm.id',
        hasMlmIncomeTxnId ? 'm.txn_id' : db.raw('NULL as txn_id'),
        'm.reference_id',
        'm.income_type as kind',
        'm.amount',
        'm.status',
        'm.created_at as createdAt',
        'u.email as source_user_email',
        'up.display_name as source_user_name',
        'm.source_user_id'
      )
      .where('m.user_id', userId)
      .whereIn('m.income_type', ['direct_sponsor_commission', 'joined_commission']),
    db('mlm_level_bonus_payouts as bp')
      .select(
        'bp.id',
        hasMlmBonusTxnId ? 'bp.txn_id' : db.raw('NULL as txn_id'),
        'bp.level_code',
        db.raw("'level_bonus_10day' as kind"),
        'bp.payout_amount as amount',
        'bp.status',
        'bp.created_at as createdAt',
        db.raw('NULL as reference_id'),
        db.raw('NULL as source_user_email'),
        db.raw('NULL as source_user_name'),
        db.raw('NULL as source_user_id')
      )
      .where('bp.user_id', userId),
    db('mlm_level_achievements as ma')
      .select(
        'ma.id',
        hasMlmAchievementTxnId ? 'ma.txn_id' : db.raw('NULL as txn_id'),
        'ma.level_code',
        db.raw("'level_promotion_reward' as kind"),
        'ma.promotion_reward_amount as amount',
        db.raw("'SUCCESS' as status"),
        'ma.created_at as createdAt',
        db.raw('NULL as reference_id'),
        db.raw('NULL as source_user_email'),
        db.raw('NULL as source_user_name'),
        db.raw('NULL as source_user_id')
      )
      .where('ma.user_id', userId),
    db('wallet_ledger as wl')
      .select(
        'wl.id',
        hasWalletTxnId ? 'wl.txn_id' : db.raw('NULL as txn_id'),
        'wl.reference_id',
        'wl.type as kind',
        'wl.credit',
        'wl.debit',
        'wl.status',
        hasWalletRemark ? 'wl.remark' : db.raw('NULL as remark'),
        'wl.created_at as createdAt',
        hasWalletAsset ? 'wl.asset' : db.raw("'USDT' as asset"),
        hasWalletSourceUserId ? 'wl.source_user_id' : db.raw('NULL as source_user_id'),
        db.raw('NULL as source_user_email'),
        db.raw('NULL as source_user_name'),
        db.raw('NULL as level_code')
      )
      .where('wl.user_id', userId)
      .whereIn('wl.type', ['admin_adjustment_credit', 'admin_adjustment_debit']),
  ]);

  const asRows = (value) => (Array.isArray(value) ? value : []);

  return [
    ...asRows(signals),
    ...asRows(directs),
    ...asRows(joins),
    ...asRows(levelBonuses),
    ...asRows(levelRewards),
    ...asRows(adminWalletAdjustments),
  ]
    .filter((row) => ADMIN_AUDIT_INCOME_TYPES.has(row.kind))
    .map((row) => ({
      id: row.id,
      txn_id: buildAdminAuditTxnId(row),
      order_id: row.order_id || null,
      incomeType: row.kind,
      amount:
        row.kind === 'admin_adjustment_debit'
          ? -Math.abs(Number(row.debit ?? row.amount ?? 0))
          : Number(row.profit_amount ?? row.total_earned ?? row.amount ?? row.credit ?? 0),
      status: String(row.status || 'SUCCESS'),
      sourceUser: row.source_user_email || null,
      sourceUserEmail: row.source_user_email || null,
      sourceUserName: row.source_user_name || null,
      sourceUserLabel: row.source_user_name
        ? row.source_user_email
          ? `${row.source_user_name} (${row.source_user_email})`
          : row.source_user_name
        : row.source_user_email || (row.kind.startsWith('admin_adjustment_') ? 'Admin' : null),
      source_user_id: row.source_user_id || null,
      level: row.level_code || null,
      reference_id: row.reference_id || null,
      signal_token: row.signal_token || null,
      batch_token: row.batch_token || null,
      symbol: row.symbol || null,
      asset: row.asset || null,
      remark: row.remark || null,
      referenceDetails: buildAdminAuditReferenceDetails(row),
      orderRefId: buildAdminAuditOrderRef(row),
      createdAt: row.createdAt,
      timestamp: row.createdAt,
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

router.get('/', guard, async (req, res) => {
  await ensureMlmLevelSchema();
  await ensureTelegramAccessSchema();
  await ensureTelegramAccessHistorySchema();
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 200);
  const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;
  const search = req.query.search ? String(req.query.search).trim() : undefined;
  const telegramOnly =
    String(req.query.telegramOnly ?? req.query.telegram_only ?? '')
      .trim()
      .toLowerCase() === 'true';

  const achievementRankSubquery = db('mlm_level_achievements as mla')
    .select('mla.user_id')
    .max({ highest_achieved_level_rank: 'mla.level_rank' })
    .groupBy('mla.user_id')
    .as('ach_rank');

  const query = db('users as u')
    .leftJoin('user_profiles as p', 'p.user_id', 'u.id')
    .leftJoin('referral_profiles as rp', 'rp.user_id', 'u.id')
    .leftJoin('user_position_status as ups', 'ups.user_id', 'u.id')
    .leftJoin(achievementRankSubquery, 'ach_rank.user_id', 'u.id')
    .leftJoin('mlm_level_achievements as ach', function () {
      this.on('ach.user_id', '=', 'u.id').andOn('ach.level_rank', '=', 'ach_rank.highest_achieved_level_rank');
    });
  if (['active', 'inactive', 'deleted'].includes(status)) {
    query.whereRaw('LOWER(COALESCE(u.status, ?)) = ?', ['inactive', status]);
  }
  if (search) {
    query.where((builder) => {
      builder.whereILike('u.email', `%${search}%`);
      builder.orWhereILike('p.display_name', `%${search}%`);
    });
  }
  if (telegramOnly) {
    const rows = await query
      .clone()
      .orderBy('u.created_at', 'desc')
      .select(
        'u.id',
        'u.email',
        'u.country',
        'u.kyc_level',
        'u.kyc_verified',
        'u.status',
        'u.roles',
        'u.password_hash',
        'u.current_level_code',
        'u.current_level_rank',
        'u.created_at',
        'rp.code as referral_code',
        'rp.url as referral_url',
        'ups.current_eligible_level_code',
        'ups.current_eligible_level_order',
        'ups.active_direct_count',
        'ups.active_team_count',
        'ups.direct_lv1_count',
        'ups.direct_lv7_count',
        'ups.direct_lv8_count',
        'ups.direct_lv9_count',
        'ups.is_currently_qualified',
        'ups.qualified_at',
        'ups.last_checked_at',
        'ups.next_bonus_due_at',
        'ach.level_code as highest_achieved_level_code',
        'ach_rank.highest_achieved_level_rank',
        'p.display_name',
        'p.profile_photo',
        'p.tier',
        'p.two_factor_enabled',
        'p.google_auth_secret',
        'p.telegram_username',
        'p.telegram_access_status',
        'p.telegram_access_requested_at',
        'p.telegram_access_approved_at',
        'p.telegram_access_rejected_at',
        'p.telegram_access_reject_note',
        'p.telegram_access_approved_by',
        'p.telegram_access_rejected_by',
        'u.updated_at'
      );

    await Promise.all(rows.map((row) => seedTelegramHistoryFromProfile(row.id, row)));
    const telegramHistoryByUser = await listTelegramAccessHistory(rows.map((row) => row.id));

    const flattenedItems = rows.flatMap((row) => {
      const history = telegramHistoryByUser.get(Number(row.id)) || [];
      const groupedByUsername = new Map();

      for (const entry of [...history].reverse()) {
        const usernameKey = String(entry.telegramUsername || '').trim().toLowerCase();
        if (!usernameKey) continue;
        if (!groupedByUsername.has(usernameKey)) {
          groupedByUsername.set(usernameKey, {
            latestEntry: entry,
            requestedAt: null,
            approvedAt: null,
            rejectedAt: null,
            rejectNote: null,
          });
        }
        const group = groupedByUsername.get(usernameKey);
        group.latestEntry = entry;
        if ((entry.action === 'submitted' || entry.action === 'legacy_import') && !group.requestedAt) {
          group.requestedAt = entry.createdAt || null;
        }
        if (entry.action === 'approved') {
          group.approvedAt = entry.createdAt || null;
        }
        if (entry.action === 'rejected') {
          group.rejectedAt = entry.createdAt || null;
          group.rejectNote = entry.note || null;
        }
      }

      return Array.from(groupedByUsername.values())
        .map((group) => {
          const entry = group.latestEntry;
          const normalizedEntryStatus = String(entry.status || '').trim().toLowerCase()
            || (String(entry.action || '').trim().toLowerCase() === 'submitted' ? 'pending' : String(entry.action || '').trim().toLowerCase());
          const isCurrentRecord =
            String(row.telegram_username || '').trim().toLowerCase() === String(entry.telegramUsername || '').trim().toLowerCase() &&
            normalizeTelegramAccessStatus(row) === normalizedEntryStatus;

          return {
            ...normalizeReferralIdentity(row.referral_code, row.referral_url),
            id: row.id,
            telegramHistoryEntryId: entry.id,
            telegramIsCurrentRecord: isCurrentRecord,
            email: row.email,
            displayName: row.display_name || null,
            profilePhoto: toAbsoluteProfilePhotoUrl(req, row.profile_photo),
            country: row.country,
            kycLevel: row.kyc_level || 0,
            kycVerified: !!row.kyc_verified,
            status: normalizeStatus(row),
            mainWalletBalance: Number(row.main_wallet_balance || 0),
            hasPassword: Boolean(row.password_hash),
            currentLevelCode: row.current_level_code || null,
            currentLevelRank: Number(row.current_level_rank || 0),
            currentEligibleLevelCode: row.current_eligible_level_code || row.current_level_code || null,
            currentEligibleLevelOrder: Number(row.current_eligible_level_order || row.current_level_rank || 0),
            previousAchievedLevelCode: row.highest_achieved_level_code || row.current_level_code || null,
            previousAchievedLevelRank: Number(row.highest_achieved_level_rank || row.current_level_rank || 0),
            fallbackHappened:
              Boolean(row.highest_achieved_level_code) &&
              Boolean(row.current_eligible_level_code) &&
              String(row.highest_achieved_level_code) !== String(row.current_eligible_level_code),
            isCurrentlyQualified: Boolean(row.is_currently_qualified),
            activeDirectCount: Number(row.active_direct_count || 0),
            activeTeamCount: Number(row.active_team_count || 0),
            directLv1Count: Number(row.direct_lv1_count || 0),
            directLv7Count: Number(row.direct_lv7_count || 0),
            directLv8Count: Number(row.direct_lv8_count || 0),
            directLv9Count: Number(row.direct_lv9_count || 0),
            qualifiedAt: row.qualified_at || null,
            lastCheckedAt: row.last_checked_at || null,
            nextBonusDueAt: row.next_bonus_due_at || null,
            roles: (row.roles || 'user').split(','),
            createdAt: row.created_at,
            passwordChangedAt: row.updated_at || row.created_at,
            twoFactorEnabled: row.two_factor_enabled === undefined || row.two_factor_enabled === null ? true : Boolean(row.two_factor_enabled),
            googleAuthConfigured: Boolean(row.google_auth_secret),
            tier: row.tier || null,
            telegramUsername: entry.telegramUsername || null,
            telegramAccessStatus: normalizedEntryStatus || 'not_submitted',
            telegramAccessRequestedAt: group.requestedAt,
            telegramAccessApprovedAt: group.approvedAt,
            telegramAccessRejectedAt: group.rejectedAt,
            telegramAccessRejectNote: group.rejectNote,
            telegramHistory: [entry],
          };
        })
        .sort((a, b) => {
          const aTime = new Date(a.telegramAccessRequestedAt || a.telegramAccessApprovedAt || a.telegramAccessRejectedAt || 0).getTime();
          const bTime = new Date(b.telegramAccessRequestedAt || b.telegramAccessApprovedAt || b.telegramAccessRejectedAt || 0).getTime();
          return bTime - aTime;
        });
    });

    const filteredItems = flattenedItems.filter((item) => {
      if (['active', 'inactive', 'deleted'].includes(status || '')) {
        if (String(item.status || '').toLowerCase() !== status) return false;
      }
      if (search) {
        const haystack = [
          item.email,
          item.displayName,
          item.telegramUsername,
          item.telegramAccessStatus,
          item.telegramAccessRejectNote,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });

    const total = filteredItems.length;
    const items = filteredItems.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return ok(res, {
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      items,
    });
  }

  const totalRow = await query.clone().count({ count: '*' }).first();
  const total = Number(totalRow?.count || 0);
  const rows = await query
    .clone()
    .orderBy('u.created_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .select(
      'u.id',
      'u.email',
      'u.country',
      'u.kyc_level',
        'u.kyc_verified',
        'u.status',
        'u.main_wallet_balance',
        'u.roles',
      'u.password_hash',
      'u.current_level_code',
      'u.current_level_rank',
      'u.created_at',
      'rp.code as referral_code',
      'rp.url as referral_url',
      'ups.current_eligible_level_code',
      'ups.current_eligible_level_order',
      'ups.active_direct_count',
      'ups.active_team_count',
      'ups.direct_lv1_count',
      'ups.direct_lv7_count',
      'ups.direct_lv8_count',
      'ups.direct_lv9_count',
      'ups.is_currently_qualified',
      'ups.qualified_at',
      'ups.last_checked_at',
      'ups.next_bonus_due_at',
      'ach.level_code as highest_achieved_level_code',
      'ach_rank.highest_achieved_level_rank',
      'p.display_name',
      'p.profile_photo',
      'p.tier',
      'p.two_factor_enabled',
      'p.google_auth_secret',
      'p.telegram_username',
      'p.telegram_access_status',
      'p.telegram_access_requested_at',
      'p.telegram_access_approved_at',
      'p.telegram_access_rejected_at',
      'p.telegram_access_reject_note',
      'p.telegram_access_approved_by',
      'p.telegram_access_rejected_by',
      'u.updated_at'
    );

  ok(res, {
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
    items: rows.map((row) => mapAdminUserRow(req, row)),
  });
});

router.get('/:id', guard, async (req, res) => {
  await ensureMlmLevelSchema();
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return fail(res, 'Invalid user ID', 400);

  const achievementRankSubquery = db('mlm_level_achievements as mla')
    .select('mla.user_id')
    .max({ highest_achieved_level_rank: 'mla.level_rank' })
    .groupBy('mla.user_id')
    .as('ach_rank');

  const row = await db('users as u')
    .leftJoin('user_profiles as p', 'p.user_id', 'u.id')
    .leftJoin('referral_profiles as rp', 'rp.user_id', 'u.id')
    .leftJoin('user_position_status as ups', 'ups.user_id', 'u.id')
    .leftJoin(achievementRankSubquery, 'ach_rank.user_id', 'u.id')
    .leftJoin('mlm_level_achievements as ach', function () {
      this.on('ach.user_id', '=', 'u.id').andOn('ach.level_rank', '=', 'ach_rank.highest_achieved_level_rank');
    })
    .where('u.id', id)
    .first(
      'u.id',
      'u.email',
      'u.country',
      'u.kyc_level',
      'u.kyc_verified',
      'u.status',
      'u.main_wallet_balance',
      'u.roles',
      'u.password_hash',
      'u.current_level_code',
      'u.current_level_rank',
      'u.created_at',
      'rp.code as referral_code',
      'rp.url as referral_url',
      'ups.current_eligible_level_code',
      'ups.current_eligible_level_order',
      'ups.active_direct_count',
      'ups.active_team_count',
      'ups.direct_lv1_count',
      'ups.direct_lv7_count',
      'ups.direct_lv8_count',
      'ups.direct_lv9_count',
      'ups.is_currently_qualified',
      'ups.qualified_at',
      'ups.last_checked_at',
      'ups.next_bonus_due_at',
      'ach.level_code as highest_achieved_level_code',
      'ach_rank.highest_achieved_level_rank',
      'p.display_name',
      'p.profile_photo',
      'p.tier',
      'p.two_factor_enabled',
      'p.google_auth_secret',
      'p.telegram_username',
      'p.telegram_access_status',
      'p.telegram_access_requested_at',
      'p.telegram_access_approved_at',
      'p.telegram_access_rejected_at',
      'p.telegram_access_reject_note',
      'u.updated_at'
    );

  if (!row) return fail(res, 'User not found', 404);
  return ok(res, mapAdminUserRow(req, row));
});

router.get('/:id/orders-audit', guard, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId) || userId <= 0) return fail(res, 'Invalid user ID', 400);
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const search = normalizeAuditText(req.query.search);
    const incomeType = normalizeAuditText(req.query.incomeType);
    const fromDate = req.query.fromDate ? `${req.query.fromDate} 00:00:00` : null;
    const toDate = req.query.toDate ? `${req.query.toDate} 23:59:59` : null;

    let rows = await loadAdminOrdersAuditRows(userId);
    rows = filterAdminAuditRows(rows, { incomeType, search, fromDate, toDate });

    const total = rows.length;
    const items = rows.slice((page - 1) * limit, (page - 1) * limit + limit);
    ok(res, {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    });
  } catch (err) {
    fail(res, err.message || 'Failed to load user orders audit history', err.status || 400);
  }
});

router.patch('/:id/status', guard, async (req, res) => {
  await ensureMlmLevelSchema();
  const id = Number(req.params.id);
  const status = String(req.body?.status || '').toLowerCase();
  if (!['active', 'inactive'].includes(status)) {
    return fail(res, 'Invalid status', 400);
  }
  try {
    await db('users')
      .where({ id })
      .update({
        status,
        kyc_verified: status === 'active',
        updated_at: new Date(),
      });
    await recalculateMlmForUser(id);
    ok(res, { id, status });
  } catch (err) {
    fail(res, err.message || 'Unable to update status', 400);
  }
});

router.post('/:id/telegram-access/approve', guard, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return fail(res, 'Invalid user ID', 400);
  }
  try {
    ok(res, await approveUserTelegramAccess(req.user.id, userId));
  } catch (err) {
    fail(res, err.message || 'Unable to approve Telegram access', err.status || 400);
  }
});

router.post('/:id/telegram-access/reject', guard, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return fail(res, 'Invalid user ID', 400);
  }
  try {
    ok(res, await rejectUserTelegramAccess(req.user.id, userId, req.body?.note));
  } catch (err) {
    fail(res, err.message || 'Unable to reject Telegram access', err.status || 400);
  }
});

export default router;
