import { HDNodeWallet, JsonRpcProvider, formatUnits, parseUnits } from 'ethers';
import QRCode from 'qrcode';
import { db, withTx } from '../db.js';
import { cfg } from '../config.js';
import {
  creditDeposit,
  creditBonus,
  getAccountBalance,
  getBalancesByNamespace,
  journal,
} from './ledgerService.js';
import { audit } from './auditService.js';
import { applyWalletCreditRecord, applyWalletDebitRecord } from './walletAccountingService.js';
import { getUserSipLiabilities } from './sipService.js';
import { getSignalAssetByNetwork, listSignalAssets } from './signalAssetService.js';
import { provisionUserWallets, getUserWalletByNetwork, listUserWallets, findWalletOwnerByAddress } from './userWalletService.js';
import { generateGlobalTxnId } from '../utils/generateGlobalTxnId.js';
import { getWithdrawalPolicyContext } from './withdrawalPolicy.service.js';
import { buildAddressExplorerUrl, buildExplorerUrl, normalizeFundingNetwork } from './fundingMirror.service.js';
import { toAbsoluteProfilePhotoUrl } from './userService.js';

const SUPPORTED_CHAINS = ['ETH', 'BSC'];
const NETWORK_CHAIN_MAP = {
  ERC20: 'ETH',
  ETH: 'ETH',
  BEP20: 'BSC',
  BSC: 'BSC',
  TRC20: 'TRC20',
};
const NATIVE_ASSET = {
  ETH: 'ETH',
  BSC: 'BNB',
};
const ADMIN_TREASURY_NAMESPACE = 'admin:treasury';
const WALLET_NAMESPACE_MAP = {
  spot: 'spot:available',
  futures: 'futures:available',
};
const tableColumnCache = new Map();

function parseMeta(meta) {
  if (!meta) return {};
  if (typeof meta === 'object') return meta;
  try {
    return JSON.parse(meta);
  } catch (err) {
    return {};
  }
}

function serializeMeta(current, patch = {}) {
  const base = parseMeta(current);
  return JSON.stringify({ ...base, ...patch });
}

function toAmountBig(amount) {
  if (typeof amount === 'bigint') return amount;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) throw new Error('Invalid amount');
    return parseUnits(amount.toString(), 18);
  }
  if (typeof amount === 'string') {
    if (!amount.trim()) throw new Error('Invalid amount');
    return parseUnits(amount.trim(), 18);
  }
  throw new Error('Invalid amount type');
}

function resolveInsertId(result) {
  if (Array.isArray(result)) {
    const value = result[0];
    if (value && typeof value === 'object') {
      return value.id ?? value.ID ?? Object.values(value)[0];
    }
    return value;
  }
  if (result && typeof result === 'object') {
    return result.id ?? result.ID ?? Object.values(result)[0];
  }
  return result;
}

function getWithdrawalSummaryAmount(row) {
  const meta = parseMeta(row?.meta);
  const payoutAmount = Number(meta?.payoutAmount);
  if (Number.isFinite(payoutAmount) && payoutAmount > 0) return payoutAmount;
  const netAmount = Number(meta?.netAmount);
  if (Number.isFinite(netAmount) && netAmount > 0) return netAmount;
  const amount = Number(row?.amount || 0);
  return Number.isFinite(amount) ? amount : 0;
}

async function getTableColumns(tableName, trx = db) {
  if (tableColumnCache.has(tableName)) {
    return tableColumnCache.get(tableName);
  }

  const columns = new Set();
  try {
    const result = await trx.raw(
      'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? AND TABLE_SCHEMA = DATABASE()',
      [tableName]
    );
    const rows = Array.isArray(result) ? result[0] || [] : [];
    for (const row of rows) {
      if (row?.COLUMN_NAME) columns.add(row.COLUMN_NAME);
    }
  } catch (err) {
    console.error(`[walletService] failed to inspect columns for ${tableName}:`, err.message);
  }

  tableColumnCache.set(tableName, columns);
  return columns;
}

async function filterInsertableFields(tableName, payload, trx) {
  const columns = await getTableColumns(tableName, trx);
  if (!columns.size) return payload;

  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => columns.has(key))
  );
}

function requireChain(chain) {
  const normalized = String(chain || '').toUpperCase();
  const mapped = NETWORK_CHAIN_MAP[normalized] || normalized;
  if (mapped === 'TRC20') return mapped;
  if (!SUPPORTED_CHAINS.includes(mapped)) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return mapped;
}

function getProvider(chain) {
  const rpcUrl =
    (cfg.custodial?.rpcUrls && cfg.custodial.rpcUrls[chain]) ||
    process.env[`${chain}_RPC_URL`];
  if (!rpcUrl) {
    throw new Error(`${chain} RPC URL not configured`);
  }
  return new JsonRpcProvider(rpcUrl);
}

function getMasterNode() {
  const xprv = cfg.custodial?.masterXprv || process.env.MASTER_XPRV;
  if (!xprv) throw new Error('MASTER_XPRV not configured');
  return HDNodeWallet.fromExtendedKey(xprv);
}

export async function createDepositAddress({ userId, chain }, { trx } = {}) {
  if (!userId) throw new Error('userId required');
  const requestedNetwork = String(chain || '').toUpperCase();
  if (['ERC20', 'BEP20', 'TRC20'].includes(requestedNetwork)) {
    await provisionUserWallets(userId, { trx });
    const userWallet = await getUserWalletByNetwork(userId, requestedNetwork, { trx });
    const assetConfig = await getSignalAssetByNetwork(requestedNetwork);
    if (!userWallet) throw new Error('USER_WALLET_NOT_FOUND');
    return {
      address: userWallet.address,
      chain: requestedNetwork,
      asset: assetConfig?.asset || 'USDT',
      label: assetConfig?.displayName || `USDT ${requestedNetwork}`,
      fee: Number(assetConfig?.withdrawFee || 0),
      memo: null,
      updatedAt: userWallet.updatedAt,
    };
  }
  const assetConfig = await getSignalAssetByNetwork(requestedNetwork);
  if (assetConfig && assetConfig.networkType === 'TRON') {
    return {
      address: assetConfig.depositWallet || assetConfig.hotWallet || '',
      chain: assetConfig.network,
      asset: assetConfig.asset,
      label: assetConfig.displayName,
      fee: Number(assetConfig.withdrawFee || 0),
      memo: null,
      updatedAt: assetConfig.updatedAt,
    };
  }
  const normalizedChain = requireChain(requestedNetwork);
  const conn = trx || db;

  const existing = await conn('deposit_addresses')
    .where({ user_id: userId, chain: normalizedChain })
    .first();
  if (existing) {
    return {
      address: existing.address,
      chain: assetConfig?.network || requestedNetwork || existing.chain,
      asset: assetConfig?.asset || 'USDT',
      label: assetConfig?.displayName || `${assetConfig?.asset || 'USDT'} ${assetConfig?.network || requestedNetwork}`,
      fee: Number(assetConfig?.withdrawFee || 0),
      memo: null,
      updatedAt: existing.updated_at,
    };
  }

  const node = getMasterNode();
  const lastIndexRow = await conn('deposit_addresses')
    .max({ maxIndex: 'address_index' })
    .first();
  const previousIndex = Number(lastIndexRow?.maxIndex ?? -1);
  const nextIndex = Number.isFinite(previousIndex) ? previousIndex + 1 : 0;
  const masterBase = (cfg.custodial?.masterBasePath || 'm').replace(/\/+$/, '');
  const deriveBase = (
    cfg.custodial?.baseDerivationPath || "m/44'/60'/0'/0"
  ).replace(/\/+$/, '');
  const fullBase = deriveBase.startsWith('m') ? deriveBase : `m/${deriveBase}`;
  const path = `${fullBase}/${nextIndex}`;
  const fullPath = path;
  if (!fullPath.startsWith(masterBase)) {
    throw new Error('Custodial derivation path incompatible with master base path');
  }
  const targetSegments = fullPath.replace(/^m\//i, '').split('/').filter(Boolean);
  const masterSegments = masterBase.replace(/^m\//i, '').split('/').filter(Boolean);
  const remaining = targetSegments.slice(masterSegments.length);
  if (remaining.length === 0 && targetSegments.length !== masterSegments.length) {
    throw new Error('Invalid derivation path configuration');
  }
  const relativePath = remaining.join('/');
  const derived = remaining.length ? node.derivePath(relativePath) : node;
  const address = derived.address;
  const now = new Date();

  await conn('deposit_addresses').insert({
    user_id: userId,
    chain: normalizedChain,
    address: address.toLowerCase(),
    path,
    address_index: nextIndex,
    created_at: now,
    updated_at: now,
  });

  return {
    address,
    chain: assetConfig?.network || requestedNetwork || normalizedChain,
    asset: assetConfig?.asset || 'USDT',
    label: assetConfig?.displayName || `${assetConfig?.asset || 'USDT'} ${assetConfig?.network || requestedNetwork}`,
    fee: Number(assetConfig?.withdrawFee || 0),
    memo: null,
    updatedAt: now,
  };
}

export async function handleInboundTx({ chain, txHash }) {
  const normalizedChain = requireChain(chain);
  if (!txHash) throw new Error('txHash required');

  const provider = getProvider(normalizedChain);
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error('Transaction not found');
  if (receipt.status !== 1) throw new Error('Transaction failed');
  if (!receipt.to) throw new Error('Transaction has no recipient');

  const address = receipt.to.toLowerCase();
  const depositAddress = await db('deposit_addresses')
    .where({ chain: normalizedChain, address })
    .first();
  let managedUserId = depositAddress?.user_id;
  if (!managedUserId) {
    const mappedNetwork =
      normalizedChain === 'ETH' ? 'ERC20' : normalizedChain === 'BSC' ? 'BEP20' : normalizedChain;
    const ownedWallet = await findWalletOwnerByAddress(mappedNetwork, receipt.to);
    managedUserId = ownedWallet?.userId;
  }
  if (!managedUserId) throw new Error('Destination not managed');

  const existing = await db('deposits')
    .where({ chain: normalizedChain, tx_hash: txHash })
    .first();
  if (existing) return existing;

  const requiredConfs = 12;
  const currentBlock = await provider.getBlockNumber();
  const confirmations = receipt.blockNumber
    ? currentBlock - receipt.blockNumber + 1
    : 0;
  if (confirmations < requiredConfs) {
    throw new Error(`Insufficient confirmations (${confirmations}/${requiredConfs})`);
  }

  const tx = await provider.getTransaction(txHash);
  if (!tx) throw new Error('Transaction payload unavailable');
  if (!tx.value || tx.value <= 0n) throw new Error('Transaction has zero value');
  const amountFormatted = formatUnits(tx.value, 18);
  const asset = NATIVE_ASSET[normalizedChain] || 'NATIVE';
  const now = new Date();

  await withTx(async (trx) => {
    const insertedDeposit = await trx('deposits').insert({
      user_id: managedUserId,
      chain: normalizedChain,
      asset,
      tx_hash: txHash,
      amount: amountFormatted,
      confirmations,
      block_number: receipt.blockNumber,
      confirmed_at: now,
      created_at: now,
      updated_at: now,
    });
    const depositId = resolveInsertId(insertedDeposit);
    const depositTxnId = await generateGlobalTxnId(trx, 'DEP');
    await trx('deposits').where({ id: depositId }).update({ txn_id: depositTxnId, updated_at: now });
    await creditDeposit(managedUserId, asset, amountFormatted, trx);
  });

  return { userId: managedUserId, chain: normalizedChain, amount: amountFormatted };
}

export async function requestWithdrawal({ userId, asset, amount, to, chain, memo = null, details = null }) {
  if (!userId) throw new Error('userId is required');
  if (!asset) throw new Error('asset is required');
  if (!amount) throw new Error('amount is required');
  if (!to) throw new Error('Destination address required');
  const requestedChain = String(chain || '').toUpperCase();
  const assetConfig = await getSignalAssetByNetwork(requestedChain);
  if (!assetConfig || !assetConfig.isEnabled) throw new Error('NETWORK_NOT_SUPPORTED');
  const normalizedChain = assetConfig.network;
  const withdrawalPolicy = await getWithdrawalPolicyContext(userId, amount);

  return withTx(async (trx) => {
    if (!withdrawalPolicy.policy.withdrawalEnabled) throw new Error('WITHDRAWAL_DISABLED');
    if (!withdrawalPolicy.user.activeUser) throw new Error('WITHDRAWAL_REQUIRES_ACTIVE_USER');
    if (!withdrawalPolicy.user.kycVerified) throw new Error('WITHDRAWAL_REQUIRES_KYC');
    if (
      withdrawalPolicy.policy.minimumWithdrawalAmount > 0 &&
      Number(amount) < withdrawalPolicy.policy.minimumWithdrawalAmount
    ) {
      throw new Error(`MINIMUM_WITHDRAWAL_${withdrawalPolicy.policy.minimumWithdrawalAmount}`);
    }
    if (
      withdrawalPolicy.policy.maximumWithdrawalAmount > 0 &&
      Number(amount) > withdrawalPolicy.policy.maximumWithdrawalAmount
    ) {
      throw new Error(`MAXIMUM_WITHDRAWAL_${withdrawalPolicy.policy.maximumWithdrawalAmount}`);
    }

    const balance = await getAccountBalance(
      { userId, namespace: 'spot:available', asset },
      trx
    );
    const amountBig = parseUnits(String(amount), 18);
    if (amountBig <= 0n) throw new Error('Amount must be positive');
    if (balance < amountBig) throw new Error('Insufficient balance');

    const now = new Date();
    const policySnapshot = {
      note: withdrawalPolicy.policy.withdrawalNote || null,
      userDetails: details ? String(details).trim() : null,
      userMemo: memo ? String(memo).trim() : null,
      adminFeePercent: withdrawalPolicy.policy.adminFeePercent,
      adminFeeAmount: withdrawalPolicy.preview.adminFeeAmount,
      lockPeriodDays: withdrawalPolicy.policy.lockPeriodDays,
      accountAgeDays: withdrawalPolicy.user.accountAgeDays,
      activeUser: withdrawalPolicy.user.activeUser,
      kycVerified: withdrawalPolicy.user.kycVerified,
      canRequestWithdrawal: withdrawalPolicy.user.canRequestWithdrawal,
      eligibilityWarnings: withdrawalPolicy.user.eligibilityWarnings,
      lockActive: withdrawalPolicy.user.lockActive,
      daysRemaining: withdrawalPolicy.user.daysRemaining,
      earlyPenaltyPercent: withdrawalPolicy.policy.earlyPenaltyPercent,
      earlyPenaltyAmount: withdrawalPolicy.preview.earlyPenaltyAmount,
      rewardReductionEnabled: withdrawalPolicy.policy.rewardReductionEnabled,
      rewardReductionType: withdrawalPolicy.policy.rewardReductionType,
      netAmount: withdrawalPolicy.preview.netAmount,
      requestedAmount: withdrawalPolicy.preview.requestedAmount,
      warningLines: [
        withdrawalPolicy.user.lockActive
          ? `Withdrawal locked for ${withdrawalPolicy.user.daysRemaining} more day(s). Early penalty ${withdrawalPolicy.policy.earlyPenaltyPercent}% applies.`
          : null,
        withdrawalPolicy.policy.adminFeePercent > 0
          ? `Admin fee applied: ${withdrawalPolicy.policy.adminFeePercent}%`
          : null,
        withdrawalPolicy.policy.rewardReductionEnabled
          ? `Reward reduction applied: ${withdrawalPolicy.policy.rewardReductionType || 'ENABLED'}`
          : null,
      ].filter(Boolean),
    };
    const withdrawalInsert = await filterInsertableFields('withdrawals', {
      user_id: userId,
      chain: normalizedChain,
      asset,
      token_contract: assetConfig.contractAddress || null,
      amount: formatUnits(amountBig, 18),
      to,
      memo: memo ? String(memo).trim() : null,
      meta: policySnapshot,
      status: 'pending',
      requested_at: now,
      created_at: now,
      updated_at: now,
    }, trx);
    const insertedWithdrawal = await trx('withdrawals').insert(withdrawalInsert);
    const withdrawalId = resolveInsertId(insertedWithdrawal);
    const withdrawalTxnId = await generateGlobalTxnId(trx, 'WDR');
    await trx('withdrawals').where({ id: withdrawalId }).update({ txn_id: withdrawalTxnId, updated_at: now });

    await journal(
      trx,
      [
        {
          account: { userId, namespace: 'spot:available', asset },
          amount: -amountBig,
          meta: { reason: 'withdrawal_reserve', withdrawalId },
        },
        {
          account: { userId, namespace: 'spot:pending_withdrawal', asset },
          amount: amountBig,
          meta: { reason: 'withdrawal_reserve', withdrawalId },
        },
      ],
      { description: `Withdrawal reserve ${asset}`, meta: { userId, withdrawalId } }
    );

    if (String(asset).toUpperCase() === 'USDT') {
      await applyWalletDebitRecord(
        {
          userId,
          amount: amountBig,
          type: 'withdrawal_debit',
          sourceType: 'withdrawal_request',
          referenceId: withdrawalId,
          remark: 'Withdrawal reserved from main wallet balance',
          meta: { chain: normalizedChain, to, memo: memo ? String(memo).trim() : null },
        },
        trx
      );
    }

    return {
      id: withdrawalId,
      txn_id: withdrawalTxnId,
      status: 'pending',
      amount: formatUnits(amountBig, 18),
      asset,
      to,
      chain: normalizedChain,
      token_contract: assetConfig.contractAddress || null,
      policy: policySnapshot,
    };
  });
}

export async function getDepositAddressWithQr({ userId, chain }) {
  const addressInfo = await createDepositAddress({ userId, chain });
  const qrData = await generateQr(addressInfo.address);
  return { ...addressInfo, qrData };
}

async function generateQr(address) {
  return QRCode.toDataURL(address, {
    errorCorrectionLevel: 'M',
    margin: 1,
    scale: 6,
  });
}

export async function listDepositAddresses(userId) {
  await provisionUserWallets(userId);
  const configs = await listSignalAssets({ includeDisabled: false });
  const userWallets = await listUserWallets(userId);
  const walletMap = new Map(userWallets.map((item) => [item.network, item]));
  if (configs.length === 0) {
    return Promise.all(
      userWallets.map(async (row) => ({
        chain: row.network,
        asset: 'USDT',
        label: `USDT ${row.network}`,
        address: row.address,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        qrData: await generateQr(row.address),
      }))
    );
  }

  const results = await Promise.all(
    configs.map(async (config) => {
      const wallet = walletMap.get(config.network);
      const address = wallet?.address || '';
      return {
        chain: config.network,
        asset: config.asset,
        label: config.displayName,
        address,
        fee: Number(config.withdrawFee || 0),
        memo: null,
        updatedAt: wallet?.updatedAt || config.updatedAt,
        qrData: address ? await generateQr(address) : null,
      };
    })
  );

  return results;
}

export async function getBalances(userId) {
  const namespaces = [
    'spot:available',
    'spot:pending_withdrawal',
    'spot:locked',
    'futures:available',
    'futures:margin',
    'futures:unrealized',
  ];
  const rows = await getBalancesByNamespace(userId, namespaces);
  const result = {
    spot: {},
    futures: {},
  };

  for (const row of rows) {
    const amount = row.amount || '0';
    const asset = row.asset;
    if (row.namespace.startsWith('spot:')) {
      const key = row.namespace.split(':')[1] || 'available';
      if (!result.spot[asset]) result.spot[asset] = {};
      result.spot[asset][key] = amount;
    } else if (row.namespace.startsWith('futures:')) {
      const key = row.namespace.split(':')[1] || 'available';
      if (!result.futures[asset]) result.futures[asset] = {};
      result.futures[asset][key] = amount;
    }
  }

  const sipLiabilities = await getUserSipLiabilities(userId);
  for (const liability of sipLiabilities) {
    if (!result.spot[liability.asset]) result.spot[liability.asset] = {};
    result.spot[liability.asset].sip = liability.amountAsset;
  }
  result.sip = sipLiabilities;

  return result;
}

export async function getFundingHistory(userId, { limit = 25 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 100);
  const [deposits, withdrawals] = await Promise.all([
    db('deposits')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(safeLimit),
    db('withdrawals')
      .where({ user_id: userId })
      .orderBy('created_at', 'desc')
      .limit(safeLimit),
  ]);

  const mapStatus = (status, confirmedAt) => {
    if (status === 'confirmed' || confirmedAt) return 'completed';
    if (status === 'broadcasted') return 'broadcasted';
    if (status === 'pending') return 'pending';
    if (status === 'failed') return 'failed';
    return status || 'pending';
  };

  const combined = [
    ...deposits.map((row) => ({
      ...(function () {
        const meta = parseMeta(row.meta);
        const explorerNetwork = meta?.explorerNetwork ? ` (${meta.explorerNetwork})` : '';
        return {
          networkLabel: `${row.chain}${explorerNetwork}`,
        };
      })(),
      id: `deposit-${row.id}`,
      type: 'deposit',
      txn_id: row.txn_id || `TXN-DEP-${String(Number(row.id) || 0).padStart(6, '0')}`,
      asset: row.asset,
      chain: row.chain,
      amount: row.amount,
      status: 'completed',
      txHash: row.tx_hash,
      txId: row.tx_hash,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      meta: parseMeta(row.meta),
      createdAt: row.created_at,
      completedAt: row.confirmed_at,
    })),
    ...withdrawals.map((row) => ({
      id: `withdrawal-${row.id}`,
      type: 'withdrawal',
      txn_id: row.txn_id || `TXN-WDR-${String(Number(row.id) || 0).padStart(6, '0')}`,
      asset: row.asset,
      chain: row.chain,
      amount: row.amount,
      status: mapStatus(row.status, row.confirmed_at),
      txHash: row.tx_hash,
      createdAt: row.requested_at || row.created_at,
      completedAt: row.confirmed_at,
    })),
  ];

  combined.sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  return combined.slice(0, safeLimit);
}

export async function creditUserBonus({ userId, asset, amount, reason, trx }) {
  return creditBonus(userId, asset, amount, { reason }, trx);
}

export async function adminListWithdrawals({
  status,
  statuses,
  limit = 100,
  page = 1,
  userId,
  network,
  fromDate,
  toDate,
  eligibleOnly = false,
} = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 500);
  const safePage = Math.max(Number(page) || 1, 1);
  const query = db('withdrawals as w')
    .leftJoin('users as u', 'w.user_id', 'u.id')
    .leftJoin('user_profiles as up', 'up.user_id', 'u.id');
  if (status) query.where('w.status', String(status).toLowerCase());
  if (Array.isArray(statuses) && statuses.length > 0) query.whereIn('w.status', statuses.map((value) => String(value).toLowerCase()));
  if (userId) query.where('w.user_id', Number(userId));
  if (network) query.whereRaw('LOWER(COALESCE(w.chain, \'\')) = ?', [String(network).toLowerCase()]);
  if (fromDate) query.where('w.requested_at', '>=', new Date(`${fromDate}T00:00:00.000Z`));
  if (toDate) query.where('w.requested_at', '<=', new Date(`${toDate}T23:59:59.999Z`));
  if (eligibleOnly) {
    query.whereRaw('LOWER(COALESCE(u.status, ?)) = ?', ['inactive', 'active']).andWhere('u.kyc_verified', true);
  }

  const [countRow, rows, summaryRows] = await Promise.all([
    query.clone().count({ total: 'w.id' }).first(),
    query
      .clone()
      .select(
        'w.*',
        'u.email as user_email',
        'u.status as user_status',
        'u.kyc_verified as user_kyc_verified',
        'up.display_name as user_name',
        'up.profile_photo as user_profile_photo'
      )
      .orderBy('w.created_at', 'desc')
      .offset((safePage - 1) * safeLimit)
      .limit(safeLimit),
    query.clone().select('w.chain', 'w.amount', 'w.meta'),
  ]);

  const total = Number(countRow?.total || 0);
  const items = await Promise.all(
    rows.map(async (row) => {
      const meta = parseMeta(row.meta);
      return {
        id: row.id,
        txn_id: row.txn_id || `TXN-WDR-${String(Number(row.id) || 0).padStart(6, '0')}`,
        userId: row.user_id,
        email: row.user_email,
        userName: row.user_name || null,
        profilePhoto: toAbsoluteProfilePhotoUrl(row.user_profile_photo),
        userStatus: row.user_status || null,
        kycVerified: !!row.user_kyc_verified,
        chain: row.chain,
        asset: row.asset,
        amount: row.amount,
        memo: row.memo || null,
        address: row.to,
        to: row.to,
        explorerUrl: row.to ? await buildAddressExplorerUrl(row.chain, row.to) : null,
        txExplorerUrl: row.tx_hash ? await buildExplorerUrl(row.chain, row.tx_hash) : null,
        status: row.status,
        txHash: row.tx_hash,
        requestedAt: row.requested_at,
        broadcastedAt: row.broadcasted_at,
        confirmedAt: row.confirmed_at,
        meta,
        adminNotes: meta?.adminNotes || meta?.reason || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    })
  );

  const summary = {
    totalUsdt: 0,
    totalErc20: 0,
    totalBep20: 0,
    totalTrc20: 0,
  };

  for (const row of summaryRows) {
    const amount = getWithdrawalSummaryAmount(row);
    summary.totalUsdt += amount;
    const network = normalizeFundingNetwork(row.chain);
    if (network === 'ethereum') summary.totalErc20 += amount;
    if (network === 'bsc') summary.totalBep20 += amount;
    if (network === 'tron') summary.totalTrc20 += amount;
  }

  return {
    items,
    summary: {
      totalUsdt: String(summary.totalUsdt),
      totalErc20: String(summary.totalErc20),
      totalBep20: String(summary.totalBep20),
      totalTrc20: String(summary.totalTrc20),
    },
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

export async function adminApproveWithdrawal({ withdrawalId, txHash, reviewerId }) {
  if (!withdrawalId) throw new Error('WITHDRAWAL_ID_REQUIRED');
  const pendingRow = await db('withdrawals').where({ id: withdrawalId }).first();
  if (!pendingRow) throw new Error('WITHDRAWAL_NOT_FOUND');
  if (pendingRow.status !== 'pending') throw new Error('WITHDRAWAL_NOT_PENDING');
  const normalizedTxHash = String(txHash || '').trim();
  if (!normalizedTxHash) throw new Error('TX_HASH_REQUIRED');

  const pendingMeta = parseMeta(pendingRow.meta);
  const payoutAmountDecimal =
    Number.isFinite(Number(pendingMeta?.netAmount)) && Number(pendingMeta.netAmount) > 0
      ? String(pendingMeta.netAmount)
      : String(pendingRow.amount);

  const finalTxHash = normalizedTxHash;

  return withTx(async (trx) => {
    const row = await trx('withdrawals').where({ id: withdrawalId }).forUpdate().first();
    if (!row) throw new Error('WITHDRAWAL_NOT_FOUND');
    if (row.status !== 'pending') throw new Error('WITHDRAWAL_NOT_PENDING');
    const amountBig = toAmountBig(row.amount);
    if (amountBig <= 0n) throw new Error('INVALID_AMOUNT');
    const now = new Date();
    await journal(
      trx,
      [
        {
          account: { userId: row.user_id, namespace: 'spot:pending_withdrawal', asset: row.asset },
          amount: -amountBig,
          meta: { withdrawalId: row.id, action: 'release' },
        },
        {
          account: { userId: null, namespace: 'hot:wallet', asset: row.asset },
          amount: amountBig,
          meta: { withdrawalId: row.id, action: 'payout' },
        },
      ],
      { description: `Withdrawal approve ${row.asset}`, meta: { withdrawalId: row.id, reviewerId } }
    );

    const meta = serializeMeta(row.meta, {
      approvedBy: reviewerId,
      approvedAt: now.toISOString(),
      txHash: finalTxHash || null,
      payoutAmount: payoutAmountDecimal,
      adminNotes: `Approved manually with tx hash ${finalTxHash}`,
    });

    await trx('withdrawals')
      .where({ id: row.id })
      .update({
        status: 'approved',
        tx_hash: finalTxHash,
        broadcasted_at: now,
        updated_at: now,
        meta,
      });

    await audit(reviewerId, 'withdrawal.approved', { withdrawalId: row.id, userId: row.user_id });

    return {
      id: row.id,
      status: 'approved',
      txHash: finalTxHash || null,
      adminNotes: `Approved manually with tx hash ${finalTxHash}`,
    };
  });
}

export async function adminRejectWithdrawal({ withdrawalId, reason, reviewerId }) {
  if (!withdrawalId) throw new Error('WITHDRAWAL_ID_REQUIRED');
  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) throw new Error('ADMIN_NOTES_REQUIRED');
  return withTx(async (trx) => {
    const row = await trx('withdrawals').where({ id: withdrawalId }).forUpdate().first();
    if (!row) throw new Error('WITHDRAWAL_NOT_FOUND');
    if (row.status !== 'pending') throw new Error('WITHDRAWAL_NOT_PENDING');
    const amountBig = toAmountBig(row.amount);
    const now = new Date();

    await journal(
      trx,
      [
        {
          account: { userId: row.user_id, namespace: 'spot:pending_withdrawal', asset: row.asset },
          amount: -amountBig,
          meta: { withdrawalId: row.id, action: 'reject_release' },
        },
        {
          account: { userId: row.user_id, namespace: 'spot:available', asset: row.asset },
          amount: amountBig,
          meta: { withdrawalId: row.id, action: 'reject_release' },
        },
      ],
      { description: `Withdrawal reject ${row.asset}`, meta: { withdrawalId: row.id, reviewerId } }
    );

    if (String(row.asset).toUpperCase() === 'USDT') {
      await applyWalletCreditRecord(
        {
          userId: row.user_id,
          amount: amountBig,
          type: 'withdrawal_reversal_credit',
          sourceType: 'withdrawal_rejected',
          referenceId: row.id,
          remark: 'Rejected withdrawal returned to main wallet balance',
          meta: { reviewerId, reason: normalizedReason },
        },
        trx
      );
    }

    const meta = serializeMeta(row.meta, {
      rejectedBy: reviewerId,
      rejectedAt: now.toISOString(),
      reason: normalizedReason,
      adminNotes: normalizedReason,
    });

    await trx('withdrawals')
      .where({ id: row.id })
      .update({
        status: 'rejected',
        updated_at: now,
        meta,
      });

    await audit(reviewerId, 'withdrawal.rejected', { withdrawalId: row.id, userId: row.user_id, reason: normalizedReason });

    return {
      id: row.id,
      status: 'rejected',
      adminNotes: normalizedReason,
    };
  });
}

export async function adminAdjustBalance({
  userId,
  asset,
  amount,
  namespace = 'spot:available',
  operation = 'credit',
  memo,
  orderId,
  reviewerId,
}) {
  if (!userId) throw new Error('userId required');
  if (!asset) throw new Error('asset required');
  const normalizedNamespace = String(namespace || '').trim() || 'spot:available';
  const normalizedOperation = String(operation || 'credit').toLowerCase();
  if (!['credit', 'debit'].includes(normalizedOperation)) throw new Error('INVALID_OPERATION');
  const amountBig = toAmountBig(amount);
  if (amountBig <= 0n) throw new Error('AMOUNT_MUST_BE_POSITIVE');

  await withTx(async (trx) => {
    if (normalizedOperation === 'credit') {
      await journal(
        trx,
        [
          {
            account: { userId: null, namespace: ADMIN_TREASURY_NAMESPACE, asset },
            amount: -amountBig,
            meta: { action: 'admin_credit', reviewerId },
          },
          {
            account: { userId, namespace: normalizedNamespace, asset },
            amount: amountBig,
            meta: { action: 'admin_credit', reviewerId },
          },
        ],
        { description: `Admin credit ${asset}`, meta: { userId, reviewerId, memo, namespace: normalizedNamespace } }
      );
      if (String(asset).toUpperCase() === 'USDT' && normalizedNamespace === 'spot:available') {
        await applyWalletCreditRecord(
          {
            userId,
            amount: amountBig,
            type: 'admin_adjustment_credit',
            sourceType: 'admin_adjustment',
            referenceId: orderId || null,
            remark: memo || 'Admin credited main wallet balance',
            meta: { reviewerId, namespace: normalizedNamespace, orderId: orderId || null },
          },
          trx
        );
      }
    } else {
      await journal(
        trx,
        [
          {
            account: { userId, namespace: normalizedNamespace, asset },
            amount: -amountBig,
            meta: { action: 'admin_debit', reviewerId },
          },
          {
            account: { userId: null, namespace: ADMIN_TREASURY_NAMESPACE, asset },
            amount: amountBig,
            meta: { action: 'admin_debit', reviewerId },
          },
        ],
        { description: `Admin debit ${asset}`, meta: { userId, reviewerId, memo, namespace: normalizedNamespace } }
      );
      if (String(asset).toUpperCase() === 'USDT' && normalizedNamespace === 'spot:available') {
        await applyWalletDebitRecord(
          {
            userId,
            amount: amountBig,
            type: 'admin_adjustment_debit',
            sourceType: 'admin_adjustment',
            referenceId: orderId || null,
            remark: memo || 'Admin debited main wallet balance',
            meta: { reviewerId, namespace: normalizedNamespace, orderId: orderId || null },
          },
          trx
        );
      }
    }
  });

  await audit(reviewerId, `wallet.${normalizedOperation}`, {
    userId,
    asset,
    amount,
    namespace: normalizedNamespace,
    memo,
    orderId: orderId || null,
  });

  return {
    userId,
    asset,
    amount: typeof amount === 'number' ? amount : amount.toString(),
    namespace: normalizedNamespace,
    operation: normalizedOperation,
    orderId: orderId || null,
  };
}

export async function transferBetweenWallets({ userId, from, to, asset, amount }, { trx } = {}) {
  if (!userId) throw new Error('userId required');
  const normalizedFrom = String(from || '').toLowerCase();
  const normalizedTo = String(to || '').toLowerCase();
  if (normalizedFrom === normalizedTo) throw new Error('WALLET_MISMATCH');
  const fromNamespace = WALLET_NAMESPACE_MAP[normalizedFrom];
  const toNamespace = WALLET_NAMESPACE_MAP[normalizedTo];
  if (!fromNamespace || !toNamespace) throw new Error('INVALID_WALLET');
  const assetCode = String(asset || '').trim().toUpperCase();
  if (!assetCode) throw new Error('ASSET_REQUIRED');
  const amountBig = toAmountBig(amount);
  if (amountBig <= 0n) throw new Error('AMOUNT_MUST_BE_POSITIVE');

  const execute = async (conn) => {
    const fromBalance = await getAccountBalance(
      { userId, namespace: fromNamespace, asset: assetCode },
      conn
    );
    if (fromBalance < amountBig) {
      const err = new Error('INSUFFICIENT_FUNDS');
      err.status = 400;
      throw err;
    }

    await journal(
      conn,
      [
        {
          account: { userId, namespace: fromNamespace, asset: assetCode },
          amount: -amountBig,
          meta: { reason: 'wallet_transfer', from: normalizedFrom, to: normalizedTo },
        },
        {
          account: { userId, namespace: toNamespace, asset: assetCode },
          amount: amountBig,
          meta: { reason: 'wallet_transfer', from: normalizedFrom, to: normalizedTo },
        },
      ],
      {
        description: `Wallet transfer ${normalizedFrom} -> ${normalizedTo}`,
        meta: { userId, asset: assetCode, amount: formatUnits(amountBig, 18) },
      }
    );
  };

  if (trx) {
    await execute(trx);
  } else {
    await withTx(async (innerTrx) => execute(innerTrx));
  }

  return {
    from: normalizedFrom,
    to: normalizedTo,
    asset: assetCode,
    amount: formatUnits(amountBig, 18),
  };
}
export async function adminTransferBetweenWallets(payload) {
  return transferBetweenWallets(payload);
}
