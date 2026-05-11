import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { v } from '../../middleware/validate.js';
import { ok, fail } from '../../utils/responses.js';
import {
  adminOpenOrders,
  adminRecentOrders,
  adminRecentTrades,
} from '../../services/orderService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

const filtersSchema = v.Joi.object({
  userId: v.Joi.number().integer().positive().optional(),
  search: v.Joi.string().max(191).optional(),
  symbol: v.Joi.string().uppercase().max(24).optional(),
  limit: v.Joi.number().integer().min(1).max(500).optional(),
});

router.get(
  '/live',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: filtersSchema,
  }),
  async (req, res) => {
    try {
      ok(res, await adminOpenOrders(req.query));
    } catch (err) {
      fail(res, err.message || 'Unable to load live orders', err.status || 400);
    }
  }
);

router.get(
  '/recent',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: filtersSchema.keys({
      status: v.Joi.string().uppercase().optional(),
    }),
  }),
  async (req, res) => {
    try {
      ok(res, await adminRecentOrders(req.query));
    } catch (err) {
      fail(res, err.message || 'Unable to load recent orders', err.status || 400);
    }
  }
);

router.get(
  '/trades',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: filtersSchema,
  }),
  async (req, res) => {
    try {
      ok(res, await adminRecentTrades(req.query));
    } catch (err) {
      fail(res, err.message || 'Unable to load trades', err.status || 400);
    }
  }
);

export default router;

