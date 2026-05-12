import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { subscribeToWalletRealtime } from "../../../app/walletRealtime";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import InlineFeedback from "../../../ui/InlineFeedback";
import { useTimedFeedback } from "../../../hooks/useTimedFeedback";
import {
  applySignal,
  fetchSignalHistory,
  fetchSignalWalletSummary,
  fetchWalletLedger,
  validateSignalToken,
  type SignalAuditJson,
  type SignalHistoryRow,
  type SignalWalletSummary,
  type WalletLedgerRow,
} from "../api/signal.api";
import {
  calculateTradeResult,
  detectEligiblePackage,
  getActiveSlot,
  validateTradeEligibility,
} from "../signal/signal.helpers";
import { formatMoneyWithSymbol } from "../../../utils/money";

const currencyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const formatSignalCloseTime = (row: SignalHistoryRow) => {
  if (row.sellCreatedAt) {
    return timeFormatter.format(new Date(row.sellCreatedAt));
  }
  if (row.expiresAt) {
    return timeFormatter.format(new Date(row.expiresAt));
  }
  return "--";
};

const resolveSignalRowStatus = (row: SignalHistoryRow) => {
  const rawTradeStatus = String(row.tradeStatus ?? row.status ?? "").trim().toUpperCase();
  if (rawTradeStatus === "CLOSED") return "CLOSED";
  if (row.sellCreatedAt) return "CLOSED";
  return "OPEN";
};

const getSignalReturnAmount = (row: SignalHistoryRow) =>
  resolveSignalRowStatus(row) === "CLOSED" ? row.totalReturnUsdt ?? row.totalEarned : null;

const getSignalInvestmentAmount = (row: SignalHistoryRow) => {
  if (row.investmentAmount > 0) {
    return row.investmentAmount;
  }
  const percent = Number(row.auditJson?.investment_percent ?? 0);
  if (percent > 0 && row.previousBalance > 0) {
    return row.previousBalance * (percent / 100);
  }
  if (row.previousBalance > 0) {
    return row.previousBalance * 0.01;
  }
  return row.investmentAmount;
};

const getSignalProfitAmount = (row: SignalHistoryRow) => {
  if (resolveSignalRowStatus(row) === "CLOSED" && row.profitAmount > 0) {
    return row.profitAmount;
  }
  const percent = Number(row.auditJson?.profit_percent ?? 0);
  if (percent > 0 && row.previousBalance > 0) {
    const investmentBasis = getSignalInvestmentAmount(row);
    return resolveSignalRowStatus(row) === "CLOSED" ? investmentBasis * (percent / 100) : null;
  }
  if (row.previousBalance > 0) {
    const investmentBasis = getSignalInvestmentAmount(row);
    return resolveSignalRowStatus(row) === "CLOSED" ? investmentBasis * 0.0065 : null;
  }
  return resolveSignalRowStatus(row) === "CLOSED" ? row.profitAmount : null;
};

const getSignalBalanceValue = (row: SignalHistoryRow) =>
  resolveSignalRowStatus(row) === "CLOSED"
    ? row.walletBalanceAfterSell ?? row.newBalance
    : row.walletBalanceAfterBuy ?? row.previousBalance - getSignalInvestmentAmount(row);

const getLatestSignalBalance = (rows: SignalHistoryRow[], fallbackBalance: number) => {
  if (rows.length === 0) return fallbackBalance;
  const latestRow = [...rows].sort((a, b) => {
    const aTime = new Date(a.sellCreatedAt ?? a.buyCreatedAt ?? a.appliedAt).getTime();
    const bTime = new Date(b.sellCreatedAt ?? b.buyCreatedAt ?? b.appliedAt).getTime();
    return bTime - aTime;
  })[0];
  return getSignalBalanceValue(latestRow);
};

const getSignalRowSlot = (row: SignalHistoryRow, slots: SignalWalletSummary["availableSlots"]) => {
  const normalizedKey = String(row.slotKey ?? "").trim();
  if (!normalizedKey) return null;
  return slots.find((slot) => String(slot.key).trim() === normalizedKey) ?? null;
};

const parseApiError = (error: unknown, fallback: string) => {
  if (!error || typeof error !== "object") return fallback;
  const maybeAxios = error as { response?: { data?: unknown }; message?: string };
  const payload = maybeAxios.response?.data;
  if (typeof payload === "string" && payload.trim()) return payload;
  if (payload && typeof payload === "object") {
    if ("message" in payload && typeof (payload as { message?: string }).message === "string") {
      return (payload as { message: string }).message;
    }
    if ("error" in payload && typeof (payload as { error?: string }).error === "string") {
      return (payload as { error: string }).error;
    }
  }
  return maybeAxios.message?.trim() || fallback;
};

const emptySummary: SignalWalletSummary = {
  currentBalance: 0,
  mainWalletBalance: 0,
  depositTotal: 0,
  signalIncomeTotal: 0,
  mlmIncomeTotal: 0,
  totalEarnings: 0,
  availableBalance: 0,
  userLevel: 0,
  todayUsedSignals: 0,
  allowedSignalsToday: 0,
  remainingSignals: 0,
  eligiblePackage: null,
  activeSlot: null,
  availableSlots: [],
  investmentPerTradePercent: 1,
  dailyPercentPerTrade: 0.65,
  signalValidityMinutes: 10,
};

type HistoryTab = "overview" | "signal" | "wallet";

type SignalIntentDetail = {
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  symbol: string;
  quantity: number;
  price?: number;
};

type SignalCenterProps = {
  marketSocketStatus?: string;
  compact?: boolean;
  compactSection?: "all" | "entry" | "history";
};

const SIGNAL_INTENT_EVENT = "exchange:signal-intent";
const OPEN_SIGNAL_REFRESH_MS = 5000;

export default function SignalCenter({ marketSocketStatus = "idle", compact = false, compactSection = "all" }: SignalCenterProps) {
  void marketSocketStatus;
  const [walletSummary, setWalletSummary] = useState<SignalWalletSummary>(emptySummary);
  const [currentPackage, setCurrentPackage] = useState<SignalWalletSummary["eligiblePackage"]>(null);
  const [todayUsedSignals, setTodayUsedSignals] = useState(0);
  const [remainingSignals, setRemainingSignals] = useState(0);
  const [activeSlot, setActiveSlot] = useState(walletSummary.activeSlot);
  const [signalCodeInput, setSignalCodeInput] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [signalHistory, setSignalHistory] = useState<SignalHistoryRow[]>([]);
  const [walletLedger, setWalletLedger] = useState<WalletLedgerRow[]>([]);
  const [pendingIntent, setPendingIntent] = useState<SignalIntentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [activeTab] = useState<HistoryTab>("overview");
  const [clockNow, setClockNow] = useState(() => new Date());
  const { feedback: submitFeedback, setFeedback: setSubmitFeedback, clearFeedback: clearSubmitFeedback } = useTimedFeedback();
  const signalInputRef = useRef<HTMLInputElement | null>(null);
  const walletRealtimeRefreshTimeoutRef = useRef<number | null>(null);
  const syncDerivedState = useCallback((summary: SignalWalletSummary) => {
    const packageState = detectEligiblePackage(summary.currentBalance, summary.userLevel);
    const nextPackage = packageState.package;
    const allowedSignalsToday = nextPackage?.signalsPerDay ?? 0;
    const usedSignals = summary.todayUsedSignals ?? 0;

    setWalletSummary({
      ...summary,
      eligiblePackage: nextPackage,
      allowedSignalsToday,
      remainingSignals: Math.max(allowedSignalsToday - usedSignals, 0),
      activeSlot: getActiveSlot(new Date(), summary.availableSlots),
    });
    setCurrentPackage(nextPackage);
    setTodayUsedSignals(usedSignals);
    setRemainingSignals(Math.max(allowedSignalsToday - usedSignals, 0));
    setActiveSlot(getActiveSlot(new Date(), summary.availableSlots));
  }, []);

  const refreshSignalData = useCallback(
    async (options?: { keepLoadingState?: boolean }) => {
      const keepLoadingState = options?.keepLoadingState ?? false;
      if (keepLoadingState) {
        setLoading(true);
        setHistoryLoading(true);
      }

      try {
        const [summary, history, ledger] = await Promise.all([
          fetchSignalWalletSummary(),
          fetchSignalHistory(),
          fetchWalletLedger(),
        ]);
        syncDerivedState(summary);
        startTransition(() => {
          setSignalHistory(history);
          setWalletLedger(ledger);
        });
        clearSubmitFeedback();
      } catch (error) {
        if (keepLoadingState) {
          setSubmitFeedback({ tone: "error", text: parseApiError(error, "Unable to load signal data right now.") });
        }
      } finally {
        if (keepLoadingState) {
          setLoading(false);
          setHistoryLoading(false);
        }
      }
    },
    [clearSubmitFeedback, setSubmitFeedback, syncDerivedState]
  );

  useEffect(() => {
    let active = true;

    const loadSignalData = async () => {
      await refreshSignalData({ keepLoadingState: true });
      if (!active) return;
    };

    void loadSignalData();

    return () => {
      active = false;
    };
  }, [refreshSignalData]);

  useEffect(() => {
    const unsubscribe = subscribeToWalletRealtime(() => {
      if (walletRealtimeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(walletRealtimeRefreshTimeoutRef.current);
      }

      walletRealtimeRefreshTimeoutRef.current = window.setTimeout(() => {
        void refreshSignalData();
      }, 150);
    });

    return () => {
      unsubscribe();
      if (walletRealtimeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(walletRealtimeRefreshTimeoutRef.current);
      }
    };
  }, [refreshSignalData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setClockNow(now);
      setActiveSlot(getActiveSlot(now, walletSummary.availableSlots));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [walletSummary.availableSlots]);

  useEffect(() => {
    const handleSignalIntent = (event: Event) => {
      const customEvent = event as CustomEvent<SignalIntentDetail>;
      const detail = customEvent.detail;
      setPendingIntent(detail);
      const nextActiveSlot = getActiveSlot(new Date(), walletSummary.availableSlots);
      setHasSubmitted(true);
      setSubmitFeedback({
        tone: "error",
        text: nextActiveSlot
          ? `${detail.side} ${detail.type} request for ${detail.symbol} moved here. Submit the admin-issued signal code for the active ${nextActiveSlot.start} to ${nextActiveSlot.end} window.`
          : "",
      });
      window.setTimeout(() => signalInputRef.current?.focus(), 180);
    };

    window.addEventListener(SIGNAL_INTENT_EVENT, handleSignalIntent as EventListener);
    return () => window.removeEventListener(SIGNAL_INTENT_EVENT, handleSignalIntent as EventListener);
  }, [walletSummary.availableSlots]);

  const nextSlot = useMemo(() => {
    if (!walletSummary.availableSlots.length) return null;
    const nowMinutes = clockNow.getHours() * 60 + clockNow.getMinutes();
    const ordered = [...walletSummary.availableSlots].sort((a, b) => a.startMinutes - b.startMinutes);
    return ordered.find((slot) => slot.startMinutes > nowMinutes) ?? null;
  }, [clockNow, walletSummary.availableSlots]);

  const activeSlotCountdown = useMemo(() => {
    if (!activeSlot) return null;
    const end = new Date(clockNow);
    end.setHours(Math.floor(activeSlot.endMinutes / 60), activeSlot.endMinutes % 60, 0, 0);
    const diffMs = end.getTime() - clockNow.getTime();
    if (diffMs <= 0) return "Closing...";
    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} remaining`;
  }, [activeSlot, clockNow]);

  const nextSlotCountdown = useMemo(() => {
    if (!nextSlot || activeSlot) return null;
    const start = new Date(clockNow);
    start.setHours(Math.floor(nextSlot.startMinutes / 60), nextSlot.startMinutes % 60, 0, 0);
    if (start.getTime() <= clockNow.getTime()) start.setDate(start.getDate() + 1);
    const diffMs = start.getTime() - clockNow.getTime();
    const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [activeSlot, clockNow, nextSlot]);

  const visibleSlots = useMemo(() => {
    if (activeSlot) return [activeSlot];
    if (nextSlot) return [nextSlot];
    return [];
  }, [activeSlot, nextSlot]);

  const eligibleSlotLabel = useMemo(() => {
    if (!walletSummary.availableSlots.length) return "No eligible slots";
    return walletSummary.availableSlots.map((slot) => slot.label.replace(/\s+slot$/i, "")).join(", ");
  }, [walletSummary.availableSlots]);

  const handleSubmitSignal = useCallback(async () => {
    setHasSubmitted(true);
    clearSubmitFeedback();

    try {
      const latestSummary = await fetchSignalWalletSummary();
      syncDerivedState(latestSummary);

      const eligibility = validateTradeEligibility({
        currentBalance: latestSummary.currentBalance,
        userLevel: latestSummary.userLevel,
        todayUsedSignals: latestSummary.todayUsedSignals,
        signalCodeInput,
        now: new Date(),
        availableSlots: latestSummary.availableSlots,
      });

      if (!eligibility.ok) {
        setSubmitFeedback({ tone: "error", text: eligibility.message });
        return;
      }

      const allowedSignalCount = eligibility.eligiblePackage.signalsPerDay;
      const isAllowedByExchangeTiming = latestSummary.todayUsedSignals < allowedSignalCount && Boolean(eligibility.activeSlot);

      if (!isAllowedByExchangeTiming) {
        setSubmitFeedback({ tone: "error", text: "This signal can only be submitted during the current active time slot." });
        return;
      }

      setSubmitLoading(true);

      try {
        await validateSignalToken({
          token: signalCodeInput.trim(),
          slot_key: eligibility.activeSlot.key,
        });
      } catch (error) {
        const message = parseApiError(error, "Invalid signal code.");
        setSubmitFeedback({
          tone: "error",
          text: /already been used/i.test(message)
            ? "This signal token has already been used."
            : /already used a signal in the current time slot/i.test(message)
              ? "You have already used a signal in the current time slot. Please wait for the next slot."
              : /belongs to a different time slot/i.test(message)
                ? "This signal code belongs to a different admin time slot."
                : /not for today/i.test(message)
                  ? "This signal code is for a different date."
                  : /not active/i.test(message)
                    ? "This signal code is not active."
                    : /expired/i.test(message)
                      ? "This signal is no longer valid for the current time slot."
                      : /invalid|not found/i.test(message)
                        ? "Invalid signal code."
                        : message,
        });
        return;
      }

      const tradeRules = {
        investmentPercent: latestSummary.investmentPerTradePercent,
        profitPercent: latestSummary.dailyPercentPerTrade,
      };
      const tradeResult = calculateTradeResult(latestSummary.currentBalance, tradeRules);
      const appliedAt = new Date().toISOString();
      const auditJson: SignalAuditJson = {
        symbol: pendingIntent?.symbol ?? "BTCUSDT",
        mode: "SIGNAL",
        side: "BUY",
        previous_balance: latestSummary.currentBalance,
        current_wallet_balance: latestSummary.currentBalance,
        wallet_balance_before: latestSummary.currentBalance,
        wallet_balance_after_buy: latestSummary.currentBalance - tradeResult.investmentAmount,
        investment_percent: latestSummary.investmentPerTradePercent,
        profit_percent: latestSummary.dailyPercentPerTrade,
        investment_amount: tradeResult.investmentAmount,
        profit_amount: tradeResult.profitAmount,
        total_earned: tradeResult.profitAmount,
        total_return_usdt: tradeResult.totalEarned,
        buy_price: pendingIntent?.price,
        new_balance: tradeResult.newBalance,
        signal_token: signalCodeInput.trim(),
        slot_key: eligibility.activeSlot.key,
        slot_time: eligibility.activeSlot.slotTime,
        applied_at: appliedAt,
        daily_trade_used_before: latestSummary.todayUsedSignals,
        daily_trade_used_after: latestSummary.todayUsedSignals + 1,
        eligible_package: {
          name: eligibility.eligiblePackage.name,
          min_amount: eligibility.eligiblePackage.minAmount,
          max_amount: eligibility.eligiblePackage.maxAmount,
          signals_per_day: eligibility.eligiblePackage.signalsPerDay,
        },
      };

      await applySignal({
        token: signalCodeInput.trim(),
        slot_key: eligibility.activeSlot.key,
        audit_json: auditJson,
      });
      setSignalCodeInput("");
      setPendingIntent(null);
      setSubmitFeedback({ tone: "success", text: "Buy executed. Wallet debited now; auto-sell will close this trade after the signal window." });

      await refreshSignalData();
    } catch (error) {
      setSubmitFeedback({ tone: "error", text: parseApiError(error, "You are not allowed for the current trade.") });
    } finally {
      setSubmitLoading(false);
    }
  }, [pendingIntent, refreshSignalData, signalCodeInput]);

  const validationFeedback = useMemo(() => {
    if (!hasSubmitted) return null;
    return submitFeedback;
  }, [hasSubmitted, submitFeedback]);

  const effectiveCurrentBalance = useMemo(
    () => getLatestSignalBalance(signalHistory, walletSummary.currentBalance),
    [signalHistory, walletSummary.currentBalance]
  );

  const latestOpenSignalId = useMemo(() => {
    const openRows = signalHistory.filter((row) => resolveSignalRowStatus(row) === "OPEN");
    if (openRows.length === 0) return null;
    const latestOpenRow = [...openRows].sort((a, b) => {
      const aTime = new Date(a.buyCreatedAt || a.appliedAt).getTime();
      const bTime = new Date(b.buyCreatedAt || b.appliedAt).getTime();
      return bTime - aTime;
    })[0];
    return latestOpenRow?.id ?? null;
  }, [signalHistory]);
  const hasOpenSignals = latestOpenSignalId !== null;
  const latestOpenSignal = useMemo(
    () => signalHistory.find((row) => row.id === latestOpenSignalId) ?? null,
    [latestOpenSignalId, signalHistory]
  );
  const openSignalSlot = useMemo(
    () => (latestOpenSignal ? getSignalRowSlot(latestOpenSignal, walletSummary.availableSlots) : null),
    [latestOpenSignal, walletSummary.availableSlots]
  );
  const displayActiveSlot = openSignalSlot ?? activeSlot;
  const openSignalSlotEndAt = useMemo(() => {
    if (!openSignalSlot) return null;
    const end = new Date(clockNow);
    end.setHours(Math.floor(openSignalSlot.endMinutes / 60), openSignalSlot.endMinutes % 60, 0, 0);
    return end;
  }, [clockNow, openSignalSlot]);
  const openSignalRefreshTargetAt = useMemo(() => {
    if (latestOpenSignal?.expiresAt) {
      const expiresAt = new Date(latestOpenSignal.expiresAt);
      if (!Number.isNaN(expiresAt.getTime())) {
        return expiresAt;
      }
    }
    return openSignalSlotEndAt;
  }, [latestOpenSignal?.expiresAt, openSignalSlotEndAt]);

  const mainWalletBalanceBasis = useMemo(() => {
    if (walletSummary.mainWalletBalance > 0) return walletSummary.mainWalletBalance;
    if (walletSummary.currentBalance > 0) return walletSummary.currentBalance;
    return effectiveCurrentBalance;
  }, [effectiveCurrentBalance, walletSummary.currentBalance, walletSummary.mainWalletBalance]);

  const tradePreview = useMemo(
    () =>
      calculateTradeResult(mainWalletBalanceBasis, {
        investmentPercent: walletSummary.investmentPerTradePercent,
        profitPercent: walletSummary.dailyPercentPerTrade,
      }),
    [mainWalletBalanceBasis, walletSummary.dailyPercentPerTrade, walletSummary.investmentPerTradePercent]
  );

  const getDisplayInvestmentAmount = useCallback(
    (row: SignalHistoryRow) =>
      resolveSignalRowStatus(row) === "OPEN" && row.id === latestOpenSignalId
        ? tradePreview.investmentAmount
        : getSignalInvestmentAmount(row),
    [latestOpenSignalId, tradePreview.investmentAmount]
  );

  const getDisplayWalletBalance = useCallback(
    (row: SignalHistoryRow) =>
      resolveSignalRowStatus(row) === "OPEN" && row.id === latestOpenSignalId
        ? mainWalletBalanceBasis - tradePreview.investmentAmount
        : getSignalBalanceValue(row),
    [latestOpenSignalId, mainWalletBalanceBasis, tradePreview.investmentAmount]
  );

  const canSubmitSignal = Boolean(activeSlot && !loading && !submitLoading && remainingSignals > 0);

  useEffect(() => {
    if (!hasOpenSignals) return;

    const intervalId = window.setInterval(() => {
      void refreshSignalData();
    }, OPEN_SIGNAL_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasOpenSignals, refreshSignalData]);

  useEffect(() => {
    if (!hasOpenSignals || !latestOpenSignalId || !openSignalRefreshTargetAt) return;

    const delayMs = openSignalRefreshTargetAt.getTime() - clockNow.getTime();
    if (delayMs <= 0) {
      void refreshSignalData();
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshSignalData();
    }, delayMs + 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [clockNow, hasOpenSignals, latestOpenSignalId, openSignalRefreshTargetAt, refreshSignalData]);

  const signalEntryCard = (
    <div className="exchange-card exchange-card-strong p-5">
      <div className="text-sm font-semibold text-white">Enter Signal Code</div>      
      {validationFeedback && (
        <InlineFeedback feedback={validationFeedback} className="mt-4 text-sm" />
      )}
      <Input
        ref={signalInputRef}
        value={signalCodeInput}
        onChange={(event) => setSignalCodeInput(event.target.value)}
        placeholder="Signal Code / Token"
        className="mt-4 h-12"
      />
      <Button
        className="mt-4 w-full disabled:opacity-100 disabled:bg-[rgba(252,213,53,0.55)] disabled:text-[#111111] disabled:shadow-none"
        size="lg"
        onClick={() => void handleSubmitSignal()}
        disabled={!canSubmitSignal}
      >
        {submitLoading ? "Submitting..." : "Submit"}
      </Button>

      {(visibleSlots.length > 0 || walletSummary.availableSlots.length > 0) && (
        <div className="mt-5 rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-4">
          <div className="micro-label">{activeSlot ? "Available Slot" : nextSlot ? "Next Available Slot" : "Eligible Package Slots"}</div>
          <div className="mt-3 grid gap-2">
            {(visibleSlots.length > 0 ? visibleSlots : walletSummary.availableSlots).map((slot) => (
              <div key={slot.key} className="rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                <span className="font-medium text-white">{slot.label.replace(/\s+slot$/i, "")}</span> {slot.start} to {slot.end}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const compactSignalEntryCard = (
    <div className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--bg-card)] p-4">
      <div className="text-sm font-semibold text-white">Enter Signal Code</div>
      {validationFeedback && (
        <InlineFeedback feedback={validationFeedback} className="mt-3 text-sm" />
      )}
      <Input
        ref={signalInputRef}
        value={signalCodeInput}
        onChange={(event) => setSignalCodeInput(event.target.value)}
        placeholder="Signal Code / Token"
        className="mt-3 h-11"
      />
      <Button
        className="mt-3 w-full disabled:opacity-100 disabled:bg-[rgba(252,213,53,0.55)] disabled:text-[#111111] disabled:shadow-none"
        size="lg"
        onClick={() => void handleSubmitSignal()}
        disabled={!canSubmitSignal}
      >
        {submitLoading ? "Submitting..." : "Submit"}
      </Button>
    </div>
  );

  const historySection = (
    <>
      <div className="mt-8 overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--bg-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-soft)] px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-white">Wallet Activity</div>            
          </div>
          {historyLoading && <div className="text-xs text-[var(--text-muted)]">Loading history...</div>}
        </div>
        <div className="flex flex-wrap gap-2 border-b border-[var(--border-soft)] px-5 py-3">
          {/* <TabButton active={activeTab === "overview"} label="Signal History" onClick={() => setActiveTab("overview")} /> */}
          {/* <TabButton active={activeTab === "signal"} label="Signal Activity" onClick={() => setActiveTab("signal")} /> */}
          {/* <TabButton active={activeTab === "wallet"} label="Wallet Activity" onClick={() => setActiveTab("wallet")} /> */}
        </div>

        {activeTab === "overview" && (
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="min-w-[980px] text-left text-sm">
              <thead className="bg-white/5 text-[11px] uppercase tracking-[0.24em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Symbol</th>
                  <th className="px-4 py-3">Time Slot</th>
                  <th className="px-4 py-3">Buy / Sell Time</th>
                  <th className="px-4 py-3">Buy / Sell Price</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Signal Token</th>
                  <th className="px-4 py-3">Investment Amount</th>
                  <th className="px-4 py-3">Leverage</th>
                  <th className="px-4 py-3">Profit Amount</th>
                  <th className="px-4 py-3">Return Amount</th>
                  <th className="px-4 py-3">Wallet Balance</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {signalHistory.map((row) => (
                  <tr key={row.id} className="text-slate-200">
                    <td className="px-4 py-3">{dateFormatter.format(new Date(row.appliedAt))}</td>
                    <td className="px-4 py-3">{row.symbol || "--"}</td>
                    <td className="px-4 py-3">{row.slotLabel || row.slotKey}</td>
                    <td className="px-4 py-3 text-xs">
                      {timeFormatter.format(new Date(row.buyCreatedAt || row.appliedAt))}
                      {" / "}
                      {formatSignalCloseTime(row)}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {row.buyPrice ? currencyFormatter.format(row.buyPrice) : "--"}
                      {" / "}
                      {resolveSignalRowStatus(row) === "CLOSED" && row.sellPrice ? currencyFormatter.format(row.sellPrice) : "--"}
                    </td>
                    <td className="px-4 py-3">{row.executedQty ? row.executedQty.toFixed(8) : "--"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.signalToken}</td>
                    <td className="px-4 py-3">{currencyFormatter.format(getDisplayInvestmentAmount(row))}</td>
                    <td className="px-4 py-3">100x</td>
                    <td className="px-4 py-3">
                      {getSignalProfitAmount(row) === null ? "--" : currencyFormatter.format(getSignalProfitAmount(row) ?? 0)}
                    </td>
                    <td className="px-4 py-3">
                      {getSignalReturnAmount(row) === null ? "--" : currencyFormatter.format(getSignalReturnAmount(row) ?? 0)}
                    </td>
                    <td className="px-4 py-3">{currencyFormatter.format(getDisplayWalletBalance(row) ?? 0)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-3 py-1 text-xs ${resolveSignalRowStatus(row) === "CLOSED" ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-100"}`}>
                        {resolveSignalRowStatus(row)}
                      </span>
                    </td>
                  </tr>
                ))}
                {!historyLoading && signalHistory.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center text-sm text-slate-400">
                      No signal history found yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeTab === "signal" && (
          <HistoryTable
            headers={["Date", "Time Slot", "Signal Token", "Previous Balance", "Investment Amount", "Profit Amount", "Total Earned", "New Balance", "Status"]}
            rows={signalHistory.map((row) => [
              dateFormatter.format(new Date(row.appliedAt)),
              row.slotLabel || row.slotKey,
              row.signalToken,
              currencyFormatter.format(row.previousBalance),
              currencyFormatter.format(getDisplayInvestmentAmount(row)),
              getSignalProfitAmount(row) === null ? "--" : currencyFormatter.format(getSignalProfitAmount(row) ?? 0),
              getSignalReturnAmount(row) === null ? "--" : currencyFormatter.format(getSignalReturnAmount(row) ?? 0),
              currencyFormatter.format(getDisplayWalletBalance(row)),
              row.status,
            ])}
            emptyMessage="No signal income history found yet."
          />
        )}

        {activeTab === "wallet" && (
          <HistoryTable
            headers={["Date", "Type", "Source Type", "Reference ID", "Previous Balance", "Credit", "Debit", "New Balance", "Status", "Remark"]}
            rows={walletLedger.map((row) => [
              dateFormatter.format(new Date(row.date)),
              row.type,
              row.sourceType,
              row.referenceId || "--",
              currencyFormatter.format(row.previousBalance),
              currencyFormatter.format(row.credit),
              currencyFormatter.format(row.debit),
              currencyFormatter.format(row.newBalance),
              row.status,
              row.remark || "--",
            ])}
            emptyMessage="No wallet ledger entries found yet."
          />
        )}
      </div>      
    </>
  );

  const compactHistorySection = (
    <div className="mt-6 overflow-hidden rounded-3xl border border-[var(--border-soft)] bg-[var(--bg-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-soft)] px-4 py-4">
        <div className="text-sm font-semibold text-white">Wallet Activity</div>
        {historyLoading && <div className="text-xs text-[var(--text-muted)]">Loading history...</div>}
      </div>
      <div className="space-y-3 p-4">
        {signalHistory.slice(0, 4).map((row) => (
          <div key={`compact-history-${row.id}`} className="rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-white">{row.symbol || "--"}</div>
                <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {dateFormatter.format(new Date(row.appliedAt))} · {row.slotLabel || row.slotKey}
                </div>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] ${resolveSignalRowStatus(row) === "CLOSED" ? "bg-emerald-500/15 text-emerald-200" : "bg-amber-500/15 text-amber-100"}`}>
                {resolveSignalRowStatus(row)}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <InfoLine label="Buy Price" value={row.buyPrice ? currencyFormatter.format(row.buyPrice) : "--"} />
              <InfoLine label="Sell Price" value={row.sellPrice ? currencyFormatter.format(row.sellPrice) : "Pending"} />
              <InfoLine label="Qty" value={row.executedQty ? row.executedQty.toFixed(6) : "--"} />
              <InfoLine label="Return" value={getSignalReturnAmount(row) === null ? "--" : currencyFormatter.format(getSignalReturnAmount(row) ?? 0)} />
            </div>
          </div>
        ))}
        {!historyLoading && signalHistory.length === 0 && (
          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
            No signal history found yet.
          </div>
        )}
      </div>
    </div>
  );

  if (compact) {
    const showEntry = compactSection === "all" || compactSection === "entry";
    const showHistory = compactSection === "all" || compactSection === "history";

    return (
      <section
        id="signal-center"
        className="exchange-card exchange-card-strong rounded-[24px] p-3.5 text-slate-100"
      >
        {/* <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="micro-label">Enter The Signal Code</div>
            <h2 className="mt-2 text-xl font-semibold text-white">User Signal Apply Screen</h2>
          </div>
          <div className="rounded-2xl border border-[rgba(252,213,53,0.22)] bg-[rgba(252,213,53,0.12)] px-4 py-3 text-right text-sm">
            <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--accent-yellow)]">Current Active Time Slot</div>
            <div className="mt-1 font-semibold text-white">{activeSlot ? `${activeSlot.start} to ${activeSlot.end}` : "Closed"}</div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">
              {activeSlotCountdown ?? (nextSlot ? `Next window ${nextSlot.start} to ${nextSlot.end} in ${nextSlotCountdown}` : "Today's eligible slots are complete")}
            </div>
          </div>
        </div> */}
        {showEntry ? compactSignalEntryCard : null}
        {showHistory ? compactHistorySection : null}
      </section>
    );
  }

  return (
    <section
      id="signal-center"
      className="exchange-card exchange-card-strong rounded-[24px] p-5 text-slate-100 md:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="micro-label">Enter The Signal Code</div>
          <h2 className="mt-2 text-2xl font-semibold text-white">User Signal Apply Screen</h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
            Balance decides how many trades you get. Every trade uses your latest wallet total, then applies the configured investment and profit percentages after the signal passes validation.
          </p>
        </div>
        <div className="rounded-2xl border border-[rgba(252,213,53,0.22)] bg-[rgba(252,213,53,0.12)] px-4 py-3 text-right text-sm">
          <div className="text-[11px] uppercase tracking-[0.24em] text-[var(--accent-yellow)]">Current Active Time Slot</div>
          <div className="mt-1 font-semibold text-white">{displayActiveSlot ? `${displayActiveSlot.start} to ${displayActiveSlot.end}` : "Closed"}</div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">
            {hasOpenSignals
              ? "Open signal is still waiting for auto-sell settlement."
              : activeSlotCountdown ?? (nextSlot ? `Next window ${nextSlot.start} to ${nextSlot.end} in ${nextSlotCountdown}` : "Today's eligible slots are complete")}
          </div>
          {/* <div className="mt-2 inline-flex rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-emerald-100/80">
            Market Socket {marketSocketStatus}
          </div> */}
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard label="Main Wallet Balance" value={formatMoneyWithSymbol(walletSummary.mainWalletBalance)} />
        <SummaryCard label="Eligible Package" value={currentPackage ? `${currentPackage.name} · ${eligibleSlotLabel}` : "No package"} />
        {/* <SummaryCard label="Deposit Total" value={currencyFormatter.format(walletSummary.depositTotal)} /> */}
        <SummaryCard label="Signal Income Total" value={formatMoneyWithSymbol(walletSummary.signalIncomeTotal)} />
        {/* <SummaryCard label="MLM Income Total" value={currencyFormatter.format(walletSummary.mlmIncomeTotal)} /> */}
        {/* <SummaryCard label="Total Earnings" value={currencyFormatter.format(walletSummary.totalEarnings)} /> */}
        {/* <SummaryCard label="Available Balance" value={currencyFormatter.format(walletSummary.availableBalance)} /> */}
        <SummaryCard label="Allowed Signals Today" value={String(walletSummary.allowedSignalsToday)} />
        <SummaryCard label="Used Signals Today" value={String(todayUsedSignals)} />
        <SummaryCard label="Remaining Signals Today" value={String(remainingSignals)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {signalEntryCard}

        <div className="exchange-card p-5">
          <div className="text-sm font-semibold text-white">Validation Message Area</div>  

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <InfoLine label="Package rule" value={currentPackage ? `${currentPackage.signalsPerDay} slot${currentPackage.signalsPerDay > 1 ? "s" : ""}/day` : "No trade allowed"} />
            <InfoLine label="Eligible slots" value={eligibleSlotLabel} />
            <InfoLine label="Required level" value={currentPackage ? String(currentPackage.requiredLevel) : "--"} />
            <InfoLine label="User level" value={String(walletSummary.userLevel)} />
            <InfoLine label="Latest balance basis" value={currencyFormatter.format(mainWalletBalanceBasis)} />
            <InfoLine label="Investment per trade %" value={`${walletSummary.investmentPerTradePercent}%`} />
            <InfoLine label="Profit per trade %" value={`${walletSummary.dailyPercentPerTrade}%`} />
            <InfoLine label="Signal validity" value={`${walletSummary.signalValidityMinutes} minutes`} />
          </div>

          <div className="mt-5 rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-4 text-sm text-[var(--text-secondary)]">
            <div className="font-medium text-white">Trade calculation preview</div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <InfoLine label={`Investment ${walletSummary.investmentPerTradePercent}%`} value={currencyFormatter.format(tradePreview.investmentAmount)} />
              <InfoLine label={`Profit ${walletSummary.dailyPercentPerTrade}%`} value={currencyFormatter.format(tradePreview.profitAmount)} />
              <InfoLine label="Return On Auto Sell" value={currencyFormatter.format(tradePreview.totalEarned)} />
              <InfoLine label="Wallet After Buy" value={currencyFormatter.format(mainWalletBalanceBasis - tradePreview.investmentAmount)} />
              <InfoLine label="Main Final Balance" value={currencyFormatter.format(tradePreview.newBalance)} />
            </div>
          </div>
        </div>
      </div>

      {historySection}
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="exchange-card p-4">
      <div className="micro-label">{label}</div>
      <div className="mt-2 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-3 py-2">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-right font-medium text-white">{value}</span>
    </div>
  );
}

function HistoryTable({
  headers,
  rows,
  emptyMessage,
}: {
  headers: string[];
  rows: string[][];
  emptyMessage: string;
}) {
  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="min-w-[900px] text-left text-sm">
        <thead className="bg-[var(--bg-card-soft)] text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(255,255,255,0.04)]">
          {rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="text-[var(--text-secondary)]">
              {row.map((cell, cellIndex) => (
                <td key={`${headers[cellIndex]}-${cellIndex}`} className="px-4 py-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={headers.length} className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
