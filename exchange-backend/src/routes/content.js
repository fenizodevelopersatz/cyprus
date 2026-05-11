/**
 * @openapi
 * tags:
 *   - name: Content
 *     description: Marketing & editorial feeds
 */

/**
 * @openapi
 * /content/promotions:
 *   get:
 *     summary: Promotional banners
 *     tags: [Content]
 *     parameters:
 *       - in: query
 *         name: placement
 *         schema:
 *           type: string
 *           example: dashboard
 *     responses:
 *       200:
 *         description: Promo banner list
 */

/**
 * @openapi
 * /content/news:
 *   get:
 *     summary: Dashboard news feed
 *     tags: [Content]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Curated news items
 */

import express from 'express';
import { ok } from '../utils/responses.js';
import { getPromotions, getNews } from '../services/dashboardService.js';
import { getSettings } from '../services/settingsService.js';

const router = express.Router();

router.get('/promotions', async (req, res) => {
  const placement = req.query.placement ? String(req.query.placement) : undefined;
  ok(res, await getPromotions({ placement }));
});

router.get('/news', async (req, res) => {
  const parsed = Number(req.query.limit);
  const limit =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(50, Math.floor(parsed))
      : 10;
  ok(res, await getNews(limit));
});

/**
 * @openapi
 * /content/system-status:
 *   get:
 *     summary: Public runtime feature flags
 *     tags: [Content]
 *     responses:
 *       200:
 *         description: Maintenance and referral settings
 */
router.get('/system-status', async (_req, res) => {
  const settings = await getSettings();
  ok(res, {
    maintenanceMode: !!settings.maintenanceMode,
    requireReferralCode: !!settings.requireReferralCode,
    maintenanceMessage: settings.maintenanceMode
      ? `${settings.siteName || 'Exchange'} is currently under maintenance`
      : null,
  });
});

router.get('/branding', async (_req, res) => {
  const settings = await getSettings();
  ok(res, {
    siteName: settings.siteName || 'CryptoSignal Exchange',
    siteLogoUrl: settings.siteLogoUrl || null,
    siteFaviconUrl: settings.siteFaviconUrl || null,
  });
});

export default router;
