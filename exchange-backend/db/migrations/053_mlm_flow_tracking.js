export async function up(knex) {
  const hasTable = await knex.schema.hasTable('mlm_flow_tracking');
  if (!hasTable) {
    await knex.schema.createTable('mlm_flow_tracking', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
      table.integer('deposit_id').unsigned().nullable();
      table.string('flow_type', 64).notNullable().defaultTo('deposit_to_freeze');
      table.string('step_key', 64).notNullable();
      table.string('step_status', 32).notNullable().defaultTo('completed');
      table.string('txn_global_sequence', 64).nullable();
      table.dateTime('completed_at', { precision: 6 }).notNullable();
      table.json('meta').nullable();
      table.timestamps(true, true);
      table.index(['user_id', 'deposit_id', 'flow_type'], 'mlm_flow_tracking_user_deposit_idx');
      table.index(['step_key', 'completed_at'], 'mlm_flow_tracking_step_idx');
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('mlm_flow_tracking');
}
