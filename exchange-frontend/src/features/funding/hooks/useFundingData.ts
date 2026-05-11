import { useCallback, useEffect, useState } from "react";
import {
  fetchFundingDepositHistory,
  fetchFundingSummary,
  fetchFundingWithdrawHistory,
  refreshFundingDeposits,
  submitFundingWithdrawal,
  type DepositHistoryItem,
  type FundingSummary,
  type Pagination,
  type WithdrawHistoryItem,
} from "../api/funding.api";
import { dispatchWalletBalanceRefresh } from "../../../app/liveWalletBalance";
import { subscribeToWalletRealtime } from "../../../app/walletRealtime";

const emptyPagination: Pagination = { page: 1, limit: 10, total: 0, totalPages: 0 };

const parseError = (error: unknown) => {
  if (error && typeof error === "object") {
    const err = error as { message?: string; response?: { data?: { message?: string } } };
    return err.response?.data?.message ?? err.message ?? "Funding service unavailable.";
  }
  return "Funding service unavailable.";
};

export function useFundingData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [summary, setSummary] = useState<FundingSummary>();
  const [selectedNetwork, setSelectedNetwork] = useState<string>("tron");
  const [depositFilterNetwork, setDepositFilterNetwork] = useState<string>("");
  const [depositHistory, setDepositHistory] = useState<DepositHistoryItem[]>([]);
  const [depositPagination, setDepositPagination] = useState<Pagination>(emptyPagination);
  const [withdrawHistory, setWithdrawHistory] = useState<WithdrawHistoryItem[]>([]);
  const [withdrawPagination, setWithdrawPagination] = useState<Pagination>(emptyPagination);
  const [refreshingDeposits, setRefreshingDeposits] = useState(false);
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);

  const loadFunding = useCallback(async (depositPage = 1, withdrawPage = 1, networkFilter = "", options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [summaryResponse, depositResponse, withdrawResponse] = await Promise.all([
        fetchFundingSummary(),
        fetchFundingDepositHistory({ network: networkFilter || undefined, page: depositPage, limit: 10 }),
        fetchFundingWithdrawHistory({ page: withdrawPage, limit: 10 }),
      ]);

      setSummary(summaryResponse);
      setDepositHistory(depositResponse.items);
      setDepositPagination(depositResponse.pagination);
      setWithdrawHistory(withdrawResponse.items);
      setWithdrawPagination(withdrawResponse.pagination);

      if (summaryResponse.depositAddresses.length > 0) {
        const current = summaryResponse.depositAddresses.find((item) => item.network === selectedNetwork);
        if (!current) {
          const tronAddress = summaryResponse.depositAddresses.find((item) => item.network === "tron");
          setSelectedNetwork(tronAddress?.network ?? summaryResponse.depositAddresses[0].network);
        }
      }
      setError(undefined);
    } catch (err) {
      setError(parseError(err));
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadFunding();
  }, [loadFunding]);

  useEffect(() => {
    const unsubscribe = subscribeToWalletRealtime((nextSummary) => {
      setSummary((current) => {
        if (!current) return current;
        return {
          ...current,
          mainWalletBalance: String(
            nextSummary.mainWalletBalance ??
              nextSummary.main_wallet_balance ??
              nextSummary.balance?.total ??
              current.mainWalletBalance
          ),
          balance: nextSummary.balance
            ? {
                ...current.balance,
                total: String(nextSummary.balance.total ?? current.balance.total),
                breakdown: nextSummary.balance.breakdown ?? current.balance.breakdown,
              }
            : current.balance,
          updatedAt: nextSummary.updatedAt ?? current.updatedAt,
        };
      });
    });

    return unsubscribe;
  }, []);

  const selectedAddress = summary?.depositAddresses.find((item) => item.network === selectedNetwork);

  return {
    loading,
    error,
    summary,
    selectedNetwork,
    setSelectedNetwork,
    selectedAddress,
    depositFilterNetwork,
    depositHistory,
    depositPagination,
    withdrawHistory,
    withdrawPagination,
    refreshingDeposits,
    submittingWithdrawal,
    async changeDepositFilter(network: string) {
      setDepositFilterNetwork(network);
      await loadFunding(1, withdrawPagination.page, network, { silent: true });
    },
    async changeDepositPage(page: number) {
      await loadFunding(page, withdrawPagination.page, depositFilterNetwork, { silent: true });
    },
    async changeWithdrawPage(page: number) {
      await loadFunding(depositPagination.page, page, depositFilterNetwork, { silent: true });
    },
    async refreshDeposits() {
      setRefreshingDeposits(true);
      try {
        await refreshFundingDeposits(selectedNetwork);
        await loadFunding(depositPagination.page, withdrawPagination.page, depositFilterNetwork, { silent: true });
        dispatchWalletBalanceRefresh();
      } catch (err) {
        const message = parseError(err);
        setError(message);
        throw new Error(message);
      } finally {
        setRefreshingDeposits(false);
      }
    },
    async submitWithdrawal(payload: { address: string; amount: number; asset: string; chain: string; memo?: string; details?: string }) {
      setSubmittingWithdrawal(true);
      try {
        const response = await submitFundingWithdrawal(payload);
        await loadFunding(depositPagination.page, 1, depositFilterNetwork, { silent: true });
        dispatchWalletBalanceRefresh();
        return response;
      } catch (err) {
        const message = parseError(err);
        throw new Error(message);
      } finally {
        setSubmittingWithdrawal(false);
      }
    },
  };
}
