
// db/migrations/004_misc.js
export async function up(knex){
  await knex.schema.createTable('swap_quotes', t=>{
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id');
    t.string('from_asset');
    t.string('to_asset');
    t.decimal('amount_in',20,8);
    t.decimal('amount_out',20,8);
    t.decimal('slippage',20,8);
    t.json('routing');
    t.timestamps(true,true);
  });

  await knex.schema.createTable('paper_orders', t=>{
    t.increments('id').primary();
    t.integer('user_id').unsigned();
    t.string('symbol');
    t.string('side');
    t.string('type');
    t.decimal('price',20,8);
    t.decimal('qty',20,8);
    t.string('status');
    t.timestamps(true,true);
  });

  await knex.schema.createTable('paper_positions', t=>{
    t.increments('id').primary();
    t.integer('user_id').unsigned();
    t.string('symbol');
    t.decimal('qty',20,8);
    t.decimal('avg_price',20,8);
    t.timestamps(true,true);
  });
}

export async function down(knex){
  await knex.schema.dropTableIfExists('paper_positions');
  await knex.schema.dropTableIfExists('paper_orders');
  await knex.schema.dropTableIfExists('swap_quotes');
}
