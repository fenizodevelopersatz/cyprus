export async function up(knex) {
  const hasUserPositionStatus = await knex.schema.hasTable('user_position_status');
  if (!hasUserPositionStatus) {
    await knex.schema.createTable('user_position_status', (table) => {
      table.integer('user_id').unsigned().primary().references('users.id').onDelete('CASCADE');
      table.string('current_eligible_level_code', 20).nullable();
      table.integer('current_eligible_level_order').notNullable().defaultTo(0);
      table.integer('active_direct_count').notNullable().defaultTo(0);
      table.integer('active_team_count').notNullable().defaultTo(0);
      table.integer('direct_lv1_count').notNullable().defaultTo(0);
      table.integer('direct_lv7_count').notNullable().defaultTo(0);
      table.integer('direct_lv8_count').notNullable().defaultTo(0);
      table.integer('direct_lv9_count').notNullable().defaultTo(0);
      table.boolean('is_currently_qualified').notNullable().defaultTo(false);
      table.dateTime('qualified_at').nullable();
      table.dateTime('last_checked_at').nullable();
      table.dateTime('next_bonus_due_at').nullable();
      table.timestamps(true, true);
      table.index(['is_currently_qualified', 'next_bonus_due_at'], 'user_position_status_due_lookup_idx');
    });
  }

  const hasRecurringBonusHistory = await knex.schema.hasTable('recurring_bonus_history');
  if (!hasRecurringBonusHistory) {
    await knex.schema.createTable('recurring_bonus_history', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      table.string('level_code', 20).nullable();
      table.decimal('percent', 10, 4).notNullable().defaultTo(0);
      table.decimal('base_amount', 36, 18).notNullable().defaultTo(0);
      table.decimal('bonus_amount', 36, 18).notNullable().defaultTo(0);
      table.dateTime('cycle_from').nullable();
      table.dateTime('cycle_to').nullable();
      table.dateTime('due_at').nullable();
      table.dateTime('paid_at').nullable();
      table.string('status', 32).notNullable().defaultTo('paid');
      table.string('skip_reason', 64).nullable();
      table.json('meta').nullable();
      table.timestamps(true, true);
      table.index(['user_id', 'due_at'], 'recurring_bonus_history_user_due_idx');
      table.index(['status', 'skip_reason'], 'recurring_bonus_history_status_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('recurring_bonus_history');
  await knex.schema.dropTableIfExists('user_position_status');
}
