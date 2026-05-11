export async function up(knex) {
  await knex.schema.createTable('signal_assets', (table) => {
    table.increments('id').primary();
    table.string('asset', 16).notNullable();
    table.string('network', 32).notNullable();
    table.string('display_name', 120).notNullable();
    table.string('network_type', 16).notNullable().defaultTo('EVM');
    table.decimal('min_deposit', 36, 18).notNullable().defaultTo(0);
    table.decimal('min_withdraw', 36, 18).notNullable().defaultTo(0);
    table.string('withdraw_fee_type', 16).notNullable().defaultTo('FIXED');
    table.decimal('withdraw_fee', 36, 18).notNullable().defaultTo(0);
    table.string('rpc_url', 255);
    table.string('chain_id', 64);
    table.string('contract_address', 191);
    table.integer('decimals').notNullable().defaultTo(18);
    table.string('deposit_wallet', 191);
    table.string('hot_wallet', 191);
    table.text('private_key');
    table.integer('confirmations').notNullable().defaultTo(12);
    table.string('full_host', 255);
    table.string('status', 24).notNullable().defaultTo('ENABLED');
    table.boolean('is_enabled').notNullable().defaultTo(true);
    table.integer('sort_order').notNullable().defaultTo(0);
    table.json('meta');
    table.timestamps(true, true);
    table.unique(['asset', 'network'], { indexName: 'signal_assets_asset_network_unique' });
    table.index(['status', 'asset'], 'signal_assets_status_asset');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('signal_assets');
}
