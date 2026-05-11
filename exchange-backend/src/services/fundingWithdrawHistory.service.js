import { db } from '../db.js';
import { buildAddressExplorerUrl, buildExplorerUrl } from './fundingMirror.service.js';

function formatCurrencyAmount(value, decimals = 2) {
  const raw = String(value ?? '0').trim();
  if (!raw) return '0.00';

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholePartRaw = '0', fractionalRaw = ''] = unsigned.split('.');
  const wholePart = wholePartRaw.replace(/^0+(?=\d)/, '') || '0';
  const paddedFraction = `${fractionalRaw}000000000000000000`;
  const fraction = paddedFraction.slice(0, decimals);

  return `${negative ? '-' : ''}${wholePart}.${fraction}`;
}

function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'object') return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return {};
  }
}

export async function getFundingWithdrawHistory(userId, { page = 1, limit = 10 } = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);

  const query = db('withdrawals').where({ user_id: userId });
  const countRow = await query.clone().count({ total: '*' }).first();
  const total = Number(countRow?.total ?? 0);
  const rows = await query
    .clone()
    .orderBy('created_at', 'desc')
    .offset((safePage - 1) * safeLimit)
    .limit(safeLimit);

  return {
    items: await Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        txn_id: row.txn_id || null,
        network: row.chain,
        token: row.asset,
        amount: formatCurrencyAmount(row.amount),
        address: row.to,
        status: row.status,
        txHash: row.tx_hash || null,
        explorerUrl: row.to ? await buildAddressExplorerUrl(row.chain, row.to) : null,
        txExplorerUrl: row.tx_hash ? await buildExplorerUrl(row.chain, row.tx_hash) : null,
        meta: parseMeta(row.meta),
        createdAt: row.requested_at || row.created_at,
        updatedAt: row.updated_at,
      }))
    ),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}
