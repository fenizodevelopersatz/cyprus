function now() {
  return new Date();
}

async function addColumnIfMissing(knex, tableName, columnName, callback) {
  const hasColumn = await knex.schema.hasColumn(tableName, columnName);
  if (!hasColumn) {
    await knex.schema.alterTable(tableName, callback);
  }
}

export async function up(knex) {
  const currentTime = now();

  await addColumnIfMissing(knex, 'user_wallets', 'address_lower', (t) => {
    t.string('address_lower', 191).nullable();
  });
  await addColumnIfMissing(knex, 'user_wallets', 'encrypted_private_key', (t) => {
    t.text('encrypted_private_key').nullable();
  });
  await addColumnIfMissing(knex, 'user_wallets', 'is_active', (t) => {
    t.boolean('is_active').notNullable().defaultTo(true);
  });

  try {
    await knex('user_wallets').update({
      address_lower: knex.raw(
        "CASE WHEN UPPER(network) = 'TRC20' THEN NULL ELSE LOWER(address) END"
      ),
      encrypted_private_key: knex.raw('COALESCE(encrypted_private_key, private_key_encrypted)'),
      is_active: knex.raw('COALESCE(is_active, 1)'),
      updated_at: currentTime,
    });
  } catch {}

  const hasAdminWallets = await knex.schema.hasTable('admin_wallets');
  if (!hasAdminWallets) {
    await knex.schema.createTable('admin_wallets', (t) => {
      t.increments('id').primary();
      t.string('network', 32).notNullable();
      t.string('token', 16).notNullable().defaultTo('USDT');
      t.string('address', 191).notNullable();
      t.string('address_lower', 191).nullable();
      t.text('encrypted_private_key').notNullable();
      t.boolean('is_active').notNullable().defaultTo(true);
      t.json('meta').nullable();
      t.timestamps(true, true);
      t.unique(['network', 'token'], { indexName: 'admin_wallets_network_token_unique' });
    });
  }

  const hasSweepTransactions = await knex.schema.hasTable('sweep_transactions');
  if (!hasSweepTransactions) {
    await knex.schema.createTable('sweep_transactions', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      t.string('network', 32).notNullable();
      t.string('token', 16).notNullable().defaultTo('USDT');
      t.string('source_wallet_address', 191).notNullable();
      t.string('destination_admin_wallet_address', 191).notNullable();
      t.integer('deposit_transaction_id').unsigned().nullable().references('deposit_transactions.id').onDelete('SET NULL');
      t.string('usdt_amount_raw', 191).nullable();
      t.string('usdt_amount_decimal', 64).notNullable().defaultTo('0');
      t.string('estimated_gas_fee_raw', 191).nullable();
      t.string('estimated_gas_fee_decimal', 64).nullable();
      t.string('gas_asset', 16).nullable();
      t.string('gas_status', 32).notNullable().defaultTo('unknown');
      t.string('gas_topup_tx_hash', 255).nullable();
      t.string('sweep_tx_hash', 255).nullable();
      t.string('status', 32).notNullable().defaultTo('pending');
      t.string('trigger_type', 32).notNullable().defaultTo('auto');
      t.text('error_message').nullable();
      t.datetime('swept_at').nullable();
      t.json('meta').nullable();
      t.timestamps(true, true);
      t.unique(['deposit_transaction_id'], { indexName: 'sweep_transactions_deposit_unique' });
      t.index(['network', 'status', 'created_at'], 'sweep_transactions_network_status_created_idx');
    });
  }

  const hasGasFundingTransactions = await knex.schema.hasTable('gas_funding_transactions');
  if (!hasGasFundingTransactions) {
    await knex.schema.createTable('gas_funding_transactions', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      t.integer('sweep_transaction_id').unsigned().nullable().references('sweep_transactions.id').onDelete('SET NULL');
      t.string('network', 32).notNullable();
      t.string('source_admin_wallet_address', 191).notNullable();
      t.string('destination_user_wallet_address', 191).notNullable();
      t.string('gas_asset', 16).notNullable();
      t.string('amount_raw', 191).nullable();
      t.string('amount_decimal', 64).notNullable().defaultTo('0');
      t.string('tx_hash', 255).nullable();
      t.string('status', 32).notNullable().defaultTo('pending');
      t.text('error_message').nullable();
      t.datetime('completed_at').nullable();
      t.json('meta').nullable();
      t.timestamps(true, true);
      t.index(['network', 'status', 'created_at'], 'gas_funding_network_status_created_idx');
    });
  }

  await addColumnIfMissing(knex, 'deposit_transactions', 'sweep_status', (t) => {
    t.string('sweep_status', 32).nullable();
  });
  await addColumnIfMissing(knex, 'deposit_transactions', 'sweep_transaction_id', (t) => {
    t.integer('sweep_transaction_id').unsigned().nullable().references('sweep_transactions.id').onDelete('SET NULL');
  });

  try {
    await knex('deposit_transactions').update({
      sweep_status: knex.raw(`
        CASE
          WHEN is_swept = 1 THEN 'sweep_confirmed'
          WHEN sweep_error IS NOT NULL AND sweep_error <> '' THEN 'failed'
          ELSE COALESCE(sweep_status, 'pending')
        END
      `),
      updated_at: currentTime,
    });
  } catch {}
}

export async function down(knex) {
  const hasDepositSweepTxId = await knex.schema.hasColumn('deposit_transactions', 'sweep_transaction_id');
  const hasDepositSweepStatus = await knex.schema.hasColumn('deposit_transactions', 'sweep_status');
  if (hasDepositSweepTxId || hasDepositSweepStatus) {
    await knex.schema.alterTable('deposit_transactions', (t) => {
      if (hasDepositSweepTxId) t.dropColumn('sweep_transaction_id');
      if (hasDepositSweepStatus) t.dropColumn('sweep_status');
    });
  }

  await knex.schema.dropTableIfExists('gas_funding_transactions');
  await knex.schema.dropTableIfExists('sweep_transactions');
  await knex.schema.dropTableIfExists('admin_wallets');

  const hasAddressLower = await knex.schema.hasColumn('user_wallets', 'address_lower');
  const hasEncryptedPrivateKey = await knex.schema.hasColumn('user_wallets', 'encrypted_private_key');
  const hasIsActive = await knex.schema.hasColumn('user_wallets', 'is_active');
  if (hasAddressLower || hasEncryptedPrivateKey || hasIsActive) {
    await knex.schema.alterTable('user_wallets', (t) => {
      if (hasAddressLower) t.dropColumn('address_lower');
      if (hasEncryptedPrivateKey) t.dropColumn('encrypted_private_key');
      if (hasIsActive) t.dropColumn('is_active');
    });
  }
}
