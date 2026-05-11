import { db, withTx } from '../db.js';
import { creditDeposit } from './ledgerService.js';
import { applyFirstDepositReferralRewards } from './fundingDepositService.js';

let depositsColumnCache = null;

async function getDepositsColumnSet(trx) {
  if (depositsColumnCache) return depositsColumnCache;
  const conn = trx || db;
  const columns = await conn('information_schema.columns')
    .whereRaw('table_schema = database()')
    .andWhere({ table_name: 'deposits' })
    .select('column_name');
  depositsColumnCache = new Set(columns.map((row) => row.column_name));
  return depositsColumnCache;
}

export function normalizeAddress(network, address) {
  const raw = String(address || '').trim();
  if (!raw) return raw;
  return String(network || '').trim().toUpperCase() === 'TRC20' ? raw : raw.toLowerCase();
}

export async function depositExists(trx, { chain, txHash, logIndex }) {
  const normalizedChain = String(chain || '').trim().toUpperCase();
  const normalizedHash = String(txHash || '').trim();
  const normalizedLogIndex = Number(logIndex ?? 0);

  const row = await trx('deposits')
    .where({
      chain: normalizedChain,
      tx_hash: normalizedHash,
    })
    .andWhere((builder) => {
      builder.where({ log_index: normalizedLogIndex });
      if (normalizedChain === 'TRC20') {
        builder.orWhereNull('log_index');
      }
    })
    .first();

  if (row) return true;

  if (normalizedChain === 'TRC20') {
    const hashOnlyRow = await trx('deposits')
      .where({
        chain: normalizedChain,
        tx_hash: normalizedHash,
      })
      .first();
    return Boolean(hashOnlyRow);
  }

  return Boolean(row);
}

export async function saveDepositAndCredit({
  userId,
  chain,
  asset,
  txHash,
  amount,
  blockNumber,
  confirmations,
  logIndex = 0,
  fromAddress = null,
  toAddress = null,
  meta = null,
}) {
  if (!userId) throw new Error('USER_ID_REQUIRED');
  if (!chain) throw new Error('CHAIN_REQUIRED');
  if (!asset) throw new Error('ASSET_REQUIRED');
  if (!txHash) throw new Error('TX_HASH_REQUIRED');

  const normalizedChain = String(chain).trim().toUpperCase();
  const normalizedHash = String(txHash).trim();

  return withTx(async (trx) => {
    const exists = await depositExists(trx, {
      chain: normalizedChain,
      txHash: normalizedHash,
      logIndex,
    });
    if (exists) return false;

    const now = new Date();
    const depositRecord = {
      user_id: userId,
      chain: normalizedChain,
      asset: String(asset).trim().toUpperCase(),
      tx_hash: normalizedHash,
      amount: String(amount),
      confirmations: Number(confirmations ?? 0),
      block_number: blockNumber !== undefined && blockNumber !== null ? Number(blockNumber) : null,
      log_index: Number(logIndex ?? 0),
      from_address: fromAddress ? normalizeAddress(normalizedChain, fromAddress) : null,
      to_address: toAddress ? normalizeAddress(normalizedChain, toAddress) : null,
      confirmed_at: now,
      created_at: now,
      updated_at: now,
      meta: meta ? JSON.stringify(meta) : null,
      raw_payload: meta ? JSON.stringify(meta) : null,
      source: meta?.source || 'explorer_refresh',
      network_key:
        normalizedChain === 'ERC20' ? 'ethereum' : normalizedChain === 'BEP20' ? 'bsc' : normalizedChain === 'TRC20' ? 'tron' : null,
      token_key: 'usdt',
      status: 'credited',
      credited: true,
      credited_at: now,
      first_seen_at: now,
      last_seen_at: now,
      last_checked_at: now,
      confirmation_target: Number(confirmations ?? 0),
    };

    const availableColumns = await getDepositsColumnSet(trx);
    const filteredRecord = Object.fromEntries(
      Object.entries(depositRecord).filter(([key]) => availableColumns.has(key))
    );

    await trx('deposits').insert(filteredRecord);

    await creditDeposit(userId, String(asset).trim().toUpperCase(), String(amount), trx);
    await applyFirstDepositReferralRewards(trx, {
      userId,
      referenceKey: txHash,
      depositAmount: amount,
      now,
    });
    return true;
  });
}
