export async function up(knex) {
  const hasInvestmentBalance = await knex.schema.hasColumn('users', 'investment_balance');
  if (!hasInvestmentBalance) {
    await knex.schema.alterTable('users', (table) => {
      table.decimal('investment_balance', 36, 18).notNullable().defaultTo(0);
    });
  }
}

export async function down(knex) {
  const hasInvestmentBalance = await knex.schema.hasColumn('users', 'investment_balance');
  if (hasInvestmentBalance) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('investment_balance');
    });
  }
}
