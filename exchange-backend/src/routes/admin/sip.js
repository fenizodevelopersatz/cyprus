import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { v } from '../../middleware/validate.js';
import { ok, fail } from '../../utils/responses.js';
import {
  listPlans,
  createPlan,
  updatePlan,
  listSubscriptions,
  updateSubscriptionStatus,
  listOrders,
} from '../../services/sipService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

router.get(
  '/plans',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      status: v.Joi.string().trim().uppercase().optional(),
      quoteCurrency: v.Joi.string().trim().uppercase().optional(),
      includeArchived: v.Joi.boolean().default(false),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const plans = await listPlans({
        status: req.query.status,
        quoteCurrency: req.query.quoteCurrency,
        includeArchived: req.query.includeArchived,
      });
      ok(res, plans);
    } catch (err) {
      fail(res, err.message || 'Failed to load SIP plans', err.status || 400);
    }
  }
);

router.post(
  '/plans',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      asset: v.Joi.string().trim().uppercase().required(),
      quoteCurrency: v.Joi.string().trim().uppercase().required(),
      nickname: v.Joi.string().max(128).required(),
      description: v.Joi.string().allow('', null).optional(),
      status: v.Joi.string().trim().uppercase().optional(),
      minFiatAmount: v.Joi.number().min(0).optional(),
      maxFiatAmount: v.Joi.number().min(0).allow(null).optional(),
      minAssetQuantity: v.Joi.number().min(0).optional(),
      maxAssetQuantity: v.Joi.number().min(0).allow(null).optional(),
      allowedFrequencies: v.Joi.array().items(v.Joi.string().trim().uppercase()).optional(),
      allowAmountInput: v.Joi.boolean().optional(),
      allowQuantityInput: v.Joi.boolean().optional(),
      sortOrder: v.Joi.number().integer().optional(),
      meta: v.Joi.object().unknown(true).optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const plan = await createPlan(req.body);
      ok(res, plan, 201);
    } catch (err) {
      fail(res, err.message || 'Unable to create SIP plan', err.status || 400);
    }
  }
);

router.patch(
  '/plans/:id',
  guard,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      id: v.Joi.number().integer().positive().required(),
    }).unknown(false),
    [v.Segments.BODY]: v.Joi.object({
      asset: v.Joi.string().trim().uppercase().optional(),
      quoteCurrency: v.Joi.string().trim().uppercase().optional(),
      nickname: v.Joi.string().max(128).optional(),
      description: v.Joi.string().allow('', null).optional(),
      status: v.Joi.string().trim().uppercase().optional(),
      minFiatAmount: v.Joi.number().min(0).allow(null).optional(),
      maxFiatAmount: v.Joi.number().min(0).allow(null).optional(),
      minAssetQuantity: v.Joi.number().min(0).allow(null).optional(),
      maxAssetQuantity: v.Joi.number().min(0).allow(null).optional(),
      allowedFrequencies: v.Joi.array().items(v.Joi.string().trim().uppercase()).optional(),
      allowAmountInput: v.Joi.boolean().optional(),
      allowQuantityInput: v.Joi.boolean().optional(),
      sortOrder: v.Joi.number().integer().optional(),
      meta: v.Joi.object().unknown(true).allow(null).optional(),
    })
      .min(1)
      .unknown(false),
  }),
  async (req, res) => {
    try {
      const plan = await updatePlan(Number(req.params.id), req.body);
      ok(res, plan);
    } catch (err) {
      fail(res, err.message || 'Unable to update SIP plan', err.status || 400);
    }
  }
);

router.get(
  '/subscriptions',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      status: v.Joi.string().trim().uppercase().optional(),
      userId: v.Joi.number().integer().positive().optional(),
      planId: v.Joi.number().integer().positive().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const subs = await listSubscriptions({
        status: req.query.status,
        userId: req.query.userId,
        planId: req.query.planId,
      });
      ok(res, subs);
    } catch (err) {
      fail(res, err.message || 'Failed to load SIP subscriptions', err.status || 400);
    }
  }
);

router.patch(
  '/subscriptions/:id/status',
  guard,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      id: v.Joi.number().integer().positive().required(),
    }).unknown(false),
    [v.Segments.BODY]: v.Joi.object({
      action: v.Joi.string().trim().uppercase().valid('PAUSE', 'RESUME', 'CANCEL').required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const updated = await updateSubscriptionStatus(Number(req.params.id), req.body.action, {
        actorId: req.user.id,
      });
      ok(res, updated);
    } catch (err) {
      fail(res, err.message || 'Unable to update subscription', err.status || 400);
    }
  }
);

router.get(
  '/orders',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      status: v.Joi.string().trim().uppercase().optional(),
      userId: v.Joi.number().integer().positive().optional(),
      subscriptionId: v.Joi.number().integer().positive().optional(),
      limit: v.Joi.number().integer().min(1).max(200).optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const orders = await listOrders({
        status: req.query.status,
        userId: req.query.userId,
        subscriptionId: req.query.subscriptionId,
        limit: req.query.limit,
      });
      ok(res, orders);
    } catch (err) {
      fail(res, err.message || 'Failed to load SIP orders', err.status || 400);
    }
  }
);

export default router;
