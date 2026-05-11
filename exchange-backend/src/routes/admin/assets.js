import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/roles.js';
import { ok, fail } from '../../utils/responses.js';
import { v } from '../../middleware/validate.js';
import { listSignalAssets, createSignalAsset, updateSignalAsset } from '../../services/signalAssetService.js';

const router = express.Router();
const guard = [requireAuth, requireRole('admin')];

const bodySchema = {
  asset: v.Joi.string().trim().uppercase().max(16),
  network: v.Joi.string().trim().uppercase().max(32),
  displayName: v.Joi.string().trim().max(120),
  networkType: v.Joi.string().trim().uppercase().valid('EVM', 'TRON'),
  minDeposit: v.Joi.alternatives().try(v.Joi.number().min(0), v.Joi.string().trim()),
  minWithdraw: v.Joi.alternatives().try(v.Joi.number().min(0), v.Joi.string().trim()),
  withdrawFeeType: v.Joi.string().trim().uppercase().valid('FIXED', 'PERCENT'),
  withdrawFee: v.Joi.alternatives().try(v.Joi.number().min(0), v.Joi.string().trim()),
  rpcUrl: v.Joi.string().allow('', null).max(255),
  chainId: v.Joi.string().allow('', null).max(64),
  contractAddress: v.Joi.string().allow('', null).max(191),
  decimals: v.Joi.number().integer().min(0).max(30),
  depositWallet: v.Joi.string().allow('', null).max(191),
  hotWallet: v.Joi.string().allow('', null).max(191),
  privateKey: v.Joi.string().allow('', null),
  confirmations: v.Joi.number().integer().min(0).max(999),
  fullHost: v.Joi.string().allow('', null).max(255),
  status: v.Joi.string().trim().uppercase().valid('ENABLED', 'DISABLED'),
  isEnabled: v.Joi.boolean(),
  sortOrder: v.Joi.number().integer().min(0).max(9999),
  meta: v.Joi.object().unknown(true).allow(null),
};

router.get(
  '/',
  guard,
  v.celebrate({
    [v.Segments.QUERY]: v.Joi.object({
      status: v.Joi.string().trim().uppercase().valid('ENABLED', 'DISABLED').optional(),
      asset: v.Joi.string().trim().uppercase().max(16).optional(),
      includeDisabled: v.Joi.boolean().default(true),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await listSignalAssets(req.query));
    } catch (err) {
      fail(res, err.message || 'Failed to load signal assets', err.status || 400);
    }
  }
);

router.post(
  '/',
  guard,
  v.celebrate({
    [v.Segments.BODY]: v.Joi.object({
      ...bodySchema,
      asset: bodySchema.asset.required(),
      network: bodySchema.network.required(),
      displayName: bodySchema.displayName.required(),
    }).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await createSignalAsset(req.body), 201);
    } catch (err) {
      fail(res, err.message || 'Unable to create signal asset', err.status || 400);
    }
  }
);

router.patch(
  '/:id',
  guard,
  v.celebrate({
    [v.Segments.PARAMS]: v.Joi.object({
      id: v.Joi.number().integer().positive().required(),
    }).unknown(false),
    [v.Segments.BODY]: v.Joi.object(bodySchema).min(1).unknown(false),
  }),
  async (req, res) => {
    try {
      ok(res, await updateSignalAsset(Number(req.params.id), req.body));
    } catch (err) {
      fail(res, err.message || 'Unable to update signal asset', err.status || 400);
    }
  }
);

export default router;
