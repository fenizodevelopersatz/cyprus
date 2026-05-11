export async function up(knex) {
  if (!(await knex.schema.hasTable('users'))) return;

  const addColumnIfMissing = async (columnName, callback) => {
    if (!(await knex.schema.hasColumn('users', columnName))) {
      await knex.schema.alterTable('users', callback);
    }
  };

  await addColumnIfMissing('direct_income_paid', (table) => {
    table.boolean('direct_income_paid').notNullable().defaultTo(false);
  });

  await addColumnIfMissing('join_reward_paid', (table) => {
    table.boolean('join_reward_paid').notNullable().defaultTo(false);
  });

  await addColumnIfMissing('first_deposit_amount', (table) => {
    table.decimal('first_deposit_amount', 24, 8).nullable();
  });

  await addColumnIfMissing('first_deposit_at', (table) => {
    table.dateTime('first_deposit_at').nullable();
  });

  await addColumnIfMissing('direct_income_paid_at', (table) => {
    table.dateTime('direct_income_paid_at').nullable();
  });
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('users'))) return;

  for (const column of [
    'first_deposit_at',
    'first_deposit_amount',
    'join_reward_paid',
    'direct_income_paid_at',
    'direct_income_paid',
  ]) {
    if (await knex.schema.hasColumn('users', column)) {
      await knex.schema.alterTable('users', (table) => {
        table.dropColumn(column);
      });
    }
  }
}
