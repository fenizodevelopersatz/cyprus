
// db/migrations/003_p2p.js
export async function up(knex){
  await knex.schema.createTable('p2p_listings', t=>{
    t.increments('id').primary();
    t.enum('type',['BUY','SELL']).notNullable();
    t.string('asset').defaultTo('USDT');
    t.string('fiat_currency').defaultTo('INR');
    t.decimal('price',20,8).notNullable();
    t.decimal('min_amount',20,8).notNullable();
    t.decimal('max_amount',20,8).notNullable();
    t.json('payment_methods');
    t.integer('trader_id').unsigned().references('users.id');
    t.string('status').defaultTo('ACTIVE');
    t.timestamps(true,true);
  });

  await knex.schema.createTable('p2p_orders', t=>{
    t.increments('id').primary();
    t.integer('listing_id').unsigned().references('p2p_listings.id');
    t.integer('buyer_id').unsigned().references('users.id');
    t.integer('seller_id').unsigned().references('users.id');
    t.enum('type',['BUY','SELL']).notNullable();
    t.decimal('fiat_amount',20,8);
    t.decimal('crypto_amount',20,8);
    t.string('status'); // ESCROW_LOCKED -> WAITING_PAYMENT -> PAID -> RELEASED / CANCELED
    t.decimal('escrow_amount',20,8);
    t.datetime('escrow_released_at');
    t.timestamps(true,true);
  });

  await knex.schema.createTable('p2p_order_messages', t=>{
    t.increments('id').primary();
    t.integer('order_id').unsigned().references('p2p_orders.id').onDelete('CASCADE');
    t.enu('author',['buyer','seller','system']).notNullable();
    t.text('body');
    t.timestamps(true,true);
  });
}

export async function down(knex){
  await knex.schema.dropTableIfExists('p2p_order_messages');
  await knex.schema.dropTableIfExists('p2p_orders');
  await knex.schema.dropTableIfExists('p2p_listings');
}

