export async function up(knex) {
  const hasSnapshotsTable = await knex.schema.hasTable('mlm_bonus_cycle_snapshots');
  if (!hasSnapshotsTable) {
    await knex.schema.createTable('mlm_bonus_cycle_snapshots', (table) => {
      table.increments('id').primary();
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      table.string('level_code', 20).notNullable();
      table.integer('level_rank').notNullable().defaultTo(0);
      table.decimal('bonus_percent', 10, 4).notNullable().defaultTo(0);
      table.dateTime('qualified_at').nullable();
      table.dateTime('next_bonus_due_at').nullable();
      table.decimal('eligible_balance', 36, 18).notNullable().defaultTo(0);
      table.integer('eligible_members').notNullable().defaultTo(0);
      table.integer('qualified_direct_members').notNullable().defaultTo(0);
      table.string('status', 32).notNullable().defaultTo('frozen');
      table.json('meta').nullable();
      table.timestamps(true, true);
      table.unique(['user_id', 'level_code', 'qualified_at', 'next_bonus_due_at'], {
        indexName: 'mlm_bonus_cycle_snapshots_freeze_unique',
      });
      table.index(['user_id', 'created_at'], 'mlm_bonus_cycle_snapshots_user_idx');
    });
  }

  const hasSnapshotMembersTable = await knex.schema.hasTable('mlm_bonus_cycle_snapshot_members');
  if (!hasSnapshotMembersTable) {
    await knex.schema.createTable('mlm_bonus_cycle_snapshot_members', (table) => {
      table.increments('id').primary();
      table.integer('snapshot_id').unsigned().notNullable().references('mlm_bonus_cycle_snapshots.id').onDelete('CASCADE');
      table.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
      table.decimal('wallet_balance', 36, 18).notNullable().defaultTo(0);
      table.string('status', 32).notNullable().defaultTo('active');
      table.string('level_code', 20).nullable();
      table.integer('level_rank').notNullable().defaultTo(0);
      table.timestamps(true, true);
      table.unique(['snapshot_id', 'user_id'], { indexName: 'mlm_bonus_cycle_snapshot_members_unique' });
      table.index(['user_id', 'created_at'], 'mlm_bonus_cycle_snapshot_members_user_idx');
    });
  }

  const userPositionStatusColumns = [
    ['current_cycle_snapshot_id', (table) => table.integer('current_cycle_snapshot_id').unsigned().nullable().references('mlm_bonus_cycle_snapshots.id').onDelete('SET NULL')],
  ];
  for (const [columnName, addColumn] of userPositionStatusColumns) {
    const hasColumn = await knex.schema.hasColumn('user_position_status', columnName);
    if (!hasColumn) {
      await knex.schema.alterTable('user_position_status', (table) => {
        addColumn(table);
      });
    }
  }

  const payoutColumns = [
    ['snapshot_id', (table) => table.integer('snapshot_id').unsigned().nullable().references('mlm_bonus_cycle_snapshots.id').onDelete('SET NULL')],
  ];
  for (const [columnName, addColumn] of payoutColumns) {
    const hasColumn = await knex.schema.hasColumn('mlm_level_bonus_payouts', columnName);
    if (!hasColumn) {
      await knex.schema.alterTable('mlm_level_bonus_payouts', (table) => {
        addColumn(table);
      });
    }
  }
}

export async function down(knex) {
  const payoutHasSnapshotId = await knex.schema.hasColumn('mlm_level_bonus_payouts', 'snapshot_id');
  if (payoutHasSnapshotId) {
    await knex.schema.alterTable('mlm_level_bonus_payouts', (table) => {
      table.dropColumn('snapshot_id');
    });
  }

  const positionHasSnapshotId = await knex.schema.hasColumn('user_position_status', 'current_cycle_snapshot_id');
  if (positionHasSnapshotId) {
    await knex.schema.alterTable('user_position_status', (table) => {
      table.dropColumn('current_cycle_snapshot_id');
    });
  }

  await knex.schema.dropTableIfExists('mlm_bonus_cycle_snapshot_members');
  await knex.schema.dropTableIfExists('mlm_bonus_cycle_snapshots');
}
