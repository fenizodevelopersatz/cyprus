export async function up(knex) {
  await knex.schema.createTable('sip_plans', (t) => {
    t.increments('id').primary();
    t.string('asset', 16).notNullable();
    t.string('quote_currency', 8).notNullable();
    t.string('nickname', 128).notNullable();
    t.text('description');
    t.string('status', 24).notNullable().defaultTo('ACTIVE');
    t.decimal('min_fiat_amount', 20, 4).notNullable().defaultTo(0);
    t.decimal('max_fiat_amount', 20, 4);
    t.decimal('min_asset_quantity', 36, 18).notNullable().defaultTo(0);
    t.decimal('max_asset_quantity', 36, 18);
    t.json('allowed_frequencies');
    t.boolean('allow_amount_input').notNullable().defaultTo(true);
    t.boolean('allow_quantity_input').notNullable().defaultTo(true);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.json('meta');
    t.timestamps(true, true);
    t.index(['status', 'asset'], 'sip_plans_status_asset');
  });

  await knex.schema.createTable('sip_subscriptions', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.integer('plan_id').unsigned().references('sip_plans.id').onDelete('SET NULL');
    t.string('asset', 16).notNullable();
    t.string('quote_currency', 8).notNullable();
    t.string('contribution_type', 16).notNullable(); // AMOUNT | QUANTITY
    t.decimal('amount_fiat', 20, 4);
    t.decimal('amount_asset', 36, 18);
    t.string('frequency', 16).notNullable();
    t.datetime('start_at').notNullable();
    t.datetime('next_run_at').notNullable();
    t.datetime('last_run_at');
    t.string('status', 24).notNullable().defaultTo('ACTIVE');
    t.integer('fail_count').notNullable().defaultTo(0);
    t.boolean('auto_pause_on_fail').notNullable().defaultTo(true);
    t.string('wallet_source', 64).notNullable().defaultTo('spot:available');
    t.json('meta');
    t.datetime('canceled_at');
    t.timestamps(true, true);
    t.index(['user_id', 'status'], 'sip_subscriptions_user_status');
    t.index(['status', 'next_run_at'], 'sip_subscriptions_due');
  });

  await knex.schema.createTable('sip_orders', (t) => {
    t.increments('id').primary();
    t.integer('subscription_id').unsigned().references('sip_subscriptions.id').onDelete('CASCADE');
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.string('asset', 16).notNullable();
    t.string('quote_currency', 8).notNullable();
    t.decimal('scheduled_amount_fiat', 20, 4);
    t.decimal('scheduled_amount_asset', 36, 18);
    t.decimal('executed_amount_asset', 36, 18);
    t.decimal('price_used', 20, 8);
    t.datetime('scheduled_for').notNullable();
    t.datetime('executed_at');
    t.string('status', 24).notNullable().defaultTo('QUEUED');
    t.string('failure_reason', 255);
    t.integer('journal_id').unsigned().references('journals.id');
    t.json('meta');
    t.timestamps(true, true);
    t.index(['subscription_id', 'status'], 'sip_orders_subscription_status');
    t.index(['status', 'scheduled_for'], 'sip_orders_schedule');
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('sip_orders');
  await knex.schema.dropTableIfExists('sip_subscriptions');
  await knex.schema.dropTableIfExists('sip_plans');
}
