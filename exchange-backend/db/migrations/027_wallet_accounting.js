export async function up(knex) {
  const hasMainWalletBalance = await knex.schema.hasColumn('users', 'main_wallet_balance');
  if (!hasMainWalletBalance) {
    await knex.schema.alterTable('users', (table) => {
      table.decimal('main_wallet_balance', 36, 18).notNullable().defaultTo(0);
    });
  }

  const hasWalletLedger = await knex.schema.hasTable('wallet_ledger');
  if (!hasWalletLedger) {
    await knex.schema.createTable('wallet_ledger', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      table.string('type', 64).notNullable();
      table.string('source_type', 64).notNullable();
      table.string('reference_id', 191).nullable();
      table.decimal('previous_balance', 36, 18).notNullable().defaultTo(0);
      table.decimal('credit', 36, 18).notNullable().defaultTo(0);
      table.decimal('debit', 36, 18).notNullable().defaultTo(0);
      table.decimal('new_balance', 36, 18).notNullable().defaultTo(0);
      table.string('status', 32).notNullable().defaultTo('SUCCESS');
      table.text('remark').nullable();
      table.json('meta').nullable();
      table.timestamps(true, true);
      table.index(['user_id', 'created_at'], 'wallet_ledger_user_created_idx');
      table.index(['user_id', 'type'], 'wallet_ledger_user_type_idx');
    });
  }

  const hasMlmIncomeHistory = await knex.schema.hasTable('mlm_income_history');
  if (!hasMlmIncomeHistory) {
    await knex.schema.createTable('mlm_income_history', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      table.string('income_type', 64).notNullable();
      table.integer('source_user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
      table.decimal('previous_balance', 36, 18).notNullable().defaultTo(0);
      table.decimal('amount', 36, 18).notNullable().defaultTo(0);
      table.decimal('new_balance', 36, 18).notNullable().defaultTo(0);
      table.string('status', 32).notNullable().defaultTo('SUCCESS');
      table.string('reference_id', 191).nullable();
      table.text('remark').nullable();
      table.json('meta').nullable();
      table.timestamps(true, true);
      table.index(['user_id', 'created_at'], 'mlm_income_history_user_created_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('mlm_income_history');
  await knex.schema.dropTableIfExists('wallet_ledger');

  const hasMainWalletBalance = await knex.schema.hasColumn('users', 'main_wallet_balance');
  if (hasMainWalletBalance) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('main_wallet_balance');
    });
  }
}
