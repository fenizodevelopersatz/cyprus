export async function up(knex) {
  const hasNetworkKey = await knex.schema.hasColumn('deposits', 'network_key');
  if (!hasNetworkKey) {
    await knex.schema.alterTable('deposits', (t) => {
      t.string('network_key', 16).notNullable().defaultTo('ethereum');
      t.string('token_key', 16).notNullable().defaultTo('usdt');
      t.string('token_contract', 191).nullable();
      t.string('status', 32).notNullable().defaultTo('detected');
      t.boolean('credited').notNullable().defaultTo(false);
      t.datetime('credited_at').nullable();
      t.datetime('first_seen_at').nullable();
      t.datetime('last_seen_at').nullable();
      t.datetime('last_checked_at').nullable();
      t.integer('confirmation_target').unsigned().notNullable().defaultTo(0);
      t.json('raw_payload');
      t.string('source', 32).nullable();
    });
  }

  try {
    await knex('deposits').update({
      network_key: knex.raw(`
        CASE
          WHEN UPPER(chain) = 'ERC20' THEN 'ethereum'
          WHEN UPPER(chain) = 'BEP20' THEN 'bsc'
          WHEN UPPER(chain) = 'TRC20' THEN 'tron'
          ELSE LOWER(chain)
        END
      `),
      token_key: 'usdt',
      status: knex.raw(`
        CASE
          WHEN credited = 1 THEN 'credited'
          WHEN confirmations > 0 THEN 'confirmed'
          ELSE 'detected'
        END
      `),
      first_seen_at: knex.raw('COALESCE(first_seen_at, created_at)'),
      last_seen_at: knex.raw('COALESCE(last_seen_at, updated_at, created_at)'),
      last_checked_at: knex.raw('COALESCE(last_checked_at, updated_at, created_at)'),
      confirmation_target: knex.raw('COALESCE(NULLIF(confirmations, 0), confirmation_target, 0)'),
      source: knex.raw("COALESCE(source, 'legacy')"),
    });
  } catch {}

  const hasCursorValue = await knex.schema.hasColumn('deposit_scan_state', 'cursor_value');
  if (!hasCursorValue) {
    await knex.schema.alterTable('deposit_scan_state', (t) => {
      t.text('cursor_value');
      t.json('cursor_meta');
      t.datetime('last_synced_at').nullable();
    });
  }

  await knex.schema.alterTable('deposits', (t) => {
    t.index(['user_id', 'network_key', 'status'], 'deposits_user_network_status_idx');
    t.index(['network_key', 'status', 'created_at'], 'deposits_network_status_created_idx');
  });
}

export async function down(knex) {
  try {
    await knex.schema.alterTable('deposits', (t) => {
      t.dropIndex(['user_id', 'network_key', 'status'], 'deposits_user_network_status_idx');
      t.dropIndex(['network_key', 'status', 'created_at'], 'deposits_network_status_created_idx');
    });
  } catch {}

  const hasCursorValue = await knex.schema.hasColumn('deposit_scan_state', 'cursor_value');
  if (hasCursorValue) {
    await knex.schema.alterTable('deposit_scan_state', (t) => {
      t.dropColumn('cursor_value');
      t.dropColumn('cursor_meta');
      t.dropColumn('last_synced_at');
    });
  }

  const hasNetworkKey = await knex.schema.hasColumn('deposits', 'network_key');
  if (hasNetworkKey) {
    await knex.schema.alterTable('deposits', (t) => {
      t.dropColumn('network_key');
      t.dropColumn('token_key');
      t.dropColumn('token_contract');
      t.dropColumn('status');
      t.dropColumn('credited');
      t.dropColumn('credited_at');
      t.dropColumn('first_seen_at');
      t.dropColumn('last_seen_at');
      t.dropColumn('last_checked_at');
      t.dropColumn('confirmation_target');
      t.dropColumn('raw_payload');
      t.dropColumn('source');
    });
  }
}
