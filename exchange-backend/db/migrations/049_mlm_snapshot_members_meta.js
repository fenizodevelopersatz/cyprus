export async function up(knex) {
  const hasMembersTable = await knex.schema.hasTable('mlm_bonus_cycle_snapshot_members');
  if (!hasMembersTable) return;

  const getExistingColumns = async () => Object.keys(await knex('mlm_bonus_cycle_snapshot_members').columnInfo());

  const hasMeta = await knex.schema.hasColumn('mlm_bonus_cycle_snapshot_members', 'meta');
  const hasPayoutStatus = await knex.schema.hasColumn('mlm_bonus_cycle_snapshot_members', 'payout_status');
  if (!hasMeta || !hasPayoutStatus) {
    await knex.schema.alterTable('mlm_bonus_cycle_snapshot_members', (table) => {
      if (!hasMeta) table.json('meta').nullable();
      if (!hasPayoutStatus) table.string('payout_status', 32).notNullable().defaultTo('frozen');
    });
  }

  const existingColumns = await getExistingColumns();
  const selectColumns = ['id', 'created_at', 'meta'];
  if (existingColumns.includes('user_id')) selectColumns.push('user_id');
  if (existingColumns.includes('member_user_id')) selectColumns.push('member_user_id');
  if (existingColumns.includes('wallet_balance')) selectColumns.push('wallet_balance');
  const legacyRows = await knex('mlm_bonus_cycle_snapshot_members').select(selectColumns);
  for (const row of legacyRows) {
    const nextMeta = row.meta
      ? row.meta
      : JSON.stringify({
          user_id: Number(row.user_id || row.member_user_id || 0),
          wallet_balance: String(row.wallet_balance || '0'),
          created_at: row.created_at,
        });
    await knex('mlm_bonus_cycle_snapshot_members').where({ id: row.id }).update({ meta: nextMeta });
  }

  const refreshedColumns = await getExistingColumns();
  if (refreshedColumns.includes('user_id')) {
    try {
      await knex.schema.alterTable('mlm_bonus_cycle_snapshot_members', (table) => {
        table.dropUnique(['snapshot_id', 'user_id'], 'mlm_bonus_cycle_snapshot_members_unique');
      });
    } catch {}
  }
  if (refreshedColumns.includes('member_user_id')) {
    try {
      await knex.schema.alterTable('mlm_bonus_cycle_snapshot_members', (table) => {
        table.dropUnique(['snapshot_id', 'member_user_id'], 'mlm_bonus_cycle_snapshot_members_unique');
      });
    } catch {}
  }

  const columnsToDrop = ['member_user_id', 'wallet_balance', 'status', 'level_code', 'level_rank'];
  for (const columnName of columnsToDrop) {
    const currentColumns = await getExistingColumns();
    if (!currentColumns.includes(columnName)) continue;
    try {
      await knex.schema.alterTable('mlm_bonus_cycle_snapshot_members', (table) => {
        table.dropColumn(columnName);
      });
    } catch {}
  }
}

export async function down(knex) {
  const hasMembersTable = await knex.schema.hasTable('mlm_bonus_cycle_snapshot_members');
  if (!hasMembersTable) return;

  const columnsToAdd = [
    ['user_id', (table) => table.integer('user_id').unsigned().nullable().references('users.id').onDelete('CASCADE')],
    ['wallet_balance', (table) => table.decimal('wallet_balance', 36, 18).notNullable().defaultTo(0)],
    ['status', (table) => table.string('status', 32).notNullable().defaultTo('active')],
    ['level_code', (table) => table.string('level_code', 20).nullable()],
    ['level_rank', (table) => table.integer('level_rank').notNullable().defaultTo(0)],
  ];
  for (const [columnName, addColumn] of columnsToAdd) {
    const hasColumn = await knex.schema.hasColumn('mlm_bonus_cycle_snapshot_members', columnName);
    if (!hasColumn) {
      await knex.schema.alterTable('mlm_bonus_cycle_snapshot_members', (table) => {
        addColumn(table);
      });
    }
  }

  const rows = await knex('mlm_bonus_cycle_snapshot_members').select('id', 'meta');
  for (const row of rows) {
    const meta = typeof row.meta === 'string' ? JSON.parse(row.meta || '{}') : row.meta || {};
    await knex('mlm_bonus_cycle_snapshot_members').where({ id: row.id }).update({
      user_id: Number(meta.user_id || 0) || null,
      wallet_balance: String(meta.wallet_balance || 0),
      status: 'active',
      level_code: null,
      level_rank: 0,
    });
  }

  const hasMeta = await knex.schema.hasColumn('mlm_bonus_cycle_snapshot_members', 'meta');
  const hasPayoutStatus = await knex.schema.hasColumn('mlm_bonus_cycle_snapshot_members', 'payout_status');
  if (hasMeta || hasPayoutStatus) {
    await knex.schema.alterTable('mlm_bonus_cycle_snapshot_members', (table) => {
      if (hasMeta) table.dropColumn('meta');
      if (hasPayoutStatus) table.dropColumn('payout_status');
    });
  }
}
