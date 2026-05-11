import { db } from '../db.js';
import { cronLogger } from '../logging/loggers.js';
import { fetchNetworkOverview, getNetworkMetaByWalletNetwork } from './adminUserWalletOverview.service.js';

const SUPPORTED_NETWORKS = ['ethereum', 'bsc', 'tron'];

function normalizeNetwork(network) {
  const normalized = String(network || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'erc20' || normalized === 'eth') return 'ethereum';
  if (normalized === 'bep20' || normalized === 'bnb') return 'bsc';
  if (normalized === 'trc20' || normalized === 'trx') return 'tron';
  return SUPPORTED_NETWORKS.includes(normalized) ? normalized : '';
}

export async function scanAllUserWalletLiveBalances({ network } = {}) {
  const normalizedNetwork = normalizeNetwork(network);
  if (network && !normalizedNetwork) {
    const err = new Error('INVALID_BALANCE_SCAN_NETWORK');
    err.status = 400;
    throw err;
  }

  const walletNetworks = normalizedNetwork
    ? [getNetworkMetaByWalletNetwork(normalizedNetwork === 'ethereum' ? 'ERC20' : normalizedNetwork === 'bsc' ? 'BEP20' : 'TRC20')?.walletNetwork].filter(Boolean)
    : ['ERC20', 'BEP20', 'TRC20'];

  const rows = await db('user_wallets as uw')
    .leftJoin('users as u', 'u.id', 'uw.user_id')
    .whereIn('uw.network', walletNetworks)
    .select(
      'uw.id',
      'uw.user_id',
      'uw.network',
      'uw.address',
      'uw.created_at',
      'uw.updated_at',
      'uw.meta',
      'u.email'
    )
    .orderBy([{ column: 'uw.user_id', order: 'asc' }, { column: 'uw.network', order: 'asc' }]);

  const items = [];

  for (const row of rows) {
    const meta = getNetworkMetaByWalletNetwork(row.network);
    if (!meta) continue;

    const live = await fetchNetworkOverview(row, meta);
    const item = {
      userId: row.user_id,
      email: row.email || null,
      walletId: row.id,
      network: live.network,
      walletNetwork: live.walletNetwork,
      address: live.address,
      explorerUrl: live.explorerUrl || null,
      nativeAsset: live.nativeAsset,
      nativeBalance: live.nativeBalance,
      tokenAsset: live.tokenAsset,
      tokenBalance: live.tokenBalance,
      live: Boolean(live.live),
      error: live.error || null,
    };

    cronLogger.info(
      {
        event: 'user_wallet_live_balance_scanned',
        job: 'user_wallet_live_balance_scan',
        userId: item.userId,
        email: item.email,
        walletId: item.walletId,
        network: item.network,
        walletNetwork: item.walletNetwork,
        address: item.address,
        nativeAsset: item.nativeAsset,
        nativeBalance: item.nativeBalance,
        tokenAsset: item.tokenAsset,
        tokenBalance: item.tokenBalance,
        live: item.live,
        error: item.error,
      },
      'user_wallet_live_balance_scanned'
    );

    items.push(item);
  }

  const successfulItems = items.filter((item) => item.live);
  const failedItems = items.filter((item) => !item.live);

  return {
    completed: true,
    network: normalizedNetwork || 'all',
    scannedWallets: items.length,
    successfulWallets: successfulItems.length,
    failedWallets: failedItems.length,
    totalUsdt: successfulItems.reduce((sum, item) => sum + Number(item.tokenBalance || 0), 0).toFixed(6),
    items,
  };
}
