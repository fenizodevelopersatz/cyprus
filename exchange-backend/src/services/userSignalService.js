import { formatUnits, parseUnits } from 'ethers';
import { db } from '../db.js';
import { getAccountBalance } from './ledgerService.js';
import { ensureDefaultControlSettings, getControlSettings } from './adminControlService.js';
import { getSignalPackageModule } from './signalPackageService.js';
import { getFundingSummary } from './fundingSummary.service.js';
import {
  applyWalletDebitRecord,
  applyWalletCreditRecord,
  getUserWalletSummary,
} from './walletAccountingService.js';
import { buildOrderId } from './txnIdService.js';
import { generateGlobalTxnId } from '../utils/generateGlobalTxnId.js';
import { fetchTickerRest, getTickerSnapshot } from './binanceSync.js';
import { allowedSpotSymbols, symbols as symbolMeta } from '../utils/symbols.js';

const USER_SIGNAL_LOGS_TABLE = 'user_signal_logs';
const TRADE_SLOT_BATCHES_TABLE = 'trade_slot_batches';
const TRADE_SLOTS_TABLE = 'trade_slots';
const USERS_TABLE = 'users';
const DEFAULT_ASSET = 'USDT';
const DECIMALS = 18;
const PRICE_DECIMALS = 8;
const PERCENT_DENOMINATOR = 10_000n;
const DEFAULT_SIGNAL_SYMBOL = 'BTCUSDT';

let schemaReadyPromise = null;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundAmount(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100000000) / 100000000;
}

function formatDecimal(value, decimals = 8) {
  return Number(value || 0).toFixed(decimals);
}

function amountBigToNumber(valueBig) {
  return roundAmount(Number(formatUnits(valueBig, DECIMALS)));
}

function percentToBps(value, fallback = 0) {
  const numeric = toNumber(value, fallback);
  return BigInt(Math.max(0, Math.round(numeric * 100)));
}

function applyPercentBig(amountBig, percentValue) {
  const bps = percentToBps(percentValue);
  return (amountBig * bps) / PERCENT_DENOMINATOR;
}

function normalizeSignalSymbol(symbol) {
  const normalized = String(symbol || DEFAULT_SIGNAL_SYMBOL).trim().toUpperCase();
  if (!normalized) return DEFAULT_SIGNAL_SYMBOL;
  return allowedSpotSymbols.includes(normalized) ? normalized : DEFAULT_SIGNAL_SYMBOL;
}

async function resolveSignalMarketPrice(symbol) {
  const snapshot = getTickerSnapshot(symbol);
  const fromCache = Number(snapshot?.last || 0);
  if (Number.isFinite(fromCache) && fromCache > 0) {
    return Number(fromCache.toFixed(PRICE_DECIMALS));
  }

  const fresh = await fetchTickerRest(symbol).catch(() => null);
  const fromRest = Number(fresh?.last || 0);
  if (Number.isFinite(fromRest) && fromRest > 0) {
    return Number(fromRest.toFixed(PRICE_DECIMALS));
  }

  throw badRequest('LIVE_PRICE_NOT_AVAILABLE', 502);
}

async function ensureSpotMarketSymbol(symbol, lastPrice, trx = db) {
  const existing = await trx('market_symbols').where({ symbol }).first();
  if (existing) return existing;

  const meta = symbolMeta[symbol] || {};
  await trx('market_symbols')
    .insert({
      symbol,
      base_asset: meta.base || symbol.replace(/USDT$/, '') || 'BTC',
      quote_asset: meta.quote || 'USDT',
      tick_size: meta.tick || '0.01',
      lot_size: meta.lot || '0.00000001',
      contract_type: 'SPOT',
      last_price: formatDecimal(lastPrice, PRICE_DECIMALS),
    })
    .onConflict('symbol')
    .ignore();

  return trx('market_symbols').where({ symbol }).first();
}

async function createSimulatedSpotFill({
  trx,
  userId,
  symbol,
  side,
  price,
  qty,
}) {
  await ensureSpotMarketSymbol(symbol, price, trx);

  const now = new Date();
  const orderPayload = {
    user_id: userId,
    symbol,
    side,
    type: 'MARKET',
    price: formatDecimal(price, PRICE_DECIMALS),
    size: formatDecimal(qty, PRICE_DECIMALS),
    filled: formatDecimal(qty, PRICE_DECIMALS),
    status: 'FILLED',
    exchange_order_id: null,
    exchange: 'SIGNAL_SIM',
    created_at: now,
    updated_at: now,
  };

  const insertedOrder = await trx('spot_orders').insert(orderPayload);
  const orderId = Array.isArray(insertedOrder) ? insertedOrder[0] : insertedOrder;

  const insertedTrade = await trx('spot_trades').insert({
    order_id: orderId,
    match_id: null,
    price: formatDecimal(price, PRICE_DECIMALS),
    size: formatDecimal(qty, PRICE_DECIMALS),
    fee: '0.00000000',
    created_at: now,
    updated_at: now,
  });
  const tradeId = Array.isArray(insertedTrade) ? insertedTrade[0] : insertedTrade;

  return {
    orderId,
    tradeId,
    createdAt: now,
  };
}

function parseAuditJsonSafe(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function getSignalTradingRules(trx = db) {
  const settings = await getControlSettings(trx);
  return {
    investmentPerTradePercent: toNumber(settings?.globalRules?.investmentPerTradePercent, 1),
    dailyPercentPerTrade: toNumber(settings?.globalRules?.dailyPercentPerTrade, 0.65),
    signalValidityMinutes: Math.max(toNumber(settings?.globalRules?.signalValidityMinutes, 10), 1),
  };
}

function badRequest(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function currentDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toClockString(slotTime) {
  const raw = String(slotTime ?? '').trim();
  if (!raw) return '';
  return raw.length === 5 ? `${raw}:00` : raw.slice(0, 8);
}

function minutesFromTime(slotTime) {
  const normalized = toClockString(slotTime);
  const [hours, minutes] = normalized.split(':').map((value) => Number(value));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function slotKeyFromIndex(index) {
  return String(index + 1);
}

async function getDynamicSlotWindows(trx = db) {
  const settings = await getControlSettings(trx);
  const validityMinutes = Math.max(Number(settings?.globalRules?.signalValidityMinutes ?? 10), 1);
  return settings.tradeSlots
    .filter((slot) => Boolean(slot.isEnabled))
    .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
    .map((slot, index) => {
      const startMinutes = minutesFromTime(slot.slotTime);
      const endMinutes = startMinutes === null ? null : startMinutes + validityMinutes;
      const endHour = endMinutes === null ? 0 : Math.floor(endMinutes / 60);
      const endMinute = endMinutes === null ? 0 : endMinutes % 60;
      return {
        id: slot.id,
        key: slotKeyFromIndex(index),
        label: slot.slotName ? `${slot.slotName} Slot` : `${String(slot.slotTime).slice(0, 5)} Slot`,
        slotTime: toClockString(slot.slotTime),
        start: String(slot.slotTime).slice(0, 5),
        end: `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`,
        startMinutes,
        endMinutes,
        validityMinutes,
      };
    })
    .filter((slot) => slot.startMinutes !== null && slot.endMinutes !== null);
}

function getEligibleSlotWindows(slots, allowedSignalsToday) {
  const safeSlots = Array.isArray(slots) ? slots : [];
  const limit = Math.max(0, Number(allowedSignalsToday) || 0);
  if (limit <= 0) return [];
  return safeSlots.slice(0, limit);
}

async function getActiveSlotWindow(now = new Date(), trx = db) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const slots = await getDynamicSlotWindows(trx);
  return slots.find((slot) => minutes >= slot.startMinutes && minutes <= slot.endMinutes) ?? null;
}

async function getEligibleActiveSlotWindow(now = new Date(), allowedSignalsToday = 0, trx = db) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const slots = getEligibleSlotWindows(await getDynamicSlotWindows(trx), allowedSignalsToday);
  return slots.find((slot) => minutes >= slot.startMinutes && minutes <= slot.endMinutes) ?? null;
}

async function ensureUserSignalSchema() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await ensureDefaultControlSettings(db);
      if (!(await db.schema.hasTable(USER_SIGNAL_LOGS_TABLE))) {
        return;
      }

      const addColumnIfMissing = async (column, callback) => {
        if (!(await db.schema.hasColumn(USER_SIGNAL_LOGS_TABLE, column))) {
          await db.schema.alterTable(USER_SIGNAL_LOGS_TABLE, callback);
        }
      };

      await addColumnIfMissing('signal_token', (table) => table.string('signal_token', 64).nullable());
      await addColumnIfMissing('status', (table) => table.string('status', 32).notNullable().defaultTo('SUCCESS'));
      await addColumnIfMissing('previous_balance', (table) => table.decimal('previous_balance', 20, 8).nullable());
      await addColumnIfMissing('current_wallet_balance', (table) => table.decimal('current_wallet_balance', 20, 8).nullable());
      await addColumnIfMissing('investment_amount', (table) => table.decimal('investment_amount', 20, 8).nullable());
      await addColumnIfMissing('profit_amount', (table) => table.decimal('profit_amount', 20, 8).nullable());
      await addColumnIfMissing('total_earned', (table) => table.decimal('total_earned', 20, 8).nullable());
      await addColumnIfMissing('new_balance', (table) => table.decimal('new_balance', 20, 8).nullable());
      await addColumnIfMissing('audit_json', (table) => table.json('audit_json').nullable());
      await addColumnIfMissing('symbol', (table) => table.string('symbol', 32).nullable());
      await addColumnIfMissing('mode', (table) => table.string('mode', 32).nullable());
      await addColumnIfMissing('order_status', (table) => table.string('order_status', 32).nullable());
      await addColumnIfMissing('trade_status', (table) => table.string('trade_status', 32).nullable());
      await addColumnIfMissing('buy_price', (table) => table.decimal('buy_price', 20, 8).nullable());
      await addColumnIfMissing('sell_price', (table) => table.decimal('sell_price', 20, 8).nullable());
      await addColumnIfMissing('executed_qty', (table) => table.decimal('executed_qty', 20, 8).nullable());
      await addColumnIfMissing('wallet_balance_before', (table) => table.decimal('wallet_balance_before', 20, 8).nullable());
      await addColumnIfMissing('wallet_balance_after_buy', (table) => table.decimal('wallet_balance_after_buy', 20, 8).nullable());
      await addColumnIfMissing('wallet_balance_before_sell', (table) => table.decimal('wallet_balance_before_sell', 20, 8).nullable());
      await addColumnIfMissing('wallet_balance_after_sell', (table) => table.decimal('wallet_balance_after_sell', 20, 8).nullable());
      await addColumnIfMissing('principal_amount', (table) => table.decimal('principal_amount', 20, 8).nullable());
      await addColumnIfMissing('profit_percent', (table) => table.decimal('profit_percent', 10, 4).nullable());
      await addColumnIfMissing('total_return_usdt', (table) => table.decimal('total_return_usdt', 20, 8).nullable());
      await addColumnIfMissing('buy_order_id', (table) => table.integer('buy_order_id').unsigned().nullable());
      await addColumnIfMissing('buy_trade_id', (table) => table.integer('buy_trade_id').unsigned().nullable());
      await addColumnIfMissing('sell_order_id', (table) => table.integer('sell_order_id').unsigned().nullable());
      await addColumnIfMissing('sell_trade_id', (table) => table.integer('sell_trade_id').unsigned().nullable());
      await addColumnIfMissing('linked_buy_trade_id', (table) => table.integer('linked_buy_trade_id').unsigned().nullable());
      await addColumnIfMissing('sell_trigger', (table) => table.string('sell_trigger', 64).nullable());
      await addColumnIfMissing('expires_at', (table) => table.timestamp('expires_at').nullable());
      await addColumnIfMissing('buy_created_at', (table) => table.timestamp('buy_created_at').nullable());
      await addColumnIfMissing('sell_created_at', (table) => table.timestamp('sell_created_at').nullable());
      await addColumnIfMissing('closed_at', (table) => table.timestamp('closed_at').nullable());
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

function detectEligiblePackage(balance, userLevel, packages) {
  const ordered = [...packages]
    .filter((item) => String(item.status || '').toUpperCase() === 'ACTIVE')
    .sort((a, b) => toNumber(a.minAmount) - toNumber(b.minAmount));

  const match = ordered.find((pkg) => {
    const min = toNumber(pkg.minAmount);
    const max = pkg.maxAmount === null ? Infinity : toNumber(pkg.maxAmount);
    return balance >= min && balance <= max;
  });

  if (!match) {
    return { package: null, allowedSignalsToday: 0, eligible: false, reason: 'Minimum 100 USDT required to activate trade.' };
  }

  const requiredLevel = toNumber(match.requiredLevel);
  if (userLevel < requiredLevel) {
    return { package: match, allowedSignalsToday: toNumber(match.signalsPerDay), eligible: false, reason: 'You are not allowed for the current trade.' };
  }

  return {
    package: {
      name: match.name,
      minAmount: toNumber(match.minAmount),
      maxAmount: match.maxAmount === null ? null : toNumber(match.maxAmount),
      signalsPerDay: toNumber(match.signalsPerDay),
      requiredLevel,
    },
    allowedSignalsToday: toNumber(match.signalsPerDay),
    eligible: true,
    reason: null,
  };
}

async function getCurrentWalletBalance(userId, trx = db) {
  try {
    const fundingSummary = await getFundingSummary(userId);
    const total = toNumber(fundingSummary?.balance?.total, 0);
    return roundAmount(total);
  } catch {
    const balanceBig = await getAccountBalance({ userId, namespace: 'spot:available', asset: DEFAULT_ASSET }, trx);
    return roundAmount(Number(formatUnits(balanceBig, DECIMALS)));
  }
}

async function getDepositTotal(userId, trx = db) {
  try {
    const fundingSummary = await getFundingSummary(userId);
    const total = toNumber(fundingSummary?.balance?.total, 0);
    return roundAmount(total);
  } catch {
  const [depositsRow, depositTransactions] = await Promise.all([
    trx('deposits')
      .where({ user_id: userId, asset: DEFAULT_ASSET })
      .sum({ total: 'amount' })
      .first()
      .catch(() => ({ total: '0' })),
    trx.schema.hasTable('deposit_transactions')
      .then((hasTable) => {
        if (!hasTable) return { total: '0' };
        return trx('deposit_transactions')
          .where({ user_id: userId, token: DEFAULT_ASSET, credited: 1 })
          .sum({ total: 'amount_decimal' })
          .first();
      })
      .catch(() => ({ total: '0' })),
  ]);

    return roundAmount(toNumber(depositsRow?.total) + toNumber(depositTransactions?.total));
  }
}

async function getUserLevel(userId, trx = db) {
  const row = await trx(USERS_TABLE).select('kyc_level').where({ id: userId }).first();
  return toNumber(row?.kyc_level);
}

async function getTodayUsedSignals(userId, trx = db, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const row = await trx(USER_SIGNAL_LOGS_TABLE)
    .where({ user_id: userId })
    .where('created_at', '>=', start)
    .where('created_at', '<', end)
    .whereNotIn('status', ['FAILED', 'CANCELED'])
    .count({ count: '*' })
    .first();
  return toNumber(row?.count);
}

async function getSuccessfulSignalUsageForToday(userId, trx = db, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return trx(USER_SIGNAL_LOGS_TABLE)
    .where({ user_id: userId })
    .where('created_at', '>=', start)
    .where('created_at', '<', end)
    .whereNotIn('status', ['FAILED', 'CANCELED'])
    .select('id', 'signal_token', 'slot_time_snapshot', 'trade_slot_batch_id', 'created_at');
}

async function enforceSingleUseRules({ userId, token, activeSlot, trx = db, now = new Date() }) {
  const tokenTrimmed = String(token).trim();
  const usages = await getSuccessfulSignalUsageForToday(userId, trx, now);

  const reusedToken = usages.find((row) => String(row.signal_token || '').trim() === tokenTrimmed);
  if (reusedToken) {
    throw badRequest('This signal token has already been used.');
  }

  const sameSlotUsage = usages.find((row) => String(row.slot_time_snapshot || '').slice(0, 8) === String(activeSlot.slotTime).slice(0, 8));
  if (sameSlotUsage) {
    throw badRequest('You have already used a signal in the current time slot. Please wait for the next slot.');
  }
}

async function getBatchForTokenAndSlot({ token, slotKey, now = new Date(), trx = db }) {
  const activeSlot = await getActiveSlotWindow(now, trx);
  if (!activeSlot || activeSlot.key !== String(slotKey)) {
    throw badRequest('Signal validity time has expired.');
  }

  const tokenTrimmed = String(token).trim();
  const today = currentDateKey(now);

  const row = await trx(`${TRADE_SLOT_BATCHES_TABLE} as batches`)
    .leftJoin(`${TRADE_SLOTS_TABLE} as slots`, 'slots.id', 'batches.slot_id')
    .select('batches.*', 'slots.slot_name')
    .where('batches.batch_token', tokenTrimmed)
    .where('batches.slot_date', today)
    .where('batches.slot_time', activeSlot.slotTime)
    .where('batches.status', 'active')
    .first();

  if (!row) {
    const tokenRow = await trx(`${TRADE_SLOT_BATCHES_TABLE} as batches`)
      .leftJoin(`${TRADE_SLOTS_TABLE} as slots`, 'slots.id', 'batches.slot_id')
      .select('batches.*', 'slots.slot_name')
      .where('batches.batch_token', tokenTrimmed)
      .orderBy('batches.created_at', 'desc')
      .first();

    console.error('[signals:getBatchForTokenAndSlot]', {
      token: tokenTrimmed,
      slotKey: String(slotKey),
      today,
      activeSlotKey: activeSlot?.key || null,
      activeSlotTime: activeSlot?.slotTime || null,
      foundToken: Boolean(tokenRow),
      foundTokenDate: tokenRow?.slot_date || null,
      foundTokenTime: tokenRow?.slot_time ? String(tokenRow.slot_time).slice(0, 8) : null,
      foundTokenStatus: tokenRow?.status || null,
    });

    if (tokenRow) {
      if (String(tokenRow.status || '').toLowerCase() !== 'active') {
        throw badRequest('This signal code is not active.');
      }

      if (String(tokenRow.slot_date || '') !== today) {
        throw badRequest('This signal code is not for today.');
      }

      if (String(tokenRow.slot_time || '').slice(0, 8) !== String(activeSlot.slotTime).slice(0, 8)) {
        throw badRequest('This signal code belongs to a different time slot.');
      }
    }

    throw badRequest('Invalid signal code.');
  }

  return row;
}

export async function getUserSignalWalletSummary(userId, now = new Date()) {
  await ensureUserSignalSchema();
  const [walletSummary, userLevel, todayUsedSignals, packageModule, tradingRules] = await Promise.all([
    getUserWalletSummary(userId),
    getUserLevel(userId),
    getTodayUsedSignals(userId, db, now),
    getSignalPackageModule(),
    getSignalTradingRules(db),
  ]);

  const currentBalance = roundAmount(walletSummary.mainWalletBalance);
  const depositTotal = roundAmount(walletSummary.depositTotal);
  const eligibility = detectEligiblePackage(currentBalance, userLevel, packageModule.packages);
  const [activeSlot, availableSlots] = await Promise.all([
    getEligibleActiveSlotWindow(now, eligibility.allowedSignalsToday, db),
    getDynamicSlotWindows(db),
  ]);
  const eligibleSlots = getEligibleSlotWindows(availableSlots, eligibility.allowedSignalsToday);

  return {
    current_balance: currentBalance,
    deposit_total: depositTotal,
    user_level: userLevel,
    today_used_signals: todayUsedSignals,
    allowed_signals_today: eligibility.allowedSignalsToday,
    remaining_signals: Math.max(eligibility.allowedSignalsToday - todayUsedSignals, 0),
    eligible_package: eligibility.package,
    investment_per_trade_percent: tradingRules.investmentPerTradePercent,
    daily_percent_per_trade: tradingRules.dailyPercentPerTrade,
    signal_validity_minutes: tradingRules.signalValidityMinutes,
    available_slots: eligibleSlots.map((slot) => ({
      id: slot.id,
      key: slot.key,
      label: slot.label,
      start: slot.start,
      end: slot.end,
      slot_time: slot.slotTime,
    })),
    active_slot: activeSlot
      ? {
          id: activeSlot.id,
          key: activeSlot.key,
          label: activeSlot.label,
          start: activeSlot.start,
          end: activeSlot.end,
          slot_time: activeSlot.slotTime,
        }
      : null,
  };
}

export async function validateUserSignalToken({ userId, token, slotKey }, now = new Date()) {
  await ensureUserSignalSchema();
  const packageModule = await getSignalPackageModule();
  const [currentBalance, userLevel, todayUsedSignals] = await Promise.all([
    getCurrentWalletBalance(userId),
    getUserLevel(userId),
    getTodayUsedSignals(userId, db, now),
  ]);

  const eligibility = detectEligiblePackage(currentBalance, userLevel, packageModule.packages);
  if (!eligibility.eligible || !eligibility.package) {
    throw badRequest(eligibility.reason || 'You are not allowed for the current trade.');
  }
  if (todayUsedSignals >= eligibility.allowedSignalsToday) {
    throw badRequest('You are not allowed for the current trade.');
  }

  const batch = await getBatchForTokenAndSlot({ token, slotKey, now, trx: db });
  const activeSlot = await getEligibleActiveSlotWindow(now, eligibility.allowedSignalsToday, db);
  if (!activeSlot) {
    throw badRequest('Signal validity time has expired.');
  }
  await enforceSingleUseRules({
    userId,
    token,
    activeSlot,
    trx: db,
    now,
  });
  return {
    valid: true,
    token: String(token).trim(),
    slot_key: String(slotKey),
    batch_token: batch.batch_token,
    slot_time: String(batch.slot_time).slice(0, 8),
  };
}

export async function applyUserSignal({ userId, token, slotKey, auditJson }, now = new Date()) {
  await ensureUserSignalSchema();
  return db.transaction(async (trx) => {
    const packageModule = await getSignalPackageModule();
    const [currentBalance, userLevel, todayUsedSignals, tradingRules] = await Promise.all([
      getCurrentWalletBalance(userId, trx),
      getUserLevel(userId, trx),
      getTodayUsedSignals(userId, trx, now),
      getSignalTradingRules(trx),
    ]);

    const eligibility = detectEligiblePackage(currentBalance, userLevel, packageModule.packages);
    if (!eligibility.eligible || !eligibility.package) {
      throw badRequest(eligibility.reason || 'You are not allowed for the current trade.');
    }
    if (todayUsedSignals >= eligibility.allowedSignalsToday) {
      throw badRequest('You are not allowed for the current trade.');
    }

    const batch = await getBatchForTokenAndSlot({ token, slotKey, now, trx });
    const activeSlot = await getEligibleActiveSlotWindow(now, eligibility.allowedSignalsToday, trx);
    if (!activeSlot) {
      throw badRequest('Signal validity time has expired.');
    }
    await enforceSingleUseRules({
      userId,
      token,
      activeSlot,
      trx,
      now,
    });
    const tokenTrimmed = String(token).trim();
    const symbol = normalizeSignalSymbol(auditJson?.symbol || auditJson?.market_symbol || DEFAULT_SIGNAL_SYMBOL);
    const livePrice = Number(
      auditJson?.buy_price ||
      auditJson?.live_price_at_buy ||
      auditJson?.price ||
      await resolveSignalMarketPrice(symbol)
    );
    if (!Number.isFinite(livePrice) || livePrice <= 0) {
      throw badRequest('LIVE_PRICE_NOT_AVAILABLE', 502);
    }

    const walletBeforeBuyBig = parseUnits(String(roundAmount(currentBalance)), DECIMALS);
    const investmentAmountBig = applyPercentBig(walletBeforeBuyBig, tradingRules.investmentPerTradePercent);
    if (investmentAmountBig <= 0n) {
      throw badRequest('INVESTMENT_AMOUNT_MUST_BE_GREATER_THAN_ZERO');
    }
    if (walletBeforeBuyBig < investmentAmountBig) {
      throw badRequest('INSUFFICIENT_MAIN_WALLET_BALANCE');
    }

    const profitAmountBig = applyPercentBig(investmentAmountBig, tradingRules.dailyPercentPerTrade);
    const totalReturnBig = investmentAmountBig + profitAmountBig;
    const walletBeforeBuy = amountBigToNumber(walletBeforeBuyBig);
    const investmentAmount = amountBigToNumber(investmentAmountBig);
    const profitAmount = amountBigToNumber(profitAmountBig);
    const totalReturn = amountBigToNumber(totalReturnBig);
    const executedQty = roundAmount(investmentAmount / livePrice);
    if (!Number.isFinite(executedQty) || executedQty <= 0) {
      throw badRequest('EXECUTED_QTY_INVALID');
    }
    const simulatedSellPrice = roundAmount(totalReturn / executedQty);

    const walletDebit = await applyWalletDebitRecord(
      {
        userId,
        amount: investmentAmountBig,
        type: 'signal_trade_debit',
        sourceType: 'signal_trade_buy',
        referenceId: batch.batch_token,
        remark: 'Signal-mode simulated buy debit',
        meta: {
          token: tokenTrimmed,
          symbol,
          slotKey: String(slotKey),
          tradeSlotBatchId: batch.id,
        },
      },
      trx
    );
    const walletAfterBuy = roundAmount(walletDebit.newBalance);

    const buyFill = await createSimulatedSpotFill({
      trx,
      userId,
      symbol,
      side: 'BUY',
      price: livePrice,
      qty: executedQty,
    });
    const expiresAt = new Date(now.getTime() + tradingRules.signalValidityMinutes * 60 * 1000);

    const payload = {
      signal_id: null,
      user_id: userId,
      trade_slot_batch_id: batch.id,
      batch_token: batch.batch_token,
      slot_time_snapshot: String(batch.slot_time).slice(0, 8),
      signal_token: tokenTrimmed,
      symbol,
      mode: 'SIGNAL',
      order_status: 'FILLED',
      trade_status: 'OPEN',
      status: 'OPEN',
      previous_balance: walletBeforeBuy.toFixed(8),
      current_wallet_balance: walletBeforeBuy.toFixed(8),
      wallet_balance_before: walletBeforeBuy.toFixed(8),
      wallet_balance_after_buy: walletAfterBuy.toFixed(8),
      investment_amount: investmentAmount.toFixed(8),
      principal_amount: investmentAmount.toFixed(8),
      profit_percent: Number(tradingRules.dailyPercentPerTrade).toFixed(4),
      profit_amount: profitAmount.toFixed(8),
      total_earned: profitAmount.toFixed(8),
      total_return_usdt: totalReturn.toFixed(8),
      new_balance: walletAfterBuy.toFixed(8),
      buy_price: livePrice.toFixed(8),
      sell_price: simulatedSellPrice.toFixed(8),
      executed_qty: executedQty.toFixed(8),
      buy_order_id: buyFill.orderId,
      buy_trade_id: buyFill.tradeId,
      buy_created_at: buyFill.createdAt,
      expires_at: expiresAt,
      audit_json: JSON.stringify({
        ...(auditJson || {}),
        mode: 'SIGNAL',
        side: 'BUY',
        symbol,
        previous_balance: walletBeforeBuy,
        current_wallet_balance: walletBeforeBuy,
        wallet_balance_before: walletBeforeBuy,
        wallet_balance_after_buy: walletAfterBuy,
        investment_percent: tradingRules.investmentPerTradePercent,
        investment_amount: investmentAmount,
        principal_amount: investmentAmount,
        profit_percent: tradingRules.dailyPercentPerTrade,
        profit_amount: profitAmount,
        total_earned: profitAmount,
        total_return_usdt: totalReturn,
        buy_price: livePrice,
        sell_price: simulatedSellPrice,
        executed_qty: executedQty,
        signal_validity_minutes: tradingRules.signalValidityMinutes,
        expires_at: expiresAt.toISOString(),
        buy_created_at: buyFill.createdAt.toISOString(),
        new_balance: walletAfterBuy,
        signal_token: tokenTrimmed,
        slot_key: String(slotKey),
        slot_time: String(batch.slot_time).slice(0, 8),
        daily_trade_used_before: todayUsedSignals,
        daily_trade_used_after: todayUsedSignals + 1,
        eligible_package: {
          name: eligibility.package.name,
          min_amount: eligibility.package.minAmount,
          max_amount: eligibility.package.maxAmount,
          signals_per_day: eligibility.package.signalsPerDay,
        },
      }),
      created_at: now,
      updated_at: now,
    };

    const inserted = await trx(USER_SIGNAL_LOGS_TABLE).insert(payload);
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    const txnId = await generateGlobalTxnId(trx, 'SIG');
    const orderId = buildOrderId(now, id);
    await trx(USER_SIGNAL_LOGS_TABLE).where({ id }).update({
      txn_id: txnId,
      order_id: orderId,
      updated_at: now,
    });
    const row = await trx(USER_SIGNAL_LOGS_TABLE).where({ id }).first();

    return {
      id: row.id,
      txn_id: row.txn_id || txnId,
      order_id: row.order_id || orderId,
      status: row.status || 'OPEN',
      batch_token: batch.batch_token,
      slot_key: String(slotKey),
      signal_token: row.signal_token,
      symbol,
      buy_price: livePrice,
      sell_price: simulatedSellPrice,
      investment_amount: investmentAmount,
      profit_amount: profitAmount,
      total_earned: profitAmount,
      total_return_usdt: totalReturn,
      new_balance: walletAfterBuy,
      expires_at: expiresAt,
      applied_at: row.created_at,
    };
  });
}

export async function closeExpiredSignalTrades(limit = 25) {
  await ensureUserSignalSchema();
  return db.transaction(async (trx) => {
    const rows = await trx(USER_SIGNAL_LOGS_TABLE)
      .where({ mode: 'SIGNAL', trade_status: 'OPEN' })
      .whereNotNull('expires_at')
      .where('expires_at', '<=', new Date())
      .orderBy('expires_at', 'asc')
      .limit(limit);

    const closed = [];
    for (const row of rows) {
      const investmentAmountBig = parseUnits(String(row.principal_amount || row.investment_amount || '0'), DECIMALS);
      const profitAmountBig = parseUnits(String(row.profit_amount || '0'), DECIMALS);
      const totalReturnBig = investmentAmountBig + profitAmountBig;
      const executedQty = toNumber(row.executed_qty);
      const sellPrice = toNumber(row.sell_price);
      const sellFill = await createSimulatedSpotFill({
        trx,
        userId: row.user_id,
        symbol: normalizeSignalSymbol(row.symbol || DEFAULT_SIGNAL_SYMBOL),
        side: 'SELL',
        price: sellPrice,
        qty: executedQty,
      });

      const walletBeforeSell = roundAmount(toNumber(row.wallet_balance_after_buy ?? row.new_balance));
      const walletCredit = await applyWalletCreditRecord(
        {
          userId: row.user_id,
          amount: totalReturnBig,
          type: 'signal_trade_credit',
          sourceType: 'signal_trade_sell',
          referenceId: row.batch_token || row.id,
          remark: 'Signal-mode simulated auto sell credit',
          meta: {
            signalLogId: row.id,
            signalToken: row.signal_token,
            symbol: row.symbol,
            sellTrigger: 'AUTO_SIGNAL_EXPIRY',
          },
        },
        trx
      );
      const walletAfterSell = roundAmount(walletCredit.newBalance);
      const auditJson = parseAuditJsonSafe(row.audit_json) || {};

      await trx(USER_SIGNAL_LOGS_TABLE)
        .where({ id: row.id })
        .update({
          order_status: 'FILLED',
          trade_status: 'CLOSED',
          status: 'CLOSED',
          sell_order_id: sellFill.orderId,
          sell_trade_id: sellFill.tradeId,
          linked_buy_trade_id: row.buy_trade_id || null,
          wallet_balance_before_sell: walletBeforeSell.toFixed(8),
          wallet_balance_after_sell: walletAfterSell.toFixed(8),
          sell_trigger: 'AUTO_SIGNAL_EXPIRY',
          sell_created_at: sellFill.createdAt,
          closed_at: sellFill.createdAt,
          new_balance: walletAfterSell.toFixed(8),
          updated_at: sellFill.createdAt,
          audit_json: JSON.stringify({
            ...auditJson,
            side: 'SELL',
            trade_status: 'CLOSED',
            wallet_balance_before_sell: walletBeforeSell,
            wallet_balance_after_sell: walletAfterSell,
            sell_created_at: sellFill.createdAt.toISOString(),
            closed_at: sellFill.createdAt.toISOString(),
            sell_trigger: 'AUTO_SIGNAL_EXPIRY',
            sell_order_id: sellFill.orderId,
            sell_trade_id: sellFill.tradeId,
            linked_buy_trade_id: row.buy_trade_id || null,
            new_balance: walletAfterSell,
          }),
        });

      closed.push({
        id: row.id,
        userId: row.user_id,
        symbol: row.symbol,
        sellOrderId: sellFill.orderId,
        sellTradeId: sellFill.tradeId,
      });
    }

    return closed;
  });
}

export async function getUserSignalHistory(userId) {
  await ensureUserSignalSchema();
  const rows = await db(USER_SIGNAL_LOGS_TABLE)
    .where({ user_id: userId })
    .orderBy('created_at', 'desc')
    .limit(100);

  return rows.map((row) => {
    let auditJson = null;
    try {
      auditJson =
        typeof row.audit_json === 'string'
          ? JSON.parse(row.audit_json)
          : row.audit_json || null;
    } catch {
      auditJson = null;
    }

    const slotTime = String(row.slot_time_snapshot || '').slice(0, 8);
    return {
      id: row.id,
      applied_at: row.buy_created_at || row.created_at,
      buy_created_at: row.buy_created_at || row.created_at,
      sell_created_at: row.sell_created_at || null,
      slot_key: SLOT_KEY_BYTimeSafe(slotTime),
      symbol: row.symbol || DEFAULT_SIGNAL_SYMBOL,
      mode: row.mode || 'SIGNAL',
      signal_token: row.signal_token || row.batch_token || '',
      previous_balance: toNumber(row.previous_balance),
      wallet_balance_before: toNumber(row.wallet_balance_before ?? row.previous_balance),
      wallet_balance_after_buy: toNumber(row.wallet_balance_after_buy ?? row.new_balance),
      wallet_balance_before_sell: toNumber(row.wallet_balance_before_sell),
      wallet_balance_after_sell: toNumber(row.wallet_balance_after_sell),
      investment_amount: toNumber(row.investment_amount),
      principal_amount: toNumber(row.principal_amount ?? row.investment_amount),
      buy_price: toNumber(row.buy_price),
      sell_price: toNumber(row.sell_price),
      executed_qty: toNumber(row.executed_qty),
      total_return_usdt: toNumber(row.total_return_usdt),
      profit_amount: toNumber(row.profit_amount),
      total_earned: toNumber(row.total_earned),
      new_balance: toNumber(row.new_balance),
      trade_status: row.trade_status || row.status || 'OPEN',
      order_status: row.order_status || 'FILLED',
      sell_trigger: row.sell_trigger || null,
      expires_at: row.expires_at || null,
      status: row.status || 'OPEN',
      audit_json: auditJson,
    };
  });
}

function SLOT_KEY_BYTimeSafe(slotTime) {
  return slotTime || '';
}
