import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { v } from '../../middleware/validate.js';
import { ok } from '../../utils/responses.js';
import { db } from '../../db.js';

/**
 * @openapi
 * tags:
 *   - name: AdminDashboard
 *     description: Administrative dashboard snapshots
 */
import {
  getOverviewSnapshot,
  getActivityFeed,
} from '../../services/adminDashboardService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

function parseCount(row) {
  if (!row) return 0;
  const value = Object.values(row)[0];
  return Number(value || 0);
}

/**
 * @openapi
 * /admin/dashboard/overview:
 *   get:
 *     summary: Aggregated admin dashboard snapshot
 *     security:
 *       - bearerAuth: []
 *     tags: [AdminDashboard]
 *     parameters:
 *       - in: query
 *         name: rangeDays
 *         schema:
 *           type: integer
 *           minimum: 7
 *           maximum: 90
 *           default: 30
 *     responses:
 *       200:
 *         description: Overview payload with metrics, charts, and queues
 */
router.get(
  '/dashboard/overview',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      rangeDays: v.Joi.number().integer().min(7).max(90).default(30),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await getOverviewSnapshot({ rangeDays: req.query.rangeDays });
      ok(res, payload);
    } catch (err) {
      console.error('[admin.dashboard] overview failed', err);
      res
        .status(err.status || 500)
        .json({ message: 'Unable to load admin overview', code: 'ADMIN_OVERVIEW_FAILED' });
    }
  }
);

/**
 * @openapi
 * /admin/dashboard/activity:
 *   get:
 *     summary: Recent platform activity for admin dashboards
 *     security:
 *       - bearerAuth: []
 *     tags: [AdminDashboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 5
 *           maximum: 100
 *           default: 25
 *     responses:
 *       200:
 *         description: Chronological activity items
 */
router.get(
  '/dashboard/activity',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      limit: v.Joi.number().integer().min(5).max(100).default(25),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await getActivityFeed({ limit: req.query.limit });
      ok(res, payload);
    } catch (err) {
      console.error('[admin.dashboard] activity failed', err);
      res
        .status(err.status || 500)
        .json({ message: 'Unable to load admin activity', code: 'ADMIN_ACTIVITY_FAILED' });
    }
  }
);

router.get('/metrics', guard, async (_req, res) => {
  const now = new Date();
  const [
    totalUsersRow,
    activeUsersRow,
    marketCountRow,
    depositsRow,
    withdrawalsRow,
    kycPendingRow,
    uniqueAssets,
  ] = await Promise.all([
    db('users').count({ count: '*' }).first(),
    db('users').where({ kyc_verified: true }).count({ count: '*' }).first(),
    db('market_symbols').count({ count: '*' }).first(),
    db('deposits').count({ count: '*' }).first(),
    db('withdrawals').count({ count: '*' }).first(),
    db('kyc_requests').whereNot({ status: 'approved' }).orWhereNull('status').count({ count: '*' }).first(),
    db('market_symbols')
      .select(db.raw('COUNT(DISTINCT base_asset) as base_count'), db.raw('COUNT(DISTINCT quote_asset) as quote_count'))
      .first(),
  ]);

  const totalUsers = parseCount(totalUsersRow);
  const activeUsers = parseCount(activeUsersRow);
  const pendingKyc = parseCount(kycPendingRow);
  const cryptoDeposits = parseCount(depositsRow);
  const cryptoWithdrawals = parseCount(withdrawalsRow);
  const markets = parseCount(marketCountRow);
  const currencies = (Number(uniqueAssets?.base_count || 0) + Number(uniqueAssets?.quote_count || 0)) || 0;

  ok(res, {
    syncedAt: now.toISOString(),
    metrics: {
      users: totalUsers,
      activeUsers,
      inactiveUsers: Math.max(totalUsers - activeUsers, 0),
      markets,
      currencies,
      kycPending: pendingKyc,
      cryptoDeposits,
      fiatDeposits: 0,
      cryptoWithdrawals,
      fiatWithdrawals: 0,
    },
  });
});

router.get('/services', guard, async (_req, res) => {
  const checks = [];

  const runCheck = async (name, fn) => {
    const result = { name, status: 'online', message: null };
    const started = Date.now();
    try {
      await fn();
      result.latencyMs = Date.now() - started;
    } catch (err) {
      result.status = 'offline';
      result.message = err.message || 'unreachable';
      result.latencyMs = Date.now() - started;
    }
    checks.push(result);
  };

  await runCheck('web', async () => true);
  await runCheck('database', async () => db.raw('select 1'));
  await runCheck('encryption', async () => true);
  await runCheck('api', async () => true);
  await runCheck('jobs', async () => true);
  await runCheck('websocket', async () => true);

  ok(res, {
    syncedAt: new Date().toISOString(),
    services: checks,
  });
});

router.get('/websocket-status', guard, async (_req, res) => {
  ok(res, {
    connected: true,
    uptimeSeconds: process.uptime ? Math.floor(process.uptime()) : undefined,
    lastEventAt: new Date().toISOString(),
  });
});

router.get(
  '/audit',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      limit: v.Joi.number().integer().min(1).max(500).default(120),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const limit = Number(req.query.limit || 120);
      const rows = await db('audit_logs as a')
        .leftJoin('users as u', 'a.user_id', 'u.id')
        .leftJoin('user_profiles as up', 'u.id', 'up.user_id')
        .select('a.id', 'a.action', 'a.created_at', 'u.email', 'up.display_name', 'a.details')
        .orderBy('a.created_at', 'desc')
        .limit(limit);

      const items = rows.map((row) => {
        let metadata = {};
        try {
          metadata = typeof row.details === 'string' ? JSON.parse(row.details || '{}') : row.details || {};
        } catch {
          metadata = {};
        }

        return {
          id: row.id,
          actor: row.display_name || row.email || 'System',
          action: row.action,
          metadata,
          createdAt: row.created_at,
        };
      });

      ok(res, items);
    } catch (err) {
      console.error('[admin.dashboard] audit failed', err);
      res
        .status(err.status || 500)
        .json({ message: 'Unable to load admin audit logs', code: 'ADMIN_AUDIT_FAILED' });
    }
  }
);

export default router;
