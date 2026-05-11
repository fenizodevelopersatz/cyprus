export async function up(knex) {
  await knex.schema.alterTable('market_symbols', (table) => {
    table.boolean('is_enabled').notNullable().defaultTo(true);
    table.integer('min_leverage').unsigned().defaultTo(1);
    table.integer('max_leverage').unsigned().defaultTo(50);
  });

  await knex('market_symbols').update({ is_enabled: 1 }).whereNull('is_enabled');
  await knex('market_symbols').update({ min_leverage: 1 }).whereNull('min_leverage');
  await knex('market_symbols').update({ max_leverage: 50 }).whereNull('max_leverage');
}

export async function down(knex) {
  await knex.schema.alterTable('market_symbols', (table) => {
    table.dropColumn('is_enabled');
    table.dropColumn('min_leverage');
    table.dropColumn('max_leverage');
  });
}

