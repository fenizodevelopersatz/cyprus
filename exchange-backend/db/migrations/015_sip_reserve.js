export async function up(knex) {
  await knex.schema.alterTable('sip_subscriptions', (t) => {
    t.string('reserve_asset', 32).nullable();
    t.decimal('reserve_amount', 36, 18).nullable();
    t.decimal('reserve_balance', 36, 18).nullable();
    t.string('reserve_status', 24).notNullable().defaultTo('PENDING');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('sip_subscriptions', (t) => {
    t.dropColumn('reserve_asset');
    t.dropColumn('reserve_amount');
    t.dropColumn('reserve_balance');
    t.dropColumn('reserve_status');
  });
}
