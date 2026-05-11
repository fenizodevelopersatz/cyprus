import { db } from '../db.js';
import {
  buildCanonicalDepositTransactionIdsQuery,
  buildExplorerUrl,
  getFundingType,
  normalizeFundingNetwork,
  syncDepositTransactionsForUser,
} from './fundingMirror.service.js';
import { buildFundingTxnId } from './txnIdService.js';

export async function getFundingDepositHistory(userId, { network, page = 1, limit = 10 } = {}) {
  await syncDepositTransactionsForUser(userId);

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const normalizedNetwork = normalizeFundingNetwork(network);
  const canonicalIdsQuery = buildCanonicalDepositTransactionIdsQuery(userId, {
    network: normalizedNetwork,
    token: 'USDT',
  });

  const countRow = await db
    .from(canonicalIdsQuery.clone().as('canonical_deposits'))
    .count({ total: '*' })
    .first();
  const total = Number(countRow?.total ?? 0);
  const items = await db('deposit_transactions')
    .whereIn('id', canonicalIdsQuery.clone())
    .orderBy('created_at', 'desc')
    .offset((safePage - 1) * safeLimit)
    .limit(safeLimit);

  const mappedItems = await Promise.all(items.map(async (row) => ({
    id: row.id,
    txn_id: row.txn_id || buildFundingTxnId('deposit', row.created_at, row.id),
    hash: row.tx_hash,
    network: row.network,
    type: row.type || getFundingType(row.network),
    token: row.token,
    amount: row.amount_decimal,
    createdAt: row.created_at,
    explorerUrl: await buildExplorerUrl(row.network, row.tx_hash),
    status: row.status,
  })));

  return {
    items: mappedItems,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}
