export async function up(knex) {
  if (await knex.schema.hasTable('withdrawals')) {
    if (!(await knex.schema.hasColumn('withdrawals', 'token_contract'))) {
      await knex.schema.alterTable('withdrawals', (table) => {
        table.string('token_contract', 191).nullable();
      });
    }
  }
}

export async function down(knex) {
  if (await knex.schema.hasTable('withdrawals') && (await knex.schema.hasColumn('withdrawals', 'token_contract'))) {
    await knex.schema.alterTable('withdrawals', (table) => {
      table.dropColumn('token_contract');
    });
  }
}
