export async function up(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  const hasGoogleAuthSecret = await knex.schema.hasColumn('user_profiles', 'google_auth_secret');
  const hasGoogleAuthTempSecret = await knex.schema.hasColumn('user_profiles', 'google_auth_temp_secret');

  if (!hasGoogleAuthSecret || !hasGoogleAuthTempSecret) {
    await knex.schema.alterTable('user_profiles', (table) => {
      if (!hasGoogleAuthSecret) {
        table.string('google_auth_secret', 255).nullable();
      }
      if (!hasGoogleAuthTempSecret) {
        table.string('google_auth_temp_secret', 255).nullable();
      }
    });
  }
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  const hasGoogleAuthSecret = await knex.schema.hasColumn('user_profiles', 'google_auth_secret');
  const hasGoogleAuthTempSecret = await knex.schema.hasColumn('user_profiles', 'google_auth_temp_secret');

  if (hasGoogleAuthSecret || hasGoogleAuthTempSecret) {
    await knex.schema.alterTable('user_profiles', (table) => {
      if (hasGoogleAuthSecret) {
        table.dropColumn('google_auth_secret');
      }
      if (hasGoogleAuthTempSecret) {
        table.dropColumn('google_auth_temp_secret');
      }
    });
  }
}
