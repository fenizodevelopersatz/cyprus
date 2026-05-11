export async function up(knex) {
  if (!(await knex.schema.hasTable('control_system_trading_flow_settings'))) {
    await knex.schema.createTable('control_system_trading_flow_settings', (table) => {
      table.bigIncrements('id').primary();
      table.decimal('investment_per_trade_percent', 10, 2).notNullable().defaultTo(1.0);
      table.decimal('daily_percent_per_trade', 10, 2).notNullable().defaultTo(0.65);
      table.integer('signal_validity_minutes').notNullable().defaultTo(10);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.bigInteger('updated_by').unsigned().nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('trade_slots'))) {
    await knex.schema.createTable('trade_slots', (table) => {
      table.bigIncrements('id').primary();
      table.string('slot_name', 100).notNullable();
      table.time('slot_time').notNullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('trade_slot_batches'))) {
    await knex.schema.createTable('trade_slot_batches', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('slot_id').unsigned().notNullable().references('id').inTable('trade_slots');
      table.date('slot_date').notNullable();
      table.time('slot_time').notNullable();
      table.string('batch_token', 10).notNullable().unique();
      table.json('token_history_json').nullable();
      table.string('status', 50).notNullable().defaultTo('active');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.unique(['slot_id', 'slot_date'], { indexName: 'trade_slot_batches_slot_date_unique' });
      table.index(['slot_date', 'slot_time'], 'trade_slot_batches_date_time_idx');
    });
  } else if (!(await knex.schema.hasColumn('trade_slot_batches', 'token_history_json'))) {
    await knex.schema.alterTable('trade_slot_batches', (table) => {
      table.json('token_history_json').nullable();
    });
  }

  if (!(await knex.schema.hasTable('package_tier_settings'))) {
    await knex.schema.createTable('package_tier_settings', (table) => {
      table.bigIncrements('id').primary();
      table.string('package_name', 100).notNullable();
      table.decimal('min_amount', 18, 2).notNullable();
      table.decimal('max_amount', 18, 2).nullable();
      table.integer('signals_per_day').notNullable().defaultTo(1);
      table.integer('required_level_id').nullable();
      table.boolean('is_active').notNullable().defaultTo(true);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('birthday_gift_settings'))) {
    await knex.schema.createTable('birthday_gift_settings', (table) => {
      table.bigIncrements('id').primary();
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.string('minimum_eligible_level', 100).notNullable().defaultTo('Level 3');
      table.decimal('gift_amount', 18, 2).notNullable().defaultTo(10.0);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.integer('sort_order').notNullable().defaultTo(1);
      table.bigInteger('updated_by').unsigned().nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('signals'))) {
    await knex.schema.createTable('signals', (table) => {
      table.increments('id').primary();
      table.text('signal_text').nullable();
      table.bigInteger('trade_slot_batch_id').unsigned().nullable().references('id').inTable('trade_slot_batches');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  } else if (!(await knex.schema.hasColumn('signals', 'trade_slot_batch_id'))) {
    await knex.schema.alterTable('signals', (table) => {
      table.bigInteger('trade_slot_batch_id').unsigned().nullable().references('id').inTable('trade_slot_batches');
    });
  }

  if (!(await knex.schema.hasTable('user_signal_logs'))) {
    await knex.schema.createTable('user_signal_logs', (table) => {
      table.increments('id').primary();
      table.integer('signal_id').unsigned().nullable().references('id').inTable('signals');
      table.integer('user_id').unsigned().nullable().references('id').inTable('users');
      table.bigInteger('trade_slot_batch_id').unsigned().nullable().references('id').inTable('trade_slot_batches');
      table.string('batch_token', 10).nullable();
      table.time('slot_time_snapshot').nullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  } else {
    if (!(await knex.schema.hasColumn('user_signal_logs', 'trade_slot_batch_id'))) {
      await knex.schema.alterTable('user_signal_logs', (table) => {
        table.bigInteger('trade_slot_batch_id').unsigned().nullable().references('id').inTable('trade_slot_batches');
      });
    }
    if (!(await knex.schema.hasColumn('user_signal_logs', 'batch_token'))) {
      await knex.schema.alterTable('user_signal_logs', (table) => {
        table.string('batch_token', 10).nullable();
      });
    }
    if (!(await knex.schema.hasColumn('user_signal_logs', 'slot_time_snapshot'))) {
      await knex.schema.alterTable('user_signal_logs', (table) => {
        table.time('slot_time_snapshot').nullable();
      });
    }
  }

  if (await knex.schema.hasTable('admin_trading_rules')) {
    const row = await knex('admin_trading_rules').where({ is_active: true }).orderBy('id', 'asc').first();
    if (row && !(await knex('control_system_trading_flow_settings').first())) {
      await knex('control_system_trading_flow_settings').insert({
        investment_per_trade_percent: row.investment_per_trade_percent,
        daily_percent_per_trade: row.daily_percent_per_trade,
        signal_validity_minutes: row.signal_validity_minutes,
        is_active: true,
        updated_by: row.updated_by ?? null,
        created_at: row.created_at ?? knex.fn.now(),
        updated_at: row.updated_at ?? knex.fn.now(),
      });
    }
  }

  if (await knex.schema.hasTable('admin_trade_time_slots')) {
    const rows = await knex('admin_trade_time_slots').orderBy('sort_order', 'asc');
    const existing = await knex('trade_slots').count({ count: '*' }).first();
    if (Number(existing?.count || 0) === 0 && rows.length > 0) {
      await knex('trade_slots').insert(rows.map((row) => ({
        slot_name: row.slot_name?.replace(/\s+Slot$/i, '') ?? row.slot_name,
        slot_time: row.slot_time,
        is_active: row.is_enabled,
        sort_order: row.sort_order,
        created_at: row.created_at ?? knex.fn.now(),
        updated_at: row.updated_at ?? knex.fn.now(),
      })));
    }
  }

  if (await knex.schema.hasTable('admin_package_tier_settings')) {
    const rows = await knex('admin_package_tier_settings').orderBy('sort_order', 'asc');
    const existing = await knex('package_tier_settings').count({ count: '*' }).first();
    if (Number(existing?.count || 0) === 0 && rows.length > 0) {
      await knex('package_tier_settings').insert(rows.map((row) => ({
        package_name: row.package_name,
        min_amount: row.min_amount,
        max_amount: String(row.max_amount).trim().toLowerCase() === 'unlimited' ? null : row.max_amount,
        signals_per_day: row.signals_per_day,
        required_level_id: String(row.required_level).trim().toLowerCase() === 'none'
          ? null
          : Number(String(row.required_level).replace(/[^\d]/g, '')) || null,
        is_active: row.is_enabled,
        sort_order: row.sort_order,
        created_at: row.created_at ?? knex.fn.now(),
        updated_at: row.updated_at ?? knex.fn.now(),
      })));
    }
  }

  if (await knex.schema.hasTable('admin_birthday_gift_settings')) {
    const rows = await knex('admin_birthday_gift_settings').where({ is_active: true }).orderBy('sort_order', 'asc');
    const existing = await knex('birthday_gift_settings').count({ count: '*' }).first();
    if (Number(existing?.count || 0) === 0 && rows.length > 0) {
      await knex('birthday_gift_settings').insert(rows.map((row) => ({
        is_enabled: row.is_enabled,
        minimum_eligible_level: row.minimum_eligible_level,
        gift_amount: row.gift_amount,
        is_active: row.is_active,
        sort_order: row.sort_order ?? 1,
        updated_by: row.updated_by ?? null,
        created_at: row.created_at ?? knex.fn.now(),
        updated_at: row.updated_at ?? knex.fn.now(),
      })));
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasColumn('user_signal_logs', 'slot_time_snapshot')) {
    await knex.schema.alterTable('user_signal_logs', (table) => table.dropColumn('slot_time_snapshot'));
  }
  if (await knex.schema.hasColumn('user_signal_logs', 'batch_token')) {
    await knex.schema.alterTable('user_signal_logs', (table) => table.dropColumn('batch_token'));
  }
  if (await knex.schema.hasColumn('user_signal_logs', 'trade_slot_batch_id')) {
    await knex.schema.alterTable('user_signal_logs', (table) => table.dropColumn('trade_slot_batch_id'));
  }
  if (await knex.schema.hasColumn('signals', 'trade_slot_batch_id')) {
    await knex.schema.alterTable('signals', (table) => table.dropColumn('trade_slot_batch_id'));
  }
  if (await knex.schema.hasColumn('trade_slot_batches', 'token_history_json')) {
    await knex.schema.alterTable('trade_slot_batches', (table) => table.dropColumn('token_history_json'));
  }

  await knex.schema.dropTableIfExists('trade_slot_batches');
  await knex.schema.dropTableIfExists('birthday_gift_settings');
  await knex.schema.dropTableIfExists('package_tier_settings');
  await knex.schema.dropTableIfExists('trade_slots');
  await knex.schema.dropTableIfExists('control_system_trading_flow_settings');
}
