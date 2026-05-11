import { db, withTx } from '../db.js';

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toAmount(value) {
  return toNumber(value, 0).toFixed(18);
}

async function findAffectedUserIds(trx) {
  const rows = await trx('wallet_ledger')
    .distinct('user_id')
    .where({ source_type: 'signup_bonus' })
    .orderBy('user_id', 'asc');
  return rows.map((row) => Number(row.user_id)).filter(Boolean);
}

async function removeSignupBonusJournals(trx, userId) {
  const journalRows = await trx('journals')
    .select('id', 'meta')
    .where((builder) => {
      builder
        .where('meta', 'like', `%"reason":"signup_bonus"%`)
        .orWhere('meta', 'like', `%"reason":"signup_bonus"%`.replace(/"/g, '\\"'));
    });

  const matchingIds = [];
  for (const row of journalRows) {
    const rawMeta = typeof row.meta === 'string' ? row.meta : JSON.stringify(row.meta || {});
    if (rawMeta.includes('"reason":"signup_bonus"') && rawMeta.includes(`"userId":${Number(userId)}`)) {
      matchingIds.push(Number(row.id));
    }
  }

  if (!matchingIds.length) return 0;

  await trx('entries').whereIn('journal_id', matchingIds).del();
  await trx('journals').whereIn('id', matchingIds).del();
  return matchingIds.length;
}

async function rebuildWalletLedger(trx, userId) {
  const rows = await trx('wallet_ledger')
    .where({ user_id: userId })
    .orderBy([{ column: 'created_at', order: 'asc' }, { column: 'id', order: 'asc' }]);

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
    ledgerRowsRebuilt: rows.length,
    finalBalance: toAmount(running),
  };
}

async function repairUser(trx, userId) {
  const removedLedgerRows = await trx('wallet_ledger').where({ user_id: userId, source_type: 'signup_bonus' }).del();
  const removedJournals = await removeSignupBonusJournals(trx, userId);
  const rebuilt = await rebuildWalletLedger(trx, userId);
  return {
    userId,
    removedLedgerRows,
    removedJournals,
    ...rebuilt,
  };
}

async function main() {
  const results = await withTx(async (trx) => {
    const userIds = await findAffectedUserIds(trx);
    const output = [];
    for (const userId of userIds) {
      output.push(await repairUser(trx, userId));
    }
    return output;
  });

  console.log(JSON.stringify({ repairedUsers: results.length, results }, null, 2));
}

main()
  .catch((error) => {
    console.error('[removeLegacySignupBonus] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy().catch(() => {});
  });
