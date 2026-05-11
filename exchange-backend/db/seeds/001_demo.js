

// db/seeds/001_demo.js
import bcryptjs from 'bcryptjs';

const bcrypt = bcryptjs;

export async function seed(knex){
  const tablesToClear = [
    'sip_orders',
    'sip_subscriptions',
    'sip_plans',
    'staking_positions',
    'staking_packages',
    'fiat_deposits',
    'user_wallets',
    'login_otps',
    'password_reset_otps',
    'futures_trades',
    'futures_positions',
    'entries',
    'journals',
    'accounts',
    'withdrawals',
    'deposits',
    'deposit_addresses',
    'kyc_documents',
    'kyc_activity',
    'dashboard_news',
    'dashboard_promotions',
    'dashboard_summary',
    'referral_referrals',
    'referral_stats',
    'referral_profiles',
    'referral_tiers',
    'exchange_connections',
    'p2p_order_messages',
    'p2p_orders',
    'p2p_listings',
    'futures_price_ticks',
    'futures_funding_rates',
    'signal_packages',
    'signal_package_settings',
    'deposit_scan_state',
    'signal_assets',
    'spot_trades',
    'spot_orders',
    'market_symbols',
    'wallet_transactions',
    'wallets',
    'refresh_tokens',
    'kyc_requests',
    'user_profiles',
    'users',
  ];

  for (const tableName of tablesToClear) {
    // Seeds should work against partially-migrated dev databases too.
    const exists = await knex.schema.hasTable(tableName);
    if (exists) {
      await knex(tableName).del();
    }
  }

  const pw = await bcrypt.hash('password123',10);
  const [adminId] = await knex('users').insert({ email:'admin@novax.io', password_hash:pw, roles:'admin,user', kyc_verified:1, kyc_level:1, country:'IN' });
  const [userId]  = await knex('users').insert({ email:'user@novax.io',  password_hash:pw, roles:'user', kyc_verified:1, kyc_level:1, country:'IN' });
  await knex('user_profiles').insert([
    { user_id: adminId, display_name:'Admin', country:'IN', tier:'pro' },
    { user_id: userId,  display_name:'DemoUser', country:'IN', tier:'basic' }
  ]);

  await knex('wallets').insert([
    { user_id: adminId, type:'spot', asset:'USDT', balance: 100000 },
    { user_id: adminId, type:'spot', asset:'BTC', balance: 10 },
    { user_id: userId,  type:'spot', asset:'USDT', balance: 5000 },
    { user_id: userId,  type:'spot', asset:'BTC', balance: 0.1 },
    { user_id: userId,  type:'futures', asset:'USDT', balance: 2000 },
    { user_id: userId,  type:'p2p_escrow', asset:'USDT', balance: 0 }
  ]);

  await knex('market_symbols').insert([
    { symbol:'BTCUSDT', base_asset:'BTC', quote_asset:'USDT', tick_size:0.1, lot_size:0.0001, contract_type:'perp', last_price:65000, is_enabled: true, min_leverage: 1, max_leverage: 50 },
    { symbol:'ETHUSDT', base_asset:'ETH', quote_asset:'USDT', tick_size:0.01, lot_size:0.001, contract_type:'perp', last_price:3200, is_enabled: true, min_leverage: 1, max_leverage: 50 },
    { symbol:'SOLUSDT', base_asset:'SOL', quote_asset:'USDT', tick_size:0.01, lot_size:0.01, contract_type:'perp', last_price:150, is_enabled: true, min_leverage: 1, max_leverage: 50 },
    { symbol:'BNBUSDT', base_asset:'BNB', quote_asset:'USDT', tick_size:0.01, lot_size:0.01, contract_type:'perp', last_price:600, is_enabled: true, min_leverage: 1, max_leverage: 50 },
    { symbol:'XRPUSDT', base_asset:'XRP', quote_asset:'USDT', tick_size:0.0001, lot_size:1, contract_type:'spot', last_price:0.6, is_enabled: true, min_leverage: 1, max_leverage: 1 },
    { symbol:'DOGEUSDT', base_asset:'DOGE', quote_asset:'USDT', tick_size:0.0001, lot_size:1, contract_type:'spot', last_price:0.2, is_enabled: true, min_leverage: 1, max_leverage: 1 },
    { symbol:'TRXUSDT', base_asset:'TRX', quote_asset:'USDT', tick_size:0.0001, lot_size:1, contract_type:'spot', last_price:0.12, is_enabled: true, min_leverage: 1, max_leverage: 1 },
    { symbol:'ADAUSDT', base_asset:'ADA', quote_asset:'USDT', tick_size:0.0001, lot_size:0.1, contract_type:'spot', last_price:0.5, is_enabled: true, min_leverage: 1, max_leverage: 1 }
  ]);

  await knex('referral_tiers').insert([
    { tier: 'Silver', requirement_label: '$5k volume', reward_label: '5% lifetime rebate', rank: 1, active: true },
    { tier: 'Gold', requirement_label: '$50k volume', reward_label: '10% rebate + $100 bonus', rank: 2, active: true },
    { tier: 'Platinum', requirement_label: '$250k volume', reward_label: '15% rebate + $600 bonus', rank: 3, active: true }
  ]);

  const promoUpdatedAt = new Date(Date.now() - 1000 * 60 * 60 * 24);
  await knex('referral_profiles').insert([
    {
      user_id: userId,
      code: 'NOVAX-WELCOME-92FH',
      message: 'Join NovaX via my invite...',
      url: 'https://novax.exchange/invite/NOVAX-WELCOME-92FH',
      promo_active: true,
      promo_updated_at: promoUpdatedAt,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      user_id: adminId,
      code: 'NOVAX-ADMIN-1',
      message: 'Trade smarter with NovaX Pro.',
      url: 'https://novax.exchange/invite/NOVAX-ADMIN-1',
      promo_active: false,
      promo_updated_at: promoUpdatedAt,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  await knex('referral_stats').insert([
    {
      user_id: userId,
      total_invites: 148,
      total_invites_delta: 12,
      total_invites_delta_label: '+12 this week',
      verified_traders: 86,
      verified_traders_delta: 7,
      verified_traders_delta_label: '+7 this week',
      rewards_earned: 2430,
      rewards_earned_delta: 180,
      rewards_earned_delta_label: '+$180',
      pending_payout: 320,
      pending_payout_delta_label: 'Scheduled Friday',
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      user_id: adminId,
      total_invites: 42,
      total_invites_delta: 3,
      total_invites_delta_label: '+3 this week',
      verified_traders: 21,
      verified_traders_delta: 2,
      verified_traders_delta_label: '+2 this week',
      rewards_earned: 1120,
      rewards_earned_delta: 75,
      rewards_earned_delta_label: '+$75',
      pending_payout: 95,
      pending_payout_delta_label: 'Processing',
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  await knex('referral_referrals').insert([
    {
      user_id: userId,
      email: 'alexa.trade@clients.io',
      status: 'rewarded',
      joined_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
      volume: 128400,
      reward_earned: 640,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      user_id: userId,
      email: 'mike.scalp@alpha.io',
      status: 'verified',
      joined_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
      volume: 42800,
      reward_earned: 210,
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      user_id: userId,
      email: 'sara.quant@edge.io',
      status: 'pending',
      joined_at: null,
      volume: 0,
      reward_earned: 0,
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  const submissionId = 'seed-kyc-submission-1';
  await knex('kyc_requests').insert({
    user_id: userId,
    status: 'approved',
    documents: JSON.stringify([{ type: 'passport', filename: 'passport_demo.pdf' }]),
    reviewer_id: adminId,
    reviewed_at: new Date(),
    submission_id: submissionId,
    resubmission_required: false,
    notes: 'Seed approval',
    created_at: new Date(),
    updated_at: new Date()
  });

  await knex('kyc_documents').insert({
    submission_id: submissionId,
    user_id: userId,
    document_type: 'passport',
    original_filename: 'passport_demo.pdf',
    stored_filename: 'seed/passport_demo.pdf',
    mime_type: 'application/pdf',
    size: 102400,
    status: 'APPROVED',
    created_at: new Date(),
    updated_at: new Date()
  });

  await knex('kyc_activity').insert([
    { user_id: userId, event: 'ACCOUNT_CREATED', message: 'User account created', created_at: new Date(Date.now() - 1000*60*60*24*5) },
    { user_id: userId, event: 'DOCUMENT_SUBMITTED', message: 'Submitted passport for verification', metadata: JSON.stringify({ submissionId }), created_at: new Date(Date.now() - 1000*60*60*24*2) },
    { user_id: userId, event: 'DOCUMENT_REVIEWED', message: 'Passport approved by compliance', metadata: JSON.stringify({ submissionId }), created_at: new Date(Date.now() - 1000*60*60*12) }
  ]);

  const now = new Date();
  for (let i=0;i<50;i++){
    await knex('futures_price_ticks').insert({ symbol:'BTCUSDT', price: 64000 + i*5, timestamp: new Date(now - (50-i)*60000) });
  }
  await knex('futures_funding_rates').insert({ symbol:'BTCUSDT', rate: 0.0001, timestamp: new Date() });

  await knex('dashboard_summary').insert([
    { user_id: adminId, balance_usdt: 100000, pnl_24h: 2500, exposure: 60000, created_at: new Date(), updated_at: new Date() },
    { user_id: userId, balance_usdt: 5000, pnl_24h: 120, exposure: 1500, created_at: new Date(), updated_at: new Date() }
  ]);

  await knex('dashboard_promotions').insert([
    {
      placement: 'dashboard',
      title: 'Unlock Pro Trading Tools',
      subtitle: 'Upgrade to Pro tier and access advanced order types & analytics.',
      cta_label: 'Upgrade Now',
      cta_url: '/settings/subscriptions',
      accent_start: '#1a237e',
      accent_end: '#0d47a1',
      published_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      placement: 'dashboard',
      title: 'Earn Yield on Idle USDT',
      subtitle: 'Stake stablecoins with flexible redemption and daily rewards.',
      cta_label: 'Start Staking',
      cta_url: '/earn/usdt',
      accent_start: '#00695c',
      accent_end: '#26a69a',
      published_at: new Date(),
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  await knex('dashboard_news').insert([
    {
      headline: 'Bitcoin steadies as markets digest latest CPI print',
      summary: 'BTC held above key support after US inflation data signalled cooling price pressures.',
      source: 'NovaX Research Desk',
      tag: 'Markets',
      url: 'https://research.novax.io/bitcoin-cpi',
      published_at: new Date(Date.now() - 1000*60*30),
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      headline: 'Ethereum developers schedule Dencun upgrade on testnets',
      summary: 'Core contributors confirmed a phased rollout starting with Goerli ahead of mainnet activation.',
      source: 'ChainWire',
      tag: 'Technology',
      url: 'https://research.novax.io/eth-dencun',
      published_at: new Date(Date.now() - 1000*60*90),
      created_at: new Date(),
      updated_at: new Date()
    },
    {
      headline: 'Asia-Pacific regulators publish joint crypto compliance guidance',
      summary: 'Regulators emphasised customer protection, stablecoin oversight, and robust AML controls.',
      source: 'Global Finance Watch',
      tag: 'Regulation',
      url: 'https://research.novax.io/apac-compliance',
      published_at: new Date(Date.now() - 1000*60*180),
      created_at: new Date(),
      updated_at: new Date()
    }
  ]);

  await knex('p2p_listings').insert([
    { type:'SELL', asset:'USDT', fiat_currency:'INR', price: 92.5, min_amount:1000, max_amount:50000, payment_methods: JSON.stringify(['UPI','IMPS']), trader_id: adminId, status:'ACTIVE' },
    { type:'BUY',  asset:'USDT', fiat_currency:'INR', price: 91.9, min_amount:1000, max_amount:30000, payment_methods: JSON.stringify(['UPI']), trader_id: adminId, status:'ACTIVE' }
  ]);
}
