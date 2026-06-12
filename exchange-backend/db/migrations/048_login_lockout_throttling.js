export async function up(knex) {
  const hasFailedAttempts = await knex.schema.hasColumn('users', 'failed_login_attempts');
  if (!hasFailedAttempts) {
    await knex.schema.alterTable('users', (table) => {
      table.integer('failed_login_attempts').defaultTo(0);
      table.dateTime('last_failed_login_at').nullable();
      table.dateTime('locked_until').nullable();
      table.string('last_login_ip', 100).nullable();
    });
  }

  const hasLogsTable = await knex.schema.hasTable('login_attempt_logs');
  if (!hasLogsTable) {
    await knex.schema.createTable('login_attempt_logs', (table) => {
      table.increments('id').primary();
      table.string('email', 255).nullable();
      table.string('ip_address', 100).nullable();
      table.text('user_agent').nullable();
      table.enum('status', ['success', 'failed', 'locked']).defaultTo('failed');
      table.dateTime('created_at').defaultTo(knex.fn.now());
    });
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('login_attempt_logs');
  
  const hasFailedAttempts = await knex.schema.hasColumn('users', 'failed_login_attempts');
  if (hasFailedAttempts) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('failed_login_attempts');
      table.dropColumn('last_failed_login_at');
      table.dropColumn('locked_until');
      table.dropColumn('last_login_ip');
    });
  }
}