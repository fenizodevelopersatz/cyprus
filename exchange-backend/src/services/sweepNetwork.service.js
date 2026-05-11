import { Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits } from 'ethers';
import { db } from '../db.js';
import { getModuleLogger } from '../logging/loggers.js';
import { decryptPrivateKey, encryptPrivateKey } from '../utils/crypto.js';
import { getSignalAssetSecretByNetwork } from './signalAssetService.js';
import { getTronClient, normalizeTronHost } from '../utils/tron.js';

const sweepLogger = getModuleLogger('custodial_sweep');

export const EVM_ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export const TRC20_ABI = [
  {
    name: 'balanceOf',
    type: 'Function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'transfer',
    type: 'Function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
];

export const NETWORK_CONFIG = {
  ethereum: {
    adminWalletEnv: 'ETH_ADMIN_WALLET',
    adminPrivateKeyEnv: 'ETH_ADMIN_PRIVATE_KEY',
    tokenContractEnv: 'ETH_USDT_CONTRACT',
    minSweepEnv: 'ETH_MIN_SWEEP_USDT',
    gasTopupMinEnv: 'ETH_GAS_TOPUP_MIN',
    gasTopupAmountEnv: 'ETH_GAS_TOPUP_AMOUNT',
    rpcEnv: 'ETH_RPC_URL',
    rpcFallbackEnv: 'ETH_RPC_HTTP',
  },
  bsc: {
    adminWalletEnv: 'BSC_ADMIN_WALLET',
    adminPrivateKeyEnv: 'BSC_ADMIN_PRIVATE_KEY',
    tokenContractEnv: 'BSC_USDT_CONTRACT',
    minSweepEnv: 'BSC_MIN_SWEEP_USDT',
    gasTopupMinEnv: 'BSC_GAS_TOPUP_MIN',
    gasTopupAmountEnv: 'BSC_GAS_TOPUP_AMOUNT',
    rpcEnv: 'BSC_RPC_URL',
    rpcFallbackEnv: 'BSC_RPC_HTTP',
  },
  tron: {
    rpcEnv: 'TRX_API_URL',
    rpcFallbackEnv: 'TRON_FULL_HOST',
  },
};

const NETWORK_RUNTIME_DEFAULTS = {
  ethereum: {
    walletNetwork: 'ERC20',
    assetNetwork: 'ERC20',
    gasAsset: 'ETH',
    decimalsDefault: 6,
    isTron: false,
  },
  bsc: {
    walletNetwork: 'BEP20',
    assetNetwork: 'BEP20',
    gasAsset: 'BNB',
    decimalsDefault: 18,
    isTron: false,
  },
  tron: {
    walletNetwork: 'TRC20',
    assetNetwork: 'TRC20',
    gasAsset: 'TRX',
    decimalsDefault: 6,
    isTron: true,
  },
};

export function normalizeSweepNetwork(network) {
  const normalized = String(network || '').trim().toLowerCase();
  if (normalized === 'ethereum' || normalized === 'erc20' || normalized === 'eth') return 'ethereum';
  if (normalized === 'bsc' || normalized === 'bep20' || normalized === 'bnb') return 'bsc';
  if (normalized === 'tron' || normalized === 'trc20' || normalized === 'trx') return 'tron';
  return '';
}

function normalizeAddress(network, address) {
  const raw = String(address || '').trim();
  if (!raw) return '';
  return network === 'tron' ? raw : raw.toLowerCase();
}

export async function getNetworkAssetRow(network) {
  const normalized = normalizeSweepNetwork(network);
  if (!normalized) return null;
  const cfg = NETWORK_RUNTIME_DEFAULTS[normalized];
  const row = await db('signal_assets')
    .where({ asset: 'USDT', network: cfg.assetNetwork })
    .first();
  return row || null;
}

export async function getSweepNetworkConfig(network) {
  const normalized = normalizeSweepNetwork(network);
  if (!normalized || !NETWORK_CONFIG[normalized]) {
    const err = new Error('UNSUPPORTED_NETWORK');
    err.status = 400;
    throw err;
  }

  const envConfig = NETWORK_CONFIG[normalized];
  const defaults = NETWORK_RUNTIME_DEFAULTS[normalized];
  const [assetRow, assetConfig] = await Promise.all([
    getNetworkAssetRow(normalized),
    getSignalAssetSecretByNetwork(defaults.assetNetwork),
  ]);
  const isTron = normalized === 'tron';
  const decimals = Number(assetRow?.decimals ?? assetConfig?.decimals ?? defaults.decimalsDefault);
  const tokenContract = String(
    assetConfig?.contractAddress ||
      assetRow?.contract_address ||
      (!isTron ? process.env[envConfig.tokenContractEnv] : '') ||
      ''
  ).trim();
  let rpcUrl = String(
    assetConfig?.rpcUrl ||
      assetConfig?.fullHost ||
      assetRow?.rpc_url ||
      assetRow?.full_host ||
      process.env[envConfig.rpcEnv] ||
      process.env[envConfig.rpcFallbackEnv] ||
      ''
  ).trim();
  let fullHost = String(
    assetConfig?.fullHost ||
      assetRow?.rpc_url ||
      assetRow?.full_host ||
      process.env[envConfig.rpcFallbackEnv] ||
      process.env[envConfig.rpcEnv] ||
      ''
  ).trim();
  if (normalized === 'tron') {
    rpcUrl = normalizeTronHost(rpcUrl || fullHost);
    fullHost = normalizeTronHost(fullHost || rpcUrl);
  }
  const adminWallet = String(assetConfig?.hotWallet || assetConfig?.depositWallet || '').trim();
  const adminPrivateKey = String(assetConfig?.privateKey || '').trim();

  return {
    network: normalized,
    ...defaults,
    ...(isTron ? {
      rpcEnv: envConfig.rpcEnv,
      rpcFallbackEnv: envConfig.rpcFallbackEnv,
    } : envConfig),
    decimals,
    tokenContract,
    rpcUrl,
    fullHost,
    adminWallet,
    adminPrivateKey,
    minSweepUsdt: isTron ? '0' : String(process.env[envConfig.minSweepEnv] || '0').trim() || '0',
    gasTopupMin: isTron ? '0' : String(process.env[envConfig.gasTopupMinEnv] || '0').trim() || '0',
    gasTopupAmount: isTron ? '0' : String(process.env[envConfig.gasTopupAmountEnv] || '0').trim() || '0',
  };
}

export async function ensureAdminWalletsSeeded() {
  for (const key of Object.keys(NETWORK_RUNTIME_DEFAULTS)) {
    const config = await getSweepNetworkConfig(key);
    if (!config.adminWalletEnv || !config.adminPrivateKeyEnv) continue;
    const address = String(process.env[config.adminWalletEnv] || '').trim();
    const privateKey = String(process.env[config.adminPrivateKeyEnv] || '').trim();
    if (!address || !privateKey) continue;

    const payload = {
      network: config.network,
      token: 'USDT',
      address,
      address_lower: config.isTron ? null : address.toLowerCase(),
      encrypted_private_key: encryptPrivateKey(privateKey),
      is_active: true,
      meta: JSON.stringify({
        source: 'env_seed',
        gasAsset: config.gasAsset,
      }),
      updated_at: new Date(),
    };
    console.log(`[sweep-network:ensureAdminWalletsSeeded] Seeding admin wallet for network ${config.network} | ${JSON.stringify(payload)}`);
    const existing = await db('admin_wallets')
      .where({ network: config.network, token: 'USDT' })
      .first();

    if (existing) {
      await db('admin_wallets').where({ id: existing.id }).update(payload);
    } else {
      await db('admin_wallets').insert({
        ...payload,
        created_at: new Date(),
      });
    }
  }
}

export async function getAdminWalletRecord(network) {
  await ensureAdminWalletsSeeded();
  const normalized = normalizeSweepNetwork(network);
  const row = await db('admin_wallets')
    .where({ network: normalized, token: 'USDT', is_active: 1 })
    .first();

  if (row) {
    return row;
  }

  const config = await getSweepNetworkConfig(normalized);
  const fallbackAddress = String(config.adminWallet || '').trim();
  const fallbackPrivateKey = String(config.adminPrivateKey || '').trim();

  if (fallbackAddress && fallbackPrivateKey) {
    const now = new Date();
    const payload = {
      network: normalized,
      token: 'USDT',
      address: fallbackAddress,
      address_lower: config?.isTron ? null : fallbackAddress.toLowerCase(),
      encrypted_private_key: encryptPrivateKey(fallbackPrivateKey),
      is_active: true,
      meta: JSON.stringify({
        source: 'asset_config',
        assetNetwork: config.assetNetwork,
        gasAsset: config.gasAsset,
      }),
      updated_at: now,
    };

    const inserted = await db('admin_wallets').insert({
      ...payload,
      created_at: now,
    });
    const id = Array.isArray(inserted) ? inserted[0] : inserted;
    const seededRow = await db('admin_wallets').where({ id }).first();
    if (seededRow) return seededRow;
  }

  const err = new Error('ADMIN_WALLET_NOT_CONFIGURED');
  err.status = 400;
  throw err;
}

export async function getAdminWalletSecret(network) {
  const row = await getAdminWalletRecord(network);
  return {
    ...row,
    decryptedPrivateKey: decryptPrivateKey(row.encrypted_private_key),
  };
}

export async function getUserWalletSecret(userId, network) {
  const config = await getSweepNetworkConfig(network);
  const row = await db('user_wallets')
    .where({ user_id: userId, network: config.walletNetwork, is_active: 1 })
    .first();
  if (!row) {
    const err = new Error('USER_WALLET_NOT_FOUND');
    err.status = 404;
    throw err;
  }

  const encryptedValue = row.encrypted_private_key || row.private_key_encrypted;
  if (!encryptedValue) {
    const err = new Error('USER_WALLET_PRIVATE_KEY_NOT_FOUND');
    err.status = 400;
    throw err;
  }

  return {
    ...row,
    normalizedAddress: normalizeAddress(config.network, row.address),
    decryptedPrivateKey: decryptPrivateKey(encryptedValue),
  };
}

export function createTronClient(privateKey, fullHost, address = '') {
  const client = getTronClient({ fullHost, privateKey });
  const normalizedAddress = String(address || '').trim();
  if (!String(privateKey || '').trim() && normalizedAddress && typeof client.setAddress === 'function') {
    client.setAddress(normalizedAddress);
  }
  return client;
}

export async function getEvmProvider(network) {
  const config = await getSweepNetworkConfig(network);
  if (!config.rpcUrl) {
    const err = new Error('RPC_URL_NOT_CONFIGURED');
    err.status = 400;
    throw err;
  }
  return new JsonRpcProvider(config.rpcUrl);
}

export async function getTokenBalanceRaw(address, network, privateKey = '') {
  const config = await getSweepNetworkConfig(network);
  if (config.isTron) {
    try {
      const tronWeb = createTronClient(privateKey, config.fullHost || config.rpcUrl, address);
      const contract = await tronWeb.contract().at(config.tokenContract);
      const raw = await contract.balanceOf(address).call();
      return BigInt(raw?.toString?.() || raw || 0);
    } catch (error) {
      console.error('[sweep-network:getTokenBalanceRaw:tron]', {
        network,
        address,
        tokenContract: config.tokenContract,
        rpcUrl: config.rpcUrl,
        fullHost: config.fullHost,
        hasPrivateKey: Boolean(String(privateKey || '').trim()),
        error: String(error?.message || error || 'TRON_TOKEN_BALANCE_FAILED'),
        status: error?.status || null,
        code: error?.code || null,
      });
      throw error;
    }
  }

  const provider = await getEvmProvider(network);
  const contract = new Contract(config.tokenContract, EVM_ERC20_ABI, provider);
  return contract.balanceOf(address);
}

export async function getNativeBalanceRaw(address, network) {
  const config = await getSweepNetworkConfig(network);
  if (config.isTron) {
    try {
      const tronWeb = createTronClient('', config.fullHost || config.rpcUrl);
      const raw = await tronWeb.trx.getBalance(address);
      return BigInt(raw?.toString?.() || raw || 0);
    } catch (error) {
      console.error('[sweep-network:getNativeBalanceRaw:tron]', {
        network,
        address,
        rpcUrl: config.rpcUrl,
        fullHost: config.fullHost,
        error: String(error?.message || error || 'TRON_NATIVE_BALANCE_FAILED'),
        status: error?.status || null,
        code: error?.code || null,
      });
      throw error;
    }
  }
  const provider = await getEvmProvider(network);
  return provider.getBalance(address);
}

export function toTokenAmountRaw(amountDecimal, decimals) {
  return parseUnits(String(amountDecimal || '0'), Number(decimals));
}

export function formatAmountRaw(amountRaw, decimals) {
  return formatUnits(amountRaw, Number(decimals));
}

export function logSweepEvent(level, payload, message) {
  sweepLogger[level](payload, message);
}
