import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { db } from '../db.js';
import { cfg } from '../config.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import { buildOtpAuthUrl, generateBase32Secret, verifyTotp } from '../utils/totp.js';
import { up as ensureGoogleAuthenticatorMigration } from '../../db/migrations/046_user_google_authenticator.js';
import { audit } from './auditService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const KYC_STORAGE_DIR = path.resolve(APP_ROOT, 'storage', 'kyc');
const PROFILE_STORAGE_DIR = path.resolve(APP_ROOT, 'storage', 'profile');
const GENDERS = new Set(['male', 'female', 'other', 'prefer_not_to_say']);
let googleAuthenticatorSchemaReadyPromise = null;

async function ensureGoogleAuthenticatorSchema() {
  if (!googleAuthenticatorSchemaReadyPromise) {
    googleAuthenticatorSchemaReadyPromise = ensureGoogleAuthenticatorMigration(db).catch((error) => {
      googleAuthenticatorSchemaReadyPromise = null;
      throw error;
    });
  }
  await googleAuthenticatorSchemaReadyPromise;
}

function normalizeString(value, maxLength) {
  if (value === undefined) return undefined;
  const next = String(value || '').trim();
  if (!next) return null;
  return next.slice(0, maxLength);
}

function normalizeDate(value) {
  if (value === undefined) return undefined;
  if (!value) return null;
  const raw = String(value).trim();
  let date = null;

  const dayFirstMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dayFirstMatch) {
    const [, dayText, monthText, yearText] = dayFirstMatch;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const next = new Date(Date.UTC(year, month - 1, day));
    if (
      next.getUTCFullYear() === year &&
      next.getUTCMonth() === month - 1 &&
      next.getUTCDate() === day
    ) {
      date = next;
    }
  }

  if (!date) {
    const next = new Date(raw);
    if (!Number.isNaN(next.getTime())) {
      date = next;
    }
  }

  if (!date || Number.isNaN(date.getTime())) throw new Error('INVALID_DATE_OF_BIRTH');
  return date.toISOString().slice(0, 10);
}

function normalizeProfilePhoto(value) {
  if (value === undefined) return undefined;
  if (!value) return null;
  // If it's a string, assume it's a URL/path
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  // If it's a file object from multer
  if (value && typeof value === 'object' && value.buffer) {
    return value;
  }
  throw new Error('PROFILE_PHOTO_MUST_BE_IMAGE');
}

export function toAbsoluteProfilePhotoUrl(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  console.log('Converting profile photo path to absolute URL:', value, cfg.api?.baseUrl);
  const baseUrl = cfg.api?.baseUrl || 'http://localhost:4000';
  return `${baseUrl}${value.startsWith('/') ? value : `/${value}`}`;
}

async function saveProfilePhoto(userId, file) {
  if (!file || !file.buffer) return null;

  // Ensure storage directory exists
  await fs.mkdir(PROFILE_STORAGE_DIR, { recursive: true });

  // Generate unique filename
  const ext = path.extname(file.originalname) || '.jpg';
  const filename = `${userId}_${crypto.randomBytes(8).toString('hex')}${ext}`;
  const filepath = path.join(PROFILE_STORAGE_DIR, filename);

  // Write file
  await fs.writeFile(filepath, file.buffer);

  // Return relative path that can be served
  return `/api/storage/profile/${filename}`;
}

async function ensureUserProfile(userId) {
  const existing = await db('user_profiles').where({ user_id: userId }).first();
  if (existing) return existing;
  await db('user_profiles').insert({ user_id: userId });
  return db('user_profiles').where({ user_id: userId }).first();
}

// Cache for column existence checks (valid for the duration of the app)
const columnExistenceCache = {};

async function getExistingColumns(tableName) {
  if (columnExistenceCache[tableName]) {
    return columnExistenceCache[tableName];
  }
  
  const columns = [];
  try {
    // Get all columns from the table
    const result = await db.raw(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()`, [tableName]);
    if (result && result[0]) {
      columns.push(...result[0].map(row => row.COLUMN_NAME));
    }
  } catch (err) {
    console.error(`Failed to get columns for table ${tableName}:`, err.message);
  }
  
  columnExistenceCache[tableName] = columns;
  return columns;
}

async function filterUpdateFields(updates, tableName = 'user_profiles') {
  const existingColumns = await getExistingColumns(tableName);
  const filtered = {};
  
  for (const [key, value] of Object.entries(updates)) {
    if (existingColumns.includes(key)) {
      filtered[key] = value;
    }
  }
  
  return filtered;
}

function sanitizeProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    displayName: row.display_name || '',
    country: row.country || '',
    tier: row.tier || null,
    two_factor_enabled: row.two_factor_enabled === undefined || row.two_factor_enabled === null ? true : Boolean(row.two_factor_enabled),
    first_name: row.first_name || '',
    last_name: row.last_name || '',
    username: row.username || '',
    mobile_number: row.mobile_number || '',
    state: row.state || '',
    city: row.city || '',
    postal_code: row.postal_code || '',
    date_of_birth: row.date_of_birth || null,
    gender: row.gender || '',
    address_line_1: row.address_line_1 || '',
    address_line_2: row.address_line_2 || '',
    default_withdraw_wallet_address: row.default_withdraw_wallet_address || '',
    default_withdraw_wallet_network: row.default_withdraw_wallet_network || '',
    google_auth_enabled: Boolean(row.google_auth_secret) && (row.two_factor_enabled === undefined || row.two_factor_enabled === null ? true : Boolean(row.two_factor_enabled)),
    google_auth_configured: Boolean(row.google_auth_secret),
    profile_photo: toAbsoluteProfilePhotoUrl(row.profile_photo),
    lastLogin: row.last_login || null,
  };
}

export async function sessionSummary(userId) {
  const u = await db('users').where({ id: userId }).first();
  const p = await db('user_profiles').where({ user_id: userId }).first();
  return {
    id: u.id,
    email: u.email,
    kycVerified: !!u.kyc_verified,
    roles: (u.roles || 'user').split(','),
    profile: p,
  };
}

export async function getProfile(userId) {
  const profile = await ensureUserProfile(userId);
  return sanitizeProfile(profile);
}

export async function updateProfile(userId, patch, file) {
  await ensureUserProfile(userId);

  const next = {};

  if (patch.displayName !== undefined) next.display_name = normalizeString(patch.displayName, 120);
  if (patch.country !== undefined) next.country = normalizeString(patch.country, 120);
  if (patch.first_name !== undefined) next.first_name = normalizeString(patch.first_name, 120);
  if (patch.last_name !== undefined) next.last_name = normalizeString(patch.last_name, 120);
  if (patch.mobile_number !== undefined) next.mobile_number = normalizeString(patch.mobile_number, 40);
  if (patch.state !== undefined) next.state = normalizeString(patch.state, 120);
  if (patch.city !== undefined) next.city = normalizeString(patch.city, 120);
  if (patch.postal_code !== undefined) next.postal_code = normalizeString(patch.postal_code, 40);
  if (patch.date_of_birth !== undefined) next.date_of_birth = normalizeDate(patch.date_of_birth);
  if (patch.address_line_1 !== undefined) next.address_line_1 = normalizeString(patch.address_line_1, 255);
  if (patch.address_line_2 !== undefined) next.address_line_2 = normalizeString(patch.address_line_2, 255);
  if (patch.default_withdraw_wallet_address !== undefined) {
    next.default_withdraw_wallet_address = normalizeString(patch.default_withdraw_wallet_address, 255);
  }
  if (patch.default_withdraw_wallet_network !== undefined) {
    next.default_withdraw_wallet_network = normalizeString(patch.default_withdraw_wallet_network, 40);
  }
  if (file) {
    next.profile_photo = await saveProfilePhoto(userId, file);
  } else if (patch.profile_photo !== undefined) {
    if (patch.profile_photo && typeof patch.profile_photo === 'object') {
      // Support legacy callers that may still pass a file-shaped object.
      next.profile_photo = await saveProfilePhoto(userId, patch.profile_photo);
    } else {
      // It's a string (URL or null)
      next.profile_photo = normalizeProfilePhoto(patch.profile_photo);
    }
  }

  if (patch.gender !== undefined) {
    const gender = normalizeString(patch.gender, 40);
    if (gender && !GENDERS.has(gender)) throw new Error('INVALID_GENDER');
    next.gender = gender;
  }

  if (patch.two_factor_enabled !== undefined) {
    next.two_factor_enabled = Boolean(
      patch.two_factor_enabled === true ||
      patch.two_factor_enabled === 'true' ||
      patch.two_factor_enabled === 1 ||
      patch.two_factor_enabled === '1'
    );
  }

  if (patch.username !== undefined) {
    const username = normalizeString(patch.username, 120);
    if (username && !/^[a-zA-Z0-9._]+$/.test(username)) throw new Error('INVALID_USERNAME');
    if (username) {
      try {
        const existing = await db('user_profiles')
          .whereRaw('LOWER(username) = ?', [username.toLowerCase()])
          .whereNot({ user_id: userId })
          .first();
        if (existing) throw new Error('USERNAME_ALREADY_EXISTS');
      } catch (err) {
        // If it's a column not found error, just ignore it for now
        if (err.message && err.message.includes('Unknown column')) {
          // Column doesn't exist yet, skip the check
        } else {
          throw err;
        }
      }
    }
    next.username = username;
  }

  if (patch.personalInformation === true) {
    // Only validate if columns exist in the database
    const existingColumns = await getExistingColumns('user_profiles');
    
    if (existingColumns.includes('first_name') && !next.first_name) throw new Error('FIRST_NAME_REQUIRED');
    if (existingColumns.includes('last_name') && !next.last_name) throw new Error('LAST_NAME_REQUIRED');
    if (existingColumns.includes('username') && !next.username) throw new Error('USERNAME_REQUIRED');
    if (existingColumns.includes('mobile_number') && !next.mobile_number) throw new Error('MOBILE_NUMBER_REQUIRED');
    if (existingColumns.includes('country') && !next.country) throw new Error('COUNTRY_REQUIRED');
    if (next.mobile_number && !/^\+?[0-9()\-\s]{7,20}$/.test(next.mobile_number)) throw new Error('INVALID_MOBILE_NUMBER');
  }

  if (Object.keys(next).length > 0) {
    // Filter to only update columns that actually exist in the database
    const updateFields = await filterUpdateFields(next, 'user_profiles');
    if (Object.keys(updateFields).length > 0) {
      await db('user_profiles').where({ user_id: userId }).update(updateFields);
    }
  }
  return getProfile(userId);
}

export async function getUserContact(userId) {
  if (!userId) return null;
  const user = await db('users').where({ id: userId }).first();
  if (!user) return null;
  const profile = await db('user_profiles').where({ user_id: userId }).first();
  const name = profile?.display_name || user.email?.split('@')[0] || 'User';
  return { id: user.id, email: user.email, name };
}

export async function changePassword(userId, current, next) {
  const u = await db('users').where({ id: userId }).first();
  if (!u) throw new Error('USER_NOT_FOUND');
  if (!current || !String(current).trim()) throw new Error('CURRENT_PASSWORD_REQUIRED');
  if (!next || String(next).trim().length < 8) throw new Error('NEW_PASSWORD_TOO_SHORT');

  const isValid = await verifyPassword(String(current), u.password_hash);
  if (!isValid) throw new Error('CURRENT_PASSWORD_INCORRECT');

  const passwordHash = await hashPassword(String(next));
  const changedAt = new Date();
  await db('users').where({ id: userId }).update({ password_hash: passwordHash, updated_at: changedAt });
  await audit(userId, 'auth.password_changed', {
    status: 'success',
    loginMethod: 'password',
    hasPassword: true,
    passwordChangedAt: changedAt.toISOString(),
  });
  return true;
}

export async function beginGoogleAuthenticatorSetup(userId) {
  await ensureGoogleAuthenticatorSchema();
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new Error('USER_NOT_FOUND');

  await ensureUserProfile(userId);

  const issuer = 'Primerica Exchange';
  const secret = generateBase32Secret(32);
  const otpauthUrl = buildOtpAuthUrl({
    issuer,
    email: user.email,
    secret,
  });
  const qrCode = await QRCode.toDataURL(otpauthUrl, { margin: 1, scale: 6 });

  const updateFields = await filterUpdateFields(
    {
      google_auth_temp_secret: secret,
    },
    'user_profiles'
  );
  if (!('google_auth_temp_secret' in updateFields)) {
    throw new Error('GOOGLE_AUTH_SCHEMA_MISSING');
  }
  if (Object.keys(updateFields).length > 0) {
    await db('user_profiles').where({ user_id: userId }).update(updateFields);
  }

  return {
    secret,
    qrCode,
    otpauthUrl,
    issuer,
    accountLabel: user.email,
  };
}

export async function enableGoogleAuthenticator(userId, code) {
  await ensureGoogleAuthenticatorSchema();
  const profile = await ensureUserProfile(userId);
  const pendingSecret = profile?.google_auth_temp_secret;
  if (!pendingSecret) throw new Error('GOOGLE_AUTH_SETUP_REQUIRED');
  if (!verifyTotp(pendingSecret, code)) throw new Error('INVALID_AUTHENTICATOR_CODE');

  const updateFields = await filterUpdateFields(
    {
      google_auth_secret: pendingSecret,
      google_auth_temp_secret: null,
      two_factor_enabled: true,
    },
    'user_profiles'
  );
  if (Object.keys(updateFields).length > 0) {
    await db('user_profiles').where({ user_id: userId }).update(updateFields);
  }
  return getProfile(userId);
}

export async function disableGoogleAuthenticator(userId, code) {
  await ensureGoogleAuthenticatorSchema();
  const profile = await ensureUserProfile(userId);
  if (profile?.google_auth_secret && !verifyTotp(profile.google_auth_secret, code)) {
    throw new Error('INVALID_AUTHENTICATOR_CODE');
  }

  const updateFields = await filterUpdateFields(
    {
      google_auth_secret: null,
      google_auth_temp_secret: null,
      two_factor_enabled: false,
    },
    'user_profiles'
  );
  if (Object.keys(updateFields).length > 0) {
    await db('user_profiles').where({ user_id: userId }).update(updateFields);
  }
  return getProfile(userId);
}

export async function deleteAccount(userId) {
  if (!userId) throw new Error('USER_ID_REQUIRED');

  const contact = await getUserContact(userId);
  const user = await db('users').where({ id: userId }).first();
  if (!user) throw new Error('USER_NOT_FOUND');

  await db('users')
    .where({ id: userId })
    .update({
      status: 'deleted',
      updated_at: new Date(),
    });

  if (contact?.email) {
    const { sendAccountDeletedEmail } = await import('./mailService.js');
    try {
      await sendAccountDeletedEmail({ to: contact.email, name: contact.name });
    } catch (err) {
      console.error('[mail] account deleted email failed', err.message);
    }
  }
}
