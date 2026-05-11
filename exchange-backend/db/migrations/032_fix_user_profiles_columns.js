export async function up(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  // Check and add missing columns to user_profiles
  const columnChecks = [
    { name: 'first_name', fn: (t) => t.string('first_name', 120).nullable() },
    { name: 'last_name', fn: (t) => t.string('last_name', 120).nullable() },
    { name: 'username', fn: (t) => t.string('username', 120).nullable().unique() },
    { name: 'mobile_number', fn: (t) => t.string('mobile_number', 40).nullable() },
    { name: 'state', fn: (t) => t.string('state', 120).nullable() },
    { name: 'city', fn: (t) => t.string('city', 120).nullable() },
    { name: 'postal_code', fn: (t) => t.string('postal_code', 40).nullable() },
    { name: 'date_of_birth', fn: (t) => t.date('date_of_birth').nullable() },
    { name: 'gender', fn: (t) => t.string('gender', 40).nullable() },
    { name: 'address_line_1', fn: (t) => t.string('address_line_1', 255).nullable() },
    { name: 'address_line_2', fn: (t) => t.string('address_line_2', 255).nullable() },
    { name: 'profile_photo', fn: (t) => t.text('profile_photo').nullable() },
  ];

  for (const column of columnChecks) {
    const exists = await knex.schema.hasColumn('user_profiles', column.name);
    if (!exists) {
      try {
        await knex.schema.alterTable('user_profiles', (table) => {
          column.fn(table);
        });
      } catch (err) {
        console.error(`Failed to add column ${column.name}:`, err.message);
        // Continue to next column even if this one fails
      }
    }
  }
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  const columnsToRemove = [
    'profile_photo',
    'address_line_2',
    'address_line_1',
    'gender',
    'date_of_birth',
    'postal_code',
    'city',
    'state',
    'mobile_number',
    'username',
    'last_name',
    'first_name',
  ];

  for (const columnName of columnsToRemove) {
    const exists = await knex.schema.hasColumn('user_profiles', columnName);
    if (exists) {
      try {
        await knex.schema.alterTable('user_profiles', (table) => {
          table.dropColumn(columnName);
        });
      } catch (err) {
        console.error(`Failed to drop column ${columnName}:`, err.message);
        // Continue to next column even if this one fails
      }
    }
  }
}
