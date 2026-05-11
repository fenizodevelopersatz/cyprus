import { db } from '../db.js';
import { decryptText, encryptText } from '../utils/crypto.js';
import { normalizeTronHost } from '../utils/tron.js';

const STATUS_VALUES = new Set(['ENABLED', 'DISABLED']);
const NETWORK_TYPE_VALUES = new Set(['EVM', 'TRON']);
const FEE_TYPE_VALUES = new Set(['FIXED', 'PERCENT']);

// const DEFAULT_SIGNAL_ASSETS = [
//   {
//     asset: 'USDT',
//     network: 'ERC20',
//     display_name: 'USDT ERC20',
//     network_type: 'EVM',
//     min_deposit: '0',
//     min_withdraw: '0',
//     withdraw_fee_type: 'FIXED',
//     withdraw_fee: '0',
//     rpc_url: '',
//     chain_id: '1',
//     contract_address: '',
//     decimals: 6,
//     deposit_wallet: '',
//     hot_wallet: '',
//     private_key: '',
//     confirmations: 12,
//     full_host: '',
//     status: 'ENABLED',
//     is_enabled: true,
//     sort_order: 10,
//     meta: null,
//   },
//   {
//     asset: 'USDT',
//     network: 'BEP20',
//     display_name: 'USDT BEP20',
//     network_type: 'EVM',
//     min_deposit: '0',
//     min_withdraw: '0',
//     withdraw_fee_type: 'FIXED',
//     withdraw_fee: '0',
//     rpc_url: 'https://bsc-dataseed.binance.org',
//     chain_id: '56',
//     contract_address: '',
//     decimals: 18,
//     deposit_wallet: '',
//     hot_wallet: '',
//     private_key: '',
//     confirmations: 15,
//     full_host: '',
//     status: 'ENABLED',
//     is_enabled: true,
//     sort_order: 20,
//     meta: null,
//   },
//   {
//     asset: 'USDT',
//     network: 'TRC20',
//     display_name: 'USDT TRC20',
//     network_type: 'TRON',
//     min_deposit: '0',
//     min_withdraw: '0',
//     withdraw_fee_type: 'FIXED',
//     withdraw_fee: '0',
//     rpc_url: '',
//     chain_id: '',
//     contract_address: '',
//     decimals: 6,
//     deposit_wallet: '',
//     hot_wallet: '',
//     private_key: '',
//     confirmations: 20,
//     full_host: 'https://api.trongrid.io',
//     status: 'ENABLED',
//     is_enabled: true,
//     sort_order: 30,
//     meta: null,
//   },
// ];

const DEFAULT_SIGNAL_ASSETS = [
  {
    asset: 'USDT',
    network: 'ERC20',
    display_name: 'USDT Ethereum',
    network_type: 'EVM',
    min_deposit: '0.1',
    min_withdraw: '10',
    withdraw_fee_type: 'FIXED',
    withdraw_fee: '0.1',
    rpc_url: 'https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID',
    chain_id: '1',
    contract_address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    deposit_wallet: '0xYOUR_MAINNET_WALLET',
    hot_wallet: '0xYOUR_MAINNET_WALLET',
    private_key: 'YOUR_PRIVATE_KEY',
    confirmations: 12,
    full_host: '',
    status: 'ENABLED',
    is_enabled: true,
    sort_order: 10,
    meta: null,
  },
  {
    asset: 'USDT',
    network: 'BEP20',
    display_name: 'USDT BSC',
    network_type: 'EVM',
    min_deposit: '0.1',
    min_withdraw: '10',
    withdraw_fee_type: 'FIXED',
    withdraw_fee: '0.1',
    rpc_url: 'https://bsc-dataseed.binance.org/',
    chain_id: '56',
    contract_address: '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    deposit_wallet: '0xYOUR_MAINNET_WALLET',
    hot_wallet: '0xYOUR_MAINNET_WALLET',
    private_key: 'YOUR_PRIVATE_KEY',
    confirmations: 12,
    full_host: '',
    status: 'ENABLED',
    is_enabled: true,
    sort_order: 20,
    meta: null,
  },
  {
    asset: 'USDT',
    network: 'TRC20',
    display_name: 'USDT TRON Nile',
    network_type: 'TRON',
    min_deposit: '0.1',
    min_withdraw: '10',
    withdraw_fee_type: 'FIXED',
    withdraw_fee: '0.1',
    rpc_url: '',
    chain_id: '',
    contract_address: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
    decimals: 6,
    deposit_wallet: 'TYOUR_TEST_WALLET',
    hot_wallet: 'TYOUR_TEST_WALLET',
    private_key: 'YOUR_PRIVATE_KEY',
    confirmations: 10,
    full_host: 'https://nile.trongrid.io',
    status: 'ENABLED',
    is_enabled: true,
    sort_order: 30,
    meta: null,
  },
];

function buildSeedRow(row, now) {
  const privateKey = optionalString(row.private_key);
  return {
    ...row,
    private_key: privateKey ? encryptText(privateKey) : null,
    created_at: now,
    updated_at: now,
  };
}

function parseMeta(meta) {
  if (!meta) return null;
  if (typeof meta === 'object') return meta;
  try {
    return JSON.parse(meta);
  } catch {
    return null;
  }
}

function decryptIfEncrypted(value) {
  const raw = optionalString(value);
  if (!raw) return null;
  try {
    return decryptText(raw);
  } catch {
    return raw;
  }
}

function hidePrivateKey(value) {
  return value ? '__configured__' : null;
}

function normalizeStatus(value, fallback = 'ENABLED') {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!STATUS_VALUES.has(normalized)) {
    const error = new Error('INVALID_STATUS');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function normalizeNetworkType(value, fallback = 'EVM') {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!NETWORK_TYPE_VALUES.has(normalized)) {
    const error = new Error('INVALID_NETWORK_TYPE');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function normalizeFeeType(value, fallback = 'FIXED') {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (!FEE_TYPE_VALUES.has(normalized)) {
    const error = new Error('INVALID_WITHDRAW_FEE_TYPE');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function mapRow(row) {
  const decryptedPrivateKey = decryptIfEncrypted(row.private_key);
  const normalizedNetwork = String(row.network || '').trim().toUpperCase();
  const rpcUrl =
    normalizedNetwork === 'TRC20' && row.rpc_url ? normalizeTronHost(row.rpc_url) : row.rpc_url;
  const fullHost =
    normalizedNetwork === 'TRC20' && row.full_host ? normalizeTronHost(row.full_host) : row.full_host;
  return {
    id: row.id,
    asset: row.asset,
    network: row.network,
    displayName: row.display_name,
    networkType: row.network_type,
    minDeposit: row.min_deposit,
    minWithdraw: row.min_withdraw,
    withdrawFeeType: row.withdraw_fee_type,
    withdrawFee: row.withdraw_fee,
    rpcUrl,
    chainId: row.chain_id,
    contractAddress: row.contract_address,
    decimals: row.decimals,
    depositWallet: row.deposit_wallet,
    hotWallet: row.hot_wallet,
    privateKey: hidePrivateKey(decryptedPrivateKey),
    hasPrivateKey: Boolean(decryptedPrivateKey),
    confirmations: row.confirmations,
    fullHost,
    status: row.status,
    isEnabled: Boolean(row.is_enabled),
    sortOrder: row.sort_order,
    meta: parseMeta(row.meta),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizePayload(input, { partial = false } = {}) {
  const payload = {};

  if (!partial || input.asset !== undefined) payload.asset = String(input.asset || '').trim().toUpperCase();
  if (!partial || input.network !== undefined) payload.network = String(input.network || '').trim().toUpperCase();
  if (!partial || input.displayName !== undefined) payload.display_name = String(input.displayName || '').trim();
  if (!partial || input.networkType !== undefined) payload.network_type = normalizeNetworkType(input.networkType);
  if (!partial || input.minDeposit !== undefined) payload.min_deposit = String(input.minDeposit ?? '0').trim() || '0';
  if (!partial || input.minWithdraw !== undefined) payload.min_withdraw = String(input.minWithdraw ?? '0').trim() || '0';
  if (!partial || input.withdrawFeeType !== undefined) payload.withdraw_fee_type = normalizeFeeType(input.withdrawFeeType);
  if (!partial || input.withdrawFee !== undefined) payload.withdraw_fee = String(input.withdrawFee ?? '0').trim() || '0';
  if (!partial || input.rpcUrl !== undefined) payload.rpc_url = optionalString(input.rpcUrl);
  if (!partial || input.chainId !== undefined) payload.chain_id = optionalString(input.chainId);
  if (!partial || input.contractAddress !== undefined) payload.contract_address = optionalString(input.contractAddress);
  if (!partial || input.decimals !== undefined) payload.decimals = Number(input.decimals ?? 0);
  if (!partial || input.depositWallet !== undefined) payload.deposit_wallet = optionalString(input.depositWallet);
  if (!partial || input.hotWallet !== undefined) payload.hot_wallet = optionalString(input.hotWallet);
  if (!partial || input.privateKey !== undefined) {
    const privateKey = optionalString(input.privateKey);
    if (privateKey && privateKey !== '__configured__') {
      payload.private_key = encryptText(privateKey);
    } else if (!partial) {
      payload.private_key = privateKey;
    }
  }
  if (!partial || input.confirmations !== undefined) payload.confirmations = Number(input.confirmations ?? 0);
  if (!partial || input.fullHost !== undefined) payload.full_host = optionalString(input.fullHost);
  if (!partial || input.status !== undefined) payload.status = normalizeStatus(input.status);
  if (!partial || input.isEnabled !== undefined) payload.is_enabled = Boolean(input.isEnabled);
  if (!partial || input.sortOrder !== undefined) payload.sort_order = Number(input.sortOrder ?? 0);
  if (!partial || input.meta !== undefined) payload.meta = input.meta ?? null;

  if (!partial) {
    if (!payload.asset) throw new Error('ASSET_REQUIRED');
    if (!payload.network) throw new Error('NETWORK_REQUIRED');
    if (!payload.display_name) throw new Error('DISPLAY_NAME_REQUIRED');
  }

  if (payload.status && input.isEnabled === undefined) payload.is_enabled = payload.status === 'ENABLED';
  if (payload.is_enabled !== undefined && input.status === undefined) payload.status = payload.is_enabled ? 'ENABLED' : 'DISABLED';

  return payload;
}

export async function ensureDefaultSignalAssets() {
  const existing = await db('signal_assets').count({ count: '*' }).first();
  const total = Number(existing?.count ?? 0);
  if (total > 0) return;
  const now = new Date();
  await db('signal_assets').insert(
    DEFAULT_SIGNAL_ASSETS.map((row) => buildSeedRow(row, now))
  );
}

export async function listSignalAssets({ status, asset, includeDisabled = true } = {}) {
  await ensureDefaultSignalAssets();
  const query = db('signal_assets').select('*');
  if (asset) query.where('asset', String(asset).trim().toUpperCase());
  if (status) query.where('status', normalizeStatus(status));
  if (!includeDisabled) query.where('is_enabled', true);
  const rows = await query.orderBy([{ column: 'sort_order', order: 'asc' }, { column: 'id', order: 'asc' }]);
  return rows.map(mapRow);
}

export async function getSignalAssetByNetwork(network) {
  await ensureDefaultSignalAssets();
  const row = await db('signal_assets').where({ network: String(network || '').trim().toUpperCase() }).first();
  return row ? mapRow(row) : null;
}

export async function getSignalAssetSecretByNetwork(network) {
  await ensureDefaultSignalAssets();
  const row = await db('signal_assets').where({ network: String(network || '').trim().toUpperCase() }).first();
  if (!row) return null;
  return {
    ...mapRow(row),
    privateKey: decryptIfEncrypted(row.private_key),
  };
}

export async function createSignalAsset(input) {
  await ensureDefaultSignalAssets();
  const payload = normalizePayload(input);
  const now = new Date();
  const existing = await db('signal_assets')
    .where({
      asset: payload.asset,
      network: payload.network,
    })
    .first();

  if (existing) {
    await db('signal_assets')
      .where({ id: existing.id })
      .update({
        ...payload,
        updated_at: now,
      });
    const row = await db('signal_assets').where({ id: existing.id }).first();
    return mapRow(row);
  }

  const inserted = await db('signal_assets').insert({ ...payload, created_at: now, updated_at: now });
  const id = Array.isArray(inserted) ? inserted[0] : inserted;
  const row = await db('signal_assets').where({ id }).first();
  return mapRow(row);
}

export async function updateSignalAsset(id, input) {
  await ensureDefaultSignalAssets();
  const payload = normalizePayload(input, { partial: true });
  if (Object.keys(payload).length === 0) {
    const error = new Error('NO_FIELDS_TO_UPDATE');
    error.status = 400;
    throw error;
  }
  await db('signal_assets')
    .where({ id: Number(id) })
    .update({ ...payload, updated_at: new Date() });
  const row = await db('signal_assets').where({ id: Number(id) }).first();
  if (!row) {
    const error = new Error('SIGNAL_ASSET_NOT_FOUND');
    error.status = 404;
    throw error;
  }
  return mapRow(row);
}
