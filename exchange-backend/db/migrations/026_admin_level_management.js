export async function up(knex) {
  const hasLevelSettingsTable = await knex.schema.hasTable('admin_level_settings');
  if (!hasLevelSettingsTable) {
    await knex.schema.createTable('admin_level_settings', (table) => {
      table.bigIncrements('id').primary();
      table.string('level_code', 20).notNullable().unique();
      table.string('qualification_text', 255).notNullable();
      table.decimal('bonus_percent', 10, 2).notNullable().defaultTo(0);
      table.decimal('promotion_reward_usdt', 18, 2).notNullable().defaultTo(0);
      table.boolean('is_enabled').notNullable().defaultTo(true);
      table.integer('sort_order').notNullable().defaultTo(0);
      table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
      table.dateTime('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasLevelManagementConfigTable = await knex.schema.hasTable('admin_level_management_config');
  if (!hasLevelManagementConfigTable) {
    await knex.schema.createTable('admin_level_management_config', (table) => {
      table.bigIncrements('id').primary();
      table.text('direct_referral_note').notNullable();
      table.text('new_user_reward_note').notNullable();
      table.text('level_achievement_note').notNullable();
      table.text('salary_reward_note').notNullable();
      table.text('one_time_reward_note').notNullable();
      table.text('minimum_deposit_eligibility_note').notNullable();
      table.decimal('minimum_eligible_deposit', 18, 2).notNullable().defaultTo(300);
      table.decimal('direct_sponsor_commission_percent', 10, 2).notNullable().defaultTo(5);
      table.decimal('joined_commission_percent', 10, 2).notNullable().defaultTo(2);
      table.boolean('is_commission_active').notNullable().defaultTo(true);
      table.boolean('is_active').notNullable().defaultTo(true);
      table.bigInteger('updated_by').unsigned().nullable();
      table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
      table.dateTime('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('admin_level_management_config');
  await knex.schema.dropTableIfExists('admin_level_settings');
}
