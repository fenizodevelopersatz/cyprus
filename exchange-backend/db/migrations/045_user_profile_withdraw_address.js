export async function up(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  const hasDefaultWithdrawWalletAddress = await knex.schema.hasColumn('user_profiles', 'default_withdraw_wallet_address');
  const hasDefaultWithdrawWalletNetwork = await knex.schema.hasColumn('user_profiles', 'default_withdraw_wallet_network');

  if (!hasDefaultWithdrawWalletAddress || !hasDefaultWithdrawWalletNetwork) {
    await knex.schema.alterTable('user_profiles', (table) => {
      if (!hasDefaultWithdrawWalletAddress) {
        table.string('default_withdraw_wallet_address', 255).nullable();
      }
      if (!hasDefaultWithdrawWalletNetwork) {
        table.string('default_withdraw_wallet_network', 40).nullable();
      }
    });
  }
}

export async function down(knex) {
  const hasTable = await knex.schema.hasTable('user_profiles');
  if (!hasTable) return;

  const hasDefaultWithdrawWalletAddress = await knex.schema.hasColumn('user_profiles', 'default_withdraw_wallet_address');
  const hasDefaultWithdrawWalletNetwork = await knex.schema.hasColumn('user_profiles', 'default_withdraw_wallet_network');

  if (hasDefaultWithdrawWalletAddress || hasDefaultWithdrawWalletNetwork) {
    await knex.schema.alterTable('user_profiles', (table) => {
      if (hasDefaultWithdrawWalletAddress) {
        table.dropColumn('default_withdraw_wallet_address');
      }
      if (hasDefaultWithdrawWalletNetwork) {
        table.dropColumn('default_withdraw_wallet_network');
      }
    });
  }
}
