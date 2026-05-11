async function addIfMissing(knex, tableName, columnName, definition) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, (table) => definition(table));
  }
}

export async function up(knex) {
  await addIfMissing(knex, 'wallet_ledger', 'txn_id', (table) => table.string('txn_id', 64).nullable().index());
  await addIfMissing(knex, 'mlm_income_history', 'txn_id', (table) => table.string('txn_id', 64).nullable().index());
}

export async function down(knex) {
  const dropIfExists = async (tableName, columnName) => {
    const exists = await knex.schema.hasColumn(tableName, columnName);
    if (exists) {
      await knex.schema.alterTable(tableName, (table) => table.dropColumn(columnName));
    }
  };

  await dropIfExists('mlm_income_history', 'txn_id');
  await dropIfExists('wallet_ledger', 'txn_id');
}
