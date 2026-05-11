function now() {
  return new Date();
}

export async function up(knex) {
  const hasWalletAddresses = await knex.schema.hasTable('wallet_addresses');
  if (!hasWalletAddresses) {
    await knex.schema.createTable('wallet_addresses', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      t.string('network', 32).notNullable();
      t.string('token', 16).notNullable().defaultTo('USDT');
      t.string('label', 64);
      t.string('address', 191).notNullable();
      t.string('address_lower', 191);
      t.boolean('is_active').notNullable().defaultTo(true);
      t.string('memo_tag', 191);
      t.json('meta');
      t.timestamps(true, true);
      t.unique(['user_id', 'network', 'token'], { indexName: 'wallet_addresses_user_network_token_unique' });
      t.index(['network', 'token', 'address_lower'], 'wallet_addresses_network_token_lower_idx');
    });
  }

  const hasDepositChainCursors = await knex.schema.hasTable('deposit_chain_cursors');
  if (!hasDepositChainCursors) {
    await knex.schema.createTable('deposit_chain_cursors', (t) => {
      t.increments('id').primary();
      t.string('network', 32).notNullable();
      t.string('token', 16).notNullable().defaultTo('USDT');
      t.bigInteger('last_scanned_block').defaultTo(0);
      t.text('cursor_value');
      t.json('cursor_meta');
      t.datetime('last_synced_at');
      t.timestamps(true, true);
      t.unique(['network', 'token'], { indexName: 'deposit_chain_cursors_network_token_unique' });
    });
  }

  const hasDepositTransactions = await knex.schema.hasTable('deposit_transactions');
  if (!hasDepositTransactions) {
    await knex.schema.createTable('deposit_transactions', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      t.integer('wallet_address_id').unsigned().references('wallet_addresses.id').onDelete('SET NULL');
      t.string('network', 32).notNullable();
      t.string('token', 16).notNullable().defaultTo('USDT');
      t.string('type', 8).notNullable();
      t.string('tx_hash', 191).notNullable();
      t.integer('log_index').unsigned().notNullable().defaultTo(0);
      t.string('contract_address', 191);
      t.string('from_address', 191);
      t.string('to_address', 191);
      t.string('deposit_address', 191);
      t.string('amount_decimal', 64).notNullable().defaultTo('0');
      t.bigInteger('block_number');
      t.integer('confirmation_count').unsigned().notNullable().defaultTo(0);
      t.integer('confirmation_target').unsigned().notNullable().defaultTo(0);
      t.string('status', 32).notNullable().defaultTo('detected');
      t.boolean('is_success').notNullable().defaultTo(true);
      t.boolean('is_inbound').notNullable().defaultTo(true);
      t.boolean('credited').notNullable().defaultTo(false);
      t.datetime('confirmed_at');
      t.datetime('credited_at');
      t.json('raw_payload');
      t.json('meta');
      t.timestamps(true, true);
      t.unique(['network', 'token', 'tx_hash', 'log_index'], { indexName: 'deposit_transactions_event_unique' });
      t.index(['user_id', 'network', 'created_at'], 'deposit_transactions_user_network_created_idx');
    });
  }

  const hasDepositSyncRuns = await knex.schema.hasTable('deposit_sync_runs');
  if (!hasDepositSyncRuns) {
    await knex.schema.createTable('deposit_sync_runs', (t) => {
      t.increments('id').primary();
      t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
      t.string('network', 32);
      t.string('token', 16).notNullable().defaultTo('USDT');
      t.string('trigger_type', 32).notNullable().defaultTo('manual');
      t.string('status', 32).notNullable().defaultTo('started');
      t.integer('synced_count').unsigned().notNullable().defaultTo(0);
      t.integer('skipped_count').unsigned().notNullable().defaultTo(0);
      t.text('error_message');
      t.json('meta');
      t.datetime('started_at').notNullable();
      t.datetime('finished_at');
      t.timestamps(true, true);
      t.index(['user_id', 'created_at'], 'deposit_sync_runs_user_created_idx');
    });
  }

  const currentTime = now();
  const hasUserWallets = await knex.schema.hasTable('user_wallets');
  if (hasUserWallets) {
    const wallets = await knex('user_wallets').select('*');
    for (const wallet of wallets) {
      const network =
        wallet.network === 'ERC20' ? 'ethereum' : wallet.network === 'BEP20' ? 'bsc' : 'tron';
      const addressLower = network === 'tron' ? null : String(wallet.address || '').toLowerCase();
      const existing = await knex('wallet_addresses')
        .where({ user_id: wallet.user_id, network, token: 'USDT' })
        .first();
      const payload = {
        user_id: wallet.user_id,
        network,
        token: 'USDT',
        label: network === 'ethereum' ? 'USDT Ethereum' : network === 'bsc' ? 'USDT BSC' : 'USDT TRON',
        address: wallet.address,
        address_lower: addressLower,
        is_active: true,
        memo_tag: null,
        meta: wallet.meta || null,
        updated_at: wallet.updated_at || currentTime,
      };
      if (existing) {
        await knex('wallet_addresses').where({ id: existing.id }).update(payload);
      } else {
        await knex('wallet_addresses').insert({ ...payload, created_at: wallet.created_at || currentTime });
      }
    }
  }

  const hasDepositScanState = await knex.schema.hasTable('deposit_scan_state');
  if (hasDepositScanState) {
    const cursors = await knex('deposit_scan_state').select('*');
    for (const cursor of cursors) {
      const network =
        cursor.network === 'ERC20' ? 'ethereum' : cursor.network === 'BEP20' ? 'bsc' : 'tron';
      const existing = await knex('deposit_chain_cursors').where({ network, token: 'USDT' }).first();
      const payload = {
        network,
        token: 'USDT',
        last_scanned_block: cursor.last_processed_block || 0,
        cursor_value: cursor.cursor_value || null,
        cursor_meta: cursor.cursor_meta || null,
        last_synced_at: cursor.last_synced_at || cursor.updated_at || currentTime,
        updated_at: cursor.updated_at || currentTime,
      };
      if (existing) {
        await knex('deposit_chain_cursors').where({ id: existing.id }).update(payload);
      } else {
        await knex('deposit_chain_cursors').insert({ ...payload, created_at: cursor.created_at || currentTime });
      }
    }
  }

  const hasDeposits = await knex.schema.hasTable('deposits');
  if (hasDeposits) {
    const deposits = await knex('deposits').select('*');
    for (const deposit of deposits) {
      const network =
        deposit.network_key ||
        (deposit.chain === 'ERC20' ? 'ethereum' : deposit.chain === 'BEP20' ? 'bsc' : 'tron');
      const type = network === 'ethereum' ? 'ERC' : network === 'bsc' ? 'BEP' : 'TRC';
      const walletAddress = await knex('wallet_addresses')
        .where({ user_id: deposit.user_id, network, token: 'USDT' })
        .first();
      const existing = await knex('deposit_transactions')
        .where({
          network,
          token: 'USDT',
          tx_hash: deposit.tx_hash,
          log_index: deposit.log_index || 0,
        })
        .first();
      const payload = {
        user_id: deposit.user_id,
        wallet_address_id: walletAddress?.id || null,
        network,
        token: 'USDT',
        type,
        tx_hash: deposit.tx_hash,
        log_index: deposit.log_index || 0,
        contract_address: deposit.token_contract || null,
        from_address: deposit.from_address || null,
        to_address: deposit.to_address || null,
        deposit_address: deposit.to_address || walletAddress?.address || null,
        amount_decimal: deposit.amount,
        block_number: deposit.block_number || null,
        confirmation_count: deposit.confirmations || 0,
        confirmation_target: deposit.confirmation_target || 0,
        status: deposit.status || 'detected',
        is_success: true,
        is_inbound: true,
        credited: Boolean(deposit.credited || deposit.status === 'credited'),
        confirmed_at: deposit.confirmed_at || null,
        credited_at: deposit.credited_at || null,
        raw_payload: deposit.raw_payload || null,
        meta: deposit.meta || null,
        updated_at: deposit.updated_at || currentTime,
      };
      if (existing) {
        await knex('deposit_transactions').where({ id: existing.id }).update(payload);
      } else {
        await knex('deposit_transactions').insert({ ...payload, created_at: deposit.created_at || currentTime });
      }
    }
  }
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('deposit_sync_runs');
  await knex.schema.dropTableIfExists('deposit_transactions');
  await knex.schema.dropTableIfExists('deposit_chain_cursors');
  await knex.schema.dropTableIfExists('wallet_addresses');
}
