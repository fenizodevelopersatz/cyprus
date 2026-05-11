export async function up(knex) {
  if (await knex.schema.hasTable('users')) {
    if (!(await knex.schema.hasColumn('users', 'direct_income_paid'))) {
      await knex.schema.alterTable('users', (table) => {
        table.boolean('direct_income_paid').notNullable().defaultTo(false);
      });
    }
    if (!(await knex.schema.hasColumn('users', 'direct_income_paid_at'))) {
      await knex.schema.alterTable('users', (table) => {
        table.dateTime('direct_income_paid_at').nullable();
      });
    }
    if (!(await knex.schema.hasColumn('users', 'join_reward_paid'))) {
      await knex.schema.alterTable('users', (table) => {
        table.boolean('join_reward_paid').notNullable().defaultTo(false);
      });
    }
    if (!(await knex.schema.hasColumn('users', 'first_deposit_amount'))) {
      await knex.schema.alterTable('users', (table) => {
        table.decimal('first_deposit_amount', 24, 8).nullable();
      });
    }
    if (!(await knex.schema.hasColumn('users', 'first_deposit_at'))) {
      await knex.schema.alterTable('users', (table) => {
        table.dateTime('first_deposit_at').nullable();
      });
    }
    if (!(await knex.schema.hasColumn('users', 'level_last_paid_at'))) {
      await knex.schema.alterTable('users', (table) => {
        table.dateTime('level_last_paid_at').nullable();
      });
    }
  }

  if (!(await knex.schema.hasTable('user_level_history'))) {
    await knex.schema.createTable('user_level_history', (table) => {
      table.bigIncrements('id').primary();
      table.bigInteger('user_id').unsigned().notNullable().index();
      table.integer('level').notNullable().index();
      table.dateTime('achieved_at').nullable();
      table.boolean('is_reward_given').notNullable().defaultTo(false).index();
      table.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
      table.dateTime('updated_at').notNullable().defaultTo(knex.fn.now());
    });
  }

  const hasUnique = async (table, columns, indexName) => {
    const exists = await knex.schema.hasTable(table);
    if (!exists) return;
    const colInfo = await knex(table).columnInfo();
    if (!columns.every((column) => Object.prototype.hasOwnProperty.call(colInfo, column))) return;
    const raw = await knex.raw(`SHOW INDEX FROM ?? WHERE Key_name = ?`, [table, indexName]);
    const rows = Array.isArray(raw) ? raw[0] : raw;
    if (!rows || rows.length === 0) {
      await knex.schema.alterTable(table, (t) => t.unique(columns, indexName));
    }
  };

  await hasUnique('mlm_income_history', ['user_id', 'income_type', 'reference_id'], 'mlm_income_history_user_income_reference_unique');
  await hasUnique('user_signal_logs', ['user_id', 'signal_token', 'slot_key'], 'user_signal_logs_user_signal_slot_unique');
  await hasUnique('user_level_history', ['user_id', 'level'], 'user_level_history_user_level_unique');
}

export async function down(knex) {
  if (await knex.schema.hasTable('user_level_history')) {
    await knex.schema.dropTable('user_level_history');
  }
  if (await knex.schema.hasTable('users')) {
    for (const column of ['level_last_paid_at', 'first_deposit_at', 'first_deposit_amount', 'join_reward_paid', 'direct_income_paid_at', 'direct_income_paid']) {
      if (await knex.schema.hasColumn('users', column)) {
        await knex.schema.alterTable('users', (table) => table.dropColumn(column));
      }
    }
  }
}
