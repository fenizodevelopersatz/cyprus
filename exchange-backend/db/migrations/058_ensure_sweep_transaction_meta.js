async function ensureColumn(knex, tableName, columnName, addColumn) {
  const exists = await knex.schema.hasColumn(tableName, columnName);
  if (!exists) {
    await knex.schema.alterTable(tableName, addColumn);
  }
}

function safeJson(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export async function up(knex) {
  const hasSweepTransactions = await knex.schema.hasTable('sweep_transactions');
  if (!hasSweepTransactions) return;

  await ensureColumn(knex, 'sweep_transactions', 'meta', (table) => {
    table.json('meta').nullable();
  });

  const rows = await knex('sweep_transactions')
    .select(
      'id',
      'user_id',
      'network',
      'token',
      'source_wallet_address',
      'destination_admin_wallet_address',
      'deposit_transaction_id',
      'usdt_amount_raw',
      'usdt_amount_decimal',
      'estimated_gas_fee_raw',
      'estimated_gas_fee_decimal',
      'gas_asset',
      'gas_status',
      'gas_topup_tx_hash',
      'sweep_tx_hash',
      'status',
      'trigger_type',
      'error_message',
      'swept_at',
      'meta',
      'created_at',
      'updated_at'
    )
    .where((builder) => {
      builder.whereNull('meta').orWhere('meta', '').orWhere('meta', '{}');
    })
    .limit(5000);

  const now = new Date();
  for (const row of rows) {
    const amountAsset = String(row.token || (String(row.network || '').toLowerCase() === 'solana' ? 'USDC' : 'USDT')).toUpperCase();
    const meta = {
      ...safeJson(row.meta),
      logType: 'sweep_existing_row_backfill',
      backfilledAt: now.toISOString(),
      userId: row.user_id,
      network: row.network,
      token: amountAsset,
      amountAsset,
      amountRaw: row.usdt_amount_raw || null,
      amountDecimal: String(row.usdt_amount_decimal || '0'),
      sourceWalletAddress: row.source_wallet_address || null,
      destinationAdminWalletAddress: row.destination_admin_wallet_address || null,
      depositTransactionId: row.deposit_transaction_id || null,
      gasAsset: row.gas_asset || null,
      gasStatus: row.gas_status || null,
      estimatedGasFeeRaw: row.estimated_gas_fee_raw || null,
      estimatedGasFeeDecimal: row.estimated_gas_fee_decimal || null,
      gasTopupTxHash: row.gas_topup_tx_hash || null,
      sweepTxHash: row.sweep_tx_hash || null,
      status: row.status || null,
      triggerType: row.trigger_type || null,
      errorMessage: row.error_message || null,
      sweptAt: row.swept_at || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      lastLogAt: now.toISOString(),
    };

    await knex('sweep_transactions').where({ id: row.id }).update({
      meta: JSON.stringify(meta),
      updated_at: row.updated_at || now,
    });
  }
}

export async function down(knex) {
  const hasSweepTransactions = await knex.schema.hasTable('sweep_transactions');
  if (!hasSweepTransactions) return;
  const hasMeta = await knex.schema.hasColumn('sweep_transactions', 'meta');
  if (hasMeta) {
    await knex.schema.alterTable('sweep_transactions', (table) => {
      table.dropColumn('meta');
    });
  }
}
