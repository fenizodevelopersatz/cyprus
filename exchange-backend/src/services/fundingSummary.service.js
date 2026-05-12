import QRCode from 'qrcode';
import { formatUnits, parseUnits } from 'ethers';
import { db } from '../db.js';
import { listSignalAssets } from './signalAssetService.js';
import { getMainWalletBalanceBig } from './walletAccountingService.js';
import {
  buildCanonicalDepositTransactionIdsQuery,
  syncDepositTransactionsForUser,
  syncWalletAddressesForUser,
} from './fundingMirror.service.js';
import { getWithdrawalPolicyContext } from './withdrawalPolicy.service.js';

function toAmount(value) {
  return String(value || '0');
}

function toNetworkKey(network) {
  if (network === 'ERC20') return 'ethereum';
  if (network === 'BEP20') return 'bsc';
  if (network === 'TRC20') return 'tron';
  return null;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sumAmountStrings(values, decimals) {
  const total = values.reduce(
    (sum, value) => sum + parseUnits(String(value || '0'), decimals),
    0n
  );
  return formatUnits(total, decimals);
}

function formatCurrencyString(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00';
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getFundingSummary(userId) {
  await syncWalletAddressesForUser(userId);
  await syncDepositTransactionsForUser(userId);

  const [
    walletAddresses,
    assets,
    creditedRows,
    mainWalletBalanceBig,
    withdrawalPolicy,
    adminAdjustmentRows,
    signalIncomeRow,
    tenDaySalaryRow,
    withdrawalRows,
  ] = await Promise.all([
    db('wallet_addresses').where({ user_id: userId, token: 'USDT', is_active: 1 }).orderBy('id', 'asc'),
    listSignalAssets({ includeDisabled: false, asset: 'USDT' }),
    db('deposit_transactions')
      .whereIn(
        'id',
        buildCanonicalDepositTransactionIdsQuery(userId, {
          token: 'USDT',
          creditedOnly: true,
        })
      )
      .select('network', 'amount_decimal'),
    getMainWalletBalanceBig(userId),
    getWithdrawalPolicyContext(userId, 0),
    db('wallet_ledger')
      .where({ user_id: userId, status: 'SUCCESS' })
      .whereIn('type', ['admin_adjustment_credit', 'admin_adjustment_debit'])
      .select('type', 'credit', 'debit'),
    db('user_signal_logs')
      .where({ user_id: userId })
      .where('trade_status', 'CLOSED')
      .sum({ total: 'profit_amount' })
      .first(),
    db('mlm_income_history')
      .where({ user_id: userId, status: 'SUCCESS', income_type: 'level_bonus_10day' })
      .sum({ total: 'amount' })
      .first(),
    db('withdrawals')
      .where({ user_id: userId })
      .whereNotIn('status', ['rejected', 'failed'])
      .select('amount'),
  ]);
  const userBalanceValue = formatUnits(mainWalletBalanceBig, 18);

  const networkDecimals = {
    ethereum: 6,
    bsc: 18,
    tron: 6,
  };

  for (const asset of assets) {
    const networkKey = toNetworkKey(asset.network);
    if (!networkKey) continue;
    networkDecimals[networkKey] = toPositiveInteger(asset.decimals, networkDecimals[networkKey]);
  }

  const balanceDisplayDecimals = Math.max(...Object.values(networkDecimals));
  const breakdown = {
    ethereum: '0',
    bsc: '0',
    tron: '0',
  };

  const breakdownTotals = {
    ethereum: 0n,
    bsc: 0n,
    tron: 0n,
  };

  for (const row of creditedRows) {
    if (!row.network || breakdownTotals[row.network] === undefined) continue;
    breakdownTotals[row.network] += parseUnits(
      String(row.amount_decimal || '0'),
      networkDecimals[row.network]
    );
  }

  for (const networkKey of Object.keys(breakdown)) {
    breakdown[networkKey] = toAmount(
      formatUnits(breakdownTotals[networkKey], networkDecimals[networkKey])
    );
  }

  const adminAdjustmentBalanceBig = adminAdjustmentRows.reduce((sum, row) => {
    const credit = parseUnits(String(row.credit || '0'), 18);
    const debit = parseUnits(String(row.debit || '0'), 18);
    if (row.type === 'admin_adjustment_credit') return sum + credit;
    if (row.type === 'admin_adjustment_debit') return sum - debit;
    return sum;
  }, 0n);

  const directDepositTotal = creditedRows.reduce((sum, row) => sum + toNumber(row.amount_decimal), 0);
  const tradeProfitTotal = toNumber(signalIncomeRow?.total);
  const tenDaySalaryTotal = toNumber(tenDaySalaryRow?.total);
  const activeWithdrawalTotal = withdrawalRows.reduce((sum, row) => sum + toNumber(row.amount), 0);
  const withdrawWalletBalance = Math.max(0, directDepositTotal + tradeProfitTotal + tenDaySalaryTotal - activeWithdrawalTotal);

  const balance = {
    token: 'USDT',
    total: sumAmountStrings(Object.values(breakdown), balanceDisplayDecimals),
    decimals: balanceDisplayDecimals,
    breakdown,
    breakdownDecimals: networkDecimals,
  };

  const assetMap = new Map(
    assets.map((asset) => [
      toNetworkKey(asset.network),
      asset,
    ])
  );

  const depositAddresses = await Promise.all(
    walletAddresses.map(async (row) => {
      const asset = assetMap.get(row.network);
      const qrValue = row.address;
      return {
        network: row.network,
        label:
          asset?.displayName ||
          (row.network === 'ethereum' ? 'USDT Ethereum' : row.network === 'bsc' ? 'USDT BSC' : 'USDT TRON'),
        address: row.address,
        memoTag: row.memo_tag || null,
        networkFee: String(asset?.withdrawFee || '0.10'),
        qrValue,
        qrCode: qrValue ? await QRCode.toDataURL(qrValue, { margin: 1, scale: 6 }) : null,
        updatedAt: row.updated_at,
      };
    })
  );

  const latestUpdatedAt = depositAddresses.reduce((latest, entry) => {
    if (!entry.updatedAt) return latest;
    if (!latest) return entry.updatedAt;
    return new Date(entry.updatedAt).getTime() > new Date(latest).getTime() ? entry.updatedAt : latest;
  }, null);

  const counts = await db('deposit_transactions')
    .where({ user_id: userId, token: 'USDT' })
    .select('network', 'status')
    .count({ total: '*' })
    .groupBy('network', 'status');

  return {
    balance,
    mainWalletBalance: formatCurrencyString(userBalanceValue),
    main_wallet_balance: formatCurrencyString(userBalanceValue),
    withdrawWalletBalance: formatCurrencyString(withdrawWalletBalance),
    withdrawWalletBreakdown: {
      directDepositTotal: formatCurrencyString(directDepositTotal),
      tradeProfitTotal: formatCurrencyString(tradeProfitTotal),
      tenDaySalaryTotal: formatCurrencyString(tenDaySalaryTotal),
      activeWithdrawalTotal: formatCurrencyString(activeWithdrawalTotal),
    },
    adminAdjustmentBalance: formatCurrencyString(formatUnits(adminAdjustmentBalanceBig, 18)),
    withdrawalPolicy,
    depositAddresses,
    updatedAt: latestUpdatedAt,
    depositCounts: counts,
  };
}
