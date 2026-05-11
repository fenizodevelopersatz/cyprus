export async function up(knex) {
  const hasIsTestUser = await knex.schema.hasColumn('users', 'is_test_user');
  const hasTestRunId = await knex.schema.hasColumn('users', 'test_run_id');

  if (!hasIsTestUser || !hasTestRunId) {
    await knex.schema.alterTable('users', (table) => {
      if (!hasIsTestUser) table.boolean('is_test_user').notNullable().defaultTo(false);
      if (!hasTestRunId) table.integer('test_run_id').unsigned().nullable();
    });
  }

  try {
    await knex.schema.alterTable('users', (table) => {
      table.index(['is_test_user', 'test_run_id'], 'users_test_run_idx');
    });
  } catch {}

  await knex.schema.dropTableIfExists('mlm_test_rewards');
  await knex.schema.dropTableIfExists('mlm_test_deposits');
  await knex.schema.dropTableIfExists('mlm_test_users');
  await knex.schema.dropTableIfExists('mlm_test_runs');
}

export async function down(knex) {
  try {
    await knex.schema.alterTable('users', (table) => {
      table.dropIndex(['is_test_user', 'test_run_id'], 'users_test_run_idx');
    });
  } catch {}

  const hasIsTestUser = await knex.schema.hasColumn('users', 'is_test_user');
  const hasTestRunId = await knex.schema.hasColumn('users', 'test_run_id');

  if (hasIsTestUser || hasTestRunId) {
    await knex.schema.alterTable('users', (table) => {
      if (hasIsTestUser) table.dropColumn('is_test_user');
      if (hasTestRunId) table.dropColumn('test_run_id');
    });
  }
}
