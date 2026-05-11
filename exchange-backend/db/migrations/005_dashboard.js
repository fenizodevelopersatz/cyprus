// db/migrations/005_dashboard.js
export async function up(knex){
  await knex.schema.alterTable('spot_orders', t=>{
    t.string('exchange_order_id').unique();
    t.string('exchange');
  });

  await knex.schema.createTable('dashboard_summary', t=>{
    t.integer('user_id').unsigned().primary().references('users.id').onDelete('CASCADE');
    t.decimal('balance_usdt', 20, 8).defaultTo(0);
    t.decimal('pnl_24h', 20, 8).defaultTo(0);
    t.decimal('exposure', 20, 8).defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('dashboard_promotions', t=>{
    t.increments('id').primary();
    t.string('placement').defaultTo('dashboard');
    t.string('title').notNullable();
    t.string('subtitle');
    t.string('cta_label');
    t.string('cta_url');
    t.string('accent_start');
    t.string('accent_end');
    t.json('meta');
    t.boolean('active').defaultTo(true);
    t.boolean('pinned').defaultTo(false);
    t.datetime('published_at').defaultTo(knex.fn.now());
    t.timestamps(true, true);
  });

  await knex.schema.createTable('dashboard_news', t=>{
    t.increments('id').primary();
    t.string('headline').notNullable();
    t.string('summary', 1024);
    t.string('source');
    t.string('tag');
    t.string('url');
    t.boolean('pinned').defaultTo(false);
    t.datetime('published_at').defaultTo(knex.fn.now());
    t.timestamps(true, true);
  });

  await knex.schema.createTable('exchange_connections', t=>{
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.string('exchange').notNullable();
    t.string('api_key').notNullable();
    t.string('api_secret').notNullable();
    t.string('listen_key');
    t.datetime('listen_key_expires_at');
    t.json('meta');
    t.timestamps(true, true);
    t.unique(['user_id', 'exchange']);
  });
}

export async function down(knex){
  await knex.schema.alterTable('spot_orders', t=>{
    t.dropColumn('exchange');
    t.dropColumn('exchange_order_id');
  });
  await knex.schema.dropTableIfExists('exchange_connections');
  await knex.schema.dropTableIfExists('dashboard_news');
  await knex.schema.dropTableIfExists('dashboard_promotions');
  await knex.schema.dropTableIfExists('dashboard_summary');
}
