export async function up(knex) {
  const hasTable = await knex.schema.hasTable('password_reset_otps');
  if (!hasTable) return;

  const hasSendCount = await knex.schema.hasColumn('password_reset_otps', 'send_count');
  if (!hasSendCount) {
    await knex.schema.alterTable('password_reset_otps', (table) => {
      table.integer('send_count').unsigned().notNullable().defaultTo(0);
    });
  }

  const hasWindowStartedAt = await knex.schema.hasColumn('password_reset_otps', 'window_started_at');
  if (!hasWindowStartedAt) {
    await knex.schema.alterTable('password_reset_otps', (table) => {
      table.datetime('window_started_at').nullable();
    });
  }
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('password_reset_otps');
  if (!hasTable) return;

  const hasWindowStartedAt = await knex.schema.hasColumn('password_reset_otps', 'window_started_at');
  if (hasWindowStartedAt) {
    await knex.schema.alterTable('password_reset_otps', (table) => {
      table.dropColumn('window_started_at');
    });
  }

  const hasSendCount = await knex.schema.hasColumn('password_reset_otps', 'send_count');
  if (hasSendCount) {
    await knex.schema.alterTable('password_reset_otps', (table) => {
      table.dropColumn('send_count');
    });
  }
}
