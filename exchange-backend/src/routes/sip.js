import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { v } from '../middleware/validate.js';
import { ok, fail } from '../utils/responses.js';
import {
  getCatalog,
  previewContribution,
  createSubscription,
  listSubscriptions,
  getSubscriptionById,
  updateSubscriptionStatus,
  recentOrdersForUser,
  listOrders,
} from '../services/sipService.js';

const router = express.Router();

const previewSchema = v.Joi.object({
  planId: v.Joi.number().integer().positive().optional(),
  asset: v.Joi.string().trim().uppercase().required(),
  quoteCurrency: v.Joi.string().trim().uppercase().optional(),
  contributionType: v.Joi.string().trim().uppercase().valid('AMOUNT', 'QUANTITY').required(),
  amountFiat: v.Joi.when('contributionType', {
    is: 'AMOUNT',
    then: v.Joi.number().positive().required(),
    otherwise: v.Joi.number().positive().allow(null).optional(),
  }),
  amountAsset: v.Joi.when('contributionType', {
    is: 'QUANTITY',
    then: v.Joi.number().positive().required(),
    otherwise: v.Joi.number().positive().allow(null).optional(),
  }),
  frequency: v.Joi.string().trim().uppercase().optional(),
  walletSource: v.Joi.string().max(64).default('spot:available'),
}).unknown(false);

router.get('/catalog', requireAuth, async (_req, res) => {
  try {
    const payload = await getCatalog();
    ok(res, payload);
  } catch (err) {
    fail(res, err.message || 'Failed to load SIP catalog', err.status || 400);
  }
});

router.post(
  '/preview',
  requireAuth,
  v.celebrate({ [v.Segments.BODY]: previewSchema }),
  async (req, res) => {
    try {
      const preview = await previewContribution(req.body, {
        userId: req.user.id,
        walletSource: req.body.walletSource,
      });
      ok(res, preview);
    } catch (err) {
      fail(res, err.message || 'Unable to preview SIP contribution', err.status || 400);
    }
  }
);

router.post(
  '/subscriptions',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: previewSchema.keys({
      startAt: v.Joi.date().optional(),
      autoPauseOnFail: v.Joi.boolean().optional(),
      walletSource: v.Joi.string().max(64).optional(),
      meta: v.Joi.object().unknown(true).optional(),
    }),
  }),
  async (req, res) => {
    try {
      const subscription = await createSubscription(req.body, { userId: req.user.id });
      ok(res, subscription, 201);
    } catch (err) {
      fail(res, err.message || 'Unable to create SIP subscription', err.status || 400);
    }
  }
);

router.get('/subscriptions', requireAuth, async (req, res) => {
  try {
    const subs = await listSubscriptions({ userId: req.user.id });
    ok(res, subs);
  } catch (err) {
    fail(res, err.message || 'Failed to load SIP subscriptions', err.status || 400);
  }
});

router.get(
  '/subscriptions/:id',
  requireAuth,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      id: v.Joi.number().integer().positive().required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const subscription = await getSubscriptionById(Number(req.params.id), {
        userId: req.user.id,
      });
      if (!subscription) return fail(res, 'Subscription not found', 404);
      ok(res, subscription);
    } catch (err) {
      fail(res, err.message || 'Failed to load subscription', err.status || 400);
    }
  }
);

function statusHandler(action) {
  return [
    requireAuth,
    v.celebrate({
      [v.Segments.PARAMS]: v.Joi.object({
        id: v.Joi.number().integer().positive().required(),
      }).unknown(false),
    }),
    async (req, res) => {
      try {
        const updated = await updateSubscriptionStatus(Number(req.params.id), action, {
          userId: req.user.id,
        });
        ok(res, updated);
      } catch (err) {
        fail(res, err.message || 'Unable to update subscription', err.status || 400);
      }
    },
  ];
}

router.post('/subscriptions/:id/pause', ...statusHandler('PAUSE'));
router.post('/subscriptions/:id/resume', ...statusHandler('RESUME'));
router.post('/subscriptions/:id/cancel', ...statusHandler('CANCEL'));

router.get(
  '/orders/recent',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      limit: v.Joi.number().integer().min(1).max(50).optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const orders = await recentOrdersForUser(req.user.id, req.query.limit || 10);
      ok(res, orders);
    } catch (err) {
      fail(res, err.message || 'Failed to load SIP orders', err.status || 400);
    }
  }
);

router.get(
  '/history',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      limit: v.Joi.number().integer().min(1).max(200).default(50),
      status: v.Joi.string().trim().uppercase().optional(),
      subscriptionId: v.Joi.number().integer().positive().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const orders = await listOrders({
        userId: req.user.id,
        limit: req.query.limit,
        status: req.query.status,
        subscriptionId: req.query.subscriptionId,
      });
      ok(res, orders);
    } catch (err) {
      fail(res, err.message || 'Failed to load SIP history', err.status || 400);
    }
  }
);

export default router;
