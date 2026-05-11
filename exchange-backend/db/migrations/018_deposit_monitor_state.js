export async function up(knex) {
  const hasLogIndex = await knex.schema.hasColumn('deposits', 'log_index');
  if (!hasLogIndex) {
    await knex.schema.alterTable('deposits', (t) => {
      t.integer('log_index').unsigned().notNullable().defaultTo(0);
    });
  }

  const hasFromAddress = await knex.schema.hasColumn('deposits', 'from_address');
  if (!hasFromAddress) {
    await knex.schema.alterTable('deposits', (t) => {
      t.string('from_address', 191);
    });
  }

  const hasToAddress = await knex.schema.hasColumn('deposits', 'to_address');
  if (!hasToAddress) {
    await knex.schema.alterTable('deposits', (t) => {
      t.string('to_address', 191);
    });
  }

  try {
    await knex.schema.alterTable('deposits', (t) => {
      t.dropUnique(['chain', 'tx_hash'], 'deposits_chain_tx_unique');
    });
  } catch {}

  try {
    await knex.schema.alterTable('deposits', (t) => {
      t.unique(['chain', 'tx_hash', 'log_index'], { indexName: 'deposits_chain_tx_log_unique' });
    });
  } catch {}

  await knex.schema.createTable('deposit_scan_state', (t) => {
    t.increments('id').primary();
    t.string('network', 16).notNullable();
    t.bigInteger('last_processed_block').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['network'], { indexName: 'deposit_scan_state_network_unique' });
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('deposit_scan_state');

  try {
    await knex.schema.alterTable('deposits', (t) => {
      t.dropUnique(['chain', 'tx_hash', 'log_index'], 'deposits_chain_tx_log_unique');
    });
  } catch {}

  try {
    await knex.schema.alterTable('deposits', (t) => {
      t.unique(['chain', 'tx_hash'], { indexName: 'deposits_chain_tx_unique' });
    });
  } catch {}

  const hasToAddress = await knex.schema.hasColumn('deposits', 'to_address');
  const hasFromAddress = await knex.schema.hasColumn('deposits', 'from_address');
  const hasLogIndex = await knex.schema.hasColumn('deposits', 'log_index');

  if (hasToAddress || hasFromAddress || hasLogIndex) {
    await knex.schema.alterTable('deposits', (t) => {
      if (hasToAddress) t.dropColumn('to_address');
      if (hasFromAddress) t.dropColumn('from_address');
      if (hasLogIndex) t.dropColumn('log_index');
    });
  }
}
