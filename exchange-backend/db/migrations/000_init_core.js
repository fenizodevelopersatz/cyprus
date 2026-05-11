export async function up(knex){
await knex.schema.createTable('users', t=>{
t.increments('id').primary();
t.string('email').unique().notNullable();
t.string('password_hash').notNullable();
t.string('country');
t.integer('kyc_level').defaultTo(0);
t.boolean('kyc_verified').defaultTo(false);
t.string('roles').defaultTo('user');
t.timestamps(true,true);
});


await knex.schema.createTable('user_profiles', t=>{
t.integer('user_id').unsigned().primary().references('users.id').onDelete('CASCADE');
t.string('display_name');
t.string('country');
t.string('tier');
t.datetime('last_login');
});


await knex.schema.createTable('kyc_requests', t=>{
t.increments('id').primary();
t.integer('user_id').unsigned().references('users.id');
t.string('status');
t.json('documents');
t.integer('reviewer_id').unsigned();
t.datetime('reviewed_at');
t.timestamps(true,true);
});


await knex.schema.createTable('refresh_tokens', t=>{
t.increments('id').primary();
t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
t.text('token').notNullable();
t.datetime('expires_at').notNullable();
t.timestamps(true,true);
});


await knex.schema.createTable('wallets', t=>{
t.increments('id').primary();
t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
t.enum('type',['spot','margin','futures','p2p_escrow']).notNullable();
t.string('asset').notNullable();
t.decimal('balance',20,8).defaultTo(0);
});


await knex.schema.createTable('wallet_transactions', t=>{
t.increments('id').primary();
t.integer('wallet_id').unsigned().references('wallets.id').onDelete('CASCADE');
t.string('type');
t.decimal('amount',20,8);
t.decimal('balance_after',20,8);
t.json('metadata');
t.timestamps(true,true);
});


await knex.schema.createTable('audit_logs', t=>{
t.increments('id').primary();
t.integer('user_id').unsigned();
t.string('action');
t.json('details');
t.timestamps(true,true);
});
}


export async function down(knex){
await knex.schema.dropTableIfExists('audit_logs');
await knex.schema.dropTableIfExists('wallet_transactions');
await knex.schema.dropTableIfExists('wallets');
await knex.schema.dropTableIfExists('refresh_tokens');
await knex.schema.dropTableIfExists('kyc_requests');
await knex.schema.dropTableIfExists('user_profiles');
}