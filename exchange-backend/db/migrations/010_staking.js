export async function up(knex) {
  await knex.schema.createTable('staking_packages', (table) => {
    table.increments('id').primary();
    table.string('label', 120).notNullable();
    table.string('asset', 16).notNullable();
    table.decimal('apr_percent', 8, 4).notNullable().defaultTo(0);
    table.integer('lock_days').unsigned().notNullable().defaultTo(0);
    table.decimal('min_amount', 36, 18).notNullable().defaultTo(0);
    table.decimal('max_amount', 36, 18);
    table.boolean('is_featured').notNullable().defaultTo(false);
    table.string('status', 32).notNullable().defaultTo('draft');
    table.integer('sort_order').defaultTo(0);
    table.text('description');
    table.json('meta');
    table.timestamps(true, true);
  });

  await knex.schema.createTable('staking_positions', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    table
      .integer('package_id')
      .unsigned()
      .references('staking_packages.id')
      .onDelete('CASCADE');
    table.string('asset', 16).notNullable();
    table.decimal('amount', 36, 18).notNullable();
    table.decimal('apr_percent', 8, 4).notNullable();
    table.integer('lock_days').unsigned().notNullable();
    table.boolean('auto_compound').notNullable().defaultTo(false);
    table.string('status', 32).notNullable().defaultTo('ACTIVE');
    table.decimal('rewards_accrued', 36, 18).notNullable().defaultTo(0);
    table.decimal('rewards_paid', 36, 18).notNullable().defaultTo(0);
    table.timestamp('staked_at').defaultTo(knex.fn.now());
    table.timestamp('unlock_at').nullable().defaultTo(null);
    table.timestamp('unstaked_at').nullable().defaultTo(null);
    table.json('meta');
    table.timestamps(true, true);
    table.index(['user_id', 'status']);
    table.index(['package_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('staking_positions');
  await knex.schema.dropTableIfExists('staking_packages');
}
