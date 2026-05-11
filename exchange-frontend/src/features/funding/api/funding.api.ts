import api from "../../../app/axios";
import { FUNDING_ENDPOINTS, WALLET_ENDPOINTS } from "../../../app/apiRoutes";

type ApiEnvelope<T> = { data: T };

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export type FundingAddress = {
  network: "ethereum" | "bsc" | "tron";
  label: string;
  address: string;
  memoTag: string | null;
  networkFee: string;
  qrValue: string;
  qrCode?: string | null;
  updatedAt?: string | null;
};

export type FundingSummary = {
  balance: {
    token: string;
    total: string;
    breakdown: Record<string, string>;
  };
  mainWalletBalance: string;
  adminAdjustmentBalance: string;
  withdrawalPolicy?: {
    policy: {
      withdrawalEnabled: boolean;
      withdrawalNote: string;
      adminFeePercent: number;
      lockPeriodDays: number;
      earlyPenaltyPercent: number;
      rewardReductionEnabled: boolean;
      rewardReductionType: string;
      minimumWithdrawalAmount: number;
      maximumWithdrawalAmount: number;
    };
    user: {
      createdAt: string | null;
      kycVerified: boolean;
      status: string;
      activeUser: boolean;
      canRequestWithdrawal: boolean;
      eligibilityWarnings: string[];
      accountAgeDays: number;
      lockActive: boolean;
      daysRemaining: number;
    };
    preview: {
      requestedAmount: number;
      adminFeeAmount: number;
      earlyPenaltyAmount: number;
      netAmount: number;
    };
  };
  depositAddresses: FundingAddress[];
  updatedAt?: string | null;
};

export type DepositHistoryItem = {
  id: number;
  txn_id?: string;
  hash: string;
  network: "ethereum" | "bsc" | "tron";
  type: "ERC" | "BEP" | "TRC";
  token: string;
  amount: string;
  createdAt: string;
  explorerUrl: string;
  status: string;
};

export type WithdrawHistoryItem = {
  id: number;
  txn_id?: string;
  network: string;
  token: string;
  amount: string;
  address: string;
  status: string;
  txHash?: string | null;
  explorerUrl?: string | null;
  txExplorerUrl?: string | null;
  meta?: Record<string, unknown>;
  createdAt: string;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type WithdrawalPayload = {
  address: string;
  amount: number;
  asset: string;
  chain: string;
  memo?: string;
  details?: string;
};

function mapSummary(payload: unknown): FundingSummary {
  const raw = asRecord(payload);
  const balanceRaw = asRecord(raw.balance);
  const withdrawalPolicyRaw = asRecord(raw.withdrawalPolicy);
  const withdrawalPolicyPolicyRaw = asRecord(withdrawalPolicyRaw.policy);
  const withdrawalPolicyUserRaw = asRecord(withdrawalPolicyRaw.user);
  const withdrawalPolicyPreviewRaw = asRecord(withdrawalPolicyRaw.preview);
  return {
    balance: {
      token: String(balanceRaw.token ?? "USDT"),
      total: String(balanceRaw.total ?? "0"),
      breakdown: asRecord(balanceRaw.breakdown) as Record<string, string>,
    },
    mainWalletBalance: String(raw.mainWalletBalance ?? raw.main_wallet_balance ?? balanceRaw.total ?? "0"),
    adminAdjustmentBalance: String(raw.adminAdjustmentBalance ?? "0"),
    withdrawalPolicy: raw.withdrawalPolicy
      ? {
          policy: {
            withdrawalEnabled: withdrawalPolicyPolicyRaw.withdrawalEnabled !== false,
            withdrawalNote: String(withdrawalPolicyPolicyRaw.withdrawalNote ?? ""),
            adminFeePercent: toNumber(withdrawalPolicyPolicyRaw.adminFeePercent, 0),
            lockPeriodDays: toNumber(withdrawalPolicyPolicyRaw.lockPeriodDays, 0),
            earlyPenaltyPercent: toNumber(withdrawalPolicyPolicyRaw.earlyPenaltyPercent, 0),
            rewardReductionEnabled: Boolean(withdrawalPolicyPolicyRaw.rewardReductionEnabled),
            rewardReductionType: String(withdrawalPolicyPolicyRaw.rewardReductionType ?? ""),
            minimumWithdrawalAmount: toNumber(withdrawalPolicyPolicyRaw.minimumWithdrawalAmount, 0),
            maximumWithdrawalAmount: toNumber(withdrawalPolicyPolicyRaw.maximumWithdrawalAmount, 0),
          },
          user: {
            createdAt:
              withdrawalPolicyUserRaw.createdAt === null || withdrawalPolicyUserRaw.createdAt === undefined
                ? null
                : String(withdrawalPolicyUserRaw.createdAt),
            kycVerified: Boolean(withdrawalPolicyUserRaw.kycVerified),
            status: String(withdrawalPolicyUserRaw.status ?? ""),
            activeUser: Boolean(withdrawalPolicyUserRaw.activeUser),
            canRequestWithdrawal: withdrawalPolicyUserRaw.canRequestWithdrawal !== false,
            eligibilityWarnings: asArray(withdrawalPolicyUserRaw.eligibilityWarnings).map((item) => String(item)),
            accountAgeDays: toNumber(withdrawalPolicyUserRaw.accountAgeDays, 0),
            lockActive: Boolean(withdrawalPolicyUserRaw.lockActive),
            daysRemaining: toNumber(withdrawalPolicyUserRaw.daysRemaining, 0),
          },
          preview: {
            requestedAmount: toNumber(withdrawalPolicyPreviewRaw.requestedAmount, 0),
            adminFeeAmount: toNumber(withdrawalPolicyPreviewRaw.adminFeeAmount, 0),
            earlyPenaltyAmount: toNumber(withdrawalPolicyPreviewRaw.earlyPenaltyAmount, 0),
            netAmount: toNumber(withdrawalPolicyPreviewRaw.netAmount, 0),
          },
        }
      : undefined,
    depositAddresses: asArray(raw.depositAddresses).map((item) => {
      const row = asRecord(item);
      return {
        network: String(row.network) as FundingAddress["network"],
        label: String(row.label ?? ""),
        address: String(row.address ?? ""),
        memoTag: row.memoTag === null || row.memoTag === undefined ? null : String(row.memoTag),
        networkFee: String(row.networkFee ?? "0"),
        qrValue: String(row.qrValue ?? row.address ?? ""),
        qrCode: row.qrCode ? String(row.qrCode) : null,
        updatedAt: row.updatedAt ? String(row.updatedAt) : null,
      };
    }),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : null,
  };
}

function mapPagination(payload: unknown): Pagination {
  const raw = asRecord(payload);
  return {
    page: toNumber(raw.page, 1),
    limit: toNumber(raw.limit, 10),
    total: toNumber(raw.total, 0),
    totalPages: toNumber(raw.totalPages, 0),
  };
}

export async function fetchFundingSummary(): Promise<FundingSummary> {
  const response = await api.get(FUNDING_ENDPOINTS.summary);
  return mapSummary(unwrap(response.data));
}

export async function refreshFundingDeposits(network?: string) {
  const response = await api.post(FUNDING_ENDPOINTS.refreshDeposits, network ? { network } : {});
  return asRecord(unwrap(response.data));
}

export async function fetchFundingDepositHistory(params: { network?: string; page?: number; limit?: number }) {
  const response = await api.get(FUNDING_ENDPOINTS.depositHistory(params));
  const payload = asRecord(unwrap(response.data));
  return {
    items: asArray(payload.items).map((item) => {
      const row = asRecord(item);
      return {
        id: toNumber(row.id),
        txn_id: row.txn_id ? String(row.txn_id) : row.txnId ? String(row.txnId) : undefined,
        hash: String(row.hash ?? ""),
        network: String(row.network) as DepositHistoryItem["network"],
        type: String(row.type ?? "ERC") as DepositHistoryItem["type"],
        token: String(row.token ?? "USDT"),
        amount: String(row.amount ?? "0"),
        createdAt: String(row.createdAt ?? ""),
        explorerUrl: String(row.explorerUrl ?? ""),
        status: String(row.status ?? "detected"),
      };
    }),
    pagination: mapPagination(payload.pagination),
  };
}

export async function fetchFundingWithdrawHistory(params: { page?: number; limit?: number }) {
  const response = await api.get(FUNDING_ENDPOINTS.withdrawHistory(params));
  const payload = asRecord(unwrap(response.data));
  return {
    items: asArray(payload.items).map((item) => {
      const row = asRecord(item);
      return {
        id: toNumber(row.id),
        txn_id: row.txn_id ? String(row.txn_id) : row.txnId ? String(row.txnId) : undefined,
        network: String(row.network ?? ""),
        token: String(row.token ?? "USDT"),
        amount: String(row.amount ?? "0"),
        address: String(row.address ?? ""),
        status: String(row.status ?? "pending"),
        txHash: row.txHash ? String(row.txHash) : null,
        explorerUrl: row.explorerUrl ? String(row.explorerUrl) : null,
        txExplorerUrl: row.txExplorerUrl ? String(row.txExplorerUrl) : null,
        meta: asRecord(row.meta),
        createdAt: String(row.createdAt ?? ""),
      };
    }),
    pagination: mapPagination(payload.pagination),
  };
}

export async function submitFundingWithdrawal(payload: WithdrawalPayload) {
  const response = await api.post(WALLET_ENDPOINTS.withdrawals, {
    asset: payload.asset,
    amount: payload.amount,
    to: payload.address,
    chain: payload.chain,
    memo: payload.memo,
    details: payload.details,
  });
  return unwrap(response.data);
}
