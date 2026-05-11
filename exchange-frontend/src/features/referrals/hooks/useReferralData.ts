import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportReferralsCsv,
  fetchReferralDashboard,
  fetchReferralIncomeHistory,
  toggleReferralPromo,
  type ReferralIncomeHistoryItem,
  type ReferralDashboard,
} from "../api/referrals.api";

const parseError = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const err = error as {
      message?: string;
      response?: { data?: { message?: string } };
    };
    return err.response?.data?.message ?? err.message ?? "Unable to load referral data.";
  }
  return "Unable to load referral data.";
};

export const useReferralData = () => {
  const [dashboard, setDashboard] = useState<ReferralDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [updatingPromo, setUpdatingPromo] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [history, setHistory] = useState<ReferralIncomeHistoryItem[]>([]);
  const [historyPagination, setHistoryPagination] = useState({ page: 1, limit: 8, total: 0, totalPages: 1 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string>();
  const [historyPage, setHistoryPage] = useState(1);

  const refresh = useCallback(() => {
    setRefreshIndex((index) => index + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await fetchReferralDashboard();
        if (cancelled) return;
        setDashboard(data);
        setError(undefined);
      } catch (err) {
        if (cancelled) return;
        setError(parseError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshIndex]);

  useEffect(() => {
    let cancelled = false;
    setHistoryLoading(true);
    (async () => {
      try {
        const payload = await fetchReferralIncomeHistory({ page: historyPage, limit: historyPagination.limit });
        if (cancelled) return;
        setHistory(payload.items);
        setHistoryPagination(payload.pagination);
        setHistoryError(undefined);
      } catch (err) {
        if (cancelled) return;
        setHistoryError(parseError(err));
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [historyPage, refreshIndex, historyPagination.limit]);

  const promoActive = dashboard?.primaryCode.promoActive ?? false;

  const setPromoActive = useCallback(
    async (active: boolean) => {
      setUpdatingPromo(true);
      try {
        const serverState = await toggleReferralPromo(active);
        setDashboard((prev) =>
          prev
            ? {
                ...prev,
                primaryCode: {
                  ...prev.primaryCode,
                  promoActive: serverState,
                },
              }
            : prev
        );
      } catch (err) {
        setError(parseError(err));
      } finally {
        setUpdatingPromo(false);
      }
    },
    []
  );

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const blob = await exportReferralsCsv();
      const fileName = `referrals-${new Date().toISOString().slice(0, 10)}.csv`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (err) {
      setError(parseError(err));
    } finally {
      setExporting(false);
    }
  }, []);

  const value = useMemo(
    () => ({
      loading,
      error,
      dashboard,
      refresh,
      promoActive,
      setPromoActive,
      updatingPromo,
      exportCsv,
      exporting,
      history,
      historyPagination,
      historyLoading,
      historyError,
      historyPage,
      setHistoryPage,
    }),
    [
      dashboard,
      error,
      exportCsv,
      exporting,
      history,
      historyError,
      historyLoading,
      historyPage,
      historyPagination,
      loading,
      promoActive,
      refresh,
      setPromoActive,
      updatingPromo,
    ]
  );

  return value;
};
