export async function up(knex) {
  const hasTable = await knex.schema.hasTable('login_otps');
  if (!hasTable) return;

  const hasEmailVerifiedAt = await knex.schema.hasColumn('login_otps', 'email_verified_at');
  if (!hasEmailVerifiedAt) {
    await knex.schema.alterTable('login_otps', (table) => {
      table.datetime('email_verified_at').nullable();
    });
  }
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('login_otps');
  if (!hasTable) return;

  const hasEmailVerifiedAt = await knex.schema.hasColumn('login_otps', 'email_verified_at');
  if (hasEmailVerifiedAt) {
    await knex.schema.alterTable('login_otps', (table) => {
      table.dropColumn('email_verified_at');
    });
  }
}
