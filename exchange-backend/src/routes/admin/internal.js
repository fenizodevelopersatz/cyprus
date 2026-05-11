import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok } from '../../utils/responses.js';
import { rebuildUserEligibleLevelsDaily, processDailyRecurringBonusCron } from '../../services/mlmLevelService.js';
import { runDepositMonitorCycleNow } from '../../services/depositMonitorService.js';
import { evaluateAutoClosePositions } from '../../services/futuresService.js';
import { closeExpiredSignalTrades } from '../../services/userSignalService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

const MANUAL_CRON_JOBS = {
  mlm_backup_rebuild: {
    key: 'mlm_backup_rebuild',
    label: 'MLM Backup Rebuild',
    description: 'Rebuild all MLM eligible levels and summary snapshots.',
    method: 'POST',
    path: '/admin/internal/cron-jobs/mlm_backup_rebuild/run',
    samplePayload: {},
    run: async () => {
      const results = await rebuildUserEligibleLevelsDaily();
      return {
        processedUsers: Array.isArray(results) ? results.length : 0,
      };
    },
  },
  mlm_level_bonus_payout: {
    key: 'mlm_level_bonus_payout',
    label: 'MLM Bonus Payout Scan',
    description: 'Scan and process due recurring MLM bonus payouts.',
    method: 'POST',
    path: '/admin/internal/cron-jobs/mlm_level_bonus_payout/run',
    samplePayload: {},
    run: async () => {
      const results = await processDailyRecurringBonusCron();
      return {
        processedPayouts: Array.isArray(results) ? results.length : 0,
      };
    },
  },
  deposit_monitor: {
    key: 'deposit_monitor',
    label: 'Deposit Monitor Poll',
    description: 'Run one deposit monitor polling cycle across configured networks.',
    method: 'POST',
    path: '/admin/internal/cron-jobs/deposit_monitor/run',
    samplePayload: {},
    run: async () => runDepositMonitorCycleNow(),
  },
  futures_auto_close: {
    key: 'futures_auto_close',
    label: 'Futures Auto Close',
    description: 'Evaluate and auto-close eligible futures positions.',
    method: 'POST',
    path: '/admin/internal/cron-jobs/futures_auto_close/run',
    samplePayload: { limit: 50 },
    run: async (payload) => {
      const limit = Number(payload?.limit) || 50;
      const results = await evaluateAutoClosePositions(limit);
      return {
        evaluatedLimit: limit,
        processedCount: Array.isArray(results) ? results.length : 0,
      };
    },
  },
  signal_auto_close: {
    key: 'signal_auto_close',
    label: 'Signal Auto Close',
    description: 'Close expired signal trades now.',
    method: 'POST',
    path: '/admin/internal/cron-jobs/signal_auto_close/run',
    samplePayload: { limit: 25 },
    run: async (payload) => {
      const limit = Number(payload?.limit) || 25;
      const results = await closeExpiredSignalTrades(limit);
      return {
        evaluatedLimit: limit,
        processedCount: Array.isArray(results) ? results.length : 0,
      };
    },
  },
};

router.get('/internal/cron-jobs', guard, async (_req, res) => {
  ok(
    res,
    Object.values(MANUAL_CRON_JOBS).map(({ run, ...job }) => job)
  );
});

router.post('/internal/cron-jobs/:jobKey/run', guard, async (req, res) => {
  const job = MANUAL_CRON_JOBS[String(req.params.jobKey || '').trim()];
  if (!job) {
    return res.status(404).json({ error: 'CRON_JOB_NOT_FOUND' });
  }

  try {
    const startedAt = new Date().toISOString();
    const result = await job.run(req.body || {});
    ok(res, {
      jobKey: job.key,
      startedAt,
      completedAt: new Date().toISOString(),
      result,
    });
  } catch (err) {
    res.status(400).json({
      error: 'CRON_JOB_RUN_FAILED',
      jobKey: job.key,
      message: err?.message || 'Unable to run manual cron job',
    });
  }
});

export default router;
