import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { v } from '../middleware/validate.js';
import { ok, fail } from '../utils/responses.js';
import {
  getUserOverview,
  listPackages,
  listUserPositions,
  stakePosition,
  unstakePosition,
  getUserEarningsReport,
} from '../services/stakingService.js';

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Staking
 *     description: Yield programs & lockups
 */

/**
 * @openapi
 * /api/staking/overview:
 *   get:
 *     summary: Combined staking summary for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     responses:
 *       200:
 *         description: Summary payload with pools, positions, and activity
 */
router.get('/overview', requireAuth, async (req, res) => {
  try {
    const payload = await getUserOverview(req.user.id);
    ok(res, payload);
  } catch (err) {
    fail(res, err.message || 'Failed to load staking summary', err.status || 400);
  }
});

/**
 * @openapi
 * /api/staking/earnings:
 *   get:
 *     summary: Earnings report for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     parameters:
 *       - in: query
 *         name: rangeDays
 *         schema:
 *           type: integer
 *           default: 30
 *           minimum: 7
 *           maximum: 90
 *     responses:
 *       200:
 *         description: Aggregated earnings data
 */
router.get(
  '/earnings',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      rangeDays: v.Joi.number().integer().min(7).max(90).default(30),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await getUserEarningsReport(req.user.id, {
        rangeDays: req.query.rangeDays,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Failed to load earnings report', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /api/staking/pools:
 *   get:
 *     summary: List staking pools available to the current user
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     responses:
 *       200:
 *         description: Pool list
 */
router.get('/pools', requireAuth, async (_req, res) => {
  try {
    const pools = await listPackages({ includeInactive: false, withStats: true });
    ok(res, pools);
  } catch (err) {
    fail(res, err.message || 'Failed to load staking pools', err.status || 400);
  }
});

/**
 * @openapi
 * /api/staking/positions:
 *   get:
 *     summary: List staking positions for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           example: ACTIVE
 *     responses:
 *       200:
 *         description: Position list
 */
router.get(
  '/positions',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      status: v.Joi.string().uppercase().valid('ACTIVE', 'COMPLETED').optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const rows = await listUserPositions(req.user.id, { status: req.query.status });
      ok(res, rows);
    } catch (err) {
      fail(res, err.message || 'Failed to load positions', err.status || 400);
    }
  }
);

const POSITIVE_DECIMAL = /^(?:0*\.\d*[1-9]\d*|0*[1-9]\d*(?:\.\d+)?)$/;
const amountSchema = v.Joi.alternatives()
  .try(
    v.Joi.number().positive(),
    v.Joi.string()
      .trim()
      .pattern(POSITIVE_DECIMAL, 'amount')
  )
  .required();

/**
 * @openapi
 * /api/staking/positions:
 *   post:
 *     summary: Create a staking position
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [packageId, amount]
 *             properties:
 *               packageId:
 *                 type: integer
 *               amount:
 *                 type: string
 *                 example: "1000"
 *               autoCompound:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Newly created position
 */
router.post(
  '/positions',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      packageId: v.Joi.number().integer().positive().required(),
      amount: amountSchema,
      autoCompound: v.Joi.boolean().default(false),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await stakePosition({
        userId: req.user.id,
        packageId: req.body.packageId,
        amount: req.body.amount,
        autoCompound: req.body.autoCompound,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to stake in this pool', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /api/staking/positions/{id}/unstake:
 *   post:
 *     summary: Unstake a matured position
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Updated position payload
 */
router.post(
  '/positions/:id/unstake',
  requireAuth,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      id: v.Joi.number().integer().positive().required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await unstakePosition({
        userId: req.user.id,
        positionId: Number(req.params.id),
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to unstake position', err.status || 400);
    }
  }
);

export default router;
