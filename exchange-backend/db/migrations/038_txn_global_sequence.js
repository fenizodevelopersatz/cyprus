export async function up(knex) {
  const exists = await knex.schema.hasTable('txn_global_sequence');
  if (!exists) {
    await knex.schema.createTable('txn_global_sequence', (t) => {
      t.integer('id').primary().notNullable().defaultTo(1);
      t.bigInteger('last_number').notNullable().defaultTo(0);
      t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
    await knex('txn_global_sequence').insert({ id: 1, last_number: 0 });
  }

  const ensureUnique = async (table) => {
    const hasColumn = await knex.schema.hasColumn(table, 'txn_id');
    if (hasColumn) {
      const indexes = await knex(table).columnInfo();
      if (!indexes.txn_id) return;
      // no-op: column exists
    }
  };

  await ensureUnique('deposit_transactions');
  await ensureUnique('withdrawals');
  await ensureUnique('wallet_ledger');
  await ensureUnique('mlm_income_history');
  await ensureUnique('mlm_level_achievements');
  await ensureUnique('mlm_level_bonus_payouts');
  await ensureUnique('user_signal_logs');
}

export async function down(knex) {
  const exists = await knex.schema.hasTable('txn_global_sequence');
  if (exists) {
    await knex.schema.dropTable('txn_global_sequence');
  }
}
