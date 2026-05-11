import express from 'express';
import { db } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { v } from '../../middleware/validate.js';
import { ok, fail } from '../../utils/responses.js';
import {
  adminListWithdrawals,
  adminApproveWithdrawal,
  adminRejectWithdrawal,
  adminAdjustBalance,
  getBalances,
  listDepositAddresses,
  adminTransferBetweenWallets,
} from '../../services/walletService.js';
import {
  getAdminTreasuryOverview,
  getAdminTreasuryLiveBalances,
  listAdminDeposits,
  listAdminWalletDeposits,
  sweepTreasuryDeposits,
} from '../../services/adminTreasuryService.js';
import {
  confirmGasFunding,
  fundUserGas,
} from '../../services/gasFunding.service.js';
import {
  getCustodialTreasuryOverview,
  listGasFundingTransactions,
  listSweepTransactions,
  processPendingSweepsByNetwork,
  processSweep,
  queueEligibleSweeps,
  retryFailedSweep,
} from '../../services/sweep.service.js';
import { normalizeSweepNetwork } from '../../services/sweepNetwork.service.js';
import { getAdminUserWalletOverview } from '../../services/adminUserWalletOverview.service.js';
import {
  adminListFiatDeposits,
  adminReviewFiatDeposit,
} from '../../services/fiatFundingService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];
const WITHDRAW_QUEUE_STATUSES = ['pending', 'under_review', 'ready_to_send', 'insufficient_gas', 'insufficient_treasury_balance'];

function normalizeWalletAdminError(error, source = 'admin.wallet.unknown') {
  const rawMessage = String(error?.message || error || 'UNKNOWN_ADMIN_WALLET_ERROR');
  console.error(`[${source}] normalized wallet admin error`, {
    source,
    rawMessage,
    status: error?.status || null,
  });
  if (/owner_address isn't set/i.test(rawMessage)) {
    return 'TRON_OWNER_ADDRESS_NOT_SET';
  }
  return rawMessage;
}

router.get(
  '/user-wallet/deposits',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      page: v.Joi.number().integer().min(1).optional(),
      limit: v.Joi.number().integer().min(1).max(100).optional(),
      network: v.Joi.string().valid('ethereum', 'bsc', 'tron').optional(),
      status: v.Joi.string().trim().optional(),
      userId: v.Joi.number().integer().positive().optional(),
      txHash: v.Joi.string().trim().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await listAdminDeposits(req.query));
    } catch (err) {
      fail(res, err.message || 'Unable to load user wallet deposits', err.status || 400);
    }
  }
);

router.get(
  '/user-wallet/withdrawals',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      page: v.Joi.number().integer().min(1).optional(),
      limit: v.Joi.number().integer().min(1).max(100).optional(),
      status: v.Joi.string().trim().optional(),
      userId: v.Joi.number().integer().positive().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;
    const limit = Number(req.query.limit);
    const page = Number(req.query.page);
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    const processedStatuses = ['approved', 'rejected', 'cancelled', 'completed'];
    try {
      ok(
        res,
        await adminListWithdrawals({
          status: status || undefined,
          statuses: status ? undefined : processedStatuses,
          page: Number.isFinite(page) ? page : undefined,
          limit: Number.isFinite(limit) ? limit : undefined,
          userId,
        })
      );
    } catch (err) {
      fail(res, err.message || 'Unable to load user wallet withdrawals', err.status || 400);
    }
  }
);

router.get(
  '/admin-wallet/deposits',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      page: v.Joi.number().integer().min(1).optional(),
      limit: v.Joi.number().integer().min(1).max(100).optional(),
      network: v.Joi.string().valid('ethereum', 'bsc', 'tron').optional(),
      status: v.Joi.string().trim().optional(),
      userId: v.Joi.number().integer().positive().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await listAdminWalletDeposits(req.query));
    } catch (err) {
      fail(res, err.message || 'Unable to load admin wallet deposits', err.status || 400);
    }
  }
);

router.get(
  '/admin-wallet/withdraw-queue',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      page: v.Joi.number().integer().min(1).optional(),
      limit: v.Joi.number().integer().min(1).max(100).optional(),
      network: v.Joi.string().valid('ethereum', 'bsc', 'tron', 'ERC20', 'BEP20', 'TRC20').optional(),
      userId: v.Joi.number().integer().positive().optional(),
      fromDate: v.Joi.string().trim().optional(),
      toDate: v.Joi.string().trim().optional(),
      eligibleOnly: v.Joi.boolean().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    const limit = Number(req.query.limit);
    const page = Number(req.query.page);
    const userId = req.query.userId ? Number(req.query.userId) : undefined;
    try {
      const rows = await adminListWithdrawals({
        page: Number.isFinite(page) ? page : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        userId,
        statuses: WITHDRAW_QUEUE_STATUSES,
        network: req.query.network,
        fromDate: req.query.fromDate,
        toDate: req.query.toDate,
        eligibleOnly: req.query.eligibleOnly !== 'false',
      });
      ok(res, rows);
    } catch (err) {
      fail(res, err.message || 'Unable to load admin wallet withdraw queue', err.status || 400);
    }
  }
);

router.get('/admin-wallet/withdraw-queue/live-balances', guard, async (_req, res) => {
  try {
    ok(res, await getAdminTreasuryLiveBalances());
  } catch (err) {
    fail(res, err.message || 'Unable to load live admin wallet balances', err.status || 400);
  }
});

router.get('/withdrawals', guard, async (req, res) => {
  const status = req.query.status ? String(req.query.status).toLowerCase() : undefined;
  const limit = Number(req.query.limit);
  const userId = req.query.userId ? Number(req.query.userId) : undefined;
  try {
    ok(
      res,
      (await adminListWithdrawals({
        status,
        limit: Number.isFinite(limit) ? limit : undefined,
        userId,
      })).items
    );
  } catch (err) {
    fail(res, err.message || 'Unable to load withdrawals', err.status || 400);
  }
});

router.get(
  '/deposits',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      page: v.Joi.number().integer().min(1).optional(),
      limit: v.Joi.number().integer().min(1).max(100).optional(),
      network: v.Joi.string().valid('ethereum', 'bsc', 'tron').optional(),
      status: v.Joi.string().trim().optional(),
      userId: v.Joi.number().integer().positive().optional(),
      txHash: v.Joi.string().trim().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await listAdminDeposits(req.query));
    } catch (err) {
      fail(res, err.message || 'Unable to load deposits', err.status || 400);
    }
  }
);

router.get('/treasury', guard, async (_req, res) => {
  try {
    const [legacy, custodial] = await Promise.all([
      getAdminTreasuryOverview(),
      getCustodialTreasuryOverview(),
    ]);
    ok(res, {
      ...legacy,
      custodial,
    });
  } catch (err) {
    fail(res, err.message || 'Unable to load treasury', err.status || 400);
  }
});

router.post(
  '/treasury/sweep',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      network: v.Joi.string().valid('ethereum', 'bsc', 'tron').optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(
        res,
        await sweepTreasuryDeposits({
          network: req.body?.network,
          adminUserId: req.user.id,
        })
      );
    } catch (err) {
      fail(res, err.message || 'Unable to sweep treasury', err.status || 400);
    }
  }
);

router.get(
  '/admin-wallet/sweeps',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      page: v.Joi.number().integer().min(1).optional(),
      limit: v.Joi.number().integer().min(1).max(100).optional(),
      network: v.Joi.string().valid('ethereum', 'bsc', 'tron').optional(),
      status: v.Joi.string().trim().optional(),
      userId: v.Joi.number().integer().positive().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await listSweepTransactions(req.query));
    } catch (err) {
      fail(res, err.message || 'Unable to load sweeps', err.status || 400);
    }
  }
);

router.get(
  '/admin-wallet/gas-funding',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      page: v.Joi.number().integer().min(1).optional(),
      limit: v.Joi.number().integer().min(1).max(100).optional(),
      network: v.Joi.string().valid('ethereum', 'bsc', 'tron').optional(),
      status: v.Joi.string().trim().optional(),
      userId: v.Joi.number().integer().positive().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await listGasFundingTransactions(req.query));
    } catch (err) {
      fail(res, err.message || 'Unable to load gas funding queue', err.status || 400);
    }
  }
);

router.post('/admin-wallet/sweeps/run-eligible', guard, async (req, res) => {
  try {
    const network = normalizeSweepNetwork(req.body?.network);
    const queued = await queueEligibleSweeps({
      network: network || undefined,
      triggerType: 'manual',
    });
    const results = await processPendingSweepsByNetwork(network || undefined);
    ok(res, {
      queuedCount: queued.length,
      processedCount: results.length,
      items: results,
    });
  } catch (err) {
    fail(res, err.message || 'Unable to run eligible sweeps', err.status || 400);
  }
});

router.post('/admin-wallet/gas-funding/run-pending', guard, async (req, res) => {
  try {
    const queue = await listGasFundingTransactions({
      network: req.body?.network,
      status: 'sent',
      limit: 100,
    });
    const items = [];
    for (const row of queue.items) {
      items.push({ id: row.id, ...(await confirmGasFunding(row.id)) });
    }
    ok(res, { processedCount: items.length, items });
  } catch (err) {
    fail(res, err.message || 'Unable to run pending gas funding', err.status || 400);
  }
});

router.post('/admin-wallet/sweeps/:id/run', guard, async (req, res) => {
  try {
    ok(res, await processSweep(Number(req.params.id)));
  } catch (err) {
    console.error('[admin.wallet.sweeps.run]', {
      sweepId: Number(req.params.id),
      error: err?.message || err,
    });
    fail(res, normalizeWalletAdminError(err, 'admin.wallet.sweeps.run'), err.status || 400);
  }
});

router.post('/admin-wallet/sweeps/:id/retry', guard, async (req, res) => {
  try {
    ok(res, await retryFailedSweep(Number(req.params.id)));
  } catch (err) {
    console.error('[admin.wallet.sweeps.retry]', {
      sweepId: Number(req.params.id),
      error: err?.message || err,
    });
    fail(res, normalizeWalletAdminError(err, 'admin.wallet.sweeps.retry'), err.status || 400);
  }
});

router.post('/admin-wallet/gas-funding/:id/send', guard, async (req, res) => {
  try {
    const row = await db('gas_funding_transactions').where({ id: Number(req.params.id) }).first();
    if (!row) return fail(res, 'Gas funding row not found', 404);
    const walletRow = await db('user_wallets')
      .where({
        user_id: row.user_id,
        address: row.destination_user_wallet_address,
      })
      .first();
    if (!walletRow) return fail(res, 'User wallet not found', 404);
    ok(res, await fundUserGas(walletRow.id, row.network, { sweepId: row.sweep_transaction_id, force: true }));
  } catch (err) {
    console.error('[admin.wallet.gas-funding.send]', {
      fundingId: Number(req.params.id),
      error: err?.message || err,
    });
    fail(res, normalizeWalletAdminError(err, 'admin.wallet.gas-funding.send'), err.status || 400);
  }
});

router.post('/admin-wallet/gas-funding/:id/retry', guard, async (req, res) => {
  try {
    ok(res, await confirmGasFunding(Number(req.params.id)));
  } catch (err) {
    fail(res, normalizeWalletAdminError(err, 'admin.wallet.gas-funding.retry'), err.status || 400);
  }
});

router.post('/withdrawals/:id/approve', guard, async (req, res) => {
  const withdrawalId = Number(req.params.id);
  try {
    ok(
      res,
      await adminApproveWithdrawal({
        withdrawalId,
        txHash: req.body?.txHash,
        reviewerId: req.user.id,
      })
    );
  } catch (err) {
    fail(res, err.message || 'Unable to approve withdrawal', err.status || 400);
  }
});

router.post('/withdrawals/:id/reject', guard, async (req, res) => {
  const withdrawalId = Number(req.params.id);
  try {
    ok(
      res,
      await adminRejectWithdrawal({
        withdrawalId,
        reason: req.body?.reason,
        reviewerId: req.user.id,
      })
    );
  } catch (err) {
    fail(res, err.message || 'Unable to reject withdrawal', err.status || 400);
  }
});

router.post('/users/:userId/adjust', guard, async (req, res) => {
  const userId = Number(req.params.userId);
  const { asset, amount, namespace, operation, memo, orderId } = req.body || {};
  try {
    ok(
      res,
      await adminAdjustBalance({
        userId,
        asset,
        amount,
        namespace,
        operation,
        memo,
        orderId,
        reviewerId: req.user.id,
      })
    );
  } catch (err) {
    fail(res, err.message || 'Unable to adjust balance', err.status || 400);
  }
});

router.get('/users/:userId/balances', guard, async (req, res) => {
  const userId = Number(req.params.userId);
  try {
    ok(res, await getBalances(userId));
  } catch (err) {
    fail(res, err.message || 'Unable to load balances', err.status || 400);
  }
});

router.get('/users/:userId/overview', guard, async (req, res) => {
  const userId = Number(req.params.userId);
  try {
    ok(res, await getAdminUserWalletOverview(userId));
  } catch (err) {
    fail(res, err.message || 'Unable to load user wallet overview', err.status || 400);
  }
});

router.get('/users/:userId/deposit-addresses', guard, async (req, res) => {
  const userId = Number(req.params.userId);
  try {
    ok(res, await listDepositAddresses(userId));
  } catch (err) {
    fail(res, err.message || 'Unable to load deposit addresses', err.status || 400);
  }
});

router.post(
  '/users/:userId/transfer',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      from: v.Joi.string().valid('spot', 'futures').required(),
      to: v.Joi.string().valid('spot', 'futures').required(),
      asset: v.Joi.string().uppercase().max(16).required(),
      amount: v.Joi.number().positive().required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await adminTransferBetweenWallets({
        userId: Number(req.params.userId),
        from: req.body.from,
        to: req.body.to,
        asset: req.body.asset,
        amount: req.body.amount,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to transfer funds', err.status || 400);
    }
  }
);

router.get(
  '/fiat/deposits',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      status: v.Joi.string().trim().optional(),
      method: v.Joi.string().trim().optional(),
      userId: v.Joi.number().integer().positive().optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(
        res,
        await adminListFiatDeposits({
          status: req.query.status,
          method: req.query.method,
          userId: req.query.userId,
        })
      );
    } catch (err) {
      fail(res, err.message || 'Unable to load fiat deposits', err.status || 400);
    }
  }
);

router.post('/fiat/deposits/:id/approve', guard, async (req, res) => {
  try {
    ok(
      res,
      await adminReviewFiatDeposit({
        depositId: Number(req.params.id),
        action: 'approve',
        reviewerId: req.user.id,
        notes: req.body?.notes,
      })
    );
  } catch (err) {
    fail(res, err.message || 'Unable to approve deposit', err.status || 400);
  }
});

router.post('/fiat/deposits/:id/reject', guard, async (req, res) => {
  try {
    ok(
      res,
      await adminReviewFiatDeposit({
        depositId: Number(req.params.id),
        action: 'reject',
        reviewerId: req.user.id,
        notes: req.body?.notes,
      })
    );
  } catch (err) {
    fail(res, err.message || 'Unable to reject deposit', err.status || 400);
  }
});

export default router;
