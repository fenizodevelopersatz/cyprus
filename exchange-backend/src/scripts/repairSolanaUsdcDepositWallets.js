import { db, withTx } from '../db.js';
import { applyWalletCreditRecord } from '../services/walletAccountingService.js';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function hasWalletCredit(trx, depositId) {
  const row = await trx('wallet_ledger')
    .where({
      type: 'deposit_credit',
      source_type: 'deposit',
      reference_id: String(depositId),
    })
    .first('id');
  return Boolean(row);
}

async function repairDeposit(trx, row, { dryRun = false } = {}) {
  if (await hasWalletCredit(trx, row.id)) {
    return { depositId: row.id, userId: row.user_id, skipped: true, reason: 'wallet_credit_exists' };
  }

  const amount = String(row.amount || '0');
  if (toNumber(amount) <= 0) {
    return { depositId: row.id, userId: row.user_id, skipped: true, reason: 'invalid_amount' };
  }

  if (dryRun) {
    return { depositId: row.id, userId: row.user_id, skipped: false, dryRun: true, amount };
  }

  const result = await applyWalletCreditRecord(
    {
      userId: row.user_id,
      amount,
      type: 'deposit_credit',
      sourceType: 'deposit',
      referenceId: row.id,
      remark: 'Successful USDC deposit credited to main wallet',
      meta: { asset: 'USDC', depositId: row.id, repaired: true },
      suppressMlmRefresh: true,
      investment: { enabled: true, amount },
    },
    trx
  );

  return {
    depositId: row.id,
    userId: row.user_id,
    skipped: false,
    amount,
    txnId: result?.txnId || null,
    newBalance: result?.newBalance || null,
    newInvestmentBalance: result?.newInvestmentBalance || null,
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const results = await withTx(async (trx) => {
    const rows = await trx('deposits')
      .where({ network_key: 'solana', credited: 1 })
      .where((query) => {
        query.where({ asset: 'USDC' }).orWhere({ token_key: 'usdc' });
      })
      .orderBy('id', 'asc');

    const output = [];
    for (const row of rows) {
      output.push(await repairDeposit(trx, row, { dryRun }));
    }
    return output;
  });

  console.log(JSON.stringify({ dryRun, checkedDeposits: results.length, results }, null, 2));
}

main()
  .catch((error) => {
    console.error('[repairSolanaUsdcDepositWallets] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy().catch(() => {});
  });
