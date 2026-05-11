import express from 'express';
import { db } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok, fail } from '../../utils/responses.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

const toNumber = (value) => {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
};

const clamp = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(num, min), max);
};

const normalizeText = (value) => String(value ?? '').trim().toLowerCase();

const incomeTypes = [
  'direct_sponsor_commission',
  'joined_commission',
  'level_bonus_10day',
  'level_promotion_reward',
  'signal_income',
  'admin_adjustment_credit',
  'admin_adjustment_debit',
];
const txnPrefixes = {
  direct_sponsor_commission: 'DIR',
  joined_commission: 'JIN',
  level_bonus_10day: 'LVB',
  level_promotion_reward: 'LVR',
  signal_income: 'SIG',
  admin_adjustment_credit: 'AVC',
  admin_adjustment_debit: 'AVD',
};
let referralCodeExistsPromise = null;
function referralCodeExists() {
  if (!referralCodeExistsPromise) {
    referralCodeExistsPromise = db('information_schema.columns')
      .where({ table_schema: db.raw('DATABASE()'), table_name: 'users', column_name: 'referral_code' })
      .first('column_name')
      .then((row) => !!row)
      .catch(() => false);
  }
  return referralCodeExistsPromise;
}

let displayNameExistsPromise = null;
function displayNameExists() {
  if (!displayNameExistsPromise) {
    displayNameExistsPromise = db('information_schema.columns')
      .where({ table_schema: db.raw('DATABASE()'), table_name: 'users', column_name: 'display_name' })
      .first('column_name')
      .then((row) => !!row)
      .catch(() => false);
  }
  return displayNameExistsPromise;
}

function parseDateBound(value, endOfDay = false) {
  if (!value) return null;
  return endOfDay ? `${value} 23:59:59` : `${value} 00:00:00`;
}

function padId(value, length = 6) {
  return String(Number(value) || 0).padStart(length, '0');
}

function buildTxnId(incomeType, eventAt, id) {
  const prefix = txnPrefixes[incomeType] || 'INC';
  const day = new Date(eventAt || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
  return `${prefix}-${day}-${padId(id)}`;
}

function normalizeLedgerTxnId(incomeType, txnId) {
  if (!txnId) return txnId;
  if (incomeType === 'admin_adjustment_credit') return String(txnId).replace(/^TXN-FEE-/i, 'TXN-ADEP-');
  if (incomeType === 'admin_adjustment_debit') return String(txnId).replace(/^TXN-FEE-/i, 'TXN-AWDR-');
  return txnId;
}

function buildOrderId(eventAt, id) {
  const day = new Date(eventAt || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
  return `ORD-${day}-${padId(id)}`;
}

async function hasColumn(tableName, columnName) {
  const row = await db('information_schema.columns')
    .where({ table_schema: db.raw('DATABASE()'), table_name: tableName, column_name: columnName })
    .first('column_name');
  return !!row;
}

async function loadLedgerRows() {
  const hasReferralCode = await referralCodeExists();
  const hasDisplayName = await displayNameExists();
  const hasWalletTxnId = await hasColumn('wallet_ledger', 'txn_id');
  const hasWalletAsset = await hasColumn('wallet_ledger', 'asset');
  const hasWalletRemark = await hasColumn('wallet_ledger', 'remark');
  const hasLevelTxnId = await hasColumn('mlm_level_bonus_payouts', 'txn_id');
  const hasAchievementTxnId = await hasColumn('mlm_level_achievements', 'txn_id');
  const hasSignalTxnId = await hasColumn('user_signal_logs', 'txn_id');
  const hasSignalOrderId = await hasColumn('user_signal_logs', 'order_id');
  const referralCodeSelect = hasReferralCode ? 'u.referral_code as referralCode' : db.raw('NULL as referralCode');
  const userNameSelect = hasDisplayName ? 'u.display_name as userName' : db.raw('NULL as userName');
  const [referrals, levels, signals, adminAdjustments] = await Promise.all([
    db('wallet_ledger as wl')
      .leftJoin('users as u', 'u.id', 'wl.user_id')
      .select(
        'wl.id',
        'wl.user_id as userId',
        'u.email as userEmail',
        userNameSelect,
        referralCodeSelect,
        hasWalletTxnId ? 'wl.txn_id as txn_id' : db.raw('NULL as txn_id'),
        'wl.source_type as incomeType',
        'wl.reference_id as reference',
        db.raw('NULL as sourceUserId'),
        db.raw('NULL as sourceUser'),
        db.raw('NULL as level'),
        'wl.credit as amount',
        'wl.status as status',
        'wl.created_at as createdAt'
      )
      .whereIn('wl.source_type', ['direct_sponsor_commission', 'joined_commission']),
    db('mlm_level_bonus_payouts as bp')
      .leftJoin('users as u', 'u.id', 'bp.user_id')
      .select(
        'bp.id',
        'bp.user_id as userId',
        'u.email as userEmail',
        userNameSelect,
        referralCodeSelect,
        hasLevelTxnId ? 'bp.txn_id as txn_id' : db.raw('NULL as txn_id'),
        db.raw(`CASE WHEN COALESCE(bp.level_code, '') = '' THEN 'level_bonus_10day' ELSE 'level_promotion_reward' END as incomeType`),
        'bp.level_code as reference',
        db.raw('NULL as sourceUserId'),
        db.raw('NULL as sourceUser'),
        'bp.level_code as level',
        'bp.payout_amount as amount',
        'bp.status as status',
        'bp.created_at as createdAt'
      ),
    db('user_signal_logs as usl')
      .leftJoin('users as u', 'u.id', 'usl.user_id')
      .select(
        'usl.id',
        'usl.user_id as userId',
        'u.email as userEmail',
        userNameSelect,
        referralCodeSelect,
        hasSignalTxnId ? 'usl.txn_id as txn_id' : db.raw('NULL as txn_id'),
        hasSignalOrderId ? 'usl.order_id as order_id' : db.raw('NULL as order_id'),
        db.raw(`'signal_income' as incomeType`),
        db.raw(`COALESCE(usl.signal_token, usl.batch_token, usl.id) as reference`),
        db.raw('NULL as sourceUserId'),
        db.raw('NULL as sourceUser'),
        db.raw('NULL as level'),
        'usl.total_earned as amount',
        'usl.status as status',
        'usl.created_at as createdAt'
      )
      .whereNotNull('usl.total_earned'),
    db('wallet_ledger as wl')
      .leftJoin('users as u', 'u.id', 'wl.user_id')
      .select(
        'wl.id',
        'wl.user_id as userId',
        'u.email as userEmail',
        userNameSelect,
        referralCodeSelect,
        hasWalletTxnId ? 'wl.txn_id as txn_id' : db.raw('NULL as txn_id'),
        'wl.type as incomeType',
        'wl.reference_id as reference',
        db.raw('NULL as sourceUserId'),
        db.raw('NULL as sourceUser'),
        db.raw('NULL as level'),
        hasWalletAsset ? 'wl.asset' : db.raw("'USDT' as asset"),
        hasWalletRemark ? 'wl.remark' : db.raw('NULL as remark'),
        'wl.credit',
        'wl.debit',
        'wl.status as status',
        'wl.created_at as createdAt'
      )
      .whereIn('wl.type', ['admin_adjustment_credit', 'admin_adjustment_debit']),
  ]);

  return [...referrals, ...levels, ...signals, ...adminAdjustments]
    .filter((row) => incomeTypes.includes(row.incomeType))
    .map((row) => ({
      id: row.id,
      txn_id: normalizeLedgerTxnId(row.incomeType, row.txn_id) || buildTxnId(row.incomeType, row.createdAt, row.id),
      order_id:
        row.order_id ||
        (row.incomeType === 'signal_income'
          ? buildOrderId(row.createdAt, row.id)
          : row.incomeType === 'admin_adjustment_credit' || row.incomeType === 'admin_adjustment_debit'
            ? row.reference || null
            : null),
      userId: row.userId,
      primary_user_id: row.userId,
      userName: row.userName || `User #${row.userId}`,
      userEmail: row.userEmail || '',
      referralCode: row.referralCode || null,
      incomeType: row.incomeType,
      source_user_id: row.sourceUserId || null,
      sourceUserId: row.sourceUserId || null,
      sourceUser: row.sourceUser || null,
      reference_type: row.incomeType,
      reference_id: row.reference || null,
      level: row.level || null,
      reference: row.reference || null,
      asset: row.asset || null,
      remark: row.remark || null,
      amount:
        row.incomeType === 'admin_adjustment_debit'
          ? -Math.abs(toNumber(row.debit))
          : toNumber(row.amount ?? row.credit),
      status: String(row.status || 'SUCCESS'),
      event_at: row.createdAt,
      createdAt: row.createdAt,
      updated_at: row.createdAt,
    }));
}

function applyFilters(rows, query) {
  const search = normalizeText(query.search);
  const incomeType = normalizeText(query.incomeType);
  const level = normalizeText(query.level);
  const status = normalizeText(query.status);
  const fromDate = parseDateBound(query.fromDate);
  const toDate = parseDateBound(query.toDate, true);

  return rows.filter((row) => {
    if (search) {
      const haystack = [
        row.userName,
        row.userEmail,
        String(row.userId),
        row.referralCode,
        row.reference,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (incomeType && row.incomeType !== incomeType) return false;
    if (level && !normalizeText(row.level).includes(level)) return false;
    if (status && normalizeText(row.status) !== status) return false;
    const rowEventAt = row.event_at || row.createdAt;
    if (fromDate && new Date(rowEventAt) < new Date(fromDate)) return false;
    if (toDate && new Date(rowEventAt) > new Date(toDate)) return false;
    return true;
  });
}

function paginate(rows, page, limit) {
  const total = rows.length;
  const totalPages = Math.ceil(total / limit);
  return {
    items: rows.slice((page - 1) * limit, (page - 1) * limit + limit),
    pagination: { page, limit, total, totalPages },
  };
}

function summarize(rows) {
  const summary = {
    totalDirectSponsorIncome: 0,
    totalJoinedIncome: 0,
    totalLevelBonus10DayIncome: 0,
    totalLevelPromotionRewardIncome: 0,
    totalSignalIncome: 0,
    totalCombinedIncome: 0,
    totalBeneficiaryUsers: 0,
  };
  const users = new Set();
  for (const row of rows) {
    users.add(row.userId);
    summary.totalCombinedIncome += row.amount;
    if (row.incomeType === 'direct_sponsor_commission') summary.totalDirectSponsorIncome += row.amount;
    if (row.incomeType === 'joined_commission') summary.totalJoinedIncome += row.amount;
    if (row.incomeType === 'level_bonus_10day') summary.totalLevelBonus10DayIncome += row.amount;
    if (row.incomeType === 'level_promotion_reward') summary.totalLevelPromotionRewardIncome += row.amount;
    if (row.incomeType === 'signal_income') summary.totalSignalIncome += row.amount;
  }
  summary.totalBeneficiaryUsers = users.size;
  return summary;
}

function filterByGroup(rows, group) {
  if (!group) return rows;
  const allowed = group === 'referral'
    ? ['direct_sponsor_commission', 'joined_commission']
    : group === 'level'
      ? ['level_bonus_10day', 'level_promotion_reward']
      : group === 'signal'
        ? ['signal_income']
        : group === 'admin'
          ? ['admin_adjustment_credit', 'admin_adjustment_debit']
        : incomeTypes;
  return rows.filter((row) => allowed.includes(row.incomeType));
}

router.get('/income-ledger/summary', guard, async (req, res) => {
  try {
    const rows = await loadLedgerRows();
    ok(res, summarize(rows));
  } catch (error) {
    fail(res, error?.message || 'Failed to load income summary', error?.status || 500);
  }
});

router.get('/income-ledger', guard, async (req, res) => {
  try {
    const page = clamp(req.query.page, 1, 100000, 1);
    const limit = clamp(req.query.limit, 1, 100, 20);
    const group = normalizeText(req.query.group);
    const rows = filterByGroup(await loadLedgerRows(), group);
    const filtered = applyFilters(rows, req.query).sort((a, b) => {
      const timeDiff = new Date(b.event_at || b.createdAt) - new Date(a.event_at || a.createdAt);
      if (timeDiff !== 0) return timeDiff;
      const createdDiff = new Date(b.createdAt) - new Date(a.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return Number(b.id) - Number(a.id);
    });
    ok(res, paginate(filtered, page, limit));
  } catch (error) {
    fail(res, error?.message || 'Failed to load income ledger', error?.status || 500);
  }
});

router.get('/income-ledger/user-summary', guard, async (req, res) => {
  try {
    const page = clamp(req.query.page, 1, 100000, 1);
    const limit = clamp(req.query.limit, 1, 100, 20);
    const rows = applyFilters(await loadLedgerRows(), req.query);
    const grouped = new Map();
    for (const row of rows) {
      const current = grouped.get(row.userId) || {
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
        referralCode: row.referralCode,
        totalIncome: 0,
        directSponsor: 0,
        joined: 0,
        levelBonus: 0,
        levelReward: 0,
        signalIncome: 0,
        records: 0,
      };
      current.totalIncome += row.amount;
      current.records += 1;
      if (row.incomeType === 'direct_sponsor_commission') current.directSponsor += row.amount;
      if (row.incomeType === 'joined_commission') current.joined += row.amount;
      if (row.incomeType === 'level_bonus_10day') current.levelBonus += row.amount;
      if (row.incomeType === 'level_promotion_reward') current.levelReward += row.amount;
      if (row.incomeType === 'signal_income') current.signalIncome += row.amount;
      grouped.set(row.userId, current);
    }
    const items = Array.from(grouped.values()).sort((a, b) => b.totalIncome - a.totalIncome);
    ok(res, paginate(items, page, limit));
  } catch (error) {
    fail(res, error?.message || 'Failed to load user income summary', error?.status || 500);
  }
});

router.get('/income-ledger/export', guard, async (req, res) => {
  try {
    const rows = applyFilters(await loadLedgerRows(), req.query).sort((a, b) => {
      const timeDiff = new Date(b.event_at || b.createdAt) - new Date(a.event_at || a.createdAt);
      if (timeDiff !== 0) return timeDiff;
      const createdDiff = new Date(b.createdAt) - new Date(a.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return Number(b.id) - Number(a.id);
    });
    const header = ['txn_id', 'order_id', 'income_type', 'primary_user_id', 'primary_user_name', 'source_user_id', 'source_user_name', 'reference_type', 'reference_id', 'amount', 'status', 'event_at', 'created_at', 'updated_at'];
    const csv = [
      header.join(','),
      ...rows.map((row) =>
        [
          row.txn_id,
          row.order_id || '',
          row.incomeType,
          row.primary_user_id,
          row.userName,
          row.source_user_id || '',
          row.sourceUser || '',
          row.reference_type || '',
          row.reference_id || '',
          row.amount,
          row.status,
          row.event_at || row.createdAt,
          row.createdAt,
          row.updated_at || '',
        ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="income-ledger.csv"');
    res.send(csv);
  } catch (error) {
    fail(res, error?.message || 'Failed to export income ledger', error?.status || 500);
  }
});

router.get('/commission/history', guard, async (req, res) => {
  try {
    const page = clamp(req.query.page, 1, 100000, 1);
    const limit = clamp(req.query.limit, 1, 100, 20);
    const rows = applyFilters(await loadLedgerRows(), req.query).sort((a, b) => {
      const timeDiff = new Date(b.event_at || b.createdAt) - new Date(a.event_at || a.createdAt);
      if (timeDiff !== 0) return timeDiff;
      const createdDiff = new Date(b.createdAt) - new Date(a.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return Number(b.id) - Number(a.id);
    });
    ok(res, paginate(rows, page, limit));
  } catch (error) {
    fail(res, error?.message || 'Failed to load commission history', error?.status || 500);
  }
});

export default router;
