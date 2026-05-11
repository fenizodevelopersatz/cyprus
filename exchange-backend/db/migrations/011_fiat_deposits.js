export async function up(knex) {
  await knex.schema.createTable('fiat_deposits', (table) => {
    table.increments('id').primary();
    table.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    table.string('method', 32).notNullable();
    table.string('status', 32).notNullable().defaultTo('pending');
    table.string('wallet', 32).notNullable().defaultTo('spot');
    table.decimal('amount', 20, 2).notNullable();
    table.string('currency', 16).notNullable().defaultTo('USD');
    table.string('reference', 191);
    table.string('proof_url', 512);
    table.string('payment_intent_id', 191);
    table.string('payment_intent_secret', 191);
    table.json('meta');
    table.integer('reviewer_id').unsigned().references('users.id');
    table.timestamp('reviewed_at');
    table.text('review_notes');
    table.timestamps(true, true);
    table.index(['user_id', 'status']);
    table.index(['method', 'status']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('fiat_deposits');
}

