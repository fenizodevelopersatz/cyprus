import { parseUnits, formatUnits } from 'ethers';
import { db, withTx } from '../db.js';
import {
  applyWalletCreditRecord,
  classifyBonusReason,
} from './walletAccountingService.js';

const DECIMALS = 18;

function toBigIntAmount(amount) {
  if (typeof amount === 'bigint') return amount;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) throw new Error('Invalid amount');
    return parseUnits(amount.toString(), DECIMALS);
  }
  if (typeof amount === 'string') {
    if (!amount.trim()) throw new Error('Invalid amount');
    return parseUnits(amount.trim(), DECIMALS);
  }
  throw new Error('Invalid amount');
}

function normaliseAmountString(amount) {
  return formatUnits(amount, DECIMALS);
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

export async function getOrCreateAccount(
  { userId = null, namespace, asset },
  trx = null
) {
  if (!namespace || !asset) throw new Error('Account namespace and asset required');
  const conn = trx || db;
  const existing = await conn('accounts')
    .where({
      user_id: userId ?? null,
      namespace,
      asset,
    })
    .first();
  if (existing) return existing;
  const now = new Date();
  const inserted = await conn('accounts').insert({
    user_id: userId ?? null,
    namespace,
    asset,
    created_at: now,
    updated_at: now,
  });
  const accountId = resolveInsertId(inserted);
  return conn('accounts').where({ id: accountId }).first();
}

export async function journal(trx, entries, { description, meta } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Journal entries required');
  }
  const conn = trx || db;
  const prepared = [];
  let sum = 0n;

  for (const entry of entries) {
    if (!entry?.account) throw new Error('Entry account is required');
    if (entry.amount === undefined || entry.amount === null) {
      throw new Error('Entry amount is required');
    }
    const amountBig = toBigIntAmount(entry.amount);
    sum += amountBig;
    const account = await getOrCreateAccount(entry.account, conn);
    prepared.push({
      accountId: account.id,
      amountBig,
      meta: entry.meta || null,
    });
  }

  if (sum !== 0n) {
    throw new Error('Journal is not balanced');
  }

  const now = new Date();
  const inserted = await conn('journals').insert({
    description: description || null,
    meta: meta ? JSON.stringify(meta) : null,
    created_at: now,
    updated_at: now,
  });
  const journalId = resolveInsertId(inserted);

  for (const preparedEntry of prepared) {
    await conn('entries').insert({
      journal_id: journalId,
      account_id: preparedEntry.accountId,
      amount: normaliseAmountString(preparedEntry.amountBig),
      meta: preparedEntry.meta ? JSON.stringify(preparedEntry.meta) : null,
      created_at: now,
      updated_at: now,
    });
  }

  return journalId;
}

export async function getAccountBalance(
  { userId = null, namespace, asset },
  trx = null
) {
  const conn = trx || db;
  const account = await getOrCreateAccount({ userId, namespace, asset }, conn);
  const row = await conn('entries')
    .where({ account_id: account.id })
    .sum({ total: 'amount' })
    .first();
  const total = row?.total ?? '0';
  return parseUnits(total.toString(), DECIMALS);
}

export async function getBalancesByNamespace(userId, namespaces = [], trx = null) {
  if (!userId) throw new Error('userId required');
  if (!Array.isArray(namespaces) || !namespaces.length) return [];
  const conn = trx || db;
  const rows = await conn('accounts as a')
    .leftJoin('entries as e', 'a.id', 'e.account_id')
    .where('a.user_id', userId)
    .whereIn('a.namespace', namespaces)
    .groupBy('a.namespace', 'a.asset')
    .select('a.namespace', 'a.asset')
    .sum({ total: 'e.amount' });

  return rows.map((row) => ({
    namespace: row.namespace,
    asset: row.asset,
    amount: row.total ? row.total.toString() : '0',
  }));
}

export async function creditDeposit(userId, asset, amount, trx = null) {
  if (!userId || !asset) throw new Error('Invalid deposit payload');
  const amountBig = toBigIntAmount(amount);
  if (amountBig <= 0n) throw new Error('Deposit amount must be positive');
  const execute = async (conn) => {
    await journal(
      conn,
      [
        {
          account: { userId: null, namespace: 'hot:wallet', asset },
          amount: -amountBig,
          meta: { reason: 'deposit', userId },
        },
        {
          account: { userId, namespace: 'spot:available', asset },
          amount: amountBig,
          meta: { reason: 'deposit' },
        },
      ],
      { description: `Deposit credit ${asset}`, meta: { userId, asset } }
    );

    if (String(asset).toUpperCase() === 'USDT') {
      await applyWalletCreditRecord(
        {
          userId,
          amount: amountBig,
          type: 'deposit_credit',
          sourceType: 'deposit',
          remark: 'Successful USDT deposit credited to main wallet',
          meta: { asset },
        },
        conn
      );
    }
  };

  if (trx) {
    return execute(trx);
  }

  return withTx(async (innerTrx) => execute(innerTrx));
}

export async function creditBonus(userId, asset, amount, { reason } = {}, trx = null) {
  if (!userId || !asset) throw new Error('Invalid bonus payload');
  const amountBig = toBigIntAmount(amount);
  if (amountBig <= 0n) throw new Error('Bonus amount must be positive');
  const execute = async (conn) => {
    await journal(
      conn,
      [
        {
          account: { userId: null, namespace: 'bonus:pool', asset },
          amount: -amountBig,
          meta: { reason: reason || 'bonus', userId },
        },
        {
          account: { userId, namespace: 'spot:available', asset },
          amount: amountBig,
          meta: { reason: reason || 'bonus' },
        },
      ],
      { description: `Bonus credit ${asset}`, meta: { userId, reason } }
    );

    if (String(asset).toUpperCase() === 'USDT') {
      const classification = classifyBonusReason(reason);
      await applyWalletCreditRecord(
        {
          userId,
          amount: amountBig,
          type: classification.ledgerType,
          sourceType: classification.sourceType,
          remark: classification.isMlm
            ? 'MLM income credited to main wallet'
            : 'Bonus credited to main wallet',
          meta: { asset, reason },
          mlm: classification.isMlm
            ? {
                incomeType: classification.sourceType,
              }
            : null,
        },
        conn
      );
    }
  };

  if (trx) {
    return execute(trx);
  }

  return withTx(async (innerTrx) => execute(innerTrx));
}



// --- FUTURES HELPERS (pure JS/ESM) -----------------------------------------

/** BigInt balance of a specific account namespace/asset for a user */
export async function getUserBalanceBig(userId, namespace, asset, trx = null) {
  // reuses your getAccountBalance which returns BigInt (scaled 1e18)
  return getAccountBalance({ userId, namespace, asset }, trx);
}

/** +amount to futures:available (e.g., bridge from spot or admin credit) */
export async function creditFuturesAvailable(
  userId,
  asset,
  amount,
  { reason = 'futures_credit' } = {},
  trx = null
) {
  const amountBig = toBigIntAmount(amount);
  if (amountBig <= 0n) throw new Error('Amount must be positive');

  const execute = async (conn) =>
    journal(
      conn,
      [
        // source can be a system pool; change name if you prefer
        { account: { userId: null, namespace: 'futures:treasury', asset }, amount: -amountBig, meta: { reason, userId } },
        { account: { userId, namespace: 'futures:available', asset },      amount:  amountBig, meta: { reason } },
      ],
      { description: `Futures credit ${asset}`, meta: { userId, asset, reason } }
    );

  return trx ? execute(trx) : withTx(async (t) => execute(t));
}

/** -amount from futures:available (withdrawal or move elsewhere) */
export async function debitFuturesAvailable(
  userId,
  asset,
  amount,
  { reason = 'futures_debit' } = {},
  trx = null
) {
  const amountBig = toBigIntAmount(amount);
  if (amountBig <= 0n) throw new Error('Amount must be positive');

  const execute = async (conn) => {
    const bal = await getUserBalanceBig(userId, 'futures:available', asset, conn);
    if (bal < amountBig) throw new Error('Insufficient available margin');

    return journal(
      conn,
      [
        { account: { userId,  namespace: 'futures:available', asset }, amount: -amountBig, meta: { reason } },
        { account: { userId: null, namespace: 'futures:treasury', asset }, amount:  amountBig, meta: { reason, userId } },
      ],
      { description: `Futures debit ${asset}`, meta: { userId, asset, reason } }
    );
  };

  return trx ? execute(trx) : withTx(async (t) => execute(t));
}

/** Move margin: futures:available -> futures:margin (allocate on order open) */
export async function allocateFuturesMargin(
  userId,
  asset,
  amount,
  { memo = 'allocate margin' } = {},
  trx = null
) {
  const amountBig = toBigIntAmount(amount);
  if (amountBig <= 0n) throw new Error('Amount must be positive');

  const execute = async (conn) => {
    const available = await getUserBalanceBig(userId, 'futures:available', asset, conn);
    if (available < amountBig) throw new Error('Insufficient available margin');

    return journal(
      conn,
      [
        { account: { userId, namespace: 'futures:available', asset }, amount: -amountBig, meta: { reason: 'MARGIN_MOVE', memo } },
        { account: { userId, namespace: 'futures:margin',    asset }, amount:  amountBig, meta: { reason: 'MARGIN_MOVE', memo } },
      ],
      { description: `Futures allocate margin ${asset}`, meta: { userId, asset, memo } }
    );
  };

  return trx ? execute(trx) : withTx(async (t) => execute(t));
}

/** Move margin back: futures:margin -> futures:available (release on close) */
export async function releaseFuturesMargin(
  userId,
  asset,
  amount,
  { memo = 'release margin' } = {},
  trx = null
) {
  const amountBig = toBigIntAmount(amount);
  if (amountBig <= 0n) throw new Error('Amount must be positive');

  const execute = async (conn) => {
    const marginBal = await getUserBalanceBig(userId, 'futures:margin', asset, conn);
    if (marginBal < amountBig) throw new Error('Insufficient margin balance');

    return journal(
      conn,
      [
        { account: { userId, namespace: 'futures:margin',    asset }, amount: -amountBig, meta: { reason: 'MARGIN_MOVE', memo } },
        { account: { userId, namespace: 'futures:available', asset }, amount:  amountBig, meta: { reason: 'MARGIN_MOVE', memo } },
      ],
      { description: `Futures release margin ${asset}`, meta: { userId, asset, memo } }
    );
  };

  return trx ? execute(trx) : withTx(async (t) => execute(t));
}

/**
 * Settle realized PnL to futures:available.
 * `pnl` can be positive (profit) or negative (loss).
 * Does not move margin; pair with releaseFuturesMargin as needed.
 */
export async function settleFuturesPnl(
  userId,
  asset,
  pnl,
  { tradeId, memo = 'realized pnl' } = {},
  trx = null
) {
  const pnlBig = toBigIntAmount(pnl);
  if (pnlBig === 0n) return;

  // booked vs a system P&L bucket; rename if you like
  const execute = async (conn) =>
    journal(
      conn,
      [
        // If pnl > 0: system pays user; if pnl < 0: user pays system.
        { account: { userId: null, namespace: 'futures:pnl_bucket', asset }, amount: -pnlBig, meta: { tradeId, memo, userId } },
        { account: { userId,     namespace: 'futures:available',   asset }, amount:  pnlBig, meta: { tradeId, memo } },
      ],
      { description: `Futures realized PnL ${asset}`, meta: { userId, asset, tradeId, memo } }
    );

  return trx ? execute(trx) : withTx(async (t) => execute(t));
}


// await creditFuturesAvailable('33', 'USDT', '100');  );
// await allocateFuturesMargin('33', 'USDT', '20', { memo: 'open BTCUSDT-PERP' } );
// await releaseFuturesMargin(userId, 'USDT', '20', { memo: 'close BTCUSDT-PERP' });
// await settleFuturesPnl(userId, 'USDT', '3.25', { tradeId });
// // withdraw 50 from futures wallet
// await debitFuturesAvailable(userId, 'USDT', '50');
