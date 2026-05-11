export async function up(knex) {
  const hasSponsorId = await knex.schema.hasColumn('users', 'sponsor_id');
  const hasStatus = await knex.schema.hasColumn('users', 'status');
  const hasCurrentLevelCode = await knex.schema.hasColumn('users', 'current_level_code');
  const hasCurrentLevelRank = await knex.schema.hasColumn('users', 'current_level_rank');
  const hasLastLevelBonusAt = await knex.schema.hasColumn('users', 'last_level_bonus_at');

  if (!hasSponsorId || !hasStatus || !hasCurrentLevelCode || !hasCurrentLevelRank || !hasLastLevelBonusAt) {
    await knex.schema.alterTable('users', (table) => {
      if (!hasSponsorId) table.integer('sponsor_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
      if (!hasStatus) table.string('status', 32).notNullable().defaultTo('active');
      if (!hasCurrentLevelCode) table.string('current_level_code', 20).nullable();
      if (!hasCurrentLevelRank) table.integer('current_level_rank').notNullable().defaultTo(0);
      if (!hasLastLevelBonusAt) table.dateTime('last_level_bonus_at').nullable();
    });
  }

  await knex('users').update({
    status: knex.raw("COALESCE(status, CASE WHEN COALESCE(kyc_verified, 0) = 1 THEN 'active' ELSE 'inactive' END)"),
    updated_at: knex.fn.now(),
  });

  const hasSummaryTable = await knex.schema.hasTable('user_team_wallet_summary');
  if (!hasSummaryTable) {
    await knex.schema.createTable('user_team_wallet_summary', (table) => {
      table.integer('user_id').unsigned().primary().references('users.id').onDelete('CASCADE');
      table.integer('direct_total_members').notNullable().defaultTo(0);
      table.integer('direct_eligible_members').notNullable().defaultTo(0);
      table.decimal('direct_total_balance', 36, 18).notNullable().defaultTo(0);
      table.decimal('direct_eligible_balance', 36, 18).notNullable().defaultTo(0);
      table.integer('team_total_members').notNullable().defaultTo(0);
      table.integer('team_eligible_members').notNullable().defaultTo(0);
      table.decimal('team_total_balance', 36, 18).notNullable().defaultTo(0);
      table.decimal('team_eligible_balance', 36, 18).notNullable().defaultTo(0);
      table.dateTime('last_calculated_at').nullable();
      table.timestamps(true, true);
    });
  }

  const hasAchievementTable = await knex.schema.hasTable('mlm_level_achievements');
  if (!hasAchievementTable) {
    await knex.schema.createTable('mlm_level_achievements', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      table.string('level_code', 20).notNullable();
      table.integer('level_rank').notNullable().defaultTo(0);
      table.decimal('promotion_reward_amount', 36, 18).notNullable().defaultTo(0);
      table.decimal('bonus_percent', 10, 4).notNullable().defaultTo(0);
      table.dateTime('achieved_at').notNullable();
      table.json('meta').nullable();
      table.timestamps(true, true);
      table.unique(['user_id', 'level_code'], { indexName: 'mlm_level_achievements_user_level_unique' });
    });
  }

  const hasBonusPayoutTable = await knex.schema.hasTable('mlm_level_bonus_payouts');
  if (!hasBonusPayoutTable) {
    await knex.schema.createTable('mlm_level_bonus_payouts', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      table.string('level_code', 20).notNullable();
      table.integer('level_rank').notNullable().defaultTo(0);
      table.decimal('bonus_percent', 10, 4).notNullable().defaultTo(0);
      table.decimal('eligible_balance', 36, 18).notNullable().defaultTo(0);
      table.integer('eligible_members').notNullable().defaultTo(0);
      table.integer('qualified_direct_members').notNullable().defaultTo(0);
      table.decimal('payout_amount', 36, 18).notNullable().defaultTo(0);
      table.dateTime('period_started_at').notNullable();
      table.dateTime('period_ended_at').notNullable();
      table.string('status', 32).notNullable().defaultTo('SUCCESS');
      table.json('meta').nullable();
      table.timestamps(true, true);
      table.unique(['user_id', 'level_code', 'period_started_at'], { indexName: 'mlm_level_bonus_payouts_user_level_period_unique' });
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('mlm_level_bonus_payouts');
  await knex.schema.dropTableIfExists('mlm_level_achievements');
  await knex.schema.dropTableIfExists('user_team_wallet_summary');

  const hasLastLevelBonusAt = await knex.schema.hasColumn('users', 'last_level_bonus_at');
  const hasCurrentLevelRank = await knex.schema.hasColumn('users', 'current_level_rank');
  const hasCurrentLevelCode = await knex.schema.hasColumn('users', 'current_level_code');
  const hasStatus = await knex.schema.hasColumn('users', 'status');
  const hasSponsorId = await knex.schema.hasColumn('users', 'sponsor_id');

  if (hasLastLevelBonusAt || hasCurrentLevelRank || hasCurrentLevelCode || hasStatus || hasSponsorId) {
    await knex.schema.alterTable('users', (table) => {
      if (hasLastLevelBonusAt) table.dropColumn('last_level_bonus_at');
      if (hasCurrentLevelRank) table.dropColumn('current_level_rank');
      if (hasCurrentLevelCode) table.dropColumn('current_level_code');
      if (hasStatus) table.dropColumn('status');
      if (hasSponsorId) table.dropColumn('sponsor_id');
    });
  }
}
