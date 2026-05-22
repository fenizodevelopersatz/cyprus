export async function up(knex) {
  const hasTable = await knex.schema.hasTable('user_position_status');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('user_position_status', 'txn_global_sequence');
  if (!hasColumn) return;

  await knex.schema.alterTable('user_position_status', (table) => {
    table.string('txn_global_sequence', 64).nullable().alter();
  });
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('user_position_status');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('user_position_status', 'txn_global_sequence');
  if (!hasColumn) return;

  await knex.schema.alterTable('user_position_status', (table) => {
    table.bigInteger('txn_global_sequence').nullable().alter();
  });
}
