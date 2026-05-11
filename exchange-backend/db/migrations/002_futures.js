

// db/migrations/002_futures.js
export async function up(knex){
  await knex.schema.createTable('futures_positions', t=>{
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id');
    t.string('symbol');
    t.enum('side',['LONG','SHORT']).notNullable();
    t.decimal('size',20,8);
    t.decimal('entry_price',20,8);
    t.integer('leverage');
    t.decimal('margin',20,8);
    t.decimal('stop_loss',20,8);
    t.decimal('take_profit',20,8);
    t.enum('status',['OPEN','CLOSED']).defaultTo('OPEN');
    t.timestamps(true,true);
  });

  await knex.schema.createTable('futures_trades', t=>{
    t.increments('id').primary();
    t.integer('user_id').unsigned();
    t.string('symbol');
    t.enum('side',['LONG','SHORT']).notNullable();
    t.decimal('size',20,8);
    t.decimal('price',20,8);
    t.integer('leverage');
    t.decimal('realized_pnl',20,8).defaultTo(0);
    t.string('status');
    t.timestamps(true,true);
  });

  await knex.schema.createTable('futures_funding_rates', t=>{
    t.increments('id').primary();
    t.string('symbol');
    t.decimal('rate',20,8);
    t.datetime('timestamp');
  });

  await knex.schema.createTable('futures_price_ticks', t=>{
    t.increments('id').primary();
    t.string('symbol');
    t.decimal('price',20,8);
    t.datetime('timestamp');
  });
}

export async function down(knex){
  await knex.schema.dropTableIfExists('futures_price_ticks');
  await knex.schema.dropTableIfExists('futures_funding_rates');
  await knex.schema.dropTableIfExists('futures_trades');
  await knex.schema.dropTableIfExists('futures_positions');
}

