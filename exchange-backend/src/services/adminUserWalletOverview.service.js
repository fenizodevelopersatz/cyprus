import { Contract, JsonRpcProvider, formatUnits } from 'ethers';
import { getTronClient } from '../utils/tron.js';
import { buildAddressExplorerUrl } from './fundingMirror.service.js';
import { listUserWallets } from './userWalletService.js';
import { getUserWalletSummary } from './walletAccountingService.js';
import { getSignalAssetSecretByNetwork } from './signalAssetService.js';

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];

export const NETWORKS = [
  { key: 'ethereum', walletNetwork: 'ERC20', nativeAsset: 'ETH', nativeDecimals: 18 },
  { key: 'bsc', walletNetwork: 'BEP20', nativeAsset: 'BNB', nativeDecimals: 18 },
  { key: 'tron', walletNetwork: 'TRC20', nativeAsset: 'TRX', nativeDecimals: 6 },
];

function toPlainAmount(value, fallback = '0') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value);
}

async function fetchEvmWalletBalances({ address, rpcUrl, contractAddress, tokenDecimals, nativeDecimals }) {
  const provider = new JsonRpcProvider(rpcUrl);
  const [nativeRaw, tokenRaw] = await Promise.all([
    provider.getBalance(address),
    new Contract(contractAddress, ERC20_ABI, provider).balanceOf(address),
  ]);

  return {
    nativeBalance: formatUnits(nativeRaw, nativeDecimals),
    tokenBalance: formatUnits(tokenRaw, tokenDecimals),
  };
}

async function fetchTronWalletBalances({ address, fullHost, contractAddress, tokenDecimals }) {
  const tronWeb = getTronClient({ fullHost });
  if (typeof tronWeb.setAddress === 'function') {
    tronWeb.setAddress(address);
  }

  const [nativeRaw, contract] = await Promise.all([
    tronWeb.trx.getBalance(address),
    tronWeb.contract().at(contractAddress),
  ]);
  const tokenRaw = await contract.balanceOf(address).call();

  return {
    nativeBalance: formatUnits(BigInt(nativeRaw || 0), 6),
    tokenBalance: formatUnits(BigInt(tokenRaw?.toString?.() || tokenRaw || 0), tokenDecimals),
  };
}

export function getNetworkMetaByWalletNetwork(walletNetwork) {
  const normalized = String(walletNetwork || '').trim().toUpperCase();
  return NETWORKS.find((item) => item.walletNetwork === normalized) || null;
}

export async function fetchNetworkOverview(walletRow, meta) {
  const assetConfig = await getSignalAssetSecretByNetwork(meta.walletNetwork);
  const explorerUrl = walletRow.address ? await buildAddressExplorerUrl(meta.key, walletRow.address) : null;

  if (!walletRow?.address) {
    return {
      network: meta.key,
      walletNetwork: meta.walletNetwork,
      address: '',
      explorerUrl,
      nativeAsset: meta.nativeAsset,
      nativeBalance: '0',
      tokenAsset: 'USDT',
      tokenBalance: '0',
      live: false,
      error: 'ADDRESS_NOT_AVAILABLE',
    };
  }

  try {
    let balances;
    if (meta.key === 'tron') {
      balances = await fetchTronWalletBalances({
        address: walletRow.address,
        fullHost: assetConfig?.fullHost || process.env.TRX_API_URL || process.env.TRON_API_BASE,
        contractAddress: assetConfig?.contractAddress,
        tokenDecimals: Number(assetConfig?.decimals || 6),
      });
    } else {
      balances = await fetchEvmWalletBalances({
        address: walletRow.address,
        rpcUrl:
          assetConfig?.rpcUrl ||
          process.env[meta.key === 'ethereum' ? 'ETH_RPC_URL' : 'BSC_RPC_URL'] ||
          process.env[meta.key === 'ethereum' ? 'ETH_RPC_HTTP' : 'BSC_RPC_HTTP'],
        contractAddress: assetConfig?.contractAddress,
        tokenDecimals: Number(assetConfig?.decimals || (meta.key === 'bsc' ? 18 : 6)),
        nativeDecimals: meta.nativeDecimals,
      });
    }

    return {
      network: meta.key,
      walletNetwork: meta.walletNetwork,
      address: walletRow.address,
      explorerUrl,
      nativeAsset: meta.nativeAsset,
      nativeBalance: toPlainAmount(balances.nativeBalance),
      tokenAsset: 'USDT',
      tokenBalance: toPlainAmount(balances.tokenBalance),
      live: true,
      error: null,
    };
  } catch (error) {
    return {
      network: meta.key,
      walletNetwork: meta.walletNetwork,
      address: walletRow.address,
      explorerUrl,
      nativeAsset: meta.nativeAsset,
      nativeBalance: '0',
      tokenAsset: 'USDT',
      tokenBalance: '0',
      live: false,
      error: String(error?.message || error || 'LIVE_BALANCE_UNAVAILABLE'),
    };
  }
}

export async function getAdminUserWalletOverview(userId) {
  const normalizedUserId = Number(userId);
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    const error = new Error('INVALID_USER_ID');
    error.status = 400;
    throw error;
  }

  const [internalSummary, wallets] = await Promise.all([
    getUserWalletSummary(normalizedUserId),
    listUserWallets(normalizedUserId),
  ]);
  const walletMap = new Map(wallets.map((wallet) => [String(wallet.network || '').toUpperCase(), wallet]));

  const networks = await Promise.all(
    NETWORKS.map((meta) => fetchNetworkOverview(walletMap.get(meta.walletNetwork), meta))
  );

  return {
    userId: normalizedUserId,
    internal: {
      mainWalletBalance: toPlainAmount(internalSummary?.mainWalletBalance, '0'),
      availableBalance: toPlainAmount(internalSummary?.availableBalance, '0'),
      depositTotal: toPlainAmount(internalSummary?.depositTotal, '0'),
      totalWithdrawals: toPlainAmount(internalSummary?.totalWithdrawals, '0'),
      totalEarnings: toPlainAmount(internalSummary?.totalEarnings, '0'),
    },
    live: {
      totalUsdt: toPlainAmount(
        networks.reduce((sum, item) => sum + Number(item.tokenBalance || 0), 0),
        '0'
      ),
      totalNative: {
        eth: networks.find((item) => item.network === 'ethereum')?.nativeBalance || '0',
        bnb: networks.find((item) => item.network === 'bsc')?.nativeBalance || '0',
        trx: networks.find((item) => item.network === 'tron')?.nativeBalance || '0',
      },
      totalToken: {
        erc20: networks.find((item) => item.network === 'ethereum')?.tokenBalance || '0',
        bep20: networks.find((item) => item.network === 'bsc')?.tokenBalance || '0',
        trc20: networks.find((item) => item.network === 'tron')?.tokenBalance || '0',
      },
      networks,
    },
  };
}
