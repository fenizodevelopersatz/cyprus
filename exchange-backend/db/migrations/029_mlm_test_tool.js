export async function up(knex) {
  const hasRuns = await knex.schema.hasTable('mlm_test_runs');
  if (!hasRuns) {
    await knex.schema.createTable('mlm_test_runs', (table) => {
      table.increments('id').primary();
      table.string('mode', 16).notNullable().defaultTo('basic');
      table.json('config').nullable();
      table.timestamps(true, true);
    });
  }

  const hasUsers = await knex.schema.hasTable('mlm_test_users');
  if (!hasUsers) {
    await knex.schema.createTable('mlm_test_users', (table) => {
      table.increments('id').primary();
      table.integer('run_id').unsigned().notNullable().references('mlm_test_runs.id').onDelete('CASCADE');
      table.integer('test_user_no').notNullable();
      table.string('full_name', 191).notNullable();
      table.string('email', 191).notNullable();
      table.string('phone', 64).nullable();
      table.integer('sponsor_test_user_no').nullable();
      table.integer('depth').notNullable().defaultTo(0);
      table.string('status', 32).notNullable().defaultTo('active');
      table.decimal('main_wallet_balance', 36, 18).notNullable().defaultTo(0);
      table.integer('direct_total_members').notNullable().defaultTo(0);
      table.integer('direct_eligible_members').notNullable().defaultTo(0);
      table.integer('team_total_members').notNullable().defaultTo(0);
      table.integer('team_eligible_members').notNullable().defaultTo(0);
      table.string('achieved_level', 20).nullable();
      table.string('next_level_possible', 20).nullable();
      table.boolean('promotion_reward_applicable').notNullable().defaultTo(false);
      table.boolean('bonus_eligible').notNullable().defaultTo(false);
      table.decimal('simulated_promotion_reward', 36, 18).notNullable().defaultTo(0);
      table.decimal('simulated_bonus_amount', 36, 18).notNullable().defaultTo(0);
      table.timestamps(true, true);
      table.unique(['run_id', 'test_user_no'], { indexName: 'mlm_test_users_run_user_no_unique' });
    });
  }

  const hasDeposits = await knex.schema.hasTable('mlm_test_deposits');
  if (!hasDeposits) {
    await knex.schema.createTable('mlm_test_deposits', (table) => {
      table.increments('id').primary();
      table.integer('run_id').unsigned().notNullable().references('mlm_test_runs.id').onDelete('CASCADE');
      table.integer('test_user_no').notNullable();
      table.decimal('amount', 36, 18).notNullable().defaultTo(0);
      table.string('tx_ref', 191).notNullable();
      table.timestamps(true, true);
      table.index(['run_id', 'test_user_no'], 'mlm_test_deposits_run_user_idx');
    });
  }

  const hasRewards = await knex.schema.hasTable('mlm_test_rewards');
  if (!hasRewards) {
    await knex.schema.createTable('mlm_test_rewards', (table) => {
      table.increments('id').primary();
      table.integer('run_id').unsigned().notNullable().references('mlm_test_runs.id').onDelete('CASCADE');
      table.integer('test_user_no').notNullable();
      table.string('reward_type', 32).notNullable();
      table.string('level_code', 20).nullable();
      table.decimal('amount', 36, 18).notNullable().defaultTo(0);
      table.boolean('applicable').notNullable().defaultTo(false);
      table.json('meta').nullable();
      table.timestamps(true, true);
      table.index(['run_id', 'test_user_no'], 'mlm_test_rewards_run_user_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('mlm_test_rewards');
  await knex.schema.dropTableIfExists('mlm_test_deposits');
  await knex.schema.dropTableIfExists('mlm_test_users');
  await knex.schema.dropTableIfExists('mlm_test_runs');
}
