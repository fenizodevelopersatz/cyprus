import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok, fail } from '../../utils/responses.js';
import { db } from '../../db.js';
import { ensureMlmLevelSchema, recalculateMlmForUser } from '../../services/mlmLevelService.js';
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

function mapAdminUserRow(req, row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || null,
    profilePhoto: toAbsoluteProfilePhotoUrl(req, row.profile_photo),
    country: row.country,
    kycLevel: row.kyc_level || 0,
    kycVerified: !!row.kyc_verified,
    status: normalizeStatus(row),
    hasPassword: Boolean(row.password_hash),
    currentLevelCode: row.current_level_code || null,
    currentLevelRank: Number(row.current_level_rank || 0),
    referralCode: row.referral_code || null,
    referralUrl: row.referral_url || null,
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
            hasPassword: Boolean(row.password_hash),
            currentLevelCode: row.current_level_code || null,
            currentLevelRank: Number(row.current_level_rank || 0),
            referralCode: row.referral_code || null,
            referralUrl: row.referral_url || null,
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
