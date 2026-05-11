async function addColumnIfMissing(knex, tableName, columnName, addColumn) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

export async function up(knex) {
  await addColumnIfMissing(knex, 'users', 'google_id', (table) => {
    table.string('google_id', 255).nullable().unique();
  });

  await addColumnIfMissing(knex, 'users', 'auth_provider', (table) => {
    table.string('auth_provider', 50).notNullable().defaultTo('local');
  });

  await addColumnIfMissing(knex, 'users', 'avatar_url', (table) => {
    table.text('avatar_url').nullable();
  });

  await addColumnIfMissing(knex, 'users', 'email_verified', (table) => {
    table.boolean('email_verified').notNullable().defaultTo(false);
  });
}

export async function down(knex) {
  const columns = ['google_id', 'auth_provider', 'avatar_url', 'email_verified'];
  for (const column of columns) {
    const exists = await knex.schema.hasColumn('users', column);
    if (exists) {
      await knex.schema.alterTable('users', (table) => {
        table.dropColumn(column);
      });
    }
  }
}
