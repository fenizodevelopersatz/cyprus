import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok, fail } from '../../utils/responses.js';
import { db } from '../../db.js';
import { ensureMlmLevelSchema, recalculateMlmForUser } from '../../services/mlmLevelService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

function normalizeStatus(user) {
  const normalized = String(user.status || '').trim().toLowerCase();
  if (['active', 'inactive', 'deleted'].includes(normalized)) return normalized;
  return 'inactive';
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

router.get('/', guard, async (req, res) => {
  await ensureMlmLevelSchema();
  const page = Math.max(Number(req.query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 25, 1), 200);
  const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;
  const search = req.query.search ? String(req.query.search).trim() : undefined;

  const achievementRankSubquery = db('mlm_level_achievements as mla')
    .select('mla.user_id')
    .max({ highest_achieved_level_rank: 'mla.level_rank' })
    .groupBy('mla.user_id')
    .as('ach_rank');

  const query = db('users as u')
    .leftJoin('user_profiles as p', 'p.user_id', 'u.id')
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
      'u.updated_at'
    );

  ok(res, {
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
    items: rows.map((row) => ({
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
    })),
  });
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

export default router;
