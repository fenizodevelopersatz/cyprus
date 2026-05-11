import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { v } from '../../middleware/validate.js';
import { ok, fail } from '../../utils/responses.js';
import {
  listPackages,
  createPackage,
  updatePackage,
  adminListPositions,
  getProgramOverview,
  getNetworkEarningsReport,
  payoutPositionRewards,
  processRewardPayouts,
} from '../../services/stakingService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];
const POSITIVE_DECIMAL = /^(?:0*\.\d*[1-9]\d*|0*[1-9]\d*(?:\.\d+)?)$/;
const amountInput = v.Joi.alternatives().try(
  v.Joi.number().positive(),
  v.Joi.string()
    .trim()
    .pattern(POSITIVE_DECIMAL, 'amount')
);
const STATUS_VALUES = ['ACTIVE', 'DRAFT', 'ARCHIVED'];

/**
 * @openapi
 * /admin/staking/overview:
 *   get:
 *     summary: Program-wide staking overview
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     responses:
 *       200:
 *         description: Overview payload
 */
router.get('/overview', guard, async (_req, res) => {
  try {
    ok(res, await getProgramOverview());
  } catch (err) {
    fail(res, err.message || 'Failed to load staking overview', err.status || 400);
  }
});

/**
 * @openapi
 * /admin/staking/earnings:
 *   get:
 *     summary: Network-wide staking earnings report
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
 *           maximum: 180
 *       - in: query
 *         name: asset
 *         schema:
 *           type: string
 *           example: USDT
 *       - in: query
 *         name: userId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           example: ACTIVE
 *     responses:
 *       200:
 *         description: Aggregated earnings payload for admin dashboards
 */
router.get(
  '/earnings',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      rangeDays: v.Joi.number().integer().min(7).max(180).default(30),
      asset: v.Joi.string().uppercase().max(16).optional(),
      userId: v.Joi.number().integer().positive().optional(),
      status: v.Joi.string().uppercase().valid('ACTIVE', 'COMPLETED').optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await getNetworkEarningsReport({
        rangeDays: req.query.rangeDays,
        asset: req.query.asset,
        userId: req.query.userId,
        status: req.query.status,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Failed to load earnings report', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /admin/staking/packages:
 *   get:
 *     summary: List staking packages (all statuses)
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
 *         description: Package list
 */
router.get(
  '/packages',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      status: v.Joi.string().uppercase().valid(...STATUS_VALUES).optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const packages = await listPackages({
        includeInactive: true,
        status: req.query.status,
        withStats: true,
      });
      ok(res, packages);
    } catch (err) {
      fail(res, err.message || 'Failed to load packages', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /admin/staking/packages:
 *   post:
 *     summary: Create a new staking package
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - label
 *               - asset
 *               - aprPercent
 *               - lockDays
 *               - minAmount
 *             properties:
 *               label:
 *                 type: string
 *               asset:
 *                 type: string
 *               aprPercent:
 *                 type: number
 *               lockDays:
 *                 type: integer
 *               minAmount:
 *                 type: string
 *               maxAmount:
 *                 type: string
 *               status:
 *                 type: string
 *               isFeatured:
 *                 type: boolean
 *               sortOrder:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Created package
 */
router.post(
  '/packages',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      label: v.Joi.string().max(120).required(),
      asset: v.Joi.string().uppercase().max(16).required(),
      aprPercent: v.Joi.number().positive().required(),
      lockDays: v.Joi.number().integer().min(0).required(),
      minAmount: amountInput.required(),
      maxAmount: amountInput.allow(null).optional(),
      status: v.Joi.string().uppercase().valid(...STATUS_VALUES).optional(),
      isFeatured: v.Joi.boolean().optional(),
      sortOrder: v.Joi.number().integer().optional(),
      description: v.Joi.string().allow('', null).optional(),
      meta: v.Joi.object().unknown(true).optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await createPackage(req.body, { actorId: req.user.id });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to create package', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /admin/staking/packages/{id}:
 *   patch:
 *     summary: Update an existing staking package
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated package
 */
router.patch(
  '/packages/:id',
  guard,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      id: v.Joi.number().integer().positive().required(),
    }).unknown(false),
    [v.Segments.BODY]: v.Joi.object({
      label: v.Joi.string().max(120).optional(),
      asset: v.Joi.string().uppercase().max(16).optional(),
      aprPercent: v.Joi.number().positive().optional(),
      lockDays: v.Joi.number().integer().min(0).optional(),
      minAmount: amountInput.optional(),
      maxAmount: amountInput.allow(null).optional(),
      status: v.Joi.string().uppercase().valid(...STATUS_VALUES).optional(),
      isFeatured: v.Joi.boolean().optional(),
      sortOrder: v.Joi.number().integer().optional(),
      description: v.Joi.string().allow('', null).optional(),
      meta: v.Joi.object().unknown(true).allow(null).optional(),
    })
      .min(1)
      .unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await updatePackage(Number(req.params.id), req.body, {
        actorId: req.user.id,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to update package', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /admin/staking/positions:
 *   get:
 *     summary: List staking positions across the platform
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *       - in: query
 *         name: userId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: packageId
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Position list with user metadata
 */
router.get(
  '/positions',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      status: v.Joi.string().uppercase().valid('ACTIVE', 'COMPLETED').optional(),
      userId: v.Joi.number().integer().positive().optional(),
      packageId: v.Joi.number().integer().positive().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const rows = await adminListPositions({
        status: req.query.status,
        userId: req.query.userId,
        packageId: req.query.packageId,
      });
      ok(res, rows);
    } catch (err) {
      fail(res, err.message || 'Failed to load positions', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /admin/staking/positions/{id}/payout:
 *   post:
 *     summary: Credit accrued rewards for a specific position without unstaking
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
 *         description: Position payload with payout details
 */
router.post(
  '/positions/:id/payout',
  guard,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      id: v.Joi.number().integer().positive().required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await payoutPositionRewards({
        positionId: Number(req.params.id),
        actorId: req.user.id,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to payout rewards for position', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /admin/staking/payouts/run:
 *   post:
 *     summary: Process periodic reward payouts for active positions
 *     security:
 *       - bearerAuth: []
 *     tags: [Staking]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               limit:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 500
 *                 default: 50
 *     responses:
 *       200:
 *         description: Summary of processed payouts
 */
router.post(
  '/payouts/run',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      limit: v.Joi.number().integer().min(1).max(500).default(50),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await processRewardPayouts({
        limit: req.body?.limit,
        actorId: req.user.id,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to process reward payouts', err.status || 400);
    }
  }
);

export default router;
