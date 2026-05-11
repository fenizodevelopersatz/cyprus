export async function up(knex) {
  await knex.schema.createTable('signal_package_settings', (table) => {
    table.increments('id').primary();
    table.decimal('min_deposit', 20, 8).notNullable().defaultTo(100);
    table.decimal('max_deposit', 20, 8).notNullable().defaultTo(25000);
    table.decimal('investment_per_trade_pct', 10, 4).notNullable().defaultTo(0);
    table.decimal('per_trade_profit_pct', 10, 4).notNullable().defaultTo(0);
    table.decimal('daily_roi_pct', 10, 4).notNullable().defaultTo(0);
    table.boolean('unlimited_last_package').notNullable().defaultTo(true);
    table.boolean('auto_package_assignment').notNullable().defaultTo(true);
    table.boolean('package_upgrade_allowed').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('signal_packages', (table) => {
    table.increments('id').primary();
    table.string('name', 120).notNullable();
    table.decimal('min_amount', 20, 8).notNullable();
    table.decimal('max_amount', 20, 8).nullable();
    table.boolean('unlimited_max').notNullable().defaultTo(false);
    table.decimal('per_trade_commission_pct', 10, 4).notNullable();
    table.integer('signals_per_day').notNullable().defaultTo(1);
    table.integer('required_level').notNullable().defaultTo(0);
    table.string('status', 24).notNullable().defaultTo('ACTIVE');
    table.text('description').nullable();
    table.integer('sort_order').notNullable().defaultTo(0);
    table.timestamps(true, true);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('signal_packages');
  await knex.schema.dropTableIfExists('signal_package_settings');
}
