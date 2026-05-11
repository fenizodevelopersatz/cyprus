import { Contract, JsonRpcProvider, Wallet, formatUnits, parseUnits } from 'ethers';
import { db, withTx } from '../db.js';
import { decryptText } from '../utils/crypto.js';
import { buildAddressExplorerUrl, buildExplorerUrl, normalizeFundingNetwork } from './fundingMirror.service.js';
import { getSignalAssetSecretByNetwork } from './signalAssetService.js';
import { buildFundingTxnId } from './txnIdService.js';
import { getTronClient, getTronOwnerAddress } from '../utils/tron.js';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const TRC20_ABI = [
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

const NETWORK_META = {
  ethereum: { label: 'ERC', assetNetwork: 'ERC20', thresholdEnv: 'ETH_MIN_SWEEP_THRESHOLD' },
  bsc: { label: 'BEP', assetNetwork: 'BEP20', thresholdEnv: 'BSC_MIN_SWEEP_THRESHOLD' },
  tron: { label: 'TRC', assetNetwork: 'TRC20', thresholdEnv: 'TRON_MIN_SWEEP_THRESHOLD' },
};

function getNetworkMeta(network) {
  const normalized = normalizeFundingNetwork(network);
  const meta = NETWORK_META[normalized];
  if (!meta) {
    const err = new Error('UNSUPPORTED_NETWORK');
    err.status = 400;
    throw err;
  }
  return { network: normalized, ...meta };
}

async function getAdminWalletConfig(network) {
  const meta = getNetworkMeta(network);
  const assetConfig = await getSignalAssetSecretByNetwork(meta.assetNetwork);
  return {
    ...meta,
    adminWallet: assetConfig?.hotWallet || assetConfig?.depositWallet || '',
    adminPrivateKey: assetConfig?.privateKey || '',
    rpcUrl: assetConfig?.rpcUrl || process.env[meta.assetNetwork === 'ERC20' ? 'ETH_RPC_HTTP' : meta.assetNetwork === 'BEP20' ? 'BSC_RPC_HTTP' : 'TRX_API_URL'],
    contractAddress: assetConfig?.contractAddress || '',
    fullHost: assetConfig?.fullHost || '',
    decimals: Number(assetConfig?.decimals || (meta.assetNetwork === 'BEP20' ? 18 : 6)),
    sweepThreshold: String(process.env[meta.thresholdEnv] || '0'),
  };
}

function getUserWalletRowNetwork(network) {
  if (network === 'ethereum') return 'ERC20';
  if (network === 'bsc') return 'BEP20';
  return 'TRC20';
}

async function getEvmUsdtBalance(provider, contractAddress, address) {
  const contract = new Contract(contractAddress, ERC20_ABI, provider);
  return contract.balanceOf(address);
}

async function transferEvmUsdt({ network, fromPrivateKey, to, amount }) {
  const config = await getAdminWalletConfig(network);
  const provider = new JsonRpcProvider(config.rpcUrl);
  const signer = new Wallet(fromPrivateKey, provider);
  const contract = new Contract(config.contractAddress, ERC20_ABI, signer);
  const tx = await contract.transfer(to, amount);
  const receipt = await tx.wait();
  return receipt?.hash || tx.hash;
}

function createTronClient(privateKey, fullHost = process.env.TRX_API_URL || process.env.TRON_API_BASE) {
  return getTronClient({ fullHost, privateKey });
}

async function getTronUsdtBalance(address) {
  const config = await getAdminWalletConfig('tron');
  const tronWeb = createTronClient('', config.fullHost || process.env.TRX_API_URL || process.env.TRON_API_BASE);
  if (typeof tronWeb.setAddress === 'function' && address) {
    tronWeb.setAddress(address);
  }
  const contract = await tronWeb.contract().at(config.contractAddress);
  const raw = await contract.balanceOf(address).call();
  return BigInt(raw?.toString?.() || raw || 0);
}

function toDecimalString(value) {
  return String(value ?? '0');
}

function createZeroTotals() {
  return {
    ethereum: '0',
    bsc: '0',
    tron: '0',
  };
}

function buildTotalsPayload(totals) {
  return {
    totalUsdt: String(
      Number(totals.ethereum || 0) +
        Number(totals.bsc || 0) +
        Number(totals.tron || 0)
    ),
    totalErc: String(totals.ethereum || '0'),
    totalBep: String(totals.bsc || '0'),
    totalTrc: String(totals.tron || '0'),
  };
}

function isGasRelatedError(errorMessage) {
  const message = String(errorMessage || '').toLowerCase();
  return [
    'insufficient funds',
    'intrinsic gas',
    'gas required exceeds allowance',
    'out of energy',
    'bandwidth',
    'energy',
    'fee limit',
    'insufficient gas',
    'trx',
    'bnb',
    'eth',
  ].some((token) => message.includes(token));
}

async function transferTronUsdt({ fromPrivateKey, to, amount }) {
  const config = await getAdminWalletConfig('tron');
  const tronWeb = getTronClient({
    fullHost: config.fullHost || process.env.TRX_API_URL || process.env.TRON_API_BASE,
    privateKey: fromPrivateKey,
  });
  const ownerAddress = getTronOwnerAddress(tronWeb, fromPrivateKey);
  try {
    const contract = await tronWeb.contract().at(config.contractAddress);
    const tx = await contract.transfer(to, amount.toString()).send(
      {
        from: ownerAddress,
        feeLimit: 100_000_000,
      },
      fromPrivateKey
    );
    return tx;
  } catch (error) {
    const rawMessage = String(error?.message || error || 'TRON_ADMIN_TRANSFER_FAILED');
    console.error('[tron-admin-transfer]', {
      ownerAddress,
      destinationWallet: to,
      tokenContract: config.contractAddress,
      rpcUrl: config.fullHost || process.env.TRX_API_URL || process.env.TRON_API_BASE,
      error: rawMessage,
    });
    if (/owner_address isn't set/i.test(rawMessage)) {
      const err = new Error('TRON_ADMIN_OWNER_ADDRESS_NOT_SET');
      err.status = 400;
      throw err;
    }
    throw error;
  }
}

export async function sendAdminTreasuryUsdt({ network, to, amountDecimal }) {
  const config = await getAdminWalletConfig(network);
  if (!config.adminPrivateKey) {
    const err = new Error('ADMIN_TREASURY_PRIVATE_KEY_NOT_CONFIGURED');
    err.status = 400;
    throw err;
  }
  if (!config.contractAddress) {
    const err = new Error('ADMIN_TREASURY_CONTRACT_NOT_CONFIGURED');
    err.status = 400;
    throw err;
  }

  const amount = parseUnits(String(amountDecimal), config.decimals);
  if (config.network === 'tron') {
    const txHash = await transferTronUsdt({
      fromPrivateKey: config.adminPrivateKey,
      to,
      amount,
    });
    return { txHash, network: config.network };
  }

  const txHash = await transferEvmUsdt({
    network: config.network,
    fromPrivateKey: config.adminPrivateKey,
    to,
    amount,
  });
  return { txHash, network: config.network };
}

export async function getAdminTreasuryLiveBalances() {
  const wallets = await Promise.all(
    ['ethereum', 'bsc', 'tron'].map(async (network) => {
      const config = await getAdminWalletConfig(network);
      const balance = await getNetworkTreasuryBalance(network);
      const explorerUrl = config.adminWallet ? await buildAddressExplorerUrl(network, config.adminWallet) : null;
      return {
        network,
        asset: 'USDT',
        label:
          network === 'ethereum'
            ? 'USDT ERC-20'
            : network === 'bsc'
              ? 'USDT BEP-20'
              : 'USDT TRC-20',
        address: config.adminWallet || '',
        explorerUrl,
        balance,
      };
    })
  );

  const totalUsdt = wallets.reduce((sum, wallet) => sum + Number(wallet.balance || 0), 0);
  return {
    totalUsdt: String(totalUsdt),
    totalErc20: wallets.find((wallet) => wallet.network === 'ethereum')?.balance || '0',
    totalBep20: wallets.find((wallet) => wallet.network === 'bsc')?.balance || '0',
    totalTrc20: wallets.find((wallet) => wallet.network === 'tron')?.balance || '0',
    wallets,
  };
}

export async function listAdminDeposits({
  page = 1,
  limit = 20,
  network,
  status,
  userId,
  txHash,
} = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const normalizedNetwork = normalizeFundingNetwork(network);

  const query = db('deposit_transactions')
    .leftJoin('users', 'deposit_transactions.user_id', 'users.id')
    .leftJoin('user_profiles', 'deposit_transactions.user_id', 'user_profiles.user_id')
    .where({ 'deposit_transactions.token': 'USDT' })
    .modify((builder) => {
      if (normalizedNetwork) builder.andWhere({ 'deposit_transactions.network': normalizedNetwork });
      if (status) builder.andWhere({ 'deposit_transactions.status': String(status).trim().toLowerCase() });
      if (userId) builder.andWhere({ 'deposit_transactions.user_id': Number(userId) });
      if (txHash) builder.andWhere('deposit_transactions.tx_hash', 'like', `%${String(txHash).trim()}%`);
    });

  const [countRow, rows, summaryRows] = await Promise.all([
    query.clone().count({ total: '*' }).first(),
    query
      .clone()
      .select(
        'deposit_transactions.*',
        'user_profiles.display_name as user_name',
        'users.email as user_email'
      )
      .orderBy('created_at', 'desc')
      .offset((safePage - 1) * safeLimit)
      .limit(safeLimit),
    db('deposit_transactions')
      .where({ token: 'USDT', status: 'credited' })
      .select('network')
      .sum({ total: 'amount_decimal' })
      .groupBy('network'),
  ]);
  const total = Number(countRow?.total ?? 0);

  const items = await Promise.all(rows.map(async (row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || null,
    userEmail: row.user_email || null,
    txn_id: row.txn_id || buildFundingTxnId('deposit', row.created_at, row.id),
    network: getNetworkMeta(row.network).label,
    networkKey: row.network,
    depositAddress: row.deposit_address || row.to_address,
    fromAddress: row.from_address,
    txHash: row.tx_hash,
    explorerUrl: await buildExplorerUrl(row.network, row.tx_hash),
    amount: row.amount_decimal,
    status: row.status,
    confirmationCount: Number(row.confirmation_count || 0),
    isSwept: Boolean(row.is_swept),
    tokenContract: row.contract_address || row.token_contract || null,
    createdAt: row.created_at,
  })));

  const totals = createZeroTotals();
  for (const row of summaryRows) {
    if (row.network in totals) totals[row.network] = toDecimalString(row.total);
  }

  return {
    summary: buildTotalsPayload(totals),
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

export async function listAdminWalletDeposits({
  page = 1,
  limit = 20,
  network,
  status,
  userId,
} = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const normalizedNetwork = normalizeFundingNetwork(network);

  const query = db('deposit_transactions')
    .where({ token: 'USDT' })
    .modify((builder) => {
      builder.andWhere((nested) => {
        nested.where({ is_swept: 1 }).whereNotNull('swept_at');
        nested.orWhereNotNull('sweep_error');
      });
      if (normalizedNetwork) builder.andWhere({ network: normalizedNetwork });
      if (status) {
        const normalizedStatus = String(status).trim().toLowerCase();
        if (normalizedStatus === 'insufficient_gas') {
          builder.andWhere('sweep_error', 'like', '%');
        } else if (normalizedStatus === 'swept') {
          builder.andWhere({ is_swept: 1 }).whereNotNull('swept_at');
        } else if (normalizedStatus === 'failed') {
          builder.whereNotNull('sweep_error');
        }
      }
      if (userId) builder.andWhere({ user_id: Number(userId) });
    });

  const [countRow, rows, summaryRows, gasIssueCountRow] = await Promise.all([
    query.clone().count({ total: '*' }).first(),
    query
      .clone()
      .orderBy([{ column: 'swept_at', order: 'desc' }, { column: 'updated_at', order: 'desc' }])
      .offset((safePage - 1) * safeLimit)
      .limit(safeLimit),
    db('deposit_transactions')
      .where({ token: 'USDT', is_swept: 1 })
      .whereNotNull('swept_at')
      .select('network')
      .sum({ total: 'amount_decimal' })
      .groupBy('network'),
    db('deposit_transactions')
      .where({ token: 'USDT', is_swept: 0 })
      .whereNotNull('sweep_error')
      .count({ total: '*' })
      .first(),
  ]);
  const total = Number(countRow?.total ?? 0);

  const items = await Promise.all(
    rows.map(async (row) => {
      const config = await getAdminWalletConfig(row.network);
      return {
        id: row.id,
        userId: row.user_id,
        txn_id: row.txn_id || buildFundingTxnId('deposit', row.created_at, row.id),
        network: getNetworkMeta(row.network).label,
        networkKey: row.network,
        sourceWalletAddress: row.deposit_address || row.to_address,
        destinationAdminWalletAddress: config.adminWallet || '',
        tokenContract: row.contract_address || row.token_contract || config.contractAddress || null,
        amount: row.amount_decimal,
        gasFee: null,
        gasAsset: row.network === 'tron' ? 'TRX' : row.network === 'bsc' ? 'BNB' : 'ETH',
        txHash: row.sweep_tx_hash,
        explorerUrl: row.sweep_tx_hash ? await buildExplorerUrl(row.network, row.sweep_tx_hash) : null,
        sweepStatus: row.sweep_error ? (isGasRelatedError(row.sweep_error) ? 'insufficient_gas' : 'failed') : 'swept',
        triggerType: 'manual',
        errorMessage: row.sweep_error || null,
        sweptAt: row.swept_at || null,
        createdAt: row.created_at,
      };
    })
  );

  const totals = createZeroTotals();
  for (const row of summaryRows) {
    if (row.network in totals) totals[row.network] = toDecimalString(row.total);
  }

  return {
    summary: {
      ...buildTotalsPayload(totals),
      insufficientGasCount: Number(gasIssueCountRow?.total || 0),
    },
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

async function getNetworkTreasuryBalance(network) {
  const config = await getAdminWalletConfig(network);
  if (!config.adminWallet || !config.contractAddress) {
    return '0';
  }

  if (config.network === 'tron') {
    const raw = await getTronUsdtBalance(config.adminWallet);
    return formatUnits(raw, config.decimals);
  }

  const provider = new JsonRpcProvider(config.rpcUrl);
  const raw = await getEvmUsdtBalance(provider, config.contractAddress, config.adminWallet);
  return formatUnits(raw, config.decimals);
}

export async function getAdminTreasuryOverview() {
  const [creditedDeposits, completedWithdrawals, pendingSweeps, lastSweepRow, sweepCountRow] = await Promise.all([
    db('deposit_transactions')
      .where({ token: 'USDT', status: 'credited' })
      .select('network')
      .sum({ total: 'amount_decimal' })
      .groupBy('network'),
    db('withdrawals')
      .whereIn('status', ['approved', 'completed'])
      .select('chain')
      .sum({ total: 'amount' })
      .groupBy('chain'),
    db('deposit_transactions')
      .where({ token: 'USDT', is_swept: 0 })
      .whereIn('status', ['confirmed', 'credited'])
      .count({ total: '*' })
      .first(),
    db('treasury_sweep_runs').orderBy('created_at', 'desc').first(),
    db('treasury_sweep_runs').count({ total: '*' }).first(),
  ]);

  const walletOverview = await Promise.all(
    ['ethereum', 'bsc', 'tron'].map(async (network) => {
      const resolvedConfig = await getAdminWalletConfig(network);
      return {
        network,
        label: network === 'ethereum' ? 'Ethereum Wallet' : network === 'bsc' ? 'BSC Wallet' : 'TRON Wallet',
        address: resolvedConfig.adminWallet || '',
        contractAddress: resolvedConfig.contractAddress || null,
        balance: await getNetworkTreasuryBalance(network),
      };
    })
  );

  const totals = {
    ethereum: '0',
    bsc: '0',
    tron: '0',
  };
  for (const row of creditedDeposits) {
    if (row.network in totals) totals[row.network] = String(row.total || '0');
  }
  for (const row of completedWithdrawals) {
    const network = normalizeFundingNetwork(row.chain);
    if (network in totals) {
      totals[network] = String(Number(totals[network]) - Number(row.total || 0));
    }
  }

  return {
    wallets: walletOverview,
    totalPlatformBalance: {
      byNetwork: totals,
      total: String(
        Number(totals.ethereum || 0) +
          Number(totals.bsc || 0) +
          Number(totals.tron || 0)
      ),
    },
    sweepStatus: {
      pendingDeposits: Number(pendingSweeps?.total || 0),
      lastSweepTime: lastSweepRow?.finished_at || lastSweepRow?.created_at || null,
      sweepCount: Number(sweepCountRow?.total || 0),
    },
  };
}

async function markDepositSwept(trx, depositId, txHash) {
  await trx('deposit_transactions')
    .where({ id: depositId })
    .update({
      is_swept: true,
      swept_at: new Date(),
      sweep_tx_hash: txHash,
      sweep_error: null,
      updated_at: new Date(),
    });
}

async function markDepositSweepFailed(trx, depositId, errorMessage) {
  await trx('deposit_transactions')
    .where({ id: depositId })
    .update({
      sweep_error: errorMessage,
      updated_at: new Date(),
    });
}

async function sweepDepositRow(row) {
  const config = await getAdminWalletConfig(row.network);
  const walletRowNetwork = getUserWalletRowNetwork(row.network);
  const userWallet = await db('user_wallets')
    .where({ user_id: row.user_id, network: walletRowNetwork })
    .first();
  if (!userWallet?.private_key_encrypted) {
    throw new Error('USER_WALLET_PRIVATE_KEY_NOT_FOUND');
  }

  const privateKey = decryptText(userWallet.private_key_encrypted);
  const threshold = Number(config.sweepThreshold || 0);
  if (Number(row.amount_decimal) <= threshold) {
    return { skipped: true, reason: 'BELOW_THRESHOLD' };
  }

  if (row.network === 'tron') {
    const amount = parseUnits(String(row.amount_decimal), config.decimals);
    const txHash = await transferTronUsdt({
      fromPrivateKey: privateKey,
      to: config.adminWallet,
      amount,
    });
    return { txHash };
  }

  const amount = parseUnits(String(row.amount_decimal), config.decimals);
  const txHash = await transferEvmUsdt({
    network: row.network,
    fromPrivateKey: privateKey,
    to: config.adminWallet,
    amount,
  });
  return { txHash };
}

export async function sweepTreasuryDeposits({ network, adminUserId = null } = {}) {
  const normalizedNetwork = normalizeFundingNetwork(network);
  const startedAt = new Date();
  const inserted = await db('treasury_sweep_runs').insert({
    network: normalizedNetwork || null,
    status: 'started',
    swept_count: 0,
    failed_count: 0,
    triggered_by: 'manual',
    admin_user_id: adminUserId,
    started_at: startedAt,
    created_at: startedAt,
    updated_at: startedAt,
  });
  const runId = Array.isArray(inserted) ? inserted[0] : inserted;

  const rows = await db('deposit_transactions')
    .where({ token: 'USDT', is_swept: 0 })
    .whereIn('status', ['confirmed', 'credited'])
    .modify((builder) => {
      if (normalizedNetwork) builder.andWhere({ network: normalizedNetwork });
    })
    .orderBy('created_at', 'asc');

  let sweptCount = 0;
  let failedCount = 0;
  const items = [];

  for (const row of rows) {
    try {
      const result = await sweepDepositRow(row);
      if (result?.skipped) {
        items.push({ depositId: row.id, status: 'skipped', reason: result.reason });
        continue;
      }
      await withTx(async (trx) => {
        await markDepositSwept(trx, row.id, result.txHash);
      });
      sweptCount += 1;
      items.push({ depositId: row.id, status: 'swept', txHash: result.txHash, network: row.network });
    } catch (err) {
      failedCount += 1;
      const errorMessage = err.message || 'SWEEP_FAILED';
      await withTx(async (trx) => {
        await markDepositSweepFailed(trx, row.id, isGasRelatedError(errorMessage) ? `INSUFFICIENT_GAS: ${errorMessage}` : errorMessage);
      });
      items.push({
        depositId: row.id,
        status: isGasRelatedError(errorMessage) ? 'insufficient_gas' : 'failed',
        error: errorMessage,
        network: row.network,
      });
    }
  }

  await db('treasury_sweep_runs').where({ id: runId }).update({
    status: failedCount > 0 ? 'completed_with_errors' : 'completed',
    swept_count: sweptCount,
    failed_count: failedCount,
    meta: JSON.stringify({ items }),
    finished_at: new Date(),
    updated_at: new Date(),
  });

  return {
    runId,
    sweptCount,
    failedCount,
    items,
  };
}
