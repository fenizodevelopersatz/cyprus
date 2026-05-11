export async function up(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('user_profiles', 'two_factor_enabled');
  if (!hasColumn) {
    await knex.schema.alterTable('user_profiles', (table) => {
      table.boolean('two_factor_enabled').notNullable().defaultTo(true);
    });
  }

  await knex('user_profiles').update({ two_factor_enabled: true }).whereNull('two_factor_enabled');
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('user_profiles', 'two_factor_enabled');
  if (hasColumn) {
    await knex.schema.alterTable('user_profiles', (table) => {
      table.dropColumn('two_factor_enabled');
    });
  }
}
