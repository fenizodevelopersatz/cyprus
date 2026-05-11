import { parseUnits } from 'ethers';
import { db, withTx } from '../db.js';
import { futuresLimits, isFuturesSymbolAllowed } from '../utils/symbols.js';
import { getAccountBalance, getBalancesByNamespace, journal } from './ledgerService.js';
import { sendFuturesTradeEmail } from './mailService.js';
import { getUserContact } from './userService.js';

const MAINTENANCE_RATE = 0.005;
const HOUSE_FUTURES_NAMESPACE = 'futures:pool';
const CLOSE_REASON_MANUAL = 'MANUAL';
const CLOSE_REASON_STOP = 'STOP_LOSS';
const CLOSE_REASON_TAKE = 'TAKE_PROFIT';

function normalizeFuturesSymbol(symbol) {
  const upper = String(symbol || '').trim().toUpperCase();
  if (!upper) throw new Error('SYMBOL_REQUIRED');
  const normalized = upper.endsWith('-PERP') ? upper.slice(0, -5) : upper;
  if (!isFuturesSymbolAllowed(normalized)) throw new Error('SYMBOL_NOT_ALLOWED');
  return normalized;
}

function displaySymbol(symbol) {
  return `${symbol}-PERP`;
}

function isContractEnabled(row) {
  if (!row) return false;
  if (row.is_enabled === null || row.is_enabled === undefined) return true;
  return Boolean(row.is_enabled);
}

function contractLeverageRange(row) {
  const fallbackMin = futuresLimits.minLev;
  const fallbackMax = futuresLimits.maxLev;
  const rawMin = Number(row?.min_leverage);
  const rawMax = Number(row?.max_leverage);
  const minLev = Number.isFinite(rawMin) && rawMin > 0 ? Math.floor(rawMin) : fallbackMin;
  const candidateMax =
    Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : Math.max(minLev, fallbackMax);
  const maxLev = Math.max(candidateMax, minLev);
  return { minLev, maxLev };
}

function coerceBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on', 'enable', 'enabled'].includes(lowered)) return true;
    if (['0', 'false', 'no', 'off', 'disable', 'disabled'].includes(lowered)) return false;
  }
  return undefined;
}

function isMissingContractControlsError(err) {
  if (!err) return false;
  if (err.code === 'ER_BAD_FIELD_ERROR') {
    const msg = String(err.sqlMessage || err.message || '').toLowerCase();
    return (
      msg.includes('is_enabled') || msg.includes('min_leverage') || msg.includes('max_leverage')
    );
  }
  if (err.code === 'SQLITE_ERROR' && /no such column/i.test(err.message || '')) {
    return /is_enabled|min_leverage|max_leverage/i.test(err.message);
  }
  return false;
}

function decimalToBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) throw new Error('Invalid decimal value');
    return parseUnits(trimmed, 18);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid decimal value');
    return parseUnits(value.toFixed(18), 18);
  }
  throw new Error('Invalid decimal value');
}

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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

function normalizeTrigger(value) {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) throw new Error('INVALID_TRIGGER');
  return num;
}

function evaluateTrigger(row, markPrice) {
  if (!Number.isFinite(markPrice)) return null;
  const stopLoss = row.stop_loss !== null && row.stop_loss !== undefined ? Number(row.stop_loss) : null;
  const takeProfit =
    row.take_profit !== null && row.take_profit !== undefined ? Number(row.take_profit) : null;
  const isLong = row.side === 'LONG';
  if (stopLoss !== null) {
    const hit = isLong ? markPrice <= stopLoss : markPrice >= stopLoss;
    if (hit) return CLOSE_REASON_STOP;
  }
  if (takeProfit !== null) {
    const hit = isLong ? markPrice >= takeProfit : markPrice <= takeProfit;
    if (hit) return CLOSE_REASON_TAKE;
  }
  return null;
}

function validateSize(size, lotSize) {
  const qty = Number(size);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('INVALID_SIZE');
  const step = Number(lotSize || 0);
  if (step > 0 && qty < step) throw new Error('SIZE_TOO_SMALL');
  if (step > 0) {
    const ratio = qty / step;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-8) throw new Error('INVALID_SIZE_STEP');
  }
  return qty;
}

function validateLeverage(value, bounds = futuresLimits) {
  const lev = Math.floor(Number(value));
  const rawMin = bounds?.minLev ?? bounds?.min_leverage ?? futuresLimits.minLev;
  const rawMax = bounds?.maxLev ?? bounds?.max_leverage ?? futuresLimits.maxLev;
  const resolvedMin = Number.isFinite(rawMin) && rawMin > 0 ? Math.floor(rawMin) : futuresLimits.minLev;
  const resolvedMaxCandidate =
    Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : futuresLimits.maxLev;
  const resolvedMax = Math.max(resolvedMin, resolvedMaxCandidate);
  if (!Number.isFinite(lev) || lev < resolvedMin || lev > resolvedMax) {
    throw new Error('INVALID_LEVERAGE');
  }
  return lev;
}

function maintenanceMargin(notional) {
  return notional * MAINTENANCE_RATE;
}

function calcNotional(size, price) {
  return size * price;
}

async function requireContract(symbol, { allowDisabled = false } = {}) {
  const row = await db('market_symbols').where({ symbol }).first();
  if (!row || row.contract_type !== 'perp') throw new Error('CONTRACT_NOT_FOUND');
  if (!allowDisabled && !isContractEnabled(row)) {
    const err = new Error('CONTRACT_DISABLED');
    err.status = 400;
    throw err;
  }
  return row;
}

async function fetchContracts(symbols) {
  if (!symbols?.length) return new Map();
  const rows = await db('market_symbols').whereIn('symbol', symbols);
  const map = new Map();
  for (const row of rows) {
    if (row.contract_type === 'perp') {
      map.set(row.symbol, row);
    }
  }
  return map;
}

async function latestMarkSnapshot(symbol) {
  const tick = await db('futures_price_ticks').where({ symbol }).orderBy('timestamp', 'desc').first();
  if (tick) {
    return { price: Number(tick.price), timestamp: tick.timestamp };
  }
  const contract = await requireContract(symbol, { allowDisabled: true });
  return { price: Number(contract.last_price || 0), timestamp: null };
}

async function fundingSnapshot(symbol) {
  const row = await db('futures_funding_rates').where({ symbol }).orderBy('timestamp', 'desc').first();
  if (!row) return { rate: 0, timestamp: null };
  return { rate: Number(row.rate || 0), timestamp: row.timestamp };
}

async function markMap(symbols) {
  if (!symbols?.length) return new Map();
  const rows = await db('futures_price_ticks')
    .whereIn('symbol', symbols)
    .orderBy('timestamp', 'desc');
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.symbol)) {
      map.set(row.symbol, { price: Number(row.price), timestamp: row.timestamp });
    }
  }
  return map;
}

async function fundingMap(symbols) {
  if (!symbols?.length) return new Map();
  const rows = await db('futures_funding_rates')
    .whereIn('symbol', symbols)
    .orderBy('timestamp', 'desc');
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.symbol)) {
      map.set(row.symbol, { rate: Number(row.rate || 0), timestamp: row.timestamp });
    }
  }
  return map;
}

function formatContractPayload(market, markPrice, fundingSnapshotEntry) {
  const leverageRange = contractLeverageRange(market);
  const enabled = isContractEnabled(market);
  return {
    symbol: displaySymbol(market.symbol),
    rawSymbol: market.symbol,
    baseAsset: market.base_asset,
    quoteAsset: market.quote_asset,
    tickSize: Number(market.tick_size || 0),
    lotSize: Number(market.lot_size || 0),
    markPrice: round(markPrice, 2),
    minLeverage: leverageRange.minLev,
    maxLeverage: leverageRange.maxLev,
    maintenanceMarginRate: MAINTENANCE_RATE,
    fundingRate: fundingSnapshotEntry?.rate ?? 0,
    fundingTimestamp: fundingSnapshotEntry?.timestamp || null,
    isEnabled: enabled,
    status: enabled ? 'enabled' : 'disabled',
  };
}

function formatPositionPayload(row, markPrice, contract) {
  const entryPrice = Number(row.entry_price || 0);
  const sizeValue = Number(row.size || 0);
  const leverage = row.leverage ? Number(row.leverage) : null;
  const margin = Number(row.margin || 0);
  const mark = Number.isFinite(markPrice) && markPrice > 0 ? markPrice : entryPrice;
  const notional = leverage ? margin * leverage : calcNotional(sizeValue, entryPrice);
  const direction = row.side === 'LONG' ? 1 : -1;
  const unrealized = (mark - entryPrice) * sizeValue * direction;
  const pnlPct = margin > 0 ? (unrealized / margin) * 100 : 0;
  const maintenance = maintenanceMargin(notional);
  const size = Number(sizeValue.toFixed(6));

  return {
    id: row.id,
    symbol: displaySymbol(row.symbol),
    rawSymbol: row.symbol,
    side: row.side,
    size,
    qty: size,
    quantity: size,
    entryPrice: round(entryPrice, 2),
    markPrice: round(mark, 2),
    notional: round(notional, 2),
    margin: round(margin, 2),
    leverage,
    maintenanceMargin: round(maintenance, 2),
    unrealizedPnl: round(unrealized, 2),
    pnlPct: round(pnlPct, 2),
    stopLoss: row.stop_loss ? Number(row.stop_loss) : null,
    takeProfit: row.take_profit ? Number(row.take_profit) : null,
    status: row.status,
    quoteAsset: contract?.quote_asset || 'USDT',
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

async function loadPositionSnapshots(userId, status) {
  const query = db('futures_positions').where({ user_id: userId });
  if (status) query.andWhere({ status });
  const rows = await query.orderBy('updated_at', 'desc');
  if (!rows.length) return [];
  const symbols = [...new Set(rows.map((row) => row.symbol))];
  const [marks, contracts] = await Promise.all([markMap(symbols), fetchContracts(symbols)]);
  return rows.map((row) => {
    const snapshot = marks.get(row.symbol);
    return {
      row,
      mark: snapshot?.price ?? Number(row.entry_price || 0),
      contract: contracts.get(row.symbol),
    };
  });
}

export async function contracts({ includeDisabled = false } = {}) {
  const query = db('market_symbols').where({ contract_type: 'perp' }).orderBy('symbol');
  if (!includeDisabled) {
    query.andWhere((builder) => {
      builder.whereNull('is_enabled').orWhere('is_enabled', true);
    });
  }
  const markets = await query;
  if (!markets.length) return [];
  const symbols = markets.map((m) => m.symbol);
  const [marks, fundings] = await Promise.all([markMap(symbols), fundingMap(symbols)]);
  return markets.map((market) => {
    const mark = marks.get(market.symbol)?.price ?? Number(market.last_price || 0);
    const funding = fundings.get(market.symbol);
    return formatContractPayload(market, mark, funding);
  });
}

export async function mark(symbol) {
  const normalized = normalizeFuturesSymbol(symbol);
  const snapshot = await latestMarkSnapshot(normalized);
  return {
    symbol: normalized,
    displaySymbol: displaySymbol(normalized),
    mark: round(snapshot.price, 2),
    timestamp: snapshot.timestamp,
  };
}

export async function funding(symbol) {
  const normalized = normalizeFuturesSymbol(symbol);
  const data = await fundingSnapshot(normalized);
  return {
    symbol: normalized,
    displaySymbol: displaySymbol(normalized),
    rate: data.rate,
    timestamp: data.timestamp,
  };
}

export async function history(symbol, limit = 200) {
  const normalized = normalizeFuturesSymbol(symbol);
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 200;
  const rows = await db('futures_price_ticks')
    .where({ symbol: normalized })
    .orderBy('timestamp', 'desc')
    .limit(safeLimit);
  return rows
    .map((row) => ({
      symbol: normalized,
      displaySymbol: displaySymbol(normalized),
      price: Number(row.price),
      timestamp: row.timestamp,
    }))
    .reverse();
}




export async function account(userId) {
  const [balanceRows, positionSnapshots, realizedRow] = await Promise.all([
    getBalancesByNamespace(userId, ['futures:available', 'futures:margin']),
    loadPositionSnapshots(userId, 'OPEN'),
    db('futures_trades')
      .where({ user_id: userId })
      .sum({ total: 'realized_pnl' })
      .first(),
  ]);

  let availableMargin = 0;
  let marginUsed = 0;
  for (const row of balanceRows) {
    const amount = Number(row.amount || 0);
    if (!amount) continue;
    if (row.namespace === 'futures:available') {
      availableMargin += amount;
    } else if (row.namespace === 'futures:margin') {
      marginUsed += amount;
    }
  }

  const unrealized = positionSnapshots.reduce((sum, snapshot) => {
    const { row, mark } = snapshot;
    const entryPrice = Number(row.entry_price || 0);
    const size = Number(row.size || 0);
    const direction = row.side === 'LONG' ? 1 : -1;
    return sum + (mark - entryPrice) * size * direction;
  }, 0);

  const realized = Number(realizedRow?.total || 0);
  const balance = availableMargin + marginUsed;
  const equity = balance + unrealized;

  return {
    equity: round(equity, 2),
    balance: round(balance, 2),
    availableMargin: round(availableMargin, 2),
    marginUsed: round(marginUsed, 2),
    unrealizedPnl: round(unrealized, 2),
    realizedPnl: round(realized, 2),
  };
}

export async function openPosition(userId, payload) {
  const symbol = normalizeFuturesSymbol(payload.symbol);
  const contract = await requireContract(symbol);
  const side = String(payload.side || '').toUpperCase();
  if (!['LONG', 'SHORT'].includes(side)) throw new Error('INVALID_SIDE');

  const size = validateSize(payload.size, contract.lot_size);
  const leverage = validateLeverage(payload.leverage, contractLeverageRange(contract));
  const stopLoss = normalizeTrigger(payload.stopLoss);
  const takeProfit = normalizeTrigger(payload.takeProfit);

  const markSnapshot = await latestMarkSnapshot(symbol);
  const markPrice = markSnapshot.price;
  if (!markPrice || markPrice <= 0) throw new Error('MARK_PRICE_UNAVAILABLE');

  const notional = calcNotional(size, markPrice);
  const marginRequirement = notional / leverage;
  const maintenanceRequirement = maintenanceMargin(notional);

  if (marginRequirement <= 0) throw new Error('MARGIN_TOO_LOW');

  const marginBig = decimalToBigInt(marginRequirement);
  if (marginBig <= 0n) throw new Error('MARGIN_TOO_LOW');

  const quoteAsset = contract.quote_asset || 'USDT';
  const journalMeta = {
    action: 'open',
    symbol,
    side,
    leverage,
    userId,
  };
  let createdRow = null;
  let openTradeNotification = null;

  await withTx(async (trx) => {
    const availableBig = await getAccountBalance(
      { userId, namespace: 'futures:available', asset: quoteAsset },
      trx
    );
    if (availableBig < marginBig) throw new Error('INSUFFICIENT_MARGIN');

    const now = new Date();
    const inserted = await trx('futures_positions').insert({
      user_id: userId,
      symbol,
      side,
      size: size.toFixed(8),
      entry_price: markPrice.toFixed(8),
      leverage,
      margin: marginRequirement.toFixed(8),
      stop_loss: stopLoss !== null ? stopLoss.toFixed(8) : null,
      take_profit: takeProfit !== null ? takeProfit.toFixed(8) : null,
      status: 'OPEN',
      created_at: now,
      updated_at: now,
    });
    const positionId = resolveInsertId(inserted);
    createdRow = await trx('futures_positions').where({ id: positionId }).first();

    await journal(
      trx,
      [
        {
          account: { userId, namespace: 'futures:available', asset: quoteAsset },
          amount: -marginBig,
          meta: { ...journalMeta, positionId },
        },
        {
          account: { userId, namespace: 'futures:margin', asset: quoteAsset },
          amount: marginBig,
          meta: { ...journalMeta, positionId },
        },
      ],
      { description: `Futures ${side} ${symbol}`, meta: { ...journalMeta, positionId } }
    );

    await trx('futures_trades').insert({
      user_id: userId,
      symbol,
      side,
      size: size.toFixed(8),
      price: markPrice.toFixed(8),
      leverage,
      realized_pnl: 0,
      status: 'OPEN',
      created_at: now,
      updated_at: now,
    });
    openTradeNotification = {
      userId,
      symbol,
      side,
      price: Number(markPrice.toFixed(8)),
      quantity: Number(size.toFixed(8)),
    };
  });

  const positionPayload = createdRow
    ? formatPositionPayload(createdRow, markPrice, contract)
    : null;
  const accountSnapshot = await account(userId);

  if (openTradeNotification) {
    await dispatchFuturesEmail(openTradeNotification);
  }

  return {
    position: positionPayload,
    metrics: {
      notional: round(notional, 2),
      marginRequirement: round(marginRequirement, 2),
      maintenanceMargin: round(maintenanceRequirement, 2),
      markPrice: round(markPrice, 2),
    },
    account: accountSnapshot,
  };
}

export async function updateTriggers(userId, payload) {
  const symbol = normalizeFuturesSymbol(payload.symbol);
  const updates = {};
  if (Object.prototype.hasOwnProperty.call(payload, 'stopLoss')) {
    const stopLoss = normalizeTrigger(payload.stopLoss);
    updates.stop_loss = stopLoss !== null ? stopLoss.toFixed(8) : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'takeProfit')) {
    const takeProfit = normalizeTrigger(payload.takeProfit);
    updates.take_profit = takeProfit !== null ? takeProfit.toFixed(8) : null;
  }
  if (!Object.keys(updates).length) throw new Error('NO_UPDATES');
  updates.updated_at = new Date();

  const affected = await db('futures_positions')
    .where({ user_id: userId, symbol, status: 'OPEN' })
    .update(updates);
  if (!affected) throw new Error('POSITION_NOT_FOUND');
}

export async function close(userId, { symbol }) {
  const normalized = normalizeFuturesSymbol(symbol);
  const contract = await requireContract(normalized, { allowDisabled: true });
  const quoteAsset = contract.quote_asset || 'USDT';
  const markSnapshot = await latestMarkSnapshot(normalized);
  const closePrice = markSnapshot.price;
  if (!closePrice || closePrice <= 0) throw new Error('MARK_PRICE_UNAVAILABLE');

  let resultPayload = null;
  let closeNotification = null;

  await withTx(async (trx) => {
    const position = await trx('futures_positions')
      .where({ user_id: userId, symbol: normalized, status: 'OPEN' })
      .orderBy('created_at', 'asc')
      .first();
    if (!position) throw new Error('POSITION_NOT_FOUND');
    resultPayload = await settlePosition(trx, position, contract, closePrice, {
      reason: CLOSE_REASON_MANUAL,
    });
    closeNotification = {
      userId,
      symbol: normalized,
      side: position.side,
      price: closePrice,
      quantity: Number(position.size || 0),
      realizedPnl: resultPayload?.realizedPnl,
    };
  });

  const accountSnapshot = await account(userId);
  if (closeNotification) {
    await dispatchFuturesEmail(closeNotification);
  }
  return { ...resultPayload, account: accountSnapshot };
}

async function settlePosition(trx, position, contract, closePrice, { reason = CLOSE_REASON_MANUAL } = {}) {
  const normalized = position.symbol;
  const userId = position.user_id;
  const quoteAsset = contract.quote_asset || 'USDT';

  const size = Number(position.size || 0);
  const entryPrice = Number(position.entry_price || 0);
  const direction = position.side === 'LONG' ? 1 : -1;
  const pnlValue = (closePrice - entryPrice) * size * direction;
  const pnlAbsBig = decimalToBigInt(Math.abs(pnlValue));
  const pnlBig = pnlValue >= 0 ? pnlAbsBig : -pnlAbsBig;
  const marginBig = decimalToBigInt(position.margin || 0);
  const now = new Date();

  await trx('futures_positions')
    .where({ id: position.id })
    .update({
      status: 'CLOSED',
      updated_at: now,
      stop_loss: null,
      take_profit: null,
    });

  const journalEntries = [
    {
      account: { userId, namespace: 'futures:margin', asset: quoteAsset },
      amount: -marginBig,
      meta: { action: reason, positionId: position.id, symbol: normalized },
    },
    {
      account: { userId, namespace: 'futures:available', asset: quoteAsset },
      amount: marginBig,
      meta: { action: reason, positionId: position.id, symbol: normalized },
    },
  ];

  if (pnlBig !== 0n) {
    const houseAccount = {
      userId: null,
      namespace: HOUSE_FUTURES_NAMESPACE,
      asset: quoteAsset,
    };
    if (pnlBig > 0n) {
      journalEntries.push(
        {
          account: houseAccount,
          amount: -pnlBig,
          meta: { action: 'pnl', positionId: position.id, symbol: normalized },
        },
        {
          account: { userId, namespace: 'futures:available', asset: quoteAsset },
          amount: pnlBig,
          meta: { action: 'pnl', positionId: position.id, symbol: normalized },
        }
      );
    } else {
      const loss = -pnlBig;
      journalEntries.push(
        {
          account: { userId, namespace: 'futures:available', asset: quoteAsset },
          amount: -loss,
          meta: { action: 'pnl', positionId: position.id, symbol: normalized },
        },
        {
          account: houseAccount,
          amount: loss,
          meta: { action: 'pnl', positionId: position.id, symbol: normalized },
        }
      );
    }
  }

  await journal(
    trx,
    journalEntries,
    {
      description: `Futures close ${position.side} ${normalized}`,
      meta: { userId, positionId: position.id, symbol: normalized, reason },
    }
  );

  await trx('futures_trades').insert({
    user_id: userId,
    symbol: normalized,
    side: position.side,
    size: position.size,
    price: closePrice.toFixed(8),
    leverage: position.leverage,
    realized_pnl: pnlValue.toFixed(8),
    status: 'CLOSE',
    created_at: now,
    updated_at: now,
  });

  const normalizedSize = Number(size.toFixed(6));
  return {
    id: position.id,
    symbol: displaySymbol(normalized),
    side: position.side,
    size: normalizedSize,
    qty: normalizedSize,
    quantity: normalizedSize,
    closedPrice: round(closePrice, 2),
    realizedPnl: round(pnlValue, 2),
    updatedAt: now,
  };
}

export async function positions(userId, { status = 'OPEN' } = {}) {
  const normalizedStatus = status ? status.toUpperCase() : undefined;
  const snapshots = await loadPositionSnapshots(userId, normalizedStatus);
  return snapshots.map(({ row, mark, contract }) => formatPositionPayload(row, mark, contract));
}

export async function evaluateAutoClosePositions(limit = 50) {
  const rows = await db('futures_positions')
    .where({ status: 'OPEN' })
    .where((builder) => builder.whereNotNull('stop_loss').orWhereNotNull('take_profit'))
    .orderBy('updated_at', 'asc')
    .limit(limit);

  if (!rows.length) return { scanned: 0, closed: 0 };
  const symbols = [...new Set(rows.map((row) => row.symbol))];
  const marks = await markMap(symbols);
  const contracts = await fetchContracts(symbols);
  let closed = 0;

  for (const row of rows) {
    const mark = marks.get(row.symbol)?.price;
    if (!Number.isFinite(mark) || mark <= 0) continue;
    const reason = evaluateTrigger(row, mark);
    if (!reason) continue;
    const contract = contracts.get(row.symbol);
    try {
      const didClose = await autoClosePosition(row.id, mark, reason, contract);
      if (didClose) closed += 1;
    } catch (err) {
      console.error('[futures:autoClose]', row.id, err.message);
    }
  }

  return { scanned: rows.length, closed };
}

async function autoClosePosition(positionId, markPrice, hintReason, cachedContract = null) {
  let closed = false;
  let closeNotification = null;
  await withTx(async (trx) => {
    const position = await trx('futures_positions').where({ id: positionId }).first();
    if (!position || position.status !== 'OPEN') return;
    const trigger = evaluateTrigger(position, markPrice) || hintReason;
    if (!trigger) return;
    const contract =
      cachedContract ||
      (await requireContract(position.symbol, {
        allowDisabled: true,
      }));
    const summary = await settlePosition(trx, position, contract, markPrice, { reason: trigger });
    closed = true;
    closeNotification = {
      userId: position.user_id,
      symbol: position.symbol,
      side: position.side,
      price: markPrice,
      quantity: Number(position.size || 0),
      realizedPnl: summary?.realizedPnl,
    };
  });
  if (closed && closeNotification) {
    await dispatchFuturesEmail(closeNotification);
  }
  return closed;
}

async function dispatchFuturesEmail(payload) {
  if (!payload?.userId) return;
  try {
    const contact = await getUserContact(payload.userId);
    if (!contact?.email) return;
    await sendFuturesTradeEmail({
      to: contact.email,
      name: contact.name,
      symbol: displaySymbol(payload.symbol || ''),
      side: payload.side,
      price: round(payload.price, 2),
      quantity: Number(payload.quantity || 0),
      realizedPnl:
        payload.realizedPnl !== undefined ? round(payload.realizedPnl, 2) : undefined,
    });
  } catch (err) {
    console.error('[mail] futures trade email failed', err.message);
  }
}

export async function trades(userId, { limit = 20, cursor } = {}) {
  const safeLimit =
    Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 200) : 20;
  const query = db('futures_trades')
    .where({ user_id: userId })
    .orderBy('id', 'desc')
    .limit(safeLimit + 1);
  if (cursor) {
    query.where('id', '<', Number(cursor));
  }
  const rows = await query;
  const hasMore = rows.length > safeLimit;
  const items = rows.slice(0, safeLimit).map((row) => {
    const rawSize = Number(row.size || 0);
    const qty = Number.isFinite(rawSize) ? rawSize : 0;
    const createdAt =
      row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at || null;
    const updatedAt =
      row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at || createdAt;
    const closeReason = (row.status || '').toUpperCase();
    const isAutoClose =
      closeReason === CLOSE_REASON_STOP ||
      closeReason === CLOSE_REASON_TAKE;
    const reasonLabel =
      closeReason === CLOSE_REASON_STOP
        ? 'Stop-loss'
        : closeReason === CLOSE_REASON_TAKE
        ? 'Take-profit'
        : 'Manual';
    return {
      id: row.id,
      symbol: displaySymbol(row.symbol),
      rawSymbol: row.symbol,
      side: row.side,
      size: qty,
      qty,
      quantity: qty,
      price: Number(row.price || 0),
      leverage: row.leverage ? Number(row.leverage) : null,
      realizedPnl: Number(row.realized_pnl || 0),
      status: closeReason,
      closeReason,
      closeReasonLabel: reasonLabel,
      autoClose: isAutoClose,
      createdAt,
      updatedAt,
    };
  });
  const nextCursor =
    hasMore && items.length ? items[items.length - 1].id : null;
  return { items, nextCursor };
}

export async function updateContractControls(symbol, payload = {}) {
  const { enabled, minLeverage, maxLeverage } = payload;
  const normalized = normalizeFuturesSymbol(symbol);
  const contract = await requireContract(normalized, { allowDisabled: true });
  const updates = {};
  const hasMin = Object.prototype.hasOwnProperty.call(payload, 'minLeverage');
  const hasMax = Object.prototype.hasOwnProperty.call(payload, 'maxLeverage');

  let desiredEnabled = enabled;
  if (desiredEnabled === undefined && Object.prototype.hasOwnProperty.call(payload, 'status')) {
    const normalizedStatus = String(payload.status || '').toLowerCase();
    if (['enabled', 'enable', 'on', 'true', '1'].includes(normalizedStatus)) {
      desiredEnabled = true;
    } else if (['disabled', 'disable', 'off', 'false', '0'].includes(normalizedStatus)) {
      desiredEnabled = false;
    }
  }
  if (desiredEnabled === undefined && Object.prototype.hasOwnProperty.call(payload, 'isEnabled')) {
    desiredEnabled = payload.isEnabled;
  }
  if (desiredEnabled !== undefined) {
    const coerced = coerceBoolean(desiredEnabled);
    if (coerced === undefined) throw new Error('INVALID_STATUS');
    updates.is_enabled = coerced ? 1 : 0;
  }

  let nextMin = Number(contract.min_leverage ?? futuresLimits.minLev);
  let nextMax = Number(contract.max_leverage ?? futuresLimits.maxLev);

  if (hasMin) {
    const parsedMin = Math.floor(Number(minLeverage));
    if (!Number.isFinite(parsedMin) || parsedMin < 1) throw new Error('INVALID_MIN_LEVERAGE');
    updates.min_leverage = parsedMin;
    nextMin = parsedMin;
  }

  if (hasMax) {
    const parsedMax = Math.floor(Number(maxLeverage));
    if (!Number.isFinite(parsedMax) || parsedMax < 1) throw new Error('INVALID_MAX_LEVERAGE');
    updates.max_leverage = parsedMax;
    nextMax = parsedMax;
  }

  if ((hasMin || hasMax) && nextMin > nextMax) {
    throw new Error('INVALID_LEVERAGE_RANGE');
  }

  if (!Object.keys(updates).length) throw new Error('NO_UPDATES');

  try {
    await db('market_symbols').where({ symbol: normalized }).update(updates);
  } catch (err) {
    if (isMissingContractControlsError(err)) {
      const friendly = new Error(
        'CONTRACT_CONTROLS_NOT_MIGRATED: run the latest database migrations to add contract controls columns (is_enabled, min_leverage, max_leverage).'
      );
      friendly.status = 500;
      throw friendly;
    }
    throw err;
  }
  const updated = await db('market_symbols').where({ symbol: normalized }).first();
  const [markSnapshotEntry, fundingEntry] = await Promise.all([
    latestMarkSnapshot(normalized),
    fundingSnapshot(normalized),
  ]);
  return formatContractPayload(updated, markSnapshotEntry.price, fundingEntry);
}
