import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getReferralDashboard,
  getReferralIncomeHistory,
  setPromoState,
  generateReferralCsv,
} from '../services/referralService.js';

const router = Router();

function handleError(res, err, fallbackMessage) {
  const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
  const message = err?.message || fallbackMessage;
  if (status >= 500) {
    console.error('[referrals]', err);
  }
  return res.status(status).json({ message });
}

/**
 * @openapi
 * /api/referrals/dashboard:
 *   get:
 *     summary: Referral dashboard payload
 *     security:
 *       - bearerAuth: []
 *     tags: [Referrals]
 *     responses:
 *       200:
 *         description: Referral dashboard data
 */
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const payload = await getReferralDashboard(req.user.id);
    return res.json(payload);
  } catch (err) {
    return handleError(res, err, 'Failed to load referral dashboard');
  }
});

router.get('/history', requireAuth, async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    const payload = await getReferralIncomeHistory(req.user.id, { page, limit });
    return res.json(payload);
  } catch (err) {
    return handleError(res, err, 'Failed to load referral income history');
  }
});

/**
 * @openapi
 * /api/referrals/promo:
 *   post:
 *     summary: Toggle referral promo state
 *     security:
 *       - bearerAuth: []
 *     tags: [Referrals]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Promo state updated
 */
router.post('/promo', requireAuth, async (req, res) => {
  try {
    const rawActive = req.body?.active;
    if (rawActive === undefined) {
      return res.status(400).json({ message: 'Field "active" is required' });
    }

    let active;
    if (typeof rawActive === 'boolean') {
      active = rawActive;
    } else if (typeof rawActive === 'string') {
      if (['true', '1', 'yes', 'on'].includes(rawActive.toLowerCase())) active = true;
      else if (['false', '0', 'no', 'off'].includes(rawActive.toLowerCase())) active = false;
      else return res.status(400).json({ message: 'Invalid value for "active"' });
    } else if (typeof rawActive === 'number') {
      if (rawActive === 1) active = true;
      else if (rawActive === 0) active = false;
      else return res.status(400).json({ message: 'Invalid value for "active"' });
    } else {
      return res.status(400).json({ message: 'Invalid value for "active"' });
    }

    const result = await setPromoState(req.user.id, active);
    return res.json(result);
  } catch (err) {
    return handleError(res, err, 'Failed to update promo state');
  }
});

/**
 * @openapi
 * /api/referrals/export:
 *   get:
 *     summary: Export referral data to CSV
 *     security:
 *       - bearerAuth: []
 *     tags: [Referrals]
 *     responses:
 *       200:
 *         description: CSV export
 */
router.get('/export', requireAuth, async (req, res) => {
  try {
    const csv = await generateReferralCsv(req.user.id);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="referrals-${date}.csv"`);
    return res.send(csv);
  } catch (err) {
    return handleError(res, err, 'Failed to export referrals');
  }
});

export default router;
