import express from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok, fail } from '../../utils/responses.js';
import { v } from '../../middleware/validate.js';
import { getSettings, saveSettingsAsset, updateSettings } from '../../services/settingsService.js';
import { db } from '../../db.js';
import { hashPassword, verifyPassword } from '../../utils/crypto.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];
const absoluteOrRelativeUrl = v.Joi.string()
  .trim()
  .max(2048)
  .custom((value, helpers) => {
    if (!value) return value;
    if (value.startsWith('/')) return value;
    try {
      new URL(value);
      return value;
    } catch {
      return helpers.error('any.invalid');
    }
  }, 'absolute or relative URL validation')
  .messages({
    'any.invalid': 'Must be a valid absolute URL or relative path',
  });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.get('/', guard, async (_req, res) => {
  ok(res, await getSettings());
});

router.post('/upload', guard, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      return fail(res, err.message || 'Unable to upload settings asset', 400);
    }

    try {
      const field = String(req.body?.field || '').trim();
      if (!['siteLogoUrl', 'siteFaviconUrl'].includes(field)) {
        return fail(res, 'Invalid asset field', 400);
      }
      if (!req.file) {
        return fail(res, 'File is required', 400);
      }

      const asset = await saveSettingsAsset(field, req.file);
      return ok(res, asset);
    } catch (uploadErr) {
      return fail(res, uploadErr.message || 'Unable to upload settings asset', 400);
    }
  });
});

router.post(
  '/password',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      currentPassword: v.Joi.string().required(),
      newPassword: v.Joi.string().min(8).required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const user = await db('users').where({ id: req.user.id }).first();
      if (!user) {
        return fail(res, 'Admin user not found', 404);
      }

      const isValid = await verifyPassword(req.body.currentPassword, user.password_hash);
      if (!isValid) {
        return fail(res, 'Current password is incorrect', 400);
      }

      const passwordHash = await hashPassword(req.body.newPassword);
      await db('users').where({ id: req.user.id }).update({ password_hash: passwordHash });

      return ok(res, { updated: true });
    } catch (err) {
      return fail(res, err.message || 'Unable to update password', 400);
    }
  }
);

router.put(
  '/',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      siteName: v.Joi.string().trim().max(120).optional(),
      siteLogoUrl: absoluteOrRelativeUrl.allow('', null).optional(),
      siteFaviconUrl: absoluteOrRelativeUrl.allow('', null).optional(),
      maintenanceMode: v.Joi.boolean().optional(),
      enableKyc: v.Joi.boolean().optional(),
      enableLanguageSwitcher: v.Joi.boolean().optional(),
      enableDarkMode: v.Joi.boolean().optional(),
      darkModeDefault: v.Joi.boolean().optional(),
      requireReferralCode: v.Joi.boolean().optional(),
      withdrawalLimitKyc: v.Joi.number().min(0).allow(null).empty('').optional(),
      withdrawalLimitNonKyc: v.Joi.number().min(0).allow(null).empty('').optional(),
      withdrawalAdminFeePercent: v.Joi.number().min(0).max(100).allow(null).empty('').optional(),
      withdrawalLockPeriodDays: v.Joi.number().min(0).allow(null).empty('').optional(),
      earlyWithdrawalPenaltyPercent: v.Joi.number().min(0).max(100).allow(null).empty('').optional(),
      rewardReductionEnabled: v.Joi.boolean().optional(),
      rewardReductionType: v.Joi.string().trim().max(64).allow('', null).optional(),
      minimumWithdrawalAmount: v.Joi.number().min(0).allow(null).empty('').optional(),
      maximumWithdrawalAmount: v.Joi.number().min(0).allow(null).empty('').optional(),
      withdrawalNote: v.Joi.string().max(2000).allow('', null).optional(),
      isWithdrawalEnabled: v.Joi.boolean().optional(),
      defaultSwapMarket: v.Joi.string().trim().uppercase().pattern(/^[A-Z0-9:_-]{0,32}$/).allow('', null).optional(),
      tradeMakerFee: v.Joi.number().min(0).max(100).allow(null).empty('').optional(),
      tradeTakerFee: v.Joi.number().min(0).max(100).allow(null).empty('').optional(),
      referralFee: v.Joi.number().min(0).max(100).allow(null).empty('').optional(),
      transferCommission: v.Joi.number().min(0).max(100).allow(null).empty('').optional(),
      disableTrades: v.Joi.boolean().optional(),
      mailType: v.Joi.string().max(32).allow('', null).optional(),
      mailHost: v.Joi.string().max(191).allow('', null).optional(),
      mailPort: v.Joi.number().integer().min(1).max(65535).allow(null).empty('').optional(),
      mailUsername: v.Joi.string().max(191).allow('', null).optional(),
      mailPassword: v.Joi.string().max(191).allow('', null).optional(),
      mailSenderName: v.Joi.string().max(191).allow('', null).optional(),
      mailSenderEmail: v.Joi
        .string()
        .email({ tlds: { allow: false } })
        .allow('', null)
        .optional(),
      mailEncryption: v.Joi.string().max(32).allow('', null).optional(),
      notificationAdminEmail: v.Joi
        .string()
        .email({ tlds: { allow: false } })
        .allow('', null)
        .optional(),
      notifyCryptoDeposits: v.Joi.boolean().optional(),
      notifyCryptoWithdrawals: v.Joi.boolean().optional(),
      notifyFiatDeposits: v.Joi.boolean().optional(),
      notifyFiatWithdrawals: v.Joi.boolean().optional(),
      notifyKyc: v.Joi.boolean().optional(),
      notifyNewUser: v.Joi.boolean().optional(),
      stripePublicKey: v.Joi.string().max(255).allow('', null).optional(),
      stripeSecretKey: v.Joi.string().max(255).allow('', null).optional(),
      stripeBaseCurrency: v.Joi.string().max(16).allow('', null).optional(),
      recaptchaEnabled: v.Joi.boolean().optional(),
      recaptchaSiteKey: v.Joi.string().max(191).allow('', null).optional(),
      recaptchaSecretKey: v.Joi.string().max(191).allow('', null).optional(),
      socialYoutube: v.Joi.string().uri().max(255).allow('', null).optional(),
      socialFacebook: v.Joi.string().uri().max(255).allow('', null).optional(),
      socialTelegram: v.Joi.string().uri().max(255).allow('', null).optional(),
      socialTwitter: v.Joi.string().uri().max(255).allow('', null).optional(),
      socialInstagram: v.Joi.string().uri().max(255).allow('', null).optional(),
      socialLinkedin: v.Joi.string().uri().max(255).allow('', null).optional(),
    })
      .custom((value, helpers) => {
        if (value.darkModeDefault && value.enableDarkMode === false) {
          return helpers.message('Dark mode must be enabled if dark mode default is on');
        }
        if (
          typeof value.minimumWithdrawalAmount === 'number' &&
          typeof value.maximumWithdrawalAmount === 'number' &&
          value.maximumWithdrawalAmount > 0 &&
          value.maximumWithdrawalAmount < value.minimumWithdrawalAmount
        ) {
          return helpers.message('Maximum withdrawal amount must be greater than or equal to minimum withdrawal amount');
        }
        return value;
      }, 'settings cross-field validation')
      .unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await updateSettings(req.body));
    } catch (err) {
      fail(res, err.message || 'Unable to update settings', 400);
    }
  }
);

export default router;
