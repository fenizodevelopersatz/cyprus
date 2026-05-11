import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import Dialog from "../../../ui/Dialog";
import TradingViewChart from "../../exchange/components/TradingViewChart";

import { useFuturesData } from "../hooks/useFuturesData";

import type { FuturesContract, FuturesSide } from "../api/futures.api";


const numberFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatValue = (v: number) => (Number.isFinite(v) ? numberFormatter.format(v) : "--");

type PendingAction = "OPEN" | "CLOSE" | "UPDATE_TRIGGERS";


export default function FuturesPage() {
  const {
    loading,
    contracts, account, positions, trades, bySymbol,
    tradesNextCursor, tradesLoadingMore, loadMoreTrades,
    hydrateSymbol, startSymbolPolling, startSymbolLive,
    openPosition, updateTriggers, closePosition,
  } = useFuturesData();

  // correct initial symbol: empty, then set to first contract when available
  const [symbol, setSymbol] = useState<string>("");         // ← do NOT derive from bySymbol
  const [side, setSide] = useState<FuturesSide>("LONG");
  const [size, setSize] = useState("0.01");
  const [leverage, setLeverage] = useState(10);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showAutoClosePanel, setShowAutoClosePanel] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"OPEN" | "CLOSE" | "UPDATE_TRIGGERS" | null>(null);
  const [skipConfirmation, setSkipConfirmation] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("futuresSkipConfirmation") === "true";
  });
  const [refreshingSymbol, setRefreshingSymbol] = useState(false);

  // pick first contract once contracts arrive
  useEffect(() => {
    if (!symbol && contracts.length > 0) setSymbol(contracts[0].symbol);
  }, [contracts, symbol]);

  // tick “latency” clock
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // --- LIVE WS + fallback polling for selected symbol ---
  const stopPollRef = useRef<(() => void) | null>(null);
  const stopLiveRef = useRef<(() => void) | null>(null);

//   useEffect(() => {
//     if (!symbol) return;

//     // initial REST snapshot so UI isn't empty
//     hydrateSymbol(symbol);

//     // stop previous streams
//     stopLiveRef.current?.();
//     stopPollRef.current?.();

//     // start websocket
//     stopLiveRef.current = startSymbolLive(symbol);

//     // fallback to HTTP polling if no tick in 3s
//     const timer = window.setTimeout(() => {
//       const fresh = (Date.now() - (bySymbol[symbol]?.lastUpdatedAt ?? 0)) < 2500;
//       if (!fresh) stopPollRef.current = startSymbolPolling(symbol);
//     }, 3000);

//     return () => {
//       window.clearTimeout(timer);
//       stopLiveRef.current?.();
//       stopPollRef.current?.();
//     };
//   }, [symbol, hydrateSymbol, startSymbolLive, startSymbolPolling, bySymbol]);


const bySymbolRef = useRef(bySymbol);
useEffect(() => { bySymbolRef.current = bySymbol; }, [bySymbol]);

useEffect(() => {
if (!symbol) return;

// seed UI once
hydrateSymbol(symbol);

// stop previous streams
stopLiveRef.current?.();
stopPollRef.current?.();

// start websocket
stopLiveRef.current = startSymbolLive(symbol);

// every 1s, check if the selected symbol is "fresh".
// if not fresh, start HTTP polling once.
const interval = window.setInterval(() => {
    const last = bySymbolRef.current[symbol]?.lastUpdatedAt ?? 0;
    const fresh = (Date.now() - last) < 2500;
    if (!fresh && !stopPollRef.current) {
    stopPollRef.current = startSymbolPolling(symbol);
    }
}, 1000);

return () => {
    window.clearInterval(interval);
    stopLiveRef.current?.();
    stopPollRef.current?.();
    // stopLiveRef.current = undefined;
    // stopPollRef.current = undefined;
};
// ✅ no bySymbol in deps, we read the latest from bySymbolRef
}, [symbol, hydrateSymbol, startSymbolLive, startSymbolPolling]);



  // reset SL/TP on symbol change
  useEffect(() => {
    setStopLoss("");
    setTakeProfit("");
  }, [symbol]);

  // current contract
  const contract: FuturesContract | undefined = useMemo(
    () => contracts.find((c) => c.symbol === symbol),
    [contracts, symbol]
  );


  // derived live data

    const markPrice    = bySymbol[symbol]?.mark?.price ?? 0;

    const fundingRate = bySymbol[symbol]?.funding?.rate ?? 0;
    const history     = Array.isArray(bySymbol[symbol]?.history) ? bySymbol[symbol]!.history : [];

    const lastTrade    = history.length ? history[history.length - 1].price : 0;
    const displayPrice = lastTrade; // <- will match TradingView better

    const lastUpdatedAt = bySymbol[symbol]?.lastUpdatedAt ?? 0;
    const position    = positions[symbol];

    const tradingViewSymbol = useMemo(() => {
        if (!symbol) return "BTCUSDTPERP";
        return symbol.replace(/-PERP$/i, "PERP").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    }, [symbol]);

    const priceChange = useMemo(() => {
    if (history.length < 2) return 0;
    return history[history.length - 1].price - history[0].price;
    }, [history]);

    const priceChangePct = useMemo(() => {
    if (history.length < 2) return 0;
    const first = history[0].price || 1;
    return ((history[history.length - 1].price - first) / first) * 100;
    }, [history]);

  const secondsSinceUpdate = Math.max(0, Math.round((now - lastUpdatedAt) / 1000));
  const lastUpdatedLabel = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : "--:--:--";
  const changePositive = priceChange >= 0;

  // small price pulse effect
  const [pricePulse, setPricePulse] = useState<"up" | "down" | null>(null);
  const prevMarkRef = useRef<number | null>(null);
  const pulseTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!Number.isFinite(markPrice)) return;
    const prev = prevMarkRef.current;
    prevMarkRef.current = markPrice;
    if (prev === null || prev === markPrice) return;
    const dir = markPrice > prev ? "up" : "down";
    setPricePulse(dir);
    if (pulseTimeoutRef.current) window.clearTimeout(pulseTimeoutRef.current);
    // @ts-ignore
    pulseTimeoutRef.current = window.setTimeout(() => setPricePulse(null), 600);
  }, [markPrice]);
  useEffect(() => () => { if (pulseTimeoutRef.current) window.clearTimeout(pulseTimeoutRef.current); }, []);
  const priceHighlightClass =
    pricePulse === "up"
      ? "text-emerald-300 drop-shadow-[0_0_12px_rgba(16,185,129,0.45)]"
      : pricePulse === "down"
      ? "text-rose-300 drop-shadow-[0_0_12px_rgba(244,63,94,0.45)]"
      : "text-white";

  // ticket derived
  const sizeValue = parseFloat(size) || 0;
  const notional = markPrice * sizeValue;
  const maxLev = contract?.maxLeverage ?? 50;
  const clippedLeverage = Math.min(Math.max(leverage, 1), maxLev);
  const marginRequired = contract ? (notional / clippedLeverage || 0) : 0;
  const maintenanceMargin = contract ? notional * ((contract.maintenanceMarginPct ?? 0) / 100) : 0;

  const parseTrigger = (raw: string) => {
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
  };
  const draftStop = parseTrigger(stopLoss);
  const draftTake = parseTrigger(takeProfit);
  const quoteSymbol = contract?.quoteAsset ?? "USDT";
  const autoCloseActive =
    draftStop !== undefined || draftTake !== undefined ||
    position?.stopLoss != null || position?.takeProfit != null;

  const stopSummary =
    draftStop !== undefined ? `${formatValue(draftStop)} ${quoteSymbol}`
    : position?.stopLoss != null ? `${formatValue(position.stopLoss)} ${quoteSymbol}` : "Not set";
  const takeSummary =
    draftTake !== undefined ? `${formatValue(draftTake)} ${quoteSymbol}`
    : position?.takeProfit != null ? `${formatValue(position.takeProfit)} ${quoteSymbol}` : "Not set";

  const handleManualRefresh = useCallback(async () => {
    if (!symbol) return;
    setRefreshingSymbol(true);
    try {
      await hydrateSymbol(symbol, { force: true });
    } finally {
      setRefreshingSymbol(false);
    }
  }, [hydrateSymbol, symbol]);

  // actions
  const performOpen = async () => {
    setLocalError(null);
    if (!contract) { setLocalError("Select a contract to trade."); return; }
    if (sizeValue <= 0) { setLocalError("Enter a contract size above zero."); return; }
    await openPosition({
      symbol, side, size: sizeValue, leverage: clippedLeverage,
      stopLoss: draftStop, takeProfit: draftTake,
    });
    setSize("0.01");
  };
  const performClose = async () => {
    setLocalError(null);
    await closePosition(symbol);
  };
  const performUpdate = async () => {
    setLocalError(null);
    if (!position) { setLocalError("No open position to update."); return; }
    await updateTriggers({ symbol, stopLoss: draftStop, takeProfit: draftTake });
  };

  // confirm dialog flow
  const requestAction = (a: PendingAction) => {
    if (skipConfirmation) { execute(a); return; }
    setPendingAction(a); setConfirmOpen(true);
  };
  const execute = (a: PendingAction) => {
    if (a === "OPEN") performOpen();
    else if (a === "CLOSE") performClose();
    else if (a === "UPDATE_TRIGGERS") performUpdate();
  };
  const confirmAndExecute = () => { if (pendingAction) execute(pendingAction); setConfirmOpen(false); setPendingAction(null); };

  const confirmationTitle =
    pendingAction === "OPEN" ? (side === "LONG" ? "Confirm open long position" : "Confirm open short position")
    : pendingAction === "CLOSE" ? "Confirm close position"
    : pendingAction === "UPDATE_TRIGGERS" ? "Confirm auto-close update"
    : "Confirm action";

  const confirmationMessage = useMemo(() => {
    if (!pendingAction) return "";
    if (pendingAction === "OPEN") {
      const direction = side === "LONG" ? "long" : "short";
      const baseAsset = contract?.baseAsset ?? "units";
      return `You are about to open a ${direction} ${symbol} position sized ${formatValue(sizeValue)} ${baseAsset} (~$${formatValue(notional)}) at ${clippedLeverage}x leverage. Continue?`;
    }
    if (pendingAction === "CLOSE") {
      const baseAsset = contract?.baseAsset ?? "";
      return position
        ? `Close your ${position.side.toLowerCase()} ${position.symbol} position of ${formatValue(position.size)} ${baseAsset} at the live mark price?`
        : "Close the current position at the live mark price?";
    }
    if (pendingAction === "UPDATE_TRIGGERS") {
      const stopChange =
        draftStop !== undefined ? `Set to ${stopSummary}` :
        position?.stopLoss != null ? `Cleared (was ${formatValue(position.stopLoss)} ${quoteSymbol})` : "Not set";
      const takeChange =
        draftTake !== undefined ? `Set to ${takeSummary}` :
        position?.takeProfit != null ? `Cleared (was ${formatValue(position.takeProfit)} ${quoteSymbol})` : "Not set";
      return `Apply these auto-close settings?\n- Stop-loss: ${stopChange}\n- Take-profit: ${takeChange}`;
    }
    return "";
  }, [pendingAction, side, contract?.baseAsset, symbol, sizeValue, notional, clippedLeverage, position, draftStop, draftTake, stopSummary, takeSummary, quoteSymbol]);

  const confirmationPrimaryLabel =
    pendingAction === "OPEN" ? (side === "LONG" ? "Open long" : "Open short")
    : pendingAction === "CLOSE" ? "Close position"
    : pendingAction === "UPDATE_TRIGGERS" ? "Save auto-close"
    : "Confirm";

  // UI
  return (
    <div className="max-w-7xl mx-auto space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Futures Trading</h1>
          <p className="text-sm text-slate-300/85">
            Perpetual swaps with live mark pricing and funding.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-300/80">
          <div>
            <span className="text-slate-400">Account equity</span>
            <div className="text-lg font-semibold text-white">${formatValue(account.equity)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Funding</div>
            <div className={fundingRate >= 0 ? "text-emerald-300" : "text-rose-300"}>
              {percentFormatter.format((fundingRate ?? 0) * 100)}%
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Tick latency</div>
            <div className="text-white">
              {secondsSinceUpdate <= 1 ? "<1s" : `${secondsSinceUpdate}s`} ago
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-right">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Last updated</div>
            <div className="text-white font-semibold">{lastUpdatedLabel}</div>
            <Button
              variant="ghost"
              size="xs"
              className="mt-1"
              onClick={handleManualRefresh}
              disabled={!symbol || refreshingSymbol}
            >
              {refreshingSymbol ? "Refreshing..." : "Refresh now"}
            </Button>
          </div>
        </div>
      </header>

      {/* Chart card */}
      <section className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.3)]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">
              {symbol || "—"} Mark Price Stream
            </div>
            <div className={`text-2xl font-semibold transition-all duration-300 ${priceHighlightClass}`}>
              {formatValue(displayPrice)} {contract?.quoteAsset ?? "USDT"}
            </div>
          </div>
          <div className="text-sm text-slate-300/80">
            <span className={changePositive ? "text-emerald-300" : "text-rose-300"}>
              {changePositive ? "+" : ""}{formatValue(priceChange)} ({priceChangePct.toFixed(2)}%)
            </span>{" "}
            over the last {history.length} ticks.
          </div>
        </div>
        <div className="h-[520px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220]">
          <TradingViewChart symbol={tradingViewSymbol} />
        </div>
      </section>

      {/* Ticket + Position + Account metrics */}
      <section className="grid gap-5 lg:grid-cols-[360px_1fr_320px]">
        {/* Ticket */}
        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Order ticket</div>
            <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="rounded-xl border border-white/15 bg-white/10 px-2 py-1 text-xs text-white focus:border-indigo-400 focus:outline-none"
                disabled={loading || contracts.length === 0}
            >
                {contracts.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                    {c.symbol}
                </option>
                ))}
            </select>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300/80">
            <div className="flex justify-between">
              <span>Mark price</span>
              <span className={`transition-all duration-300 ${priceHighlightClass}`}>
                {formatValue(markPrice)} {contract?.quoteAsset ?? "USDT"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Funding (8h)</span>
              <span className={fundingRate >= 0 ? "text-emerald-300" : "text-rose-300"}>
                {percentFormatter.format((fundingRate ?? 0) * 100)}%
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            {(["LONG", "SHORT"] as FuturesSide[]).map((v) => (
              <button
                key={v}
                onClick={() => setSide(v)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm transition ${
                  side === v
                    ? v === "LONG"
                      ? "border-emerald-500/60 bg-emerald-500/20 text-white"
                      : "border-rose-500/60 bg-rose-500/20 text-white"
                    : "border-white/10 bg-white/5 text-slate-200 hover:border-indigo-400/40"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-xs text-slate-300/70">Contract size ({contract?.baseAsset ?? "BASE"})</label>
            <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="0.01" inputMode="decimal" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300/70">
              <span>Leverage</span>
              <span>{clippedLeverage}x (max {contract?.maxLeverage ?? 50}x)</span>
            </div>
            <input
              type="range"
              min={1}
              max={contract?.maxLeverage ?? 50}
              value={clippedLeverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          {/* Auto-close */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <button
              type="button"
              onClick={() => setShowAutoClosePanel((p) => !p)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-slate-200 transition hover:border-indigo-400/40"
            >
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300/60">Auto-close controls</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300/80">
                  <span>Stop-loss: {stopSummary}</span>
                  <span>|</span>
                  <span>Take-profit: {takeSummary}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    autoCloseActive
                      ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                      : "border-white/10 bg-white/10 text-slate-300/80"
                  }`}>
                    {autoCloseActive ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
              <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs text-white">
                {showAutoClosePanel ? "-" : "+"}
              </span>
            </button>

            {showAutoClosePanel && (
              <div className="mt-3 space-y-3">
                <div className="space-y-2">
                  <label className="text-xs text-slate-300/70">Stop-loss price ({contract?.quoteAsset ?? "QUOTE"})</label>
                  <Input value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} placeholder="e.g. 67500" inputMode="decimal" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-slate-300/70">Take-profit price ({contract?.quoteAsset ?? "QUOTE"})</label>
                  <Input value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} placeholder="e.g. 70500" inputMode="decimal" />
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/70">
                  Set target prices to auto-close the active position. Leave blank to remove a trigger.
                </div>
                <Button variant="ghost" size="md" className="w-full" onClick={() => requestAction("UPDATE_TRIGGERS")} disabled={!position}>
                  Save Auto-close
                </Button>
              </div>
            )}
          </div>

          {localError && (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {localError}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <Button className="w-full" size="lg" onClick={() => requestAction("OPEN")}>
              {side === "LONG" ? "Open Long" : "Open Short"}
            </Button>
            <Button className="w-full" variant="secondary" size="lg" onClick={() => requestAction("CLOSE")} disabled={!position}>
              Close Position
            </Button>
          </div>

          {/* ticket stats */}
          <div className="grid grid-cols-2 gap-3 text-sm text-slate-200">
            <Stat label="Notional" value={`$${formatValue(notional)}`} />
            <Stat label="Order margin" value={`$${formatValue(marginRequired)}`} />
            <Stat label="Maintenance" value={`$${formatValue(maintenanceMargin)}`} />
            <Stat label="Available" value={`$${formatValue(account.availableMargin)}`} />
          </div>
        </div>

        {/* Position overview */}
        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.3)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Position overview</div>
            <div className="text-xs text-slate-300/75">
              {position ? `Leverage ${position.leverage}x` : "No open position"}
            </div>
          </div>

          {!position ? (
            <div className="text-sm text-slate-300/80">
              No open position for {symbol || "—"}. Submit an order to open exposure.
            </div>
          ) : (
            <div className="space-y-3 text-sm text-slate-200">
              <Row label="Direction" value={position.side} tone={position.side === "LONG" ? "text-emerald-300" : "text-rose-300"} />
              <Row label="Size" value={`${formatValue(position.size)} ${contract?.baseAsset ?? ""}`} />
              <Row label="Entry price" value={`${formatValue(position.entryPrice)} ${contract?.quoteAsset ?? ""}`} />
              <Row label="Mark price" value={`${formatValue(markPrice)} ${contract?.quoteAsset ?? ""}`} valueClass={priceHighlightClass} />
              <Row label="Stop-loss" value={position.stopLoss != null ? `${formatValue(position.stopLoss)} ${contract?.quoteAsset ?? ""}` : "--"} />
              <Row label="Take-profit" value={position.takeProfit != null ? `${formatValue(position.takeProfit)} ${contract?.quoteAsset ?? ""}` : "--"} />
              <Row label="Unrealized PnL" value={`$${formatValue(account.unrealizedPnl)}`} tone={account.unrealizedPnl >= 0 ? "text-emerald-300" : "text-rose-300"} big />
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/75">
            Funding impacts long/short carry. Positive rates pay shorts; negative rates pay longs.
            <div className="mt-2">Maintenance margin threshold: {contract?.maintenanceMarginPct ?? 0}% of notional.</div>
          </div>
        </div>

        {/* Account metrics */}
        <aside className="space-y-3 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.3)]">
          <div className="text-sm font-semibold text-white">Account metrics</div>
          <div className="space-y-2 text-sm">
            <Stat label="Equity" value={`$${formatValue(account.equity)}`} />
            <Stat label="Balance" value={`$${formatValue(account.balance)}`} />
            <Stat label="Available Margin" value={`$${formatValue(account.availableMargin)}`} />
            <Stat label="Margin Used" value={`$${formatValue(account.marginUsed)}`} />
            <Stat label="Unrealized PnL" value={`${account.unrealizedPnl >= 0 ? "+" : ""}$${formatValue(account.unrealizedPnl)}`} tone={account.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
            <Stat label="Realized PnL" value={`${account.realizedPnl >= 0 ? "+" : ""}$${formatValue(account.realizedPnl)}`} tone={account.realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400"} />
          </div>
        </aside>
      </section>

      {/* Executions */}
      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(37,99,235,0.35)]">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white">Recent executions</div>
            <div className="text-xs text-slate-300/75">
              {trades.length > 0
                ? `${trades.length} records${tradesNextCursor ? " + more available" : ""}`
                : "No fills yet"}
            </div>
          </div>

          {trades.length === 0 ? (
            <div className="text-sm text-slate-300/80">Trades will appear after you open or close a position.</div>
          ) : (
            <div className="space-y-2 text-sm">
              {trades.map((trade) => {
                const c = contracts.find((x) => x.symbol === trade.symbol);
                const executedAt =
                  trade.createdAt ?? (trade.timestamp ? new Date(trade.timestamp).toISOString() : undefined);
                const timeLabel = executedAt ? new Date(executedAt).toLocaleString() : "--";
                const isAutoClose =
                  trade.autoClose ??
                  (trade.trigger === "STOP_LOSS" || trade.trigger === "TAKE_PROFIT");
                const reasonLabel =
                  trade.closeReasonLabel ??
                  (trade.status === "CLOSED"
                    ? isAutoClose
                      ? trade.trigger === "STOP_LOSS"
                        ? "Stop-loss"
                        : trade.trigger === "TAKE_PROFIT"
                        ? "Take-profit"
                        : "Auto close"
                      : "Manual close"
                    : "Fill");
                const priceLabel = `${reasonLabel}${Number.isFinite(trade.price) ? ` @ ${formatValue(trade.price)} ${c?.quoteAsset ?? ""}` : ""}`;
                return (
                  <div
                    key={trade.id}
                    className={`grid grid-cols-[160px_1.2fr_0.8fr_0.9fr_1.4fr_0.9fr] items-center gap-2 rounded-xl border border-white/10 px-3 py-2 ${
                      isAutoClose ? "bg-rose-500/5" : "bg-white/5"
                    }`}
                  >
                    <span className="text-xs text-slate-400">{timeLabel}</span>
                    <span className="font-semibold text-white flex items-center gap-2">
                      {trade.symbol}
                      {reasonLabel && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] ${
                            isAutoClose
                              ? "border-rose-400/60 bg-rose-500/10 text-rose-100"
                              : "border-indigo-400/60 bg-indigo-500/10 text-indigo-200"
                          }`}
                        >
                          {reasonLabel}
                        </span>
                      )}
                    </span>
                    <span className={trade.side === "LONG" ? "text-emerald-300" : "text-rose-300"}>{trade.side}</span>
                    <span>
                      {formatValue(trade.size)} {c?.baseAsset ?? ""}
                    </span>
                    <span className="text-xs text-slate-300/80">{priceLabel}</span>
                    <span className={trade.realizedPnl >= 0 ? "text-emerald-300 text-right" : "text-rose-300 text-right"}>
                      {trade.status === "OPENED" ? "--" : `${trade.realizedPnl >= 0 ? "+" : ""}$${formatValue(trade.realizedPnl)}`}
                    </span>
                  </div>
                );
              })}
              {tradesNextCursor && (
                <div className="pt-2">
                  <Button
                    variant="ghost"
                    size="md"
                    className="w-full"
                    onClick={loadMoreTrades}
                    disabled={tradesLoadingMore}
                  >
                    {tradesLoadingMore ? "Loading more..." : "Load more"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] space-y-3 text-sm text-slate-200">
          <div className="text-sm font-semibold text-white">Risk checklist</div>
          <ul className="space-y-2 text-xs text-slate-300/80">
            <li>- Maintain margin ratio above maintenance to avoid liquidation.</li>
            <li>- Funding is applied periodically to mark-to-market equity.</li>
            <li>- Adjust leverage to tune required margin before opening a position.</li>
            <li>- Closing a position realizes PnL back into available balance.</li>
          </ul>
        </div>
      </section>

      {/* Confirm dialog */}
      <Dialog
        open={confirmOpen && pendingAction !== null}
        onClose={() => { setConfirmOpen(false); setPendingAction(null); }}
        title={confirmationTitle}
        footer={
          <>
            <Button variant="ghost" onClick={() => { setConfirmOpen(false); setPendingAction(null); }}>Cancel</Button>
            <Button onClick={confirmAndExecute}>{confirmationPrimaryLabel}</Button>
          </>
        }
      >
        <p className="whitespace-pre-line">{confirmationMessage}</p>
        <label className="mt-4 flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={skipConfirmation} onChange={(e) => setSkipConfirmation(e.target.checked)} />
          Do not show this confirmation again
        </label>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-xs text-slate-300/80">{label}</div>
      <div className={`text-white font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}
function Row({ label, value, tone, valueClass, big }: { label: string; value: string; tone?: string; valueClass?: string; big?: boolean }) {
  return (
    <div className={`flex justify-between ${big ? "text-base" : ""}`}>
      <span>{label}</span>
      <span className={`${tone ?? ""} ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}
