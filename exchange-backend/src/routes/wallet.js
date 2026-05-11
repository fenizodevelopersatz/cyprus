import express from 'express';
import { v } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { ok, fail } from '../utils/responses.js';
import {
  getDepositAddressWithQr,
  getBalances,
  requestWithdrawal,
  getFundingHistory,
  listDepositAddresses,
  transferBetweenWallets,
} from '../services/walletService.js';
import { syncExplorerDepositsForUser } from '../services/depositExplorerService.js';
import {
  createFiatDeposit,
  listUserFiatDeposits,
  createFiatCheckoutSession,
  verifyCheckoutSession,
} from '../services/fiatFundingService.js';

const router = express.Router();

/**
 * @openapi
 * tags:
 *   - name: Wallet
 *     description: Custodial wallet operations
 */

/**
 * @openapi
 * /api/wallet/balances:
 *   get:
 *     summary: Get custodial account balances
 *     security:
 *       - bearerAuth: []
 *     tags: [Wallet]
 *     responses:
 *       200:
 *         description: Balances grouped by market
 */
router.get('/balances', requireAuth, async (req, res) => {
  try {
    const balances = await getBalances(req.user.id);
    ok(res, balances);
  } catch (err) {
    fail(res, err.message || 'Failed to load balances', 400);
  }
});

/**
 * @openapi
 * /api/wallet/deposit-address:
 *   get:
 *     summary: Fetch or generate a deposit address
 *     security:
 *       - bearerAuth: []
 *     tags: [Wallet]
 *     parameters:
 *       - in: query
 *         name: chain
 *         schema:
 *           type: string
 *           enum: [ETH, BSC]
 *         required: false
 *     responses:
 *       200:
 *         description: Deposit address payload
 */
router.get(
  '/deposit-address',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      chain: v.Joi.string().trim().uppercase().default('BEP20'),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await getDepositAddressWithQr({
        userId: req.user.id,
        chain: req.query.chain,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Failed to generate deposit address', 400);
    }
  }
);

router.get('/deposit-addresses', requireAuth, async (req, res) => {
  try {
    const addresses = await listDepositAddresses(req.user.id);
    ok(res, addresses);
  } catch (err) {
    fail(res, err.message || 'Failed to load addresses', 400);
  }
});

/**
 * @openapi
 * /api/wallet/history:
 *   get:
 *     summary: Funding history
 *     security:
 *       - bearerAuth: []
 *     tags: [Wallet]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 25
 *     responses:
 *       200:
 *         description: Combined deposits and withdrawals
 */
router.get(
  '/history',
  requireAuth,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      limit: v.Joi.number().integer().min(1).max(100).optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const history = await getFundingHistory(req.user.id, {
        limit: req.query.limit,
      });
      ok(res, history);
    } catch (err) {
      fail(res, err.message || 'Failed to load funding history', 400);
    }
  }
);

router.post(
  '/history/refresh',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      network: v.Joi.string().valid('ERC20', 'BEP20', 'TRC20').required(),
      limit: v.Joi.number().integer().min(1).max(100).optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const sync = await syncExplorerDepositsForUser(req.user.id, req.body.network);
      const history = await getFundingHistory(req.user.id, {
        limit: req.body.limit,
      });
      ok(res, {
        sync,
        history,
      });
    } catch (err) {
      fail(res, err.message || 'Failed to refresh deposit history', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /api/wallet/transfer:
 *   post:
 *     summary: Move funds between spot and futures wallets
 *     security:
 *       - bearerAuth: []
 *     tags: [Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [from, to, asset, amount]
 *             properties:
 *               from:
 *                 type: string
 *                 enum: [spot, futures]
 *               to:
 *                 type: string
 *                 enum: [spot, futures]
 *               asset:
 *                 type: string
 *                 example: USDT
 *               amount:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: Transfer summary
 */
router.post(
  '/transfer',
  requireAuth,
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
      const payload = await transferBetweenWallets({
        userId: req.user.id,
        from: req.body.from,
        to: req.body.to,
        asset: req.body.asset,
        amount: req.body.amount,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Transfer failed', err.status || 400);
    }
  }
);

/**
 * @openapi
 * /api/wallet/withdrawals:
 *   post:
 *     summary: Submit a withdrawal request
 *     security:
 *       - bearerAuth: []
 *     tags: [Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [asset, amount, to]
 *             properties:
 *               asset:
 *                 type: string
 *                 example: USDT
 *               amount:
 *                 type: number
 *                 minimum: 0
 *               to:
 *                 type: string
 *               chain:
 *                 type: string
 *                 enum: [ETH, BSC]
 *     responses:
 *       200:
 *         description: Withdrawal request summary
 */
router.post(
  '/withdrawals',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      asset: v.Joi.string().uppercase().trim().required(),
      amount: v.Joi.number().positive().required(),
      to: v.Joi.string().trim().required(),
      chain: v.Joi.string().trim().uppercase().required(),
      memo: v.Joi.string().trim().max(191).allow('', null).optional(),
      details: v.Joi.string().trim().max(2000).allow('', null).optional(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await requestWithdrawal({
        userId: req.user.id,
        asset: req.body.asset,
        amount: req.body.amount,
        to: req.body.to,
        chain: req.body.chain,
        memo: req.body.memo,
        details: req.body.details,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Withdrawal request failed', 400);
    }
  }
);

router.get('/fiat/deposits', requireAuth, async (req, res) => {
  try {
    const deposits = await listUserFiatDeposits(req.user.id, {
      status: req.query?.status,
    });
    ok(res, deposits);
  } catch (err) {
    fail(res, err.message || 'Failed to load fiat deposits', err.status || 400);
  }
});

router.post(
  '/fiat/deposits',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      method: v.Joi.string().valid('stripe', 'bank').required(),
      amount: v.Joi.number().positive().required(),
      currency: v.Joi.string().uppercase().max(8).default('USD'),
      wallet: v.Joi.string().valid('spot', 'futures').default('spot'),
      reference: v.Joi.string().max(191).allow('', null),
      proofUrl: v.Joi.when('method', {
        is: 'bank',
        then: v.Joi.string().uri().required(),
        otherwise: v.Joi.string().uri().allow('', null),
      }),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await createFiatDeposit({
        userId: req.user.id,
        method: req.body.method,
        amount: req.body.amount,
        currency: req.body.currency,
        wallet: req.body.wallet,
        reference: req.body.reference,
        proofUrl: req.body.proofUrl,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to create fiat deposit', err.status || 400, err.meta);
    }
  }
);

router.post(
  '/fiat/checkout',
  requireAuth,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      amount: v.Joi.number().positive().required(),
      wallet: v.Joi.string().valid('spot', 'futures').default('spot'),
      currency: v.Joi.string().uppercase().max(8).default('USD'),
      reference: v.Joi.string().max(191).allow('', null),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await createFiatCheckoutSession({
        userId: req.user.id,
        amount: req.body.amount,
        wallet: req.body.wallet,
        currency: req.body.currency,
        reference: req.body.reference,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to start Stripe checkout', err.status || 400, err.meta);
    }
  }
);

router.get(
  '/fiat/checkout/:sessionId',
  requireAuth,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      sessionId: v.Joi.string().required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      const payload = await verifyCheckoutSession({
        userId: req.user.id,
        sessionId: req.params.sessionId,
      });
      ok(res, payload);
    } catch (err) {
      fail(res, err.message || 'Unable to verify checkout session', err.status || 400, err.meta);
    }
  }
);

export default router;
