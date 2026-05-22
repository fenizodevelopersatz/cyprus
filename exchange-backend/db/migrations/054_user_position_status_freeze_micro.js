export async function up(knex) {
  const hasTable = await knex.schema.hasTable('user_position_status');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('user_position_status', 'freeze_completed_at_micro');
  if (!hasColumn) {
    await knex.schema.alterTable('user_position_status', (table) => {
      table.bigInteger('freeze_completed_at_micro').nullable().index();
    });
  }
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('user_position_status');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('user_position_status', 'freeze_completed_at_micro');
  if (hasColumn) {
    await knex.schema.alterTable('user_position_status', (table) => {
      table.dropColumn('freeze_completed_at_micro');
    });
  }
}
