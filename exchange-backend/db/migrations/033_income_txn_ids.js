export async function up(knex) {
  const addIfMissing = async (table, column, cb) => {
    if (await knex.schema.hasTable(table) && !(await knex.schema.hasColumn(table, column))) {
      await knex.schema.alterTable(table, cb);
    }
  };

  await addIfMissing('wallet_ledger', 'txn_id', (t) => t.string('txn_id', 64).nullable().index());
  await addIfMissing('mlm_income_history', 'txn_id', (t) => t.string('txn_id', 64).nullable().index());
  await addIfMissing('mlm_level_achievements', 'txn_id', (t) => t.string('txn_id', 64).nullable().index());
  await addIfMissing('mlm_level_bonus_payouts', 'txn_id', (t) => t.string('txn_id', 64).nullable().index());
  await addIfMissing('user_signal_logs', 'txn_id', (t) => t.string('txn_id', 64).nullable().index());
  await addIfMissing('user_signal_logs', 'order_id', (t) => t.string('order_id', 64).nullable().index());
}

export async function down(knex) {
  const dropIfExists = async (table, column) => {
    if (await knex.schema.hasTable(table) && await knex.schema.hasColumn(table, column)) {
      await knex.schema.alterTable(table, (t) => t.dropColumn(column));
    }
  };

  await dropIfExists('user_signal_logs', 'order_id');
  await dropIfExists('user_signal_logs', 'txn_id');
  await dropIfExists('mlm_level_bonus_payouts', 'txn_id');
  await dropIfExists('mlm_level_achievements', 'txn_id');
  await dropIfExists('mlm_income_history', 'txn_id');
  await dropIfExists('wallet_ledger', 'txn_id');
}
