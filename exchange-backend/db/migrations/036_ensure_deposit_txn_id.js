export async function up(knex) {
  const hasDepositTxnId = await knex.schema.hasColumn('deposit_transactions', 'txn_id');
  if (!hasDepositTxnId) {
    await knex.schema.alterTable('deposit_transactions', (t) => {
      t.string('txn_id', 64).nullable().index();
    });
  }

  const rows = await knex('deposit_transactions').select('id', 'created_at', 'txn_id');
  for (const row of rows) {
    if (!row.txn_id) {
      const date = new Date(row.created_at || Date.now()).toISOString().slice(0, 10).replace(/-/g, '');
      const txnId = `TXN-DEP-${date}-${String(Number(row.id) || 0).padStart(6, '0')}`;
      await knex('deposit_transactions').where({ id: row.id }).update({ txn_id: txnId });
    }
  }
}

export async function down(knex) {
  const hasDepositTxnId = await knex.schema.hasColumn('deposit_transactions', 'txn_id');
  if (hasDepositTxnId) {
    await knex.schema.alterTable('deposit_transactions', (t) => {
      t.dropColumn('txn_id');
    });
  }
}
