import { db, withTx } from '../db.js';

function toAmount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(18) : '0.000000000000000000';
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function getUserIds(trx) {
  const rows = await trx('wallet_ledger').distinct('user_id').orderBy('user_id', 'asc');
  return rows.map((row) => Number(row.user_id)).filter((id) => Number.isFinite(id) && id > 0);
}

async function rebuildUserWallet(trx, userId) {
  const rows = await trx('wallet_ledger')
    .where({ user_id: userId })
    .orderBy([{ column: 'id', order: 'desc' }]);

  let running = 0;
  for (const row of rows) {
    const credit = toNumber(row.credit);
    const debit = toNumber(row.debit);
    const previousBalance = running;
    const newBalance = previousBalance + credit - debit;

    await trx('wallet_ledger')
      .where({ id: row.id })
      .update({
        previous_balance: toAmount(previousBalance),
        new_balance: toAmount(newBalance),
        updated_at: new Date(),
      });

    running = newBalance;
  }

  await trx('users')
    .where({ id: userId })
    .update({
      main_wallet_balance: toAmount(running),
      updated_at: new Date(),
    });

  return {
    userId,
    ledgerRows: rows.length,
    finalBalance: toAmount(running),
  };
}

async function main() {
  const results = await withTx(async (trx) => {
    const userIds = await getUserIds(trx);
    const repaired = [];
    for (const userId of userIds) {
      repaired.push(await rebuildUserWallet(trx, userId));
    }
    return repaired;
  });

  console.log(JSON.stringify({ repairedUsers: results.length, results }, null, 2));
}

main()
  .catch((error) => {
    console.error('[repairWalletBalances] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy().catch(() => {});
  });
