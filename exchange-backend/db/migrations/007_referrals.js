// db/migrations/007_referrals.js

export async function up(knex) {
  await knex.schema.createTable('referral_profiles', (t) => {
    t.integer('user_id').unsigned().primary().references('users.id').onDelete('CASCADE');
    t.string('code').notNullable().unique();
    t.string('message', 512);
    t.string('url', 512);
    t.boolean('promo_active').defaultTo(false);
    t.datetime('promo_updated_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('referral_stats', (t) => {
    t.integer('user_id').unsigned().primary().references('users.id').onDelete('CASCADE');
    t.integer('total_invites').defaultTo(0);
    t.integer('total_invites_delta').defaultTo(0);
    t.string('total_invites_delta_label', 255);
    t.integer('verified_traders').defaultTo(0);
    t.integer('verified_traders_delta').defaultTo(0);
    t.string('verified_traders_delta_label', 255);
    t.decimal('rewards_earned', 20, 8).defaultTo(0);
    t.decimal('rewards_earned_delta', 20, 8).defaultTo(0);
    t.string('rewards_earned_delta_label', 255);
    t.decimal('pending_payout', 20, 8).defaultTo(0);
    t.string('pending_payout_delta_label', 255);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('referral_tiers', (t) => {
    t.increments('id').primary();
    t.string('tier').notNullable();
    t.string('requirement_label', 255);
    t.string('reward_label', 255);
    t.integer('rank').defaultTo(0);
    t.boolean('active').defaultTo(true);
    t.timestamps(true, true);
    t.unique(['tier']);
  });

  await knex.schema.createTable('referral_referrals', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().references('users.id').onDelete('CASCADE');
    t.string('email', 255).notNullable();
    t.string('status', 32).notNullable().defaultTo('invited');
    t.datetime('joined_at');
    t.decimal('volume', 20, 8).defaultTo(0);
    t.decimal('reward_earned', 20, 8).defaultTo(0);
    t.timestamps(true, true);
    t.index(['user_id', 'status']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('referral_referrals');
  await knex.schema.dropTableIfExists('referral_tiers');
  await knex.schema.dropTableIfExists('referral_stats');
  await knex.schema.dropTableIfExists('referral_profiles');
}
