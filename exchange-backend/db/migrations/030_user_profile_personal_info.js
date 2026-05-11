export async function up(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  const addIfMissing = async (column, callback) => {
    const exists = await knex.schema.hasColumn('user_profiles', column);
    if (!exists) {
      await knex.schema.alterTable('user_profiles', (table) => {
        callback(table);
      });
    }
  };

  await addIfMissing('first_name', (table) => table.string('first_name', 120).nullable());
  await addIfMissing('last_name', (table) => table.string('last_name', 120).nullable());
  await addIfMissing('username', (table) => table.string('username', 120).nullable().unique());
  await addIfMissing('mobile_number', (table) => table.string('mobile_number', 40).nullable());
  await addIfMissing('state', (table) => table.string('state', 120).nullable());
  await addIfMissing('city', (table) => table.string('city', 120).nullable());
  await addIfMissing('postal_code', (table) => table.string('postal_code', 40).nullable());
  await addIfMissing('date_of_birth', (table) => table.date('date_of_birth').nullable());
  await addIfMissing('gender', (table) => table.string('gender', 40).nullable());
  await addIfMissing('address_line_1', (table) => table.string('address_line_1', 255).nullable());
  await addIfMissing('address_line_2', (table) => table.string('address_line_2', 255).nullable());
  await addIfMissing('profile_photo', (table) => table.text('profile_photo').nullable());
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  const dropIfExists = async (column) => {
    const exists = await knex.schema.hasColumn('user_profiles', column);
    if (exists) {
      await knex.schema.alterTable('user_profiles', (table) => {
        table.dropColumn(column);
      });
    }
  };

  await dropIfExists('profile_photo');
  await dropIfExists('address_line_2');
  await dropIfExists('address_line_1');
  await dropIfExists('gender');
  await dropIfExists('date_of_birth');
  await dropIfExists('postal_code');
  await dropIfExists('city');
  await dropIfExists('state');
  await dropIfExists('mobile_number');
  await dropIfExists('username');
  await dropIfExists('last_name');
  await dropIfExists('first_name');
}
