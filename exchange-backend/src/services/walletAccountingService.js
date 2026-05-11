import { formatUnits, parseUnits } from 'ethers';
import { db } from '../db.js';
import { up as ensureWalletAccountingMigration } from '../../db/migrations/027_wallet_accounting.js';
import { getAccountBalance } from './ledgerService.js';
import { allocateGlobalTxnNumber, formatGlobalTxnId } from '../utils/generateGlobalTxnId.js';
import { queueWalletRealtimeRefresh } from './walletRealtime.service.js';

const DEFAULT_ASSET = 'USDT';
const DECIMALS = 18;

let schemaReadyPromise = null;
let walletLedgerTxnIdColumnPromise = null;
let mlmIncomeTxnIdColumnPromise = null;

async function triggerMlmRefresh(userId, context = {}, trx = db) {
  const normalizedSourceType = String(context?.sourceType || '').trim().toLowerCase();
  if (normalizedSourceType.startsWith('mlm_level_')) return;
  try {
    const { recalculateMlmForUser } = await import('./mlmLevelService.js');
    await recalculateMlmForUser(userId, { trx });
  } catch (error) {
    console.error('[mlm] wallet-trigger refresh failed', error?.message || error);
  }
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toAmountString(value, decimals = DECIMALS) {
  if (typeof value === 'bigint') return formatUnits(value, decimals);
  if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(8) : '0';
  if (typeof value === 'string') return value;
  return '0';
}

function toBigIntAmount(value, decimals = DECIMALS) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return parseUnits(value.toString(), decimals);
  return parseUnits(String(value || '0'), decimals);
}

function formatWalletBalance(value) {
  return Number(formatUnits(toBigIntAmount(value), DECIMALS));
}

function classifyBonusReason(reason = '') {
  const normalized = String(reason || '').trim().toLowerCase();
  const mlmTypes = new Set([
    'direct_sponsor_commission',
    'joined_commission',
    'level_reward',
    'team_bonus',
    'promotion_reward',
    'salary_reward',
    'mlm_income',
  ]);

  if (mlmTypes.has(normalized)) {
    return {
      ledgerType: 'mlm_income_credit',
      sourceType: normalized,
      isMlm: true,
    };
  }

  return {
    ledgerType: 'admin_adjustment_credit',
    sourceType: normalized || 'bonus_credit',
    isMlm: false,
  };
}

function orderByGlobalTxnSequence(query, alias = null) {
  const col = alias ? `${alias}.txn_id` : 'txn_id';
  const idCol = alias ? `${alias}.id` : 'id';
  return query
    .orderByRaw(
      `CASE WHEN ?? IS NULL OR ?? = '' THEN 1 ELSE 0 END ASC`,
      [col, col]
    )
    .orderByRaw(
      `COALESCE(CAST(SUBSTRING_INDEX(??, '-', -1) AS UNSIGNED), ??) ASC`,
      [col, idCol]
    )
    .orderBy(idCol, 'asc');
}

function buildHistoryTxnId(category, number, fallbackId) {
  try {
    return formatGlobalTxnId(category, number);
  } catch {
    return fallbackId ? String(fallbackId) : null;
  }
}

function getWalletLedgerTxnCategory(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'admin_adjustment_credit') return 'ADEP';
  if (normalized === 'admin_adjustment_debit') return 'AWDR';
  if (normalized === 'withdrawal_debit') return 'WDR';
  return 'FEE';
}

async function ensureWalletAccountingSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureWalletAccountingMigration(db).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  await schemaReadyPromise;
}

async function readUserBalanceRow(userId, trx = db) {
  const hasMainWalletBalance = await trx('information_schema.columns')
    .where({
      table_schema: trx.raw('DATABASE()'),
      table_name: 'users',
      column_name: 'main_wallet_balance',
    })
    .first('column_name')
    .then((row) => !!row)
    .catch(() => false);

  const hasWalletMainBalance = await trx('information_schema.columns')
    .where({
      table_schema: trx.raw('DATABASE()'),
      table_name: 'users',
      column_name: 'wallet_main_balance',
    })
    .first('column_name')
    .then((row) => !!row)
    .catch(() => false);

  const columns = [];
  if (hasMainWalletBalance) columns.push('main_wallet_balance');
  if (hasWalletMainBalance) columns.push('wallet_main_balance');
  if (columns.length === 0) columns.push(trx.raw('NULL as main_wallet_balance'));

  return trx('users').where({ id: userId }).select(columns).first();
}

async function hasTxnIdColumn(tableName) {
  if (tableName === 'wallet_ledger') {
    if (!walletLedgerTxnIdColumnPromise) {
      walletLedgerTxnIdColumnPromise = db('information_schema.columns')
        .where({
          table_schema: db.raw('DATABASE()'),
          table_name: tableName,
          column_name: 'txn_id',
        })
        .first('column_name')
        .then((row) => !!row)
        .catch(() => false);
    }
    return walletLedgerTxnIdColumnPromise;
  }

  if (tableName === 'mlm_income_history') {
    if (!mlmIncomeTxnIdColumnPromise) {
      mlmIncomeTxnIdColumnPromise = db('information_schema.columns')
        .where({
          table_schema: db.raw('DATABASE()'),
          table_name: tableName,
          column_name: 'txn_id',
        })
        .first('column_name')
        .then((row) => !!row)
        .catch(() => false);
    }
    return mlmIncomeTxnIdColumnPromise;
  }

  return false;
}

export async function getMainWalletBalanceBig(userId, trx = db) {
  await ensureWalletAccountingSchema();
  const row = await readUserBalanceRow(userId, trx);
  const balanceValue = row?.main_wallet_balance ?? row?.wallet_main_balance;
  if (balanceValue !== undefined && balanceValue !== null) {
    return parseUnits(String(balanceValue || '0'), DECIMALS);
  }
  return getAccountBalance({ userId, namespace: 'spot:available', asset: DEFAULT_ASSET }, trx);
}

async function getLatestMainWalletLedgerBalance(userId, trx = db) {
  const row = await trx('wallet_ledger')
    .where({
      user_id: userId,
      status: 'SUCCESS',
    })
    .orderBy('id', 'desc')
    .first('new_balance');

  if (!row?.new_balance) return null;

  try {
    return parseUnits(String(row.new_balance), DECIMALS);
  } catch {
    return null;
  }
}

export async function syncUserMainWalletBalance(userId, trx = db) {
  await ensureWalletAccountingSchema();
  const ledgerBalanceBig = await getLatestMainWalletLedgerBalance(userId, trx);
  const balanceBig = ledgerBalanceBig ?? (await getMainWalletBalanceBig(userId, trx));
  const amount = formatUnits(balanceBig, DECIMALS);
  await trx('users').where({ id: userId }).update({
    main_wallet_balance: amount,
    updated_at: new Date(),
  });
  return Number(amount);
}

export async function recordWalletLedgerEntry(
  {
    userId,
    type,
    sourceType,
    referenceId = null,
    previousBalance,
    creditAmount = '0',
    debitAmount = '0',
    newBalance,
    status = 'SUCCESS',
    remark = null,
    meta = null,
    txnSequence = null,
  },
  trx = db
) {
  await ensureWalletAccountingSchema();

  const payload = {
    user_id: userId,
    type,
    source_type: sourceType,
    reference_id: referenceId ? String(referenceId) : null,
    previous_balance: toAmountString(previousBalance),
    credit: toAmountString(creditAmount),
    debit: toAmountString(debitAmount),
    new_balance: toAmountString(newBalance),
    status,
    remark,
    meta: meta ? JSON.stringify(meta) : null,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const inserted = await trx('wallet_ledger').insert(payload);
  const ledgerId = Array.isArray(inserted) ? inserted[0] : inserted;
  const sequenceNumber = txnSequence ?? (await allocateGlobalTxnNumber(trx));
  const txnId = formatGlobalTxnId(getWalletLedgerTxnCategory(type), sequenceNumber);
  if (await hasTxnIdColumn('wallet_ledger')) {
    await trx('wallet_ledger').where({ id: ledgerId }).update({ txn_id: txnId, updated_at: new Date() });
  }

  return { ledgerId, txnId };
}

async function mutateMainWalletBalance(
  { userId, amountBig, type, sourceType, referenceId = null, remark = null, meta = null, txnSequence = null, isCredit = true },
  trx = db
) {
  await ensureWalletAccountingSchema();

  const user = await readUserBalanceRow(userId, trx);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const currentBalanceValue = user.main_wallet_balance ?? user.wallet_main_balance ?? '0';
  const previousBalanceBig = parseUnits(String(currentBalanceValue || '0'), DECIMALS);
  const newBalanceBig = isCredit ? previousBalanceBig + amountBig : previousBalanceBig - amountBig;
  if (newBalanceBig < 0n) {
    throw new Error('INSUFFICIENT_MAIN_WALLET_BALANCE');
  }

  const ledgerEntry = await recordWalletLedgerEntry(
    {
      userId,
      type,
      sourceType,
      referenceId,
      previousBalance: previousBalanceBig,
      creditAmount: isCredit ? amountBig : 0n,
      debitAmount: isCredit ? 0n : amountBig,
      newBalance: newBalanceBig,
      status: 'SUCCESS',
      remark,
      meta,
      txnSequence,
    },
    trx
  );

  const newBalance = formatUnits(newBalanceBig, DECIMALS);
  const userUpdate = { updated_at: new Date() };
  if ('main_wallet_balance' in user) userUpdate.main_wallet_balance = newBalance;
  if ('wallet_main_balance' in user) userUpdate.wallet_main_balance = newBalance;
  await trx('users').where({ id: userId }).update(userUpdate);

  const latestLedger = await trx('wallet_ledger').where({ id: ledgerEntry.ledgerId }).first('new_balance');
  const normalizedLedgerBalance = latestLedger?.new_balance !== undefined && latestLedger?.new_balance !== null
    ? formatUnits(parseUnits(String(latestLedger.new_balance), DECIMALS), DECIMALS)
    : null;
  const normalizedUserBalance = formatUnits(parseUnits(String(newBalance), DECIMALS), DECIMALS);
  if (normalizedLedgerBalance !== normalizedUserBalance) {
    throw new Error('WALLET_CONSISTENCY_FAILURE');
  }

  return {
    ledgerId: ledgerEntry.ledgerId,
    txnId: ledgerEntry.txnId,
    previousBalance: formatWalletBalance(previousBalanceBig),
    newBalance: formatWalletBalance(newBalanceBig),
  };
}

export async function recordMlmIncomeHistory(
  {
    userId,
    incomeType,
    sourceUserId = null,
    previousBalance,
    amount,
    newBalance,
    status = 'SUCCESS',
    referenceId = null,
    remark = null,
    meta = null,
    txnSequence = null,
  },
  trx = db
) {
  await ensureWalletAccountingSchema();

  const inserted = await trx('mlm_income_history').insert({
    user_id: userId,
    income_type: incomeType,
    source_user_id: sourceUserId,
    previous_balance: toAmountString(previousBalance),
    amount: toAmountString(amount),
    new_balance: toAmountString(newBalance),
    status,
    reference_id: referenceId ? String(referenceId) : null,
    remark,
    meta: meta ? JSON.stringify(meta) : null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  const historyId = Array.isArray(inserted) ? inserted[0] : inserted;
  const map = {
    direct_sponsor_commission: 'COM',
    joined_commission: 'REF',
    level_bonus_10day: 'BON',
    level_promotion_reward: 'LVL',
    signal_income: 'SIG',
  };
  const sequenceNumber = txnSequence ?? (await allocateGlobalTxnNumber(trx));
  const txnId = formatGlobalTxnId(map[incomeType] || 'COM', sequenceNumber);
  if (await hasTxnIdColumn('mlm_income_history')) {
    await trx('mlm_income_history').where({ id: historyId }).update({ txn_id: txnId, updated_at: new Date() });
  }
  return { historyId, txnId };
}

export async function applyWalletCreditRecord(
  { userId, amount, type, sourceType, referenceId = null, remark = null, meta = null, mlm = null },
  trx = db
) {
  const amountBig = toBigIntAmount(amount);
  const txnSequence = await allocateGlobalTxnNumber(trx);
  const walletMutation = await mutateMainWalletBalance(
    {
      userId,
      amountBig,
      type,
      sourceType,
      referenceId,
      remark,
      meta,
      txnSequence,
      isCredit: true,
    },
    trx
  );

  if (mlm?.incomeType) {
    await recordMlmIncomeHistory(
      {
        userId,
        incomeType: mlm.incomeType,
        sourceUserId: mlm.sourceUserId ?? null,
        previousBalance: toBigIntAmount(walletMutation.previousBalance),
        amount: amountBig,
        newBalance: toBigIntAmount(walletMutation.newBalance),
        status: 'SUCCESS',
        referenceId: referenceId ?? walletMutation.ledgerId,
        remark,
        meta,
        txnSequence,
      },
      trx
    );
  }

  await triggerMlmRefresh(userId, { type, sourceType }, trx);
  queueWalletRealtimeRefresh(userId, trx);

  return {
    ledgerId: walletMutation.ledgerId,
    txnId: walletMutation.txnId,
    previousBalance: walletMutation.previousBalance,
    newBalance: walletMutation.newBalance,
  };
}

export async function applyWalletDebitRecord(
  { userId, amount, type, sourceType, referenceId = null, remark = null, meta = null },
  trx = db
) {
  const amountBig = toBigIntAmount(amount);
  const walletMutation = await mutateMainWalletBalance(
    {
      userId,
      amountBig,
      type,
      sourceType,
      referenceId,
      remark,
      meta,
      isCredit: false,
    },
    trx
  );

  await triggerMlmRefresh(userId, { type, sourceType }, trx);
  queueWalletRealtimeRefresh(userId, trx);

  return {
    ledgerId: walletMutation.ledgerId,
    previousBalance: walletMutation.previousBalance,
    newBalance: walletMutation.newBalance,
  };
}

export async function getUserWalletSummary(userId, trx = db) {
  await ensureWalletAccountingSchema();
  const [userRow, depositRow, signalRow, mlmRow, debitRows] = await Promise.all([
    readUserBalanceRow(userId, trx),
    trx('deposit_transactions')
      .where({ user_id: userId, token: DEFAULT_ASSET, credited: 1 })
      .where((builder) => builder.whereNull('status').orWhere('status', 'credited').orWhere('status', 'SUCCESS'))
      .sum({ total: 'amount_decimal' })
      .first()
      .catch(() => ({ total: '0' })),
    trx('user_signal_logs')
      .where({ user_id: userId })
      .whereIn('trade_status', ['CLOSED'])
      .sum({ total: 'profit_amount' })
      .first()
      .catch(() => ({ total: '0' })),
    trx('mlm_income_history')
      .where({ user_id: userId, status: 'SUCCESS' })
      .sum({ total: 'amount' })
      .first()
      .catch(() => ({ total: '0' })),
    trx('wallet_ledger')
      .where({ user_id: userId, status: 'SUCCESS' })
      .whereIn('type', ['withdrawal_debit', 'admin_adjustment_debit'])
      .select('type')
      .sum({ total: 'debit' })
      .groupBy('type')
      .catch(() => []),
  ]);

  const depositTotal = toNumber(depositRow?.total);
  const signalIncomeTotal = toNumber(signalRow?.total);
  const mlmIncomeTotal = toNumber(mlmRow?.total);
  const totalDebits = debitRows.reduce((sum, row) => sum + toNumber(row.total), 0);
  const userBalanceValue = userRow?.main_wallet_balance ?? userRow?.wallet_main_balance ?? '0';
  const mainWalletBalance = toNumber(userBalanceValue);
  const mainWalletBalanceBig = parseUnits(String(userBalanceValue || '0'), DECIMALS);
  const totalEarnings = signalIncomeTotal + mlmIncomeTotal;

  await trx('users').where({ id: userId }).update({
    ...('main_wallet_balance' in (userRow || {}) ? { main_wallet_balance: formatUnits(mainWalletBalanceBig, DECIMALS) } : {}),
    ...('wallet_main_balance' in (userRow || {}) ? { wallet_main_balance: formatUnits(mainWalletBalanceBig, DECIMALS) } : {}),
    updated_at: new Date(),
  });

  return {
    mainWalletBalance,
    depositTotal,
    signalIncomeTotal,
    mlmIncomeTotal,
    totalEarnings,
    availableBalance: mainWalletBalance,
    totalWithdrawals: debitRows
      .filter((row) => row.type === 'withdrawal_debit')
      .reduce((sum, row) => sum + toNumber(row.total), 0),
    totalOtherDebits: debitRows
      .filter((row) => row.type !== 'withdrawal_debit')
      .reduce((sum, row) => sum + toNumber(row.total), 0),
    totalDebits,
  };
}

export async function getUserDepositBalanceHistory(userId, { limit = 100 } = {}, trx = db) {
  await ensureWalletAccountingSchema();
  const items = await trx('deposit_transactions')
    .where({ user_id: userId, token: DEFAULT_ASSET, credited: 1 })
    .where((builder) => builder.whereNull('status').orWhere('status', 'credited').orWhere('status', 'SUCCESS'))
    .orderBy('created_at', 'asc')
    .limit(limit);

  let runningDepositTotal = 0;
  return items
    .map((row) => {
      const amount = toNumber(row.amount_decimal);
      const previousDepositTotal = runningDepositTotal;
      const newDepositTotal = previousDepositTotal + amount;
      runningDepositTotal = newDepositTotal;
      return {
        id: row.id,
        txnId: row.txn_id || null,
        date: row.created_at,
        depositToken: row.tx_hash,
        network: row.network,
        method: row.type,
        depositAmount: amount,
        previousDepositTotal,
        newDepositTotal,
        status: row.status || 'credited',
      };
    })
    .reverse();
}

export async function getUserSignalIncomeHistory(userId, { limit = 100 } = {}, trx = db) {
  await ensureWalletAccountingSchema();
  const items = await orderByGlobalTxnSequence(
    trx('user_signal_logs'),
    'user_signal_logs'
  )
    .where({ user_id: userId })
    .whereIn('trade_status', ['CLOSED'])
    .limit(limit);

  return items.map((row) => ({
    id: row.id,
    txnId: row.txn_id || buildHistoryTxnId('SIG', row.id, row.id),
    date: row.created_at,
    timeSlot: row.slot_time_snapshot,
    signalToken: row.signal_token || row.batch_token,
    previousBalance: toNumber(row.previous_balance),
    investmentAmount: toNumber(row.investment_amount),
    profitAmount: toNumber(row.profit_amount),
    totalEarned: toNumber(row.total_return_usdt ?? row.total_earned),
    newBalance: toNumber(row.wallet_balance_after_sell ?? row.new_balance),
    status: row.status || 'SUCCESS',
  }));
}

export async function getUserMlmIncomeHistory(userId, { limit = 100 } = {}, trx = db) {
  await ensureWalletAccountingSchema();
  const items = await orderByGlobalTxnSequence(
    trx('mlm_income_history as m'),
    'm'
  )
    .leftJoin('users as u', 'm.source_user_id', 'u.id')
    .leftJoin('user_profiles as up', 'u.id', 'up.user_id')
    .select('m.*', 'u.email as source_user_email', 'up.display_name as source_user_name')
    .where('m.user_id', userId)
    .limit(limit);

  return items.map((row) => ({
    id: row.id,
    txnId: row.txn_id || buildHistoryTxnId(
      row.income_type === 'joined_commission' ? 'REF' : row.income_type === 'signal_income' ? 'SIG' : row.income_type === 'level_promotion_reward' ? 'LVL' : row.income_type === 'level_bonus_10day' ? 'BON' : 'COM',
      row.id,
      row.id
    ),
    date: row.created_at,
    incomeType: row.income_type,
    sourceUser: row.source_user_email,
    sourceUserEmail: row.source_user_email || null,
    sourceUserName: row.source_user_name || null,
    sourceUserLabel: row.source_user_name
      ? row.source_user_email
        ? `${row.source_user_name} (${row.source_user_email})`
        : row.source_user_name
      : row.source_user_email || null,
    previousBalance: toNumber(row.previous_balance),
    mlmEarned: toNumber(row.amount),
    newBalance: toNumber(row.new_balance),
    status: row.status,
    remark: row.remark,
  }));
}

export async function getUserWalletLedger(userId, { limit = 100 } = {}, trx = db) {
  await ensureWalletAccountingSchema();
  const items = await orderByGlobalTxnSequence(trx('wallet_ledger'), 'wallet_ledger')
    .where({ user_id: userId })
    .limit(limit);

  return items.map((row) => ({
    id: row.id,
    txnId: row.txn_id || buildHistoryTxnId(getWalletLedgerTxnCategory(row.type), row.id, row.id),
    date: row.created_at,
    type: row.type,
    sourceType: row.source_type,
    referenceId: row.reference_id,
    previousBalance: toNumber(row.previous_balance),
    credit: toNumber(row.credit),
    debit: toNumber(row.debit),
    newBalance: toNumber(row.new_balance),
    status: row.status,
    remark: row.remark,
  }));
}

export { classifyBonusReason };
