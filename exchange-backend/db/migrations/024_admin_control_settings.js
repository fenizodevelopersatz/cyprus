export async function up(knex) {
  const hasTable = await knex.schema.hasTable('admin_trading_rules');
  if (hasTable) return; // Skip if table already exists

  await knex.schema.createTable('admin_trading_rules', (table) => {
    table.bigIncrements('id').primary();
    table.decimal('investment_per_trade_percent', 10, 2).notNullable().defaultTo(1.0);
    table.decimal('daily_percent_per_trade', 10, 2).notNullable().defaultTo(0.65);
    table.integer('signal_validity_minutes').notNullable().defaultTo(10);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.bigInteger('updated_by').unsigned().nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  const hasTable2 = await knex.schema.hasTable('admin_trade_time_slots');
  if (hasTable2) {
    // Continue to next table
  } else {
    await knex.schema.createTable('admin_trade_time_slots', (table) => {
      table.bigIncrements('id').primary();
      table.string('slot_name', 100).notNullable();
      table.time('slot_time').notNullable();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasTable3 = await knex.schema.hasTable('admin_package_tier_settings');
  if (hasTable3) {
    // Continue to next table
  } else {
    await knex.schema.createTable('admin_package_tier_settings', (table) => {
      table.bigIncrements('id').primary();
      table.string('package_name', 100).notNullable();
      table.decimal('min_amount', 18, 2).notNullable();
      table.string('max_amount', 50).notNullable();
      table.integer('signals_per_day').notNullable().defaultTo(0);
      table.string('required_level', 100).notNullable().defaultTo('None');
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasTable4 = await knex.schema.hasTable('admin_birthday_gift_settings');
  if (hasTable4) {
    // Table already exists, skip
  } else {
    await knex.schema.createTable('admin_birthday_gift_settings', (table) => {
      table.bigIncrements('id').primary();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.string('minimum_eligible_level', 100).notNullable().defaultTo('Level 3');
      table.decimal('gift_amount', 18, 2).notNullable().defaultTo(10.0);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.bigInteger('updated_by').unsigned().nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('admin_birthday_gift_settings');
  await knex.schema.dropTableIfExists('admin_package_tier_settings');
  await knex.schema.dropTableIfExists('admin_trade_time_slots');
  await knex.schema.dropTableIfExists('admin_trading_rules');
}
