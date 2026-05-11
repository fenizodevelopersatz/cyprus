import { EventEmitter } from 'events';
import { formatUnits } from 'ethers';

export const walletRealtimeEmitter = new EventEmitter();

function scheduleAfterCommit(trx, callback) {
  if (trx?.executionPromise && typeof trx.executionPromise.then === 'function') {
    trx.executionPromise
      .then(() => {
        void callback();
      })
      .catch(() => {});
    return;
  }

  void callback();
}

export function queueWalletRealtimeRefresh(userId, trx = null) {
  const normalizedUserId = Number(userId);
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) return;

  scheduleAfterCommit(trx, async () => {
    try {
      const summary = await getWalletRealtimeSnapshot(normalizedUserId);
      walletRealtimeEmitter.emit('wallet:update', {
        userId: normalizedUserId,
        summary,
      });
    } catch (error) {
      console.error('[wallet-realtime] refresh failed', {
        userId: normalizedUserId,
        message: error?.message || error,
      });
    }
  });
}

export async function getWalletRealtimeSnapshot(userId) {
  const { getMainWalletBalanceBig } = await import('./walletAccountingService.js');
  const balanceBig = await getMainWalletBalanceBig(userId);
  const amount = formatUnits(balanceBig, 18);
  return {
    mainWalletBalance: amount,
    main_wallet_balance: amount,
    updatedAt: new Date().toISOString(),
  };
}
