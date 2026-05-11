export async function up(knex) {
  const hasDepositTransactions = await knex.schema.hasTable('deposit_transactions');
  if (hasDepositTransactions) {
    const hasIsSwept = await knex.schema.hasColumn('deposit_transactions', 'is_swept');
    const hasSweptAt = await knex.schema.hasColumn('deposit_transactions', 'swept_at');
    const hasSweepTxHash = await knex.schema.hasColumn('deposit_transactions', 'sweep_tx_hash');
    const hasSweepError = await knex.schema.hasColumn('deposit_transactions', 'sweep_error');

    await knex.schema.alterTable('deposit_transactions', (t) => {
      if (!hasIsSwept) t.boolean('is_swept').notNullable().defaultTo(false);
      if (!hasSweptAt) t.datetime('swept_at').nullable();
      if (!hasSweepTxHash) t.string('sweep_tx_hash', 255).nullable();
      if (!hasSweepError) t.text('sweep_error').nullable();
    });
  }

  const hasTreasurySweepRuns = await knex.schema.hasTable('treasury_sweep_runs');
  if (!hasTreasurySweepRuns) {
    await knex.schema.createTable('treasury_sweep_runs', (t) => {
      t.increments('id').primary();
      t.string('network', 32).nullable();
      t.string('status', 32).notNullable().defaultTo('started');
      t.integer('swept_count').unsigned().notNullable().defaultTo(0);
      t.integer('failed_count').unsigned().notNullable().defaultTo(0);
      t.string('triggered_by', 32).notNullable().defaultTo('manual');
      t.integer('admin_user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
      t.json('meta').nullable();
      t.text('error_message').nullable();
      t.datetime('started_at').notNullable();
      t.datetime('finished_at').nullable();
      t.timestamps(true, true);
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('treasury_sweep_runs');

  const hasDepositTransactions = await knex.schema.hasTable('deposit_transactions');
  if (hasDepositTransactions) {
    const hasIsSwept = await knex.schema.hasColumn('deposit_transactions', 'is_swept');
    const hasSweptAt = await knex.schema.hasColumn('deposit_transactions', 'swept_at');
    const hasSweepTxHash = await knex.schema.hasColumn('deposit_transactions', 'sweep_tx_hash');
    const hasSweepError = await knex.schema.hasColumn('deposit_transactions', 'sweep_error');

    await knex.schema.alterTable('deposit_transactions', (t) => {
      if (hasIsSwept) t.dropColumn('is_swept');
      if (hasSweptAt) t.dropColumn('swept_at');
      if (hasSweepTxHash) t.dropColumn('sweep_tx_hash');
      if (hasSweepError) t.dropColumn('sweep_error');
    });
  }
}
