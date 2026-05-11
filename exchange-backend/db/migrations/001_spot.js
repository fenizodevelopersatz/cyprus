// db/migrations/001_spot.js
export async function up(knex){
  await knex.schema.createTable('market_symbols', t=>{
    t.string('symbol').primary();
    t.string('base_asset');
    t.string('quote_asset');
    t.decimal('tick_size',20,8).defaultTo(0.01);
    t.decimal('lot_size',20,8).defaultTo(0.0001);
    t.string('contract_type');
    t.decimal('last_price',20,8).defaultTo(0);
  });

  await knex.schema.createTable('spot_orders', t=>{
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id');
    t.string('symbol').references('market_symbols.symbol');
    t.enum('side',['BUY','SELL']).notNullable();
    t.enum('type',['MARKET','LIMIT']).notNullable();
    t.decimal('price',20,8);
    t.decimal('size',20,8).notNullable();
    t.decimal('filled',20,8).defaultTo(0);
    t.enum('status',['NEW','FILLED','CANCELED','PARTIALLY_FILLED']).defaultTo('NEW');
    t.timestamps(true,true);
  });

  await knex.schema.createTable('spot_trades', t=>{
    t.increments('id').primary();
    t.integer('order_id').unsigned().references('spot_orders.id');
    t.integer('match_id').unsigned();
    t.decimal('price',20,8);
    t.decimal('size',20,8);
    t.decimal('fee',20,8);
    t.timestamps(true,true);
  });
}

export async function down(knex){
  await knex.schema.dropTableIfExists('spot_trades');
  await knex.schema.dropTableIfExists('spot_orders');
  await knex.schema.dropTableIfExists('market_symbols');
}
