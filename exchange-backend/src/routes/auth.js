/**
 * @openapi
 * tags:
 *   - name: Auth
 *     description: Authentication & sessions
 */

/**
 * @openapi
 * /auth/register:
 *   post:
 *     summary: Register user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, country]
 *             properties:
 *               name:
 *                 type: string
 *                 description: Optional display name
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *               country:
 *                 type: string
 *               referralCode:
 *                 type: string
 *                 description: Optional invite code from another user
 *     responses:
 *       200:
 *         description: Registered
 *       400:
 *         description: Already exists / validation error
 */

/**
 * @openapi
 * /auth/login:
 *   post:
 *     summary: Login and get tokens
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *               remember:
 *                 type: boolean
 *               otp:
 *                 type: string
 *     responses:
 *       200:
 *         description: JWT tokens
 *       401:
 *         description: Invalid credentials
 */

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Logout (revoke refresh token)
 *     security:
 *       - bearerAuth: []
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out
 */

/**
 * @openapi
 * /auth/session:
 *   get:
 *     summary: Current session summary
 *     security:
 *       - bearerAuth: []
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Session info
 */

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refresh:
 *                 type: string
 *     responses:
 *       200:
 *         description: New access token
 */

/**
 * @openapi
 * /auth/mfa/verify:
 *   post:
 *     summary: Verify MFA (dummy)
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Always success in demo
 */

/**
 * @openapi
 * /auth/forgot-password/request:
 *   post:
 *     summary: Request password reset OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: OTP sent
 *       404:
 *         description: Email not found
 */

/**
 * @openapi
 * /auth/forgot-password/reset:
 *   post:
 *     summary: Reset password with OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               otp:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       200:
 *         description: Password reset successful
 */

import express from 'express';
import crypto from 'crypto';
import { v } from '../middleware/validate.js';
import { authLimiter } from '../middleware/rateLimit.js';
import {
  register,
  login,
  refresh,
  logout,
  findOrCreateGoogleUser,
  createUserSession,
  requestPasswordReset,
  resetPassword,
} from '../services/authService.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/responses.js';
import { db } from '../db.js';

const router = express.Router();
const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state';

function getFrontendBaseUrl() {
  return String(process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function getGoogleRedirectUri(req) {
  return String(process.env.GOOGLE_REDIRECT_URI || '').trim()
    || `${req.protocol}://${req.get('host')}/auth/google/callback`;
}

function buildGoogleAuthUrl(req, state) {
  const params = new URLSearchParams({
    client_id: String(process.env.GOOGLE_CLIENT_ID || ''),
    redirect_uri: getGoogleRedirectUri(req),
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function parseCookieHeader(req) {
  const raw = String(req.headers.cookie || '');
  return raw.split(';').reduce((acc, pair) => {
    const [key, ...rest] = pair.split('=');
    if (!key || rest.length === 0) return acc;
    acc[key.trim()] = decodeURIComponent(rest.join('=').trim());
    return acc;
  }, {});
}

function setStateCookie(res, state) {
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const cookie = [
    `${GOOGLE_OAUTH_STATE_COOKIE}=${encodeURIComponent(state)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${10 * 60}`,
  ];
  if (secure) cookie.push('Secure');
  res.append('Set-Cookie', cookie.join('; '));
}

function clearStateCookie(res) {
  const secure = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
  const cookie = [
    `${GOOGLE_OAUTH_STATE_COOKIE}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) cookie.push('Secure');
  res.append('Set-Cookie', cookie.join('; '));
}

function getAuthRequestContext(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedFor = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0];
  return {
    ipAddress: forwardedFor?.trim() || req.ip || null,
    userAgent: String(req.headers['user-agent'] || '').trim() || null,
  };
}

const emailSchema = v.Joi.string().email({ tlds: { allow: false } });

router.post(
  '/register',
  authLimiter,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      name: v.Joi.string().trim().max(255).optional(),
      email: emailSchema.required(),
      password: v.Joi.string().min(6).required(),
      country: v.Joi.string().required(),
      referralCode: v.Joi.string().trim().max(64).optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const result = await register(req.body);
      ok(res, result);
    } catch (e) {
      fail(res, e.message, e.status || 400);
    }
  }
);

router.get('/google', authLimiter, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return fail(res, 'Google OAuth is not configured', 503);
  }

  const state = crypto.randomBytes(24).toString('hex');
  setStateCookie(res, state);
  return res.redirect(buildGoogleAuthUrl(req, state));
});

router.get('/google/callback', authLimiter, async (req, res) => {
  const { code, state, error } = req.query || {};
  const frontendBaseUrl = getFrontendBaseUrl();

  if (error) {
    clearStateCookie(res);
    return res.redirect(`${frontendBaseUrl}/login?google_error=${encodeURIComponent(String(error))}`);
  }

  const cookies = parseCookieHeader(req);
  const savedState = String(cookies[GOOGLE_OAUTH_STATE_COOKIE] || '').trim();
  if (!code || !state || !savedState || String(state) !== savedState) {
    clearStateCookie(res);
    return res.redirect(`${frontendBaseUrl}/login?google_error=invalid_state`);
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: String(code),
        client_id: String(process.env.GOOGLE_CLIENT_ID || ''),
        client_secret: String(process.env.GOOGLE_CLIENT_SECRET || ''),
        redirect_uri: getGoogleRedirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData?.access_token) {
      clearStateCookie(res);
      return res.redirect(`${frontendBaseUrl}/login?google_error=${encodeURIComponent(String(tokenData?.error || 'token_exchange_failed'))}`);
    }

    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });
    const googleUser = await userInfoResponse.json();

    if (!userInfoResponse.ok || !googleUser?.sub || !googleUser?.email) {
      clearStateCookie(res);
      return res.redirect(`${frontendBaseUrl}/login?google_error=userinfo_failed`);
    }

    const appUser = await findOrCreateGoogleUser(googleUser, { context: getAuthRequestContext(req) });
    const session = await createUserSession(appUser, {
      ...getAuthRequestContext(req),
      auditAction: 'auth.google.login',
    });
    clearStateCookie(res);

    const redirectUrl = new URL(`${frontendBaseUrl}/auth/google/complete`);
    redirectUrl.hash = new URLSearchParams({
      access: session.access,
      refresh: session.refresh,
    }).toString();
    return res.redirect(redirectUrl.toString());
  } catch (err) {
    console.error('[auth.google.callback]', err?.message || err);
    clearStateCookie(res);
    return res.redirect(`${frontendBaseUrl}/login?google_error=server_error`);
  }
});

router.post(
  '/login',
  authLimiter,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      email: emailSchema.required(),
      password: v.Joi.string().required(),
      remember: v.Joi.boolean().optional(),
      otp: v.Joi.string().optional(),
    }),
  }),
  async (req, res) => {
    try {
      const result = await login(req.body, { context: getAuthRequestContext(req) });
      ok(res, result);
    } catch (e) {
      fail(res, e.message, e.status || 401);
    }
  }
);

router.post(
  '/admin/login',
  authLimiter,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      email: emailSchema.required(),
      password: v.Joi.string().required(),
    }),
  }),
  async (req, res) => {
    try {
      const result = await login(req.body, {
        bypassOtpForAdmin: true,
        context: getAuthRequestContext(req),
      });
      ok(res, result);
    } catch (e) {
      fail(res, e.message, e.status || 401);
    }
  }
);

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await logout(req.user.id, req.body.refresh);
    ok(res, { loggedOut: true });
  } catch (e) {
    fail(res, e.message, 400);
  }
});

router.get('/session', requireAuth, async (req, res) => {
  const u = await db('users').where({ id: req.user.id }).first();
  ok(res, {
    id: u.id,
    email: u.email,
    roles: (u.roles || 'user').split(','),
    kycVerified: !!u.kyc_verified,
  });
});

router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const { access } = await refresh(req.body.refresh);
    ok(res, { access });
  } catch (e) {
    fail(res, e.message, 401);
  }
});

router.post('/mfa/verify', authLimiter, (req, res) => ok(res, { verified: true }));

router.post(
  '/forgot-password/request',
  authLimiter,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      email: emailSchema.required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const result = await requestPasswordReset(req.body);
      ok(res, result);
    } catch (e) {
      fail(res, e.message, e.status || 400);
    }
  }
);

router.post(
  '/forgot-password/reset',
  authLimiter,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      email: emailSchema.required(),
      otp: v.Joi.string().length(6).required(),
      password: v.Joi.string().min(6).required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const result = await resetPassword(req.body);
      ok(res, result);
    } catch (e) {
      fail(res, e.message, e.status || 400);
    }
  }
);

export default router;
