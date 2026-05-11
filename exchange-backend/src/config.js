import 'dotenv/config';

const DEFAULT_SPOT_SYMBOLS =
  'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,TRXUSDT,ADAUSDT';
const DEFAULT_FUTURES_SYMBOLS = 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT';
const REFERRAL_BASE_URL =
  process.env.REFERRAL_BASE_URL || 'http://localhost:5173/invite';
const REFERRAL_DEFAULT_MESSAGE =
  process.env.REFERRAL_DEFAULT_MESSAGE || 'Join NovaX via my invite...';
const MASTER_BASE_PATH = process.env.MASTER_BASE_PATH || 'm';
const CUSTODIAL_BASE_PATH = process.env.CUSTODIAL_BASE_PATH || "m/44'/60'/0'/0";
const SIGNUP_BONUS_USDT = Number(process.env.SIGNUP_BONUS_USDT || 0);
const ASSET_ICON_BASE =
  process.env.ASSET_ICON_BASE_URL || process.env.ASSET_ICON_BASE || null;
const API_BASE_URL = process.env.API_BASE_URL || process.env.API_URL || `http://localhost:${Number(process.env.PORT || 4000)}`;
const APP_BASE_URL = process.env.APP_BASE_URL || process.env.APP_URL || 'http://localhost:5173/app';
const EXCHANGE_MIN_NOTIONAL = Number(process.env.EXCHANGE_MIN_NOTIONAL_USDT || 0);
const EXCHANGE_ENFORCE_MIN_NOTIONAL =
  String(process.env.EXCHANGE_ENFORCE_MIN_NOTIONAL || '').toLowerCase() === 'true';

function parseSymbolList(input, fallback = '') {
  const raw = String(input ?? fallback)
    .split(',')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(raw));
}

const allowedSpotSymbols = parseSymbolList(
  process.env.BINANCE_SPOT_SYMBOLS,
  DEFAULT_SPOT_SYMBOLS
);

const allowedFuturesSymbols = parseSymbolList(
  process.env.BINANCE_FUT_SYMBOLS,
  DEFAULT_FUTURES_SYMBOLS
);

export const cfg = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  wsPort: Number(process.env.WS_PORT || process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET,
  jwtExpires: process.env.JWT_EXPIRES || '15m',
  refreshExpires: process.env.REFRESH_EXPIRES || '30d',
  binanceKey: process.env.BINANCE_KEY,
  binanceSecret: process.env.BINANCE_SECRET,
  binance: {
    apiKey: process.env.BINANCE_KEY,
    apiSecret: process.env.BINANCE_SECRET,
    spotTestnet: String(process.env.SPOT_TESTNET || '').toLowerCase() === 'true',
    spotBaseRest: process.env.SPOT_BASE_REST,
    spotBaseWs: process.env.SPOT_BASE_WS,
    futuresTestnet: String(process.env.FUT_TESTNET || '').toLowerCase() === 'true',
    futuresBaseRest: process.env.FUT_BASE_REST,
    allowedSpotSymbols,
    allowedFuturesSymbols,
  },
  referrals: {
    baseUrl: REFERRAL_BASE_URL,
    defaultMessage: REFERRAL_DEFAULT_MESSAGE,
  },
  custodial: {
    masterXprv: process.env.MASTER_XPRV,
    masterBasePath: MASTER_BASE_PATH,
    baseDerivationPath: CUSTODIAL_BASE_PATH,
    rpcUrls: {
      ETH: process.env.ETH_RPC_URL,
      BSC: process.env.BSC_RPC_URL,
    },
  },
  wallet: {
    signupBonusUsdt: SIGNUP_BONUS_USDT,
    encryptionSecret: process.env.WALLET_ENCRYPTION_SECRET || process.env.WALLET_SECRET,
  },
  depositMonitor: {
    enabled: String(process.env.DEPOSIT_MONITOR_ENABLED || '').toLowerCase() === 'true',
  },
  mlm: {
    backupCronEnabled: String(process.env.MLM_BACKUP_CRON_ENABLED ?? 'true').toLowerCase() !== 'false',
    backupCronTimes: String(process.env.MLM_BACKUP_CRON_TIMES || '00:00,06:00,12:00,18:00')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    bonusPayoutCronEnabled: String(process.env.MLM_BONUS_PAYOUT_CRON_ENABLED ?? 'true').toLowerCase() !== 'false',
    bonusPayoutIntervalMinutes: Number(process.env.MLM_BONUS_PAYOUT_INTERVAL_MINUTES || 30),
  },
  exchange: {
    minNotionalOverride: Number.isFinite(EXCHANGE_MIN_NOTIONAL) ? EXCHANGE_MIN_NOTIONAL : 0,
    enforceMinNotional: EXCHANGE_ENFORCE_MIN_NOTIONAL,
  },
  ui: {
    assetIconBase: ASSET_ICON_BASE,
    appBaseUrl: APP_BASE_URL,
  },
  api: {
    baseUrl: String(API_BASE_URL).replace(/\/+$/, ''),
  },
};
