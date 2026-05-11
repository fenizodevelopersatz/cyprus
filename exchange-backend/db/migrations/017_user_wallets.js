export async function up(knex) {
  await knex.schema.createTable('user_wallets', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('network', 16).notNullable();
    t.string('address', 191).notNullable();
    t.text('private_key_encrypted').notNullable();
    t.json('meta');
    t.timestamps(true, true);
    t.unique(['user_id', 'network'], { indexName: 'user_wallets_user_network_unique' });
    t.unique(['network', 'address'], { indexName: 'user_wallets_network_address_unique' });
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('user_wallets');
}
