/**
 * Admin futures management routes.
 * Mirrors the public futures endpoints but allows the console to act on behalf
 * of any user (requires admin role).
 */

import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok, fail } from '../../utils/responses.js';
import { v } from '../../middleware/validate.js';
import * as futures from '../../services/futuresService.js';

const router = express.Router();
const adminGuard = [requireAuth, requireRole('admin')];

function parseUserId(param) {
  const id = Number(param);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('INVALID_USER_ID');
    err.status = 400;
    throw err;
  }
  return id;
}

router.get('/contracts', adminGuard, async (_req, res) => {
  ok(res, await futures.contracts({ includeDisabled: true }));
});

router.patch(
  '/contracts/:symbol',
  adminGuard,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      symbol: v.Joi.string().trim().required(),
    }),
    [v.Segments.BODY]: v.Joi.object({
      enabled: v.Joi.alternatives().try(
        v.Joi.boolean(),
        v.Joi.string().valid('true', 'false', '1', '0').insensitive()
      ),
      isEnabled: v.Joi.alternatives().try(
        v.Joi.boolean(),
        v.Joi.string().valid('true', 'false', '1', '0').insensitive()
      ),
      status: v.Joi.string().valid('enabled', 'disabled', 'enable', 'disable', 'on', 'off').insensitive(),
      minLeverage: v.Joi.number().integer().min(1),
      maxLeverage: v.Joi.number().integer().min(1),
    })
      .min(1)
      .unknown(true),
  }),
  async (req, res) => {
    try {
      const updated = await futures.updateContractControls(req.params.symbol, req.body);
      ok(res, updated);
    } catch (err) {
      fail(res, err.message || 'UPDATE_FAILED', err.status || 400);
    }
  }
);

router.get('/mark/:symbol', adminGuard, async (req, res) => {
  ok(res, await futures.mark(req.params.symbol));
});

router.get('/funding/:symbol', adminGuard, async (req, res) => {
  ok(res, await futures.funding(req.params.symbol));
});

router.get('/history/:symbol', adminGuard, async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  ok(res, await futures.history(req.params.symbol, limit));
});

router.get('/users/:userId/account', adminGuard, async (req, res) => {
  const userId = parseUserId(req.params.userId);
  ok(res, await futures.account(userId));
});

router.get('/users/:userId/positions', adminGuard, async (req, res) => {
  const userId = parseUserId(req.params.userId);
  const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
  ok(res, await futures.positions(userId, { status }));
});

router.get(
  '/users/:userId/trades',
  adminGuard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      limit: v.Joi.number().integer().min(1).max(200).default(20),
      cursor: v.Joi.number().integer().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    const userId = parseUserId(req.params.userId);
    ok(
      res,
      await futures.trades(userId, {
        limit: req.query.limit,
        cursor: req.query.cursor,
      })
    );
  }
);

router.post('/users/:userId/open', adminGuard, async (req, res) => {
  const userId = parseUserId(req.params.userId);
  try {
    ok(res, await futures.openPosition(userId, req.body));
  } catch (err) {
    fail(res, err.message || 'OPEN_FAILED', err.status || 400);
  }
});

router.post('/users/:userId/update-triggers', adminGuard, async (req, res) => {
  const userId = parseUserId(req.params.userId);
  try {
    await futures.updateTriggers(userId, req.body);
    ok(res, { updated: true });
  } catch (err) {
    fail(res, err.message || 'UPDATE_FAILED', err.status || 400);
  }
});

router.post('/users/:userId/close', adminGuard, async (req, res) => {
  const userId = parseUserId(req.params.userId);
  try {
    ok(res, await futures.close(userId, req.body));
  } catch (err) {
    fail(res, err.message || 'CLOSE_FAILED', err.status || 400);
  }
});

export default router;
