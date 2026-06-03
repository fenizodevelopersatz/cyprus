export async function up(knex) {
  const usdcSolana = await knex('signal_assets')
    .where({ asset: 'USDC', network: 'SOLANA' })
    .first();
  const usdtSolana = await knex('signal_assets')
    .where({ asset: 'USDT', network: 'SOLANA' })
    .first();

  if (usdcSolana && usdtSolana) {
    await knex('signal_assets').where({ id: usdtSolana.id }).delete();
    return;
  }

  if (usdtSolana && !usdcSolana) {
    await knex('signal_assets')
      .where({ id: usdtSolana.id })
      .update({
        asset: 'USDC',
        display_name: 'USDC Solana',
        updated_at: new Date(),
      });
  }
}

export async function down(knex) {
  const usdtSolana = await knex('signal_assets')
    .where({ asset: 'USDT', network: 'SOLANA' })
    .first();

  if (usdtSolana) return;

  const usdcSolana = await knex('signal_assets')
    .where({ asset: 'USDC', network: 'SOLANA' })
    .first();

  if (usdcSolana) {
    await knex('signal_assets')
      .where({ id: usdcSolana.id })
      .update({
        asset: 'USDT',
        display_name: 'USDT Solana',
        updated_at: new Date(),
      });
  }
}
