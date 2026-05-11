import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { v } from '../../middleware/validate.js';
import { ok, fail } from '../../utils/responses.js';
import {
  createSignalPackage,
  getSignalPackageModule,
  updateSignalPackage,
  updateSignalPackageSettings,
} from '../../services/signalPackageService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

const decimalField = () => v.Joi.alternatives().try(v.Joi.number().min(0), v.Joi.string().trim());

router.get('/', guard, async (_req, res) => {
  try {
    ok(res, await getSignalPackageModule());
  } catch (err) {
    fail(res, err.message || 'Failed to load package settings', err.status || 400);
  }
});

router.put(
  '/settings',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      minDeposit: decimalField().optional(),
      maxDeposit: decimalField().optional(),
      investmentPerTradePct: decimalField().optional(),
      perTradeProfitPct: decimalField().optional(),
      dailyRoiPct: decimalField().optional(),
      unlimitedLastPackage: v.Joi.boolean().optional(),
      autoPackageAssignment: v.Joi.boolean().optional(),
      packageUpgradeAllowed: v.Joi.boolean().optional(),
    })
      .min(1)
      .unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await updateSignalPackageSettings(req.body));
    } catch (err) {
      fail(res, err.message || 'Unable to update package settings', err.status || 400);
    }
  }
);

router.post(
  '/packages',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      name: v.Joi.string().trim().max(120).required(),
      minAmount: decimalField().required(),
      maxAmount: decimalField().allow(null, '').optional(),
      unlimitedMax: v.Joi.boolean().required(),
      perTradeCommissionPct: decimalField().required(),
      signalsPerDay: v.Joi.number().integer().min(1).required(),
      requiredLevel: v.Joi.number().integer().min(0).required(),
      status: v.Joi.string().trim().uppercase().valid('ACTIVE', 'INACTIVE').required(),
      description: v.Joi.string().allow('', null).max(5000).optional(),
      sortOrder: v.Joi.number().integer().min(0).required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await createSignalPackage(req.body), 201);
    } catch (err) {
      fail(res, err.message || 'Unable to create package', err.status || 400);
    }
  }
);

router.patch(
  '/packages/:id',
  guard,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      id: v.Joi.number().integer().positive().required(),
    }).unknown(false),
    [v.Segments.BODY]: v.Joi.object({
      name: v.Joi.string().trim().max(120).optional(),
      minAmount: decimalField().optional(),
      maxAmount: decimalField().allow(null, '').optional(),
      unlimitedMax: v.Joi.boolean().optional(),
      perTradeCommissionPct: decimalField().optional(),
      signalsPerDay: v.Joi.number().integer().min(1).optional(),
      requiredLevel: v.Joi.number().integer().min(0).optional(),
      status: v.Joi.string().trim().uppercase().valid('ACTIVE', 'INACTIVE').optional(),
      description: v.Joi.string().allow('', null).max(5000).optional(),
      sortOrder: v.Joi.number().integer().min(0).optional(),
    })
      .min(1)
      .unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await updateSignalPackage(Number(req.params.id), req.body));
    } catch (err) {
      fail(res, err.message || 'Unable to update package', err.status || 400);
    }
  }
);

export default router;
