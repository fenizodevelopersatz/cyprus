import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { cfg } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const STORAGE_DIR = path.resolve(APP_ROOT, 'storage');
const SETTINGS_FILE = path.resolve(STORAGE_DIR, 'admin-settings.json');
const SETTINGS_ASSET_DIR = path.resolve(STORAGE_DIR, 'site');

const DEFAULT_SETTINGS = {
  siteName: 'CryptoSignal Exchange',
  siteLogoUrl: '/icons/logo-white.webp',
  siteFaviconUrl: '/favicon.ico',
  maintenanceMode: false,
  enableKyc: true,
  enableLanguageSwitcher: false,
  enableDarkMode: true,
  darkModeDefault: true,
  requireReferralCode: false,
  withdrawalLimitKyc: 0,
  withdrawalLimitNonKyc: 0,
  withdrawalAdminFeePercent: 0,
  withdrawalLockPeriodDays: 0,
  earlyWithdrawalPenaltyPercent: 0,
  rewardReductionEnabled: false,
  rewardReductionType: '',
  minimumWithdrawalAmount: 0,
  maximumWithdrawalAmount: 0,
  withdrawalNote: '',
  isWithdrawalEnabled: true,
  defaultSwapMarket: 'BTCUSDT',
  tradeMakerFee: 0.1,
  tradeTakerFee: 0.2,
  referralFee: 0,
  transferCommission: 0,
  disableTrades: false,
  mailType: 'smtp',
  mailHost: 'smtp.hostinger.com',
  mailPort: 465,
  mailUsername: 'exchange@fenizomlmsoft.com',
  mailPassword: '>N7Uk7|Cc5Sz',
  mailSenderName: 'exchange@fenizomlmsoft.com',
  mailSenderEmail: 'exchange@fenizomlmsoft.com',
  mailEncryption: 'ssl',
  notificationAdminEmail: '',
  notifyCryptoDeposits: false,
  notifyCryptoWithdrawals: false,
  notifyFiatDeposits: false,
  notifyFiatWithdrawals: false,
  notifyKyc: false,
  notifyNewUser: false,
  stripePublicKey: '',
  stripeSecretKey: '',
  stripeBaseCurrency: 'usd',
  recaptchaEnabled: false,
  recaptchaSiteKey: '',
  recaptchaSecretKey: '',
  socialYoutube: '',
  socialFacebook: '',
  socialTelegram: '',
  socialTwitter: '',
  socialInstagram: '',
  socialLinkedin: '',
  sipEnabled: true,
  sipSupportedFiats: ['USD'],
  sipDefaultFrequency: 'DAILY',
  sipAllowedFrequencies: ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'],
  sipDefaultWalletSource: 'spot:available',
  sipDefaultStartBufferMinutes: 10,
  sipGraceMinutes: 15,
  sipMinFiatAmount: 10,
  sipMaxFiatAmount: 100000,
  sipMinAssetQuantity: '0.00001000',
  sipMaxAssetQuantity: null,
  sipMaxFailedExecutions: 3,
  sipFiatExchangeRates: {
    USD: 1,
  },
  sipHero: {
    title: 'SIP for Cryptos',
    subtitle:
      'Automate USD contributions into your favourite coins and smoothen volatility with disciplined investing.',
    sections: [
      {
        title: 'Steer Through the Volatility',
        body:
          'Invest a fixed INR or USD amount on a recurring schedule to accumulate coins at the best blended cost.',
      },
      {
        title: 'Gradually Build Wealth',
        body:
          'Remove emotions from trading. SIP executes on a fixed cadence so you keep stacking through all market cycles.',
      },
    ],
    cta: {
      label: 'Start a SIP',
      helper: 'Choose a coin, enter INR/USD amount or quantity, schedule and confirm.',
    },
  },
};

async function ensureFileExists() {
  try {
    await fs.access(SETTINGS_FILE);
  } catch {
    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    await fs.writeFile(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
}

function sanitizeField(field) {
  if (field === 'siteLogoUrl' || field === 'siteFaviconUrl') return field;
  throw new Error('INVALID_SETTINGS_ASSET_FIELD');
}

function inferExtension(file) {
  const rawExt = path.extname(file?.originalname || '').toLowerCase();
  if (rawExt) return rawExt;

  const mime = String(file?.mimetype || '').toLowerCase();
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/svg+xml') return '.svg';
  if (mime === 'image/x-icon' || mime === 'image/vnd.microsoft.icon') return '.ico';
  return '.bin';
}

function validateImageFile(file, field) {
  if (!file?.buffer) throw new Error('SETTINGS_ASSET_FILE_REQUIRED');
  const mime = String(file.mimetype || '').toLowerCase();
  const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']);
  if (!allowed.has(mime)) throw new Error('SETTINGS_ASSET_MUST_BE_IMAGE');

  const ext = inferExtension(file);
  if (field === 'siteFaviconUrl') {
    const faviconExts = new Set(['.png', '.ico', '.svg', '.webp']);
    if (!faviconExts.has(ext)) throw new Error('FAVICON_FORMAT_NOT_SUPPORTED');
  }
}

function toAbsoluteSettingsAssetUrl(value) {
  if (!value) return value;
  if (/^https?:\/\//i.test(value)) return value;
  const baseUrl = cfg.api?.baseUrl || 'http://localhost:4000';
  return `${baseUrl}${String(value).startsWith('/') ? value : `/${value}`}`;
}

export async function getSettings() {
  await ensureFileExists();
  const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    const next = { ...DEFAULT_SETTINGS, ...parsed };
    next.siteLogoUrl = toAbsoluteSettingsAssetUrl(next.siteLogoUrl);
    next.siteFaviconUrl = toAbsoluteSettingsAssetUrl(next.siteFaviconUrl);
    return next;
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      siteLogoUrl: toAbsoluteSettingsAssetUrl(DEFAULT_SETTINGS.siteLogoUrl),
      siteFaviconUrl: toAbsoluteSettingsAssetUrl(DEFAULT_SETTINGS.siteFaviconUrl),
    };
  }
}

export async function updateSettings(patch = {}) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

export async function saveSettingsAsset(field, file) {
  const safeField = sanitizeField(field);
  validateImageFile(file, safeField);

  await fs.mkdir(SETTINGS_ASSET_DIR, { recursive: true });

  const ext = inferExtension(file);
  const filename = `${safeField}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const filepath = path.join(SETTINGS_ASSET_DIR, filename);

  await fs.writeFile(filepath, file.buffer);

  const relativeUrl = `/api/storage/site/${filename}`;

  return {
    field: safeField,
    url: toAbsoluteSettingsAssetUrl(relativeUrl),
    filename,
    mimeType: file.mimetype,
    size: file.size,
  };
}
