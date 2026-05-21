export async function up(knex) {
  const hasTable = await knex.schema.hasTable('admin_level_management_config');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('admin_level_management_config', 'bonus_interval_days');
  if (!hasColumn) {
    await knex.schema.alterTable('admin_level_management_config', (table) => {
      table.integer('bonus_interval_days').notNullable().defaultTo(10);
    });
  }
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('admin_level_management_config');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('admin_level_management_config', 'bonus_interval_days');
  if (hasColumn) {
    await knex.schema.alterTable('admin_level_management_config', (table) => {
      table.dropColumn('bonus_interval_days');
    });
  }
}
