export async function up(knex) {
  const drops = [
    ['min_deposit', (table) => table.dropColumn('min_deposit')],
    ['min_withdraw', (table) => table.dropColumn('min_withdraw')],
    ['withdraw_fee_type', (table) => table.dropColumn('withdraw_fee_type')],
    ['withdraw_fee', (table) => table.dropColumn('withdraw_fee')],
  ];

  for (const [column, dropColumn] of drops) {
    const exists = await knex.schema.hasColumn('signal_assets', column);
    if (exists) {
      await knex.schema.alterTable('signal_assets', dropColumn);
    }
  }
}

export async function down(knex) {
  const hasMinDeposit = await knex.schema.hasColumn('signal_assets', 'min_deposit');
  const hasMinWithdraw = await knex.schema.hasColumn('signal_assets', 'min_withdraw');
  const hasWithdrawFeeType = await knex.schema.hasColumn('signal_assets', 'withdraw_fee_type');
  const hasWithdrawFee = await knex.schema.hasColumn('signal_assets', 'withdraw_fee');

  await knex.schema.alterTable('signal_assets', (table) => {
    if (!hasMinDeposit) table.decimal('min_deposit', 36, 18).notNullable().defaultTo(0);
    if (!hasMinWithdraw) table.decimal('min_withdraw', 36, 18).notNullable().defaultTo(0);
    if (!hasWithdrawFeeType) table.string('withdraw_fee_type', 16).notNullable().defaultTo('FIXED');
    if (!hasWithdrawFee) table.decimal('withdraw_fee', 36, 18).notNullable().defaultTo(0);
  });
}
