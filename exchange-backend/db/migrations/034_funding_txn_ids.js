export async function up(knex) {
  const addIfMissing = async (table, column, definition) => {
    const exists = await knex.schema.hasColumn(table, column);
    if (!exists) {
      await knex.schema.alterTable(table, (t) => definition(t));
    }
  };

  await addIfMissing('deposit_transactions', 'txn_id', (t) => t.string('txn_id', 64).nullable().index());
  await addIfMissing('withdrawals', 'txn_id', (t) => t.string('txn_id', 64).nullable().index());

  const depositRows = await knex('deposit_transactions').select('id', 'created_at', 'txn_id');
  for (const row of depositRows) {
    if (!row.txn_id) {
      const txnId = `DPT-${new Date(row.created_at || Date.now()).toISOString().slice(0, 10).replace(/-/g, '')}-${String(Number(row.id) || 0).padStart(6, '0')}`;
      await knex('deposit_transactions').where({ id: row.id }).update({ txn_id: txnId });
    }
  }

  const withdrawalRows = await knex('withdrawals').select('id', 'requested_at', 'created_at', 'txn_id');
  for (const row of withdrawalRows) {
    if (!row.txn_id) {
      const eventAt = row.requested_at || row.created_at || Date.now();
      const txnId = `WDR-${new Date(eventAt).toISOString().slice(0, 10).replace(/-/g, '')}-${String(Number(row.id) || 0).padStart(6, '0')}`;
      await knex('withdrawals').where({ id: row.id }).update({ txn_id: txnId });
    }
  }
}

export async function down(knex) {
  const dropIfExists = async (table, column) => {
    const exists = await knex.schema.hasColumn(table, column);
    if (exists) {
      await knex.schema.alterTable(table, (t) => t.dropColumn(column));
    }
  };

  await dropIfExists('withdrawals', 'txn_id');
  await dropIfExists('deposit_transactions', 'txn_id');
}
