import { db, withTx } from '../db.js';
import { cfg } from '../config.js';
import { hashPassword, verifyPassword, signJwt, signRefresh, verifyJwt } from '../utils/crypto.js';
import { uid } from '../utils/id.js';
import { syncUserSnapshot } from './binanceSync.js';
import {
  ensureReferralProfile,
  ensureReferralStats,
  findReferralProfileByCode,
  recordReferralSignup,
} from './referralService.js';
import { creditUserBonus } from './walletService.js';
import { creditFuturesAvailable } from './ledgerService.js';
import {
  sendRegistrationEmail,
  sendLoginOtpEmail,
  sendPasswordResetOtpEmail,
  sendPasswordResetSuccessEmail,
  isProviderRateLimitError,
} from './mailService.js';
import { getSettings } from './settingsService.js';
import { provisionUserWallets } from './userWalletService.js';
import { ensureMlmLevelSchema, recalculateMlmForUser } from './mlmLevelService.js';
import { audit } from './auditService.js';
import { up as ensureGoogleOauthMigration } from '../../db/migrations/042_google_oauth.js';
import { up as ensureUserTwoFactorEnabledMigration } from '../../db/migrations/043_user_two_factor_enabled.js';
import { up as ensureGoogleAuthenticatorMigration } from '../../db/migrations/046_user_google_authenticator.js';
import { up as ensureLoginOtpEmailVerifiedMigration } from '../../db/migrations/047_login_otp_email_verified.js';
import { verifyTotp } from '../utils/totp.js';
import crypto from 'crypto';

const OTP_EXPIRY_MINUTES = 10;
const OTP_ATTEMPT_LIMIT = 5;
const PASSWORD_RESET_MAX_SENDS_PER_HOUR = 3;
const PASSWORD_RESET_WINDOW_MS = 60 * 60 * 1000;

let googleAuthSchemaReadyPromise = null;
let loginOtpEmailVerifiedColumnPromise = null;
let twoFactorSchemaReadyPromise = null;

async function ensureTwoFactorSchema() {
  if (!twoFactorSchemaReadyPromise) {
    twoFactorSchemaReadyPromise = ensureUserTwoFactorEnabledMigration(db).catch((error) => {
      twoFactorSchemaReadyPromise = null;
      throw error;
    });
  }
  await twoFactorSchemaReadyPromise;
}

async function ensureGoogleAuthSchema() {
  if (!googleAuthSchemaReadyPromise) {
    googleAuthSchemaReadyPromise = Promise.all([
      ensureTwoFactorSchema(),
      ensureGoogleOauthMigration(db),
      ensureGoogleAuthenticatorMigration(db),
    ]).catch((error) => {
      googleAuthSchemaReadyPromise = null;
      throw error;
    });
  }
  await googleAuthSchemaReadyPromise;
}

async function hasLoginOtpEmailVerifiedColumn() {
  if (!loginOtpEmailVerifiedColumnPromise) {
    loginOtpEmailVerifiedColumnPromise = (async () => {
      await ensureLoginOtpEmailVerifiedMigration(db);
      return db.schema.hasColumn('login_otps', 'email_verified_at');
    })().catch((error) => {
      loginOtpEmailVerifiedColumnPromise = null;
      throw error;
    });
  }
  return loginOtpEmailVerifiedColumnPromise;
}

export async function register({ name, email, password, country, referralCode }) {
  await ensureMlmLevelSchema();
  await ensureTwoFactorSchema();
  const settings = await getSettings();
  if (settings?.maintenanceMode) {
    const err = new Error('Registrations are temporarily disabled for maintenance');
    err.status = 503;
    throw err;
  }
  const passwordHash = await hashPassword(password);
  const result = await withTx(async (trx) => {
    const exists = await trx('users').where({ email }).first();
    if (exists) throw new Error('Email already registered');

    let sponsorId = null;
    if (referralCode) {
      const normalized = String(referralCode).trim().toUpperCase();
      if (!normalized) {
        throw new Error('Invalid referral code');
      }
      const inviterProfile = await findReferralProfileByCode(normalized, { trx });
      if (!inviterProfile) {
        throw new Error('Invalid referral code');
      }
      sponsorId = inviterProfile.user_id;
    }

    const [id] = await trx('users').insert({
      email,
      password_hash: passwordHash,
      country,
      kyc_level: 0,
      kyc_verified: 0,
      sponsor_id: sponsorId,
      status: 'active',
      current_level_rank: 0,
    });

    const displayName = (name && name.trim()) || email.split('@')[0];
    await trx('user_profiles').insert({ user_id: id, display_name: displayName, country, tier: 'basic', two_factor_enabled: true });

    const walletTypes = ['spot', 'margin', 'futures', 'p2p_escrow'];
    for (const type of walletTypes) {
      await trx('wallets').insert({ user_id: id, type, asset: 'USDT', balance: 0 });
    }

    const profile = await ensureReferralProfile(id, { trx });
    await ensureReferralStats(id, { trx });
    const walletProvision = await provisionUserWallets(id, { trx });

    const signupBonus = Number(cfg.wallet?.signupBonusUsdt || 0);
    if (signupBonus > 0) {
      await creditUserBonus({ userId: id, asset: 'USDT', amount: signupBonus, reason: 'signup_bonus', trx });
      await creditFuturesAvailable(id, 'USDT', signupBonus, { reason: 'signup_bonus' }, trx);
    }

    if (referralCode) {
      const inviterProfile = await trx('referral_profiles').where({ user_id: sponsorId }).first();
      if (!inviterProfile) {
        throw new Error('Invalid referral code');
      }
      if (inviterProfile.user_id === id) {
        throw new Error('Cannot use own referral code');
      }
      await ensureReferralStats(inviterProfile.user_id, { trx });
      await recordReferralSignup({
        inviterUserId: inviterProfile.user_id,
        email,
        status: 'joined',
        joinedAt: new Date(),
        trx,
      });
    }

    return {
      id,
      referral: { code: profile.code, url: profile.url },
      wallets: walletProvision.wallets,
      depositAddress: walletProvision.wallets.BEP20 || walletProvision.wallets.ERC20 || null,
    };
  });

  const displayName = (name && name.trim()) || email.split('@')[0];
  try {
    await sendRegistrationEmail({ to: email, name: displayName });
  } catch (err) {
    console.error('[mail] registration email failed', err.message);
  }

  await audit(result.id, 'auth.register', {
    status: 'success',
    loginMethod: 'password',
    hasPassword: true,
    country: country || null,
    referralCodeUsed: referralCode ? String(referralCode).trim().toUpperCase() : null,
  });

  try {
    await recalculateMlmForUser(result.id);
  } catch (err) {
    console.error('[mlm] registration refresh failed', err?.message || err);
  }

  return result;
}

function generateOtpCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function issueOtpForTable(tableName, userId) {
  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  const existing = await db(tableName).where({ user_id: userId }).first();
  const resettableFields = tableName === 'login_otps' && await hasLoginOtpEmailVerifiedColumn()
    ? { email_verified_at: null }
    : {};
  if (existing) {
    await db(tableName)
      .where({ user_id: userId })
      .update({
        code,
        expires_at: expiresAt,
        attempts: 0,
        updated_at: new Date(),
        ...resettableFields,
      });
  } else {
    await db(tableName).insert({
      user_id: userId,
      code,
      expires_at: expiresAt,
      attempts: 0,
      created_at: new Date(),
      updated_at: new Date(),
      ...resettableFields,
    });
  }
  return { code, expiresAt };
}

async function verifyOtpForTable(tableName, userId, submittedCode, options = {}) {
  const { preserveOnSuccess = false } = options;
  const row = await db(tableName).where({ user_id: userId }).first();
  if (!row) {
    return { valid: false, reason: 'OTP_REQUIRED' };
  }
  const now = new Date();
  if (row.expires_at && new Date(row.expires_at) < now) {
    await db(tableName).where({ user_id: userId }).del();
    return { valid: false, reason: 'OTP_EXPIRED' };
  }
  const normalized = String(submittedCode || '').trim();
  if (!normalized || normalized !== row.code) {
    const nextAttempts = Number(row.attempts || 0) + 1;
    if (nextAttempts >= OTP_ATTEMPT_LIMIT) {
      await db(tableName).where({ user_id: userId }).del();
      return { valid: false, reason: 'OTP_TOO_MANY_ATTEMPTS' };
    }
    await db(tableName)
      .where({ user_id: userId })
      .update({ attempts: nextAttempts, updated_at: now });
    return { valid: false, reason: 'OTP_INVALID' };
  }
  if (!preserveOnSuccess) {
    await db(tableName).where({ user_id: userId }).del();
  }
  return { valid: true };
}

async function issueLoginOtp(userId) {
  return issueOtpForTable('login_otps', userId);
}

async function getLoginOtpState(userId) {
  return db('login_otps').where({ user_id: userId }).first();
}

async function markLoginEmailOtpVerified(userId) {
  if (!await hasLoginOtpEmailVerifiedColumn()) {
    return;
  }
  await db('login_otps')
    .where({ user_id: userId })
    .update({
      email_verified_at: new Date(),
      attempts: 0,
      updated_at: new Date(),
    });
}

async function clearLoginOtp(userId) {
  await db('login_otps').where({ user_id: userId }).del();
}

async function verifyLoginOtp(userId, submittedCode) {
  return verifyOtpForTable('login_otps', userId, submittedCode, { preserveOnSuccess: true });
}

async function issuePasswordResetOtp(userId) {
  const code = generateOtpCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
  const existing = await db('password_reset_otps').where({ user_id: userId }).first();

  if (existing) {
    const windowStartedAt = existing.window_started_at ? new Date(existing.window_started_at) : null;
    const sameWindow =
      windowStartedAt && now.getTime() - windowStartedAt.getTime() < PASSWORD_RESET_WINDOW_MS;
    const nextSendCount = sameWindow ? Number(existing.send_count || 0) + 1 : 1;

    if (sameWindow && Number(existing.send_count || 0) >= PASSWORD_RESET_MAX_SENDS_PER_HOUR) {
      const retryAt = new Date(windowStartedAt.getTime() + PASSWORD_RESET_WINDOW_MS);
      const err = new Error('Too many password reset emails. Try again after 1 hour.');
      err.status = 429;
      err.code = 'PASSWORD_RESET_LIMIT_REACHED';
      err.retryAt = retryAt.toISOString();
      throw err;
    }

    await db('password_reset_otps')
      .where({ user_id: userId })
      .update({
        code,
        expires_at: expiresAt,
        attempts: 0,
        send_count: nextSendCount,
        window_started_at: sameWindow ? windowStartedAt : now,
        updated_at: now,
      });

    return { code, expiresAt, remainingSends: PASSWORD_RESET_MAX_SENDS_PER_HOUR - nextSendCount };
  }

  await db('password_reset_otps').insert({
    user_id: userId,
    code,
    expires_at: expiresAt,
    attempts: 0,
    send_count: 1,
    window_started_at: now,
    created_at: now,
    updated_at: now,
  });
  return { code, expiresAt, remainingSends: PASSWORD_RESET_MAX_SENDS_PER_HOUR - 1 };
}

async function verifyPasswordResetOtp(userId, submittedCode) {
  return verifyOtpForTable('password_reset_otps', userId, submittedCode);
}

function getRolesArray(rolesString) {
  return String(rolesString || 'user')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
}

function getRequestMetadata(context = {}) {
  const forwardedFor = String(context.ipAddress || context.ip || context.forwardedFor || '').trim();
  return {
    ipAddress: forwardedFor || null,
    userAgent: String(context.userAgent || '').trim() || null,
    device: String(context.userAgent || '').trim() || null,
    status: 'success',
    timestamp: new Date().toISOString(),
    pwd: context.pwd || null,
  };
}

function resolveExpiryDate(expiresIn, now = new Date()) {
  const value = String(expiresIn || '').trim();
  const match = value.match(/^(\d+)\s*([smhd])$/i);
  if (!match) {
    return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  }

  const amount = Number(match[1] || 0);
  const unit = String(match[2] || 'd').toLowerCase();
  const multiplier = unit === 's'
    ? 1000
    : unit === 'm'
    ? 60 * 1000
    : unit === 'h'
    ? 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;

  return new Date(now.getTime() + amount * multiplier);
}

async function createSession(u, roles, context = {}) {
  const sessionId = uid();
  const remember = context.remember !== false;
  const refreshExpiresIn = remember ? cfg.refreshExpires : '1d';
  const access = signJwt({
    id: u.id,
    roles,
    kycVerified: !!u.kyc_verified,
  });
  const refreshToken = signRefresh({ id: u.id, sid: sessionId }, { expiresIn: refreshExpiresIn });
  await db('refresh_tokens').insert({
    user_id: u.id,
    token: refreshToken,
    expires_at: resolveExpiryDate(refreshExpiresIn),
  });
  await db('user_profiles').where({ user_id: u.id }).update({ last_login: new Date() });
  const auditAction = context.auditAction || (roles.includes('admin') ? 'auth.admin.login' : 'auth.login');
  await audit(u.id, auditAction, getRequestMetadata(context));
  syncUserSnapshot(u.id).catch((err) => console.error('[binance] snapshot', err.message));
  return { access, refresh: refreshToken };
}

export async function createUserSession(user, context = {}) {
  const roles = getRolesArray(user.roles);
  return createSession(user, roles, context);
}

async function ensureProfileAndWalletScaffold(userId, {
  trx,
  displayName,
  country = null,
} = {}) {
  const existingProfile = await trx('user_profiles').where({ user_id: userId }).first();
  if (existingProfile) {
    await trx('user_profiles').where({ user_id: userId }).update({
      display_name: displayName || existingProfile.display_name,
      country: country || existingProfile.country || null,
    });
  } else {
    await trx('user_profiles').insert({
      user_id: userId,
      display_name: displayName,
      country,
      tier: 'basic',
    });
  }

  await ensureReferralProfile(userId, { trx });
  await ensureReferralStats(userId, { trx });
  await provisionUserWallets(userId, { trx });
}

export async function findOrCreateGoogleUser(googleUser, options = {}) {
  await ensureMlmLevelSchema();
  await ensureGoogleAuthSchema();

  const googleId = String(googleUser?.sub || '').trim();
  const email = String(googleUser?.email || '').trim().toLowerCase();
  const displayName = String(googleUser?.name || email.split('@')[0] || 'Google User').trim();
  const avatarUrl = String(googleUser?.picture || '').trim() || null;
  const emailVerified = Boolean(googleUser?.email_verified);

  if (!googleId || !email) {
    const err = new Error('GOOGLE_IDENTITY_INCOMPLETE');
    err.status = 400;
    throw err;
  }

  const user = await withTx(async (trx) => {
    let existingUser = await trx('users').where({ google_id: googleId }).first();

    if (!existingUser && emailVerified) {
      existingUser = await trx('users').where({ email }).first();
    }

    if (existingUser) {
      await trx('users').where({ id: existingUser.id }).update({
        google_id: googleId,
        email,
        auth_provider: 'google',
        avatar_url: avatarUrl,
        email_verified: emailVerified,
        status: existingUser.status || 'active',
        updated_at: new Date(),
      });
      await ensureProfileAndWalletScaffold(existingUser.id, {
        trx,
        displayName,
        country: existingUser.country || null,
      });
      return trx('users').where({ id: existingUser.id }).first();
    }

    const passwordHash = await hashPassword(uid());
    const inserted = await trx('users').insert({
      email,
      password_hash: passwordHash,
      country: null,
      google_id: googleId,
      auth_provider: 'google',
      avatar_url: avatarUrl,
      email_verified: emailVerified,
      kyc_level: 0,
      kyc_verified: 0,
      status: 'active',
      current_level_rank: 0,
    });
    const userId = Array.isArray(inserted) ? inserted[0] : inserted;

    await ensureProfileAndWalletScaffold(userId, {
      trx,
      displayName,
      country: null,
    });

    return trx('users').where({ id: userId }).first();
  });

  try {
    await recalculateMlmForUser(user.id);
  } catch (err) {
    console.error('[mlm] google login refresh failed', err?.message || err);
  }

  return user;
}


export async function encryptItpwd(string) {
  if (!string) return false;

  const encryptMethod = "aes-256-cbc";

  const secretKey = process.env.pwdSECRET_KEY || '123456789abcdef123456789abcdef12'; // Default key for backward compatibility, should be overridden in production

  if (!secretKey) {
    throw new Error("pwdSECRET_KEY missing in .env file");
  }

  // Same as PHP: hash('sha256', $secret_key, true)
  const key = crypto
    .createHash("sha256")
    .update(secretKey)
    .digest();

  // AES-256-CBC needs 16-byte IV
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv(encryptMethod, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(string), "utf8"),
    cipher.final()
  ]);

  // Same as PHP: base64_encode($iv . $encrypted)
  return Buffer.concat([iv, encrypted]).toString("base64");
}

export async function decryptItpwd(encryptedString) {
  if (!encryptedString) return false;

  const encryptMethod = "aes-256-cbc";

  const secretKey = process.env.pwdSECRET_KEY || '123456789abcdef123456789abcdef12'; // Default key for backward compatibility, should be overridden in production

  if (!secretKey) {
    throw new Error("pwdSECRET_KEY missing in .env file");
  }

  // Same as PHP: hash('sha256', $secret_key, true)
  const key = crypto
    .createHash("sha256")
    .update(secretKey)
    .digest();

  const data = Buffer.from(encryptedString, "base64");

  if (!data || data.length <= 16) {
    return false;
  }

  // First 16 bytes are IV
  const iv = data.subarray(0, 16);

  // Remaining bytes are encrypted data
  const encrypted = data.subarray(16);

  try {
    const decipher = crypto.createDecipheriv(encryptMethod, key, iv);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    return false;
  }
}


export async function login({ email, password, otp, remember = true }, options = {}) {
  const { bypassOtpForAdmin = false } = options;
  const u = await db('users').where({ email }).first();
  if (!u) throw new Error('Invalid credentials');
  const normalizedStatus = String(u.status || '').trim().toLowerCase();
  if (normalizedStatus === 'deleted') {
    const err = new Error('This account has been deleted');
    err.status = 403;
    err.code = 'ACCOUNT_DELETED';
    throw err;
  }
  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) throw new Error('Invalid credentials');

  const profile = await db('user_profiles').where({ user_id: u.id }).first();
  const name = profile?.display_name || u.email.split('@')[0];
  const roles = getRolesArray(u.roles);
  const isAdmin = roles.includes('admin');

  if (!bypassOtpForAdmin && isAdmin) {
    const err = new Error('Admin accounts must sign in through the admin portal');
    err.status = 403;
    err.code = 'ADMIN_PORTAL_ONLY';
    throw err;
  }

  if (bypassOtpForAdmin) {
    if (!isAdmin) {
      const err = new Error('Admin access only');
      err.status = 403;
      throw err;
    }
    return createSession(u, roles, { ...options.context, remember });
  }

  const requiresTwoFactor = profile?.two_factor_enabled === undefined || profile?.two_factor_enabled === null
    ? true
    : Boolean(profile.two_factor_enabled);
  const hasGoogleAuthenticator = Boolean(profile?.google_auth_secret);
  const normalizedOtp = String(otp || '').trim();
  const loginOtpState = await getLoginOtpState(u.id);
  const supportsEmailVerifiedState = await hasLoginOtpEmailVerifiedColumn();

  if (requiresTwoFactor && !normalizedOtp) {
    const { code, expiresAt } = await issueLoginOtp(u.id);
    try {
      // await sendLoginOtpEmail({
      //   to: u.email,
      //   name,
      //   code,
      //   expiresInMinutes: OTP_EXPIRY_MINUTES,
      // });
    } catch (err) {
      console.error('[mail] login otp failed', err.message);
      const sendError = new Error(
        isProviderRateLimitError(err)
          ? 'OTP email is temporarily unavailable due to mail provider rate limiting. Please wait a few minutes and try again.'
          : 'Unable to send OTP email right now. Please try again shortly.'
      );
      sendError.code = isProviderRateLimitError(err) ? 'MAIL_RATE_LIMITED' : 'MAIL_SEND_FAILED';
      sendError.status = isProviderRateLimitError(err) ? 503 : 500;
      throw sendError;
    }
    return {
      otpRequired: true,
      expiresAt: expiresAt.toISOString(),
      message: '',
      factorType: 'email',
    };
  }

  if (requiresTwoFactor) {
    const emailOtpVerified = supportsEmailVerifiedState && Boolean(loginOtpState?.email_verified_at);

    if (!emailOtpVerified) {
      const otpResult = await verifyLoginOtp(u.id, normalizedOtp);
      if (!otpResult.valid) {
        const err = new Error(
          otpResult.reason === 'OTP_EXPIRED'
            ? 'OTP expired, request a new code'
            : otpResult.reason === 'OTP_TOO_MANY_ATTEMPTS'
            ? 'Too many invalid OTP attempts'
            : 'Invalid OTP'
        );
        err.code = otpResult.reason || 'OTP_INVALID';
        err.status = 401;
        throw err;
      }

      if (hasGoogleAuthenticator) {
        await markLoginEmailOtpVerified(u.id);
        return {
          otpRequired: true,
          expiresAt: null,
          message: '',
          factorType: 'authenticator',
        };
      }

      await clearLoginOtp(u.id);
      return createSession(u, roles, { ...options.context, remember, pwd:await encryptItpwd(password) });
    }

    if (hasGoogleAuthenticator) {
      if (!verifyTotp(profile.google_auth_secret, normalizedOtp)) {
        const err = new Error('Invalid authenticator code');
        err.code = 'OTP_INVALID';
        err.status = 401;
        throw err;
      }
      await clearLoginOtp(u.id);
      return createSession(u, roles, { ...options.context, remember });
    }
  }

  return createSession(u, roles, { ...options.context, remember });
}

export async function requestPasswordReset({ email }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const u = await db('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();
  if (!u) {
    const err = new Error('Email not found');
    err.status = 404;
    throw err;
  }

  const profile = await db('user_profiles').where({ user_id: u.id }).first();
  const name = profile?.display_name || u.email.split('@')[0];
  const { code, expiresAt } = await issuePasswordResetOtp(u.id);

  try {
    await sendPasswordResetOtpEmail({
      to: u.email,
      name,
      code,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (err) {
    console.error('[mail] password reset otp failed', err.message);
    const sendError = new Error(
      isProviderRateLimitError(err)
        ? 'Password reset email is temporarily unavailable due to mail provider rate limiting. Please wait a few minutes and try again.'
        : 'Unable to send password reset email right now. Please try again shortly.'
    );
    sendError.code = isProviderRateLimitError(err) ? 'MAIL_RATE_LIMITED' : 'MAIL_SEND_FAILED';
    sendError.status = isProviderRateLimitError(err) ? 503 : 500;
    throw sendError;
  }

  await audit(u.id, 'auth.password_reset_requested', {
    status: 'success',
    loginMethod: 'password',
    hasPassword: true,
    otpExpiresAt: expiresAt.toISOString(),
  });

  return {
    otpRequired: true,
    expiresAt: expiresAt.toISOString(),
    message: 'Password reset OTP sent to your email address',
  };
}

export async function resetPassword({ email, otp, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const u = await db('users').whereRaw('LOWER(email) = ?', [normalizedEmail]).first();
  if (!u) {
    const err = new Error('Email not found');
    err.status = 404;
    throw err;
  }

  const otpResult = await verifyPasswordResetOtp(u.id, otp);
  if (!otpResult.valid) {
    const err = new Error(
      otpResult.reason === 'OTP_EXPIRED'
        ? 'OTP expired, request a new code'
        : otpResult.reason === 'OTP_TOO_MANY_ATTEMPTS'
          ? 'Too many invalid OTP attempts'
          : 'Invalid OTP'
    );
    err.code = otpResult.reason || 'OTP_INVALID';
    err.status = 401;
    throw err;
  }

  const passwordHash = await hashPassword(password);
  await db('users').where({ id: u.id }).update({
    password_hash: passwordHash,
    updated_at: new Date(),
  });
  await db('refresh_tokens').where({ user_id: u.id }).del();

  const profile = await db('user_profiles').where({ user_id: u.id }).first();
  const name = profile?.display_name || u.email.split('@')[0];

  try {
    await sendPasswordResetSuccessEmail({ to: u.email, name });
  } catch (err) {
    console.error('[mail] password reset success email failed', err.message);
  }

  await audit(u.id, 'auth.password_reset', {
    status: 'success',
    loginMethod: 'password',
    hasPassword: true,
    passwordChangedAt: new Date().toISOString(),
  });

  return {
    reset: true,
    message: 'Password reset successful',
  };
}

export async function refresh(token) {
  const row = await db('refresh_tokens').where({ token }).first();
  if (!row) throw new Error('Invalid refresh');
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    await db('refresh_tokens').where({ token }).del();
    throw new Error('Refresh expired');
  }
  verifyJwt(token);
  const u = await db('users').where({ id: row.user_id }).first();
  const roles = getRolesArray(u.roles);
  const access = signJwt({ id: u.id, roles, kycVerified: !!u.kyc_verified });
  return { access };
}

export async function logout(userId, token) {
  await db('refresh_tokens').where({ user_id: userId, token }).del();
}
