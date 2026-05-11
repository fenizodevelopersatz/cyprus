const now = () => new Date();

const DEFAULT_PACKAGES = [
  {
    name: 'Package 1',
    min_amount: 100,
    max_amount: 299,
    unlimited_max: false,
    per_trade_commission_pct: 0.65,
    signals_per_day: 1,
    required_level: 0,
    status: 'ACTIVE',
    description: '0.65% commission for deposits from $100 to $299 with 1 signal per day.',
    sort_order: 10,
  },
  {
    name: 'Package 2',
    min_amount: 300,
    max_amount: 4999,
    unlimited_max: false,
    per_trade_commission_pct: 1.3,
    signals_per_day: 2,
    required_level: 0,
    status: 'ACTIVE',
    description: '1.3% commission for deposits from $300 to $4,999 with 2 signals per day.',
    sort_order: 20,
  },
  {
    name: 'Package 3',
    min_amount: 5000,
    max_amount: 24999,
    unlimited_max: false,
    per_trade_commission_pct: 1.95,
    signals_per_day: 3,
    required_level: 1,
    status: 'ACTIVE',
    description: '1.95% commission for deposits from $5,000 to $24,999 with 3 signals per day.',
    sort_order: 30,
  },
  {
    name: 'Package 4',
    min_amount: 25000,
    max_amount: null,
    unlimited_max: true,
    per_trade_commission_pct: 2.6,
    signals_per_day: 4,
    required_level: 2,
    status: 'ACTIVE',
    description: '2.6% commission for deposits at $25,000 and above with 4 signals per day.',
    sort_order: 40,
  },
];

export async function seed(knex) {
  const existingSettings = await knex('signal_package_settings').first();
  if (!existingSettings) {
    await knex('signal_package_settings').insert({
      min_deposit: 100,
      max_deposit: 25000,
      investment_per_trade_pct: 0,
      per_trade_profit_pct: 0,
      daily_roi_pct: 0,
      unlimited_last_package: true,
      auto_package_assignment: true,
      package_upgrade_allowed: true,
      created_at: now(),
      updated_at: now(),
    });
  }

  for (const pkg of DEFAULT_PACKAGES) {
    const existing = await knex('signal_packages').where({ sort_order: pkg.sort_order }).first();
    if (existing) {
      await knex('signal_packages')
        .where({ id: existing.id })
        .update({
          ...pkg,
          updated_at: now(),
        });
      continue;
    }

    await knex('signal_packages').insert({
      ...pkg,
      created_at: now(),
      updated_at: now(),
    });
  }
}
