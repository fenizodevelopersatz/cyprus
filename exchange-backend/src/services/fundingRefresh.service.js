import { db } from '../db.js';
import { syncExplorerDepositsForUser } from './depositExplorerService.js';
import { normalizeFundingNetwork, syncDepositChainCursors, syncDepositTransactionsForUser, syncWalletAddressesForUser } from './fundingMirror.service.js';
import { syncUserMainWalletBalance } from './walletAccountingService.js';

const NETWORK_TO_LEGACY = {
  ethereum: 'ERC20',
  bsc: 'BEP20',
  tron: 'TRC20',
};

function extractErrorMessage(error) {
  if (!error) return 'SYNC_FAILED';
  if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  if (Array.isArray(error.errors)) {
    const nested = error.errors
      .map((item) => extractErrorMessage(item))
      .find((message) => message && message !== 'SYNC_FAILED');
    if (nested) return nested;
  }
  if (error.cause) {
    const nested = extractErrorMessage(error.cause);
    if (nested && nested !== 'SYNC_FAILED') return nested;
  }
  if (typeof error.code === 'string' && error.code.trim()) return error.code.trim();
  return 'SYNC_FAILED';
}

export async function refreshFundingDeposits(userId, { network } = {}) {
  await syncWalletAddressesForUser(userId);
  const normalizedNetwork = normalizeFundingNetwork(network);
  const targetNetworks = normalizedNetwork ? [normalizedNetwork] : ['ethereum', 'bsc', 'tron'];

  console.log(`Starting deposit refresh for user ${userId} on networks: ${targetNetworks.join(', ')} | normalizedNetwork: ${normalizedNetwork}`);
  const startedAt = new Date();
  const inserted = await db('deposit_sync_runs').insert({
    user_id: userId,
    network: normalizedNetwork || null,
    token: 'USDT',
    trigger_type: 'manual',
    status: 'started',
    synced_count: 0,
    skipped_count: 0,
    started_at: startedAt,
    created_at: startedAt,
    updated_at: startedAt,
  });
  const runId = Array.isArray(inserted) ? inserted[0] : inserted;

  let syncedCount = 0;
  let skippedCount = 0;
  const networks = [];
  const failures = [];

  try {
    for (const item of targetNetworks) {
      try {
        const result = await syncExplorerDepositsForUser(userId, NETWORK_TO_LEGACY[item]);
        syncedCount += Number(result?.synced || 0);
        skippedCount += Number(result?.skipped || 0);
        networks.push({
          network: item,
          synced: Number(result?.synced || 0),
          skipped: Number(result?.skipped || 0),
          address: result?.address || null,
          status: 'completed',
        });
      } catch (error) {
        const message = extractErrorMessage(error);
        failures.push({ network: item, message });
        networks.push({
          network: item,
          synced: 0,
          skipped: 0,
          address: null,
          status: 'failed',
          error: message,
        });
      }
    }

    if (failures.length === targetNetworks.length) {
      const err = new Error(
        failures.length === 1
          ? failures[0].message
          : failures.map((item) => `${item.network}: ${item.message}`).join('; ')
      );
      err.status = 400;
      throw err;
    }

    await syncDepositTransactionsForUser(userId);
    await syncUserMainWalletBalance(userId);
    await syncDepositChainCursors();

    const finishedAt = new Date();
    await db('deposit_sync_runs').where({ id: runId }).update({
      status: 'completed',
      synced_count: syncedCount,
      skipped_count: skippedCount,
      finished_at: finishedAt,
      meta: JSON.stringify({ networks }),
      updated_at: finishedAt,
    });

    return {
      runId,
      network: normalizedNetwork || null,
      synced: syncedCount,
      skipped: skippedCount,
      networks,
      partial: failures.length > 0,
      errors: failures,
      updatedAt: finishedAt.toISOString(),
    };
  } catch (err) {
    console.error(err);
    const finishedAt = new Date();
    await db('deposit_sync_runs').where({ id: runId }).update({
      status: 'failed',
      synced_count: syncedCount,
      skipped_count: skippedCount,
      error_message: extractErrorMessage(err),
      finished_at: finishedAt,
      updated_at: finishedAt,
    });
    err.message = extractErrorMessage(err);
    throw err;
  }
}
