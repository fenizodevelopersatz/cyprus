function padId(value, length = 6) {
  return String(Number(value) || 0).padStart(length, '0');
}

function yyyymmdd(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10).replace(/-/g, '');
}

function buildTxnId(prefix, eventAt, id) {
  return `${prefix}-${yyyymmdd(eventAt)}-${padId(id)}`;
}

async function addIfMissing(knex, table, column) {
  const exists = await knex.schema.hasColumn(table, column);
  if (!exists) {
    await knex.schema.alterTable(table, (t) => {
      t.string(column, 64).nullable().index();
    });
  }
}

async function backfillRows(knex, table, rows, prefix, dateField = 'created_at') {
  for (const row of rows) {
    if (!row.txn_id) {
      const txnId = buildTxnId(prefix, row[dateField] || Date.now(), row.id);
      await knex(table).where({ id: row.id }).update({ txn_id: txnId });
    }
  }
}

export async function up(knex) {
  const tables = [
    'deposit_transactions',
    'withdrawals',
    'wallet_ledger',
    'mlm_income_history',
    'mlm_level_achievements',
    'mlm_level_bonus_payouts',
    'user_signal_logs',
  ];

  for (const table of tables) {
    await addIfMissing(knex, table, 'txn_id');
  }

  await backfillRows(
    knex,
    'deposit_transactions',
    await knex('deposit_transactions').select('id', 'created_at', 'txn_id'),
    'TXN-DEP'
  );
  await backfillRows(
    knex,
    'withdrawals',
    await knex('withdrawals').select('id', 'requested_at', 'created_at', 'txn_id'),
    'TXN-WDR',
    'requested_at'
  );
  await backfillRows(
    knex,
    'wallet_ledger',
    await knex('wallet_ledger').select('id', 'created_at', 'txn_id'),
    'TXN-FEE'
  );
  await backfillRows(
    knex,
    'mlm_income_history',
    await knex('mlm_income_history').select('id', 'created_at', 'txn_id', 'income_type'),
    'TXN-COM'
  );
  await backfillRows(
    knex,
    'mlm_level_achievements',
    await knex('mlm_level_achievements').select('id', 'created_at', 'txn_id'),
    'TXN-LVL'
  );
  await backfillRows(
    knex,
    'mlm_level_bonus_payouts',
    await knex('mlm_level_bonus_payouts').select('id', 'created_at', 'txn_id'),
    'TXN-BON'
  );
  await backfillRows(
    knex,
    'user_signal_logs',
    await knex('user_signal_logs').select('id', 'created_at', 'txn_id'),
    'TXN-SIG'
  );
}

export async function down(knex) {
  const tables = [
    'user_signal_logs',
    'mlm_level_bonus_payouts',
    'mlm_level_achievements',
    'mlm_income_history',
    'wallet_ledger',
    'withdrawals',
    'deposit_transactions',
  ];

  for (const table of tables) {
    const exists = await knex.schema.hasColumn(table, 'txn_id');
    if (exists) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('txn_id');
      });
    }
  }
}
