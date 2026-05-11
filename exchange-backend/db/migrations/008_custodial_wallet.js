// db/migrations/008_custodial_wallet.js

export async function up(knex) {
  await knex.schema.createTable('accounts', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().nullable().references('users.id').onDelete('CASCADE');
    t.string('namespace', 191).notNullable();
    t.string('asset', 32).notNullable();
    t.json('meta');
    t.timestamps(true, true);
    t.unique(['user_id', 'namespace', 'asset'], {
      indexName: 'accounts_unique_user_namespace_asset',
    });
  });

  await knex.schema.createTable('journals', (t) => {
    t.increments('id').primary();
    t.string('description', 255);
    t.json('meta');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('entries', (t) => {
    t.increments('id').primary();
    t.integer('journal_id').unsigned().references('journals.id').onDelete('CASCADE');
    t.integer('account_id').unsigned().references('accounts.id').onDelete('CASCADE');
    t.decimal('amount', 36, 18).notNullable();
    t.json('meta');
    t.timestamps(true, true);
    t.index(['journal_id']);
    t.index(['account_id']);
  });

  await knex.schema.createTable('deposit_addresses', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.string('chain', 16).notNullable();
    t.string('address', 191).notNullable();
    t.string('path', 128).notNullable();
    t.integer('address_index').unsigned().notNullable();
    t.timestamps(true, true);
    t.unique(['chain', 'address'], { indexName: 'deposit_addresses_chain_address_unique' });
    t.unique(['user_id', 'chain'], { indexName: 'deposit_addresses_user_chain_unique' });
  });

  await knex.schema.createTable('deposits', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.string('chain', 16).notNullable();
    t.string('asset', 16).notNullable();
    t.string('tx_hash', 191).notNullable();
    t.decimal('amount', 36, 18).notNullable();
    t.integer('confirmations').unsigned().defaultTo(0);
    t.integer('block_number').unsigned();
    t.datetime('confirmed_at');
    t.timestamps(true, true);
    t.unique(['chain', 'tx_hash'], { indexName: 'deposits_chain_tx_unique' });
  });

  await knex.schema.createTable('withdrawals', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.string('chain', 16).notNullable();
    t.string('asset', 16).notNullable();
    t.decimal('amount', 36, 18).notNullable();
    t.string('to', 191).notNullable();
    t.string('status', 32).notNullable().defaultTo('pending');
    t.string('tx_hash', 191);
    t.datetime('requested_at').defaultTo(knex.fn.now());
    t.datetime('broadcasted_at');
    t.datetime('confirmed_at');
    t.json('meta');
    t.timestamps(true, true);
    t.index(['status']);
    t.index(['user_id', 'status']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('withdrawals');
  await knex.schema.dropTableIfExists('deposits');
  await knex.schema.dropTableIfExists('deposit_addresses');
  await knex.schema.dropTableIfExists('entries');
  await knex.schema.dropTableIfExists('journals');
  await knex.schema.dropTableIfExists('accounts');
}
