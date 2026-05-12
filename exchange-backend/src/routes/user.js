// =============================
// src/routes/user.js
// =============================

/**
 * @openapi
 * tags:
 *   - name: User
 *     description: Profile & password management
 */

/**
 * @openapi
 * /user/profile:
 *   get:
 *     summary: Get profile
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - User
 *     responses:
 *       200:
 *         description: Profile object
 *   patch:
 *     summary: Update profile
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - User
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated profile
 */

/**
 * @openapi
 * /user/password:
 *   post:
 *     summary: Change password
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - User
 *     responses:
 *       200:
 *         description: Password changed
 */

/**
 * @openapi
 * /user/account:
 *   delete:
 *     summary: Permanently delete the authenticated user's account
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - User
 *     responses:
 *       200:
 *         description: Account deleted
 */

import express from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/responses.js';
import {
  getProfile,
  updateProfile,
  changePassword,
  beginGoogleAuthenticatorSetup,
  enableGoogleAuthenticator,
  disableGoogleAuthenticator,
  deleteAccount,
} from '../services/userService.js';
import {
  getUserSignalWalletSummary,
  validateUserSignalToken,
  applyUserSignal,
  getUserSignalHistory,
} from '../services/userSignalService.js';
import {
  getUserDepositBalanceHistory,
  getUserMlmIncomeHistory,
  getUserSignalIncomeHistory,
  getUserWalletLedger,
  getUserWalletSummary,
} from '../services/walletAccountingService.js';
import { v } from '../middleware/validate.js';

const AUDIT_INCOME_TYPES = new Set([
  'signal_income',
  'direct_sponsor_commission',
  'joined_commission',
  'level_bonus_10day',
  'level_promotion_reward',
  'admin_adjustment_credit',
  'admin_adjustment_debit',
]);

const AUDIT_LABELS = {
  signal_income: 'Signal Income',
  direct_sponsor_commission: 'Direct Sponsor Income',
  joined_commission: 'Joined Commission',
  level_bonus_10day: '10-Day Level Income',
  level_promotion_reward: 'Level Reward',
  admin_adjustment_credit: 'admin_deposit',
  admin_adjustment_debit: 'admin_withdraw',
};

const AUDIT_GROUPS = {
  signal_income: ['signal_income'],
  direct: ['direct_sponsor_commission'],
  joined: ['joined_commission'],
  level: ['level_bonus_10day', 'level_promotion_reward'],
};

const toNumber = (value) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const toMoneyString = (value) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
};

const parseDateBound = (value, endOfDay = false) => {
  if (!value) return null;
  return `${value} ${endOfDay ? '23:59:59' : '00:00:00'}`;
};

const normalizeText = (value) => String(value ?? '').trim().toLowerCase();

const formatDateKey = (value) => new Date(value || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');

const buildTxnId = (prefix, eventAt, id) => `${prefix}-${formatDateKey(eventAt)}-${String(Number(id) || 0).padStart(6, '0')}`;

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

function buildAuditTxnId(row) {
  if (row.txn_id) {
    if (row.kind === 'admin_adjustment_credit') return String(row.txn_id).replace(/^TXN-FEE-/i, 'TXN-ADEP-');
    if (row.kind === 'admin_adjustment_debit') return String(row.txn_id).replace(/^TXN-FEE-/i, 'TXN-AWDR-');
    return row.txn_id;
  }
  if (row.kind === 'signal_income') return buildTxnId('SIG', row.createdAt, row.id);
  if (row.kind === 'direct_sponsor_commission') return buildTxnId('DIR', row.createdAt, row.id);
  if (row.kind === 'joined_commission') return buildTxnId('JIN', row.createdAt, row.id);
  if (row.kind === 'level_bonus_10day') return buildTxnId('LVB', row.createdAt, row.id);
  if (row.kind === 'level_promotion_reward') return buildTxnId('LVR', row.createdAt, row.id);
  if (row.kind === 'admin_adjustment_credit') return buildTxnId('AVC', row.createdAt, row.id);
  if (row.kind === 'admin_adjustment_debit') return buildTxnId('AVD', row.createdAt, row.id);
  return buildTxnId('INC', row.createdAt, row.id);
}

function buildOrderRef(row) {
  if (row.kind === 'signal_income') return row.order_id || row.signal_token || row.batch_token || null;
  if (row.kind === 'direct_sponsor_commission' || row.kind === 'joined_commission') return row.reference_id || null;
  if (row.kind === 'level_bonus_10day' || row.kind === 'level_promotion_reward') return row.level_code || row.reference_id || null;
  if (row.kind === 'admin_adjustment_credit' || row.kind === 'admin_adjustment_debit') return row.reference_id || null;
  return row.reference_id || null;
}

function buildReferenceDetails(row) {
  if (row.kind === 'signal_income') {
    return `${row.symbol || 'BTCUSDT'} | signal code ${row.signal_token || row.batch_token || '-'}${row.order_id ? ` | order ${row.order_id}` : ''}`;
  }
  if (row.kind === 'direct_sponsor_commission') {
    return `first deposit ref ${row.reference_id || '-'}`;
  }
  if (row.kind === 'joined_commission') {
    return `first deposit ref ${row.reference_id || '-'}`;
  }
  if (row.kind === 'level_bonus_10day') {
    return `level cycle ${row.level_code || row.reference_id || '-'}`;
  }
  if (row.kind === 'level_promotion_reward') {
    return `level reward ref ${row.reference_id || row.level_code || '-'}`;
  }
  if (row.kind === 'admin_adjustment_credit') {
    return `admin virtual deposit${row.reference_id ? ` | order ${row.reference_id}` : ''}${row.asset ? ` | asset ${row.asset}` : ''}`;
  }
  if (row.kind === 'admin_adjustment_debit') {
    return `admin virtual withdrawal${row.reference_id ? ` | order ${row.reference_id}` : ''}${row.asset ? ` | asset ${row.asset}` : ''}`;
  }
  return row.reference_id ? String(row.reference_id) : '-';
}

function filterOrdersAuditRows(rows, { incomeType, search, fromDate, toDate }) {
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

async function loadOrdersAuditRows(userId) {
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
    db('mlm_income_history as mh')
      .leftJoin('mlm_level_achievements as ma', function joinAchievements() {
        this.on('ma.user_id', '=', 'mh.user_id').andOn('ma.level_code', '=', 'mh.income_type');
      })
      .select(
        'mh.id',
        hasMlmIncomeTxnId ? 'mh.txn_id' : db.raw('NULL as txn_id'),
        'mh.reference_id',
        'mh.income_type as kind',
        'mh.amount',
        'mh.status',
        'mh.created_at as createdAt',
        'ma.level_code',
        db.raw('NULL as source_user_name')
      )
      .where('mh.user_id', userId)
      .whereIn('mh.income_type', ['level_bonus_10day', 'level_promotion_reward']),
    db('mlm_level_bonus_payouts as bp')
      .select(
        'bp.id',
        hasMlmBonusTxnId ? 'bp.txn_id' : db.raw('NULL as txn_id'),
        'bp.level_code',
        db.raw("CASE WHEN COALESCE(bp.level_code, '') = '' THEN 'level_bonus_10day' ELSE 'level_promotion_reward' END as kind"),
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

  const combined = [...signals, ...directs, ...joins, ...levelBonuses, ...levelRewards, ...adminWalletAdjustments]
    .filter((row) => AUDIT_INCOME_TYPES.has(row.kind))
    .map((row) => ({
      id: row.id,
      txn_id: buildAuditTxnId(row),
      order_id: row.order_id || null,
      incomeType: row.kind,
      incomeTypeLabel: AUDIT_LABELS[row.kind],
      amount:
        row.kind === 'admin_adjustment_debit'
          ? -Math.abs(toNumber(row.debit ?? row.amount))
          : toNumber(row.profit_amount ?? row.total_earned ?? row.amount ?? row.credit),
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
      referenceDetails: buildReferenceDetails(row),
      orderRefId: buildOrderRef(row),
      createdAt: row.createdAt,
      timestamp: row.createdAt,
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return combined;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for profile photos
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

const r = express.Router();

function toAbsoluteProfilePhotoUrl(req, value) {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
    .split(',')[0]
    .trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  if (!forwardedHost) return value;
  return `${forwardedProto}://${forwardedHost}${value.startsWith('/') ? value : `/${value}`}`;
}

function parseProfileUpload(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('profile_photo')(req, res, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

r.get('/profile', requireAuth, async (req, res) => {
  const profile = await getProfile(req.user.id);
  ok(res, {
    ...profile,
    profile_photo: toAbsoluteProfilePhotoUrl(req, profile.profile_photo),
  });
});

r.patch('/profile', requireAuth, async (req, res) => {
  try {
    await parseProfileUpload(req, res);
    const profile = await updateProfile(req.user.id, req.body, req.file);
    ok(res, {
      ...profile,
      profile_photo: toAbsoluteProfilePhotoUrl(req, profile.profile_photo),
    });
  } catch (err) {
    const message =
      err?.code === 'LIMIT_FILE_SIZE'
        ? 'Profile photo must be smaller than 5MB'
        : err?.message || 'Unable to update profile';
    fail(res, message, 400);
  }
});

r.post(
  '/password',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      currentPassword: v.Joi.string().required(),
      newPassword: v.Joi.string().min(8).required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      await changePassword(req.user.id, req.body.currentPassword, req.body.newPassword);
      ok(res, { changed: true });
    } catch (err) {
      fail(res, err.message || 'Unable to change password', 400);
    }
  }
);

r.post('/two-factor/setup', requireAuth, async (req, res) => {
  try {
    ok(res, await beginGoogleAuthenticatorSetup(req.user.id));
  } catch (err) {
    fail(res, err.message || 'Unable to start Google Authenticator setup', 400);
  }
});

r.post(
  '/two-factor/enable',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      code: v.Joi.string().length(6).required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await enableGoogleAuthenticator(req.user.id, req.body.code));
    } catch (err) {
      fail(res, err.message || 'Unable to enable Google Authenticator', 400);
    }
  }
);

r.post(
  '/two-factor/disable',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      code: v.Joi.string().length(6).required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await disableGoogleAuthenticator(req.user.id, req.body.code));
    } catch (err) {
      fail(res, err.message || 'Unable to disable Google Authenticator', 400);
    }
  }
);

r.delete('/account', requireAuth, async (req, res) => {
  try {
    await deleteAccount(req.user.id);
    ok(res, { deleted: true });
  } catch (err) {
    fail(res, err.message || 'Unable to delete account', 400);
  }
});

r.get('/wallet-summary', requireAuth, async (req, res) => {
  try {
    const walletSummary = await getUserWalletSummary(req.user.id);
    const signalSummary = await getUserSignalWalletSummary(req.user.id, new Date(), { walletSummary });
    const summary = {
      ...signalSummary,
      main_wallet_balance: toMoneyString(walletSummary.mainWalletBalance),
      signal_income_total: toMoneyString(walletSummary.signalIncomeTotal),
      mlm_income_total: toMoneyString(walletSummary.mlmIncomeTotal),
      total_earnings: toMoneyString(walletSummary.totalEarnings),
      available_balance: toMoneyString(walletSummary.availableBalance),
    };
    ok(res, summary);
  } catch (err) {
    fail(res, err.message || 'Failed to load wallet summary', err.status || 400);
  }
});

r.get('/wallet-history/deposits', requireAuth, async (req, res) => {
  try {
    ok(res, await getUserDepositBalanceHistory(req.user.id));
  } catch (err) {
    fail(res, err.message || 'Failed to load deposit history', err.status || 400);
  }
});

r.get('/wallet-history/signals', requireAuth, async (req, res) => {
  try {
    ok(res, await getUserSignalIncomeHistory(req.user.id));
  } catch (err) {
    fail(res, err.message || 'Failed to load signal income history', err.status || 400);
  }
});

r.get('/wallet-history/mlm', requireAuth, async (req, res) => {
  try {
    ok(res, await getUserMlmIncomeHistory(req.user.id));
  } catch (err) {
    fail(res, err.message || 'Failed to load MLM income history', err.status || 400);
  }
});

r.get('/wallet-history/ledger', requireAuth, async (req, res) => {
  try {
    ok(res, await getUserWalletLedger(req.user.id));
  } catch (err) {
    fail(res, err.message || 'Failed to load wallet ledger', err.status || 400);
  }
});

r.get(
  '/orders-audit/summary',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      incomeType: v.Joi.string().trim().optional(),
      search: v.Joi.string().trim().allow('').optional(),
      fromDate: v.Joi.string().trim().allow('').optional(),
      toDate: v.Joi.string().trim().allow('').optional(),
    }).unknown(false),
  }),
  async (req, res) => {
  try {
    const search = normalizeText(req.query.search);
    const incomeType = normalizeText(req.query.incomeType);
    const fromDate = parseDateBound(req.query.fromDate);
    const toDate = parseDateBound(req.query.toDate, true);

    let rows = await loadOrdersAuditRows(req.user.id);
    rows = filterOrdersAuditRows(rows, { incomeType, search, fromDate, toDate });
    const summary = rows.reduce(
      (acc, row) => {
        if (row.incomeType === 'signal_income') {
          acc.totalSignalIncome += row.amount;
          acc.totalCombinedIncome += row.amount;
        }
        if (row.incomeType === 'direct_sponsor_commission') {
          acc.totalDirectIncome += row.amount;
          acc.totalCombinedIncome += row.amount;
        }
        if (row.incomeType === 'joined_commission') {
          acc.totalJoinedIncome += row.amount;
          acc.totalCombinedIncome += row.amount;
        }
        if (row.incomeType === 'level_bonus_10day' || row.incomeType === 'level_promotion_reward') {
          acc.totalLevelIncome += row.amount;
          acc.totalCombinedIncome += row.amount;
        }
        return acc;
      },
      {
        totalSignalIncome: 0,
        totalDirectIncome: 0,
        totalJoinedIncome: 0,
        totalLevelIncome: 0,
        totalCombinedIncome: 0,
      }
    );
    ok(res, summary);
  } catch (err) {
    fail(res, err.message || 'Failed to load orders audit summary', err.status || 400);
  }
});

r.get(
  '/orders-audit',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      page: v.Joi.number().integer().min(1).optional(),
      limit: v.Joi.number().integer().min(1).max(100).optional(),
      incomeType: v.Joi.string().trim().optional(),
      search: v.Joi.string().trim().allow('').optional(),
      fromDate: v.Joi.string().trim().allow('').optional(),
      toDate: v.Joi.string().trim().allow('').optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
      const search = normalizeText(req.query.search);
      const incomeType = normalizeText(req.query.incomeType);
      const fromDate = parseDateBound(req.query.fromDate);
      const toDate = parseDateBound(req.query.toDate, true);

      let rows = await loadOrdersAuditRows(req.user.id);
      rows = filterOrdersAuditRows(rows, { incomeType, search, fromDate, toDate });

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
      fail(res, err.message || 'Failed to load orders audit history', err.status || 400);
    }
  }
);

r.post(
  '/signals/validate',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      token: v.Joi.string().trim().required(),
      slot_key: v.Joi.string().trim().required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const result = await validateUserSignalToken({
        userId: req.user.id,
        token: req.body.token,
        slotKey: req.body.slot_key,
      });
      ok(res, result);
    } catch (err) {
      fail(res, err.message || 'Invalid signal code.', err.status || 400);
    }
  }
);

r.post(
  '/signals/apply',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      token: v.Joi.string().trim().required(),
      slot_key: v.Joi.string().trim().required(),
      audit_json: v.Joi.object().required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const result = await applyUserSignal({
        userId: req.user.id,
        token: req.body.token,
        slotKey: req.body.slot_key,
        auditJson: req.body.audit_json,
      });
      ok(res, result);
    } catch (err) {
      fail(res, err.message || 'Unable to apply signal', err.status || 400);
    }
  }
);

r.get('/signals/history', requireAuth, async (req, res) => {
  try {
    const history = await getUserSignalHistory(req.user.id);
    ok(res, history);
  } catch (err) {
    fail(res, err.message || 'Failed to load signal history', err.status || 400);
  }
});

export default r;
