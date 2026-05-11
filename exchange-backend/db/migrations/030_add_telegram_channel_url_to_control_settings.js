export async function up(knex) {
  const tableName = 'control_system_trading_flow_settings';
  if (!(await knex.schema.hasTable(tableName))) return;

  const hasColumn = await knex.schema.hasColumn(tableName, 'telegram_channel_url');
  if (!hasColumn) {
    await knex.schema.alterTable(tableName, (table) => {
      table.string('telegram_channel_url', 500).nullable();
    });
  }
}

export async function down(knex) {
  const tableName = 'control_system_trading_flow_settings';
  if (!(await knex.schema.hasTable(tableName))) return;

  const hasColumn = await knex.schema.hasColumn(tableName, 'telegram_channel_url');
  if (hasColumn) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('telegram_channel_url');
    });
  }
}
