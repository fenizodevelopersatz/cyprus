import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import Dialog from "../../../ui/Dialog";
import { useFuturesEngine } from "../../../hooks/useFuturesEngine";
import type { FuturesContract, FuturesSide } from "../../../utils/futuresEngine";
import TradingViewChart from "../../exchange/components/TradingViewChart";

const numberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatValue(value: number) {
  if (!Number.isFinite(value)) return "--";
  return numberFormatter.format(value);
}

type PendingAction = "OPEN" | "CLOSE" | "UPDATE_TRIGGERS";

export default function FuturesPage() {
  const engine = useFuturesEngine();
  const [symbol, setSymbol] = useState(() => engine.contracts[0]?.symbol ?? "BTCUSDT-PERP");
  const [side, setSide] = useState<FuturesSide>("LONG");
  const [size, setSize] = useState("0.01");
  const [leverage, setLeverage] = useState(10);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showAutoClosePanel, setShowAutoClosePanel] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [skipConfirmation, setSkipConfirmation] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("futuresSkipConfirmation") === "true";
  });
  const [pricePulse, setPricePulse] = useState<"up" | "down" | null>(null);
  const previousMarkPriceRef = useRef<number | null>(null);
  const pricePulseTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("futuresSkipConfirmation", skipConfirmation ? "true" : "false");
  }, [skipConfirmation]);

  useEffect(() => {
    setStopLoss("");
    setTakeProfit("");
  }, [symbol]);

  const contract = useMemo(
    () => engine.contracts.find((item) => item.symbol === symbol),
    [engine.contracts, symbol]
  );
  const contractMap = useMemo(() => {
    const map: Record<string, FuturesContract> = {};
    engine.contracts.forEach((item) => {
      map[item.symbol] = item;
    });
    return map;
  }, [engine.contracts]);
  const markPrice = engine.markPrices[symbol] ?? 0;
  const fundingRate = engine.fundingRates[symbol] ?? 0;
  const position = engine.positions[symbol];
  const priceHistory = useMemo(
    () => engine.history[symbol] ?? [],
    [engine.history, symbol]
  );
  const tradingViewSymbol = useMemo(() => {
    if (!symbol) return "BTCUSDTPERP";
    return symbol.replace(/-PERP$/i, "PERP").replace(/[^A-Z0-9]/gi, "").toUpperCase();
  }, [symbol]);

  const priceChange = useMemo(() => {
    if (priceHistory.length < 2) return 0;
    const first = priceHistory[0].price;
    const last = priceHistory[priceHistory.length - 1].price;
    return last - first;
  }, [priceHistory]);

  const priceChangePct = useMemo(() => {
    if (priceHistory.length < 2) return 0;
    const first = priceHistory[0].price || 1;
    return ((priceHistory[priceHistory.length - 1].price - first) / first) * 100;
  }, [priceHistory]);

  const changePositive = priceChange >= 0;
  const secondsSinceUpdate = Math.max(0, Math.round((now - engine.lastUpdatedAt) / 1000));
  const priceHighlightClass =
    pricePulse === "up"
      ? "text-emerald-300 drop-shadow-[0_0_12px_rgba(16,185,129,0.45)]"
      : pricePulse === "down"
      ? "text-rose-300 drop-shadow-[0_0_12px_rgba(244,63,94,0.45)]"
      : "text-white";

  useEffect(() => {
    if (!Number.isFinite(markPrice)) return;
    const previous = previousMarkPriceRef.current;
    previousMarkPriceRef.current = markPrice;
    if (previous === null || previous === markPrice) return;
    const direction = markPrice > previous ? "up" : "down";
    setPricePulse(direction);
    if (pricePulseTimeoutRef.current) {
      window.clearTimeout(pricePulseTimeoutRef.current);
    }
    pricePulseTimeoutRef.current = window.setTimeout(() => setPricePulse(null), 600);
  }, [markPrice]);

  useEffect(
    () => () => {
      if (pricePulseTimeoutRef.current) {
        window.clearTimeout(pricePulseTimeoutRef.current);
      }
    },
    []
  );

  const sizeValue = parseFloat(size) || 0;
  const notional = markPrice * sizeValue;
  const marginRequired = contract ? (notional / leverage || 0) : 0;
  const maintenanceMargin = contract
    ? notional * (contract.maintenanceMarginPct / 100)
    : 0;

  const maxLeverage = contract?.maxLeverage ?? 50;
  const clippedLeverage = Math.min(Math.max(leverage, 1), maxLeverage);

  const account = engine.account;

  const parseTrigger = (raw: string) => {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return parsed;
  };

  const draftStop = parseTrigger(stopLoss);
  const draftTake = parseTrigger(takeProfit);
  const quoteSymbol = contract?.quoteAsset ?? "USDT";
  const autoCloseActive =
    draftStop !== undefined ||
    draftTake !== undefined ||
    position?.stopLoss != null ||
    position?.takeProfit != null;
  const stopSummary =
    draftStop !== undefined
      ? `${formatValue(draftStop)} ${quoteSymbol}`
      : position?.stopLoss != null
        ? `${formatValue(position.stopLoss)} ${quoteSymbol}`
        : "Not set";
  const takeSummary =
    draftTake !== undefined
      ? `${formatValue(draftTake)} ${quoteSymbol}`
      : position?.takeProfit != null
        ? `${formatValue(position.takeProfit)} ${quoteSymbol}`
        : "Not set";
  const stopChangeDescription =
    draftStop !== undefined
      ? `Set to ${stopSummary}`
      : position?.stopLoss != null
        ? `Cleared (was ${formatValue(position.stopLoss)} ${quoteSymbol})`
        : "Not set";
  const takeChangeDescription =
    draftTake !== undefined
      ? `Set to ${takeSummary}`
      : position?.takeProfit != null
        ? `Cleared (was ${formatValue(position.takeProfit)} ${quoteSymbol})`
        : "Not set";

  const performOpenPosition = () => {
    setError(null);
    if (!contract) {
      setError("Select a contract to trade.");
      return;
    }
    if (sizeValue <= 0) {
      setError("Enter a contract size above zero.");
      return;
    }
    try {
      engine.openPosition({
        symbol,
        side,
        size: sizeValue,
        leverage: clippedLeverage,
        stopLoss: draftStop,
        takeProfit: draftTake,
      });
      setSize("0.01");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order rejected.");
    }
  };

  const performClosePosition = () => {
    setError(null);
    engine.closePosition(symbol);
  };

  const performUpdateTriggers = () => {
    setError(null);
    if (!position) {
      setError("No open position to update.");
      return;
    }
    try {
      engine.setPositionTriggers(symbol, {
        stopLoss: draftStop,
        takeProfit: draftTake,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update triggers.");
    }
  };

  const executeAction = (action: PendingAction) => {
    switch (action) {
      case "OPEN":
        performOpenPosition();
        break;
      case "CLOSE":
        performClosePosition();
        break;
      case "UPDATE_TRIGGERS":
        performUpdateTriggers();
        break;
      default:
        break;
    }
  };

  const requestAction = (action: PendingAction) => {
    if (skipConfirmation) {
      executeAction(action);
      return;
    }
    setPendingAction(action);
    setConfirmOpen(true);
  };

  const closeDialog = () => {
    setConfirmOpen(false);
    setPendingAction(null);
  };

  const confirmAndExecute = () => {
    if (pendingAction) {
      executeAction(pendingAction);
    }
    closeDialog();
  };

  const confirmationTitle = useMemo(() => {
    switch (pendingAction) {
      case "OPEN":
        return side === "LONG" ? "Confirm open long position" : "Confirm open short position";
      case "CLOSE":
        return "Confirm close position";
      case "UPDATE_TRIGGERS":
        return "Confirm auto-close update";
      default:
        return "Confirm action";
    }
  }, [pendingAction, side]);

  const confirmationMessage = useMemo(() => {
    if (!pendingAction) return "";
    switch (pendingAction) {
      case "OPEN": {
        const direction = side === "LONG" ? "long" : "short";
        const baseAsset = contract?.baseAsset ?? "units";
        return `You are about to open a ${direction} ${symbol} position sized ${formatValue(sizeValue)} ${baseAsset} (~$${formatValue(notional)}) at ${clippedLeverage}x leverage. Continue?`;
      }
      case "CLOSE": {
        if (!position) return "Close the current position at the live mark price?";
        const baseAsset = contract?.baseAsset ?? "";
        return `Close your ${position.side.toLowerCase()} ${position.symbol} position of ${formatValue(position.size)} ${baseAsset} at the live mark price?`;
      }
      case "UPDATE_TRIGGERS":
        return `Apply these auto-close settings?\n- Stop-loss: ${stopChangeDescription}\n- Take-profit: ${takeChangeDescription}`;
      default:
        return "";
    }
  }, [
    pendingAction,
    side,
    contract?.baseAsset,
    symbol,
    sizeValue,
    notional,
    clippedLeverage,
    position,
    stopChangeDescription,
    takeChangeDescription,
  ]);

  const confirmationPrimaryLabel = useMemo(() => {
    switch (pendingAction) {
      case "OPEN":
        return side === "LONG" ? "Open long" : "Open short";
      case "CLOSE":
        return "Close position";
      case "UPDATE_TRIGGERS":
        return "Save auto-close";
      default:
        return "Confirm";
    }
  }, [pendingAction, side]);

  const accountStats = [
    { label: "Equity", value: `$${formatValue(account.equity)}` },
    { label: "Balance", value: `$${formatValue(account.balance)}` },
    { label: "Available Margin", value: `$${formatValue(account.availableMargin)}` },
    { label: "Margin Used", value: `$${formatValue(account.marginUsed)}` },
    {
      label: "Unrealized PnL",
      value: `${account.unrealizedPnl >= 0 ? "+" : ""}$${formatValue(account.unrealizedPnl)}`,
      tone: account.unrealizedPnl >= 0 ? "text-emerald-400" : "text-rose-400",
    },
    {
      label: "Realized PnL",
      value: `${account.realizedPnl >= 0 ? "+" : ""}$${formatValue(account.realizedPnl)}`,
      tone: account.realizedPnl >= 0 ? "text-emerald-400" : "text-rose-400",
    },
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Futures Trading</h1>
          <p className="text-sm text-slate-300/85">
            Simulate perpetual swaps with isolated margin, live mark pricing, and funding flows.
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
              {percentFormatter.format(fundingRate * 100)}%
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Tick latency</div>
            <div className="text-white">
              {secondsSinceUpdate <= 1 ? "<1s" : `${secondsSinceUpdate}s`} ago
            </div>
          </div>
        </div>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.3)]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">
              {symbol} Mark Price Stream
            </div>
            <div className={`text-2xl font-semibold transition-all duration-300 ${priceHighlightClass}`}>
              {formatValue(markPrice)} {contract?.quoteAsset}
            </div>
          </div>
          <div className="text-sm text-slate-300/80">
            <span className={changePositive ? "text-emerald-300" : "text-rose-300"}>
              {changePositive ? "+" : ""}
              {formatValue(priceChange)} ({priceChangePct.toFixed(2)}%)
            </span>{" "}
            over the last {priceHistory.length} ticks.
          </div>
        </div>
        <div className="h-[520px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220]">
          <TradingViewChart symbol={tradingViewSymbol} />
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[360px_1fr_320px]">
        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Order ticket</div>
            <select
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              className="rounded-xl border border-white/15 bg-white/10 px-2 py-1 text-xs text-white focus:border-indigo-400 focus:outline-none"
            >
              {engine.contracts.map((item) => (
                <option key={item.symbol} value={item.symbol}>
                  {item.symbol}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300/80">
            <div className="flex justify-between">
              <span>Mark price</span>
              <span className={`transition-all duration-300 ${priceHighlightClass}`}>
                {formatValue(markPrice)} {contract?.quoteAsset}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Funding (8h)</span>
              <span className={fundingRate >= 0 ? "text-emerald-300" : "text-rose-300"}>
                {percentFormatter.format(fundingRate * 100)}%
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            {(["LONG", "SHORT"] as FuturesSide[]).map((value) => (
              <button
                key={value}
                onClick={() => setSide(value)}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm transition ${
                  side === value
                    ? value === "LONG"
                      ? "border-emerald-500/60 bg-emerald-500/20 text-white"
                      : "border-rose-500/60 bg-rose-500/20 text-white"
                    : "border-white/10 bg-white/5 text-slate-200 hover:border-indigo-400/40"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <label className="text-xs text-slate-300/70">Contract size ({contract?.baseAsset ?? "BASE"})</label>
            <Input
              value={size}
              onChange={(event) => setSize(event.target.value)}
              placeholder="0.01"
              inputMode="decimal"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300/70">
              <span>Leverage</span>
              <span>{clippedLeverage}x (max {maxLeverage}x)</span>
            </div>
            <input
              type="range"
              min={1}
              max={maxLeverage}
              value={clippedLeverage}
              onChange={(event) => setLeverage(Number(event.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <button
              type="button"
              onClick={() => setShowAutoClosePanel((prev) => !prev)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-slate-200 transition hover:border-indigo-400/40"
            >
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-slate-300/60">
                  Auto-close controls
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300/80">
                  <span>Stop-loss: {stopSummary}</span>
                  <span>|</span>
                  <span>Take-profit: {takeSummary}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${
                      autoCloseActive
                        ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-200"
                        : "border-white/10 bg-white/10 text-slate-300/80"
                    }`}
                  >
                    {autoCloseActive ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
              <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-xs text-white">
                {showAutoClosePanel ? "-" : "+"}
              </span>
            </button>
            {showAutoClosePanel ? (
              <div className="mt-3 space-y-3">
                <div className="space-y-2">
                  <label className="text-xs text-slate-300/70">
                    Stop-loss price ({contract?.quoteAsset ?? "QUOTE"})
                  </label>
                  <Input
                    value={stopLoss}
                    onChange={(event) => setStopLoss(event.target.value)}
                    placeholder="e.g. 67500"
                    inputMode="decimal"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-slate-300/70">
                    Take-profit price ({contract?.quoteAsset ?? "QUOTE"})
                  </label>
                  <Input
                    value={takeProfit}
                    onChange={(event) => setTakeProfit(event.target.value)}
                    placeholder="e.g. 70500"
                    inputMode="decimal"
                  />
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/70">
                  Set target prices to auto-close the active position. Leave blank to remove a trigger.
                </div>
                <Button
                  variant="ghost"
                  size="md"
                  className="w-full"
                  onClick={() => requestAction("UPDATE_TRIGGERS")}
                  disabled={!position}
                >
                  Save Auto-close
                </Button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm text-slate-200">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-xs text-slate-300/80">Notional</div>
              <div className="text-white font-semibold">
                ${formatValue(notional)}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-xs text-slate-300/80">Order margin</div>
              <div className="text-white font-semibold">
                ${formatValue(marginRequired)}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-xs text-slate-300/80">Maintenance</div>
              <div className="text-white font-semibold">
                ${formatValue(maintenanceMargin)}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
              <div className="text-xs text-slate-300/80">Available</div>
              <div className="text-white font-semibold">
                ${formatValue(account.availableMargin)}
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <Button className="w-full" size="lg" onClick={() => requestAction("OPEN")}>
              {side === "LONG" ? "Open Long" : "Open Short"}
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              size="lg"
              onClick={() => requestAction("CLOSE")}
              disabled={!position}
            >
              Close Position
            </Button>
          </div>
        </div>

        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.3)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Position overview</div>
            <div className="text-xs text-slate-300/75">
              {position ? `Leverage ${position.leverage}x` : "No open position"}
            </div>
          </div>
          {!position ? (
            <div className="text-sm text-slate-300/80">
              No open position for {symbol}. Submit an order to open exposure.
            </div>
          ) : (
            <div className="space-y-3 text-sm text-slate-200">
              <div className="flex justify-between">
                <span>Direction</span>
                <span className={position.side === "LONG" ? "text-emerald-300" : "text-rose-300"}>
                  {position.side}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Size</span>
                <span>
                  {formatValue(position.size)} {contract?.baseAsset}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Entry price</span>
                <span>{formatValue(position.entryPrice)} {contract?.quoteAsset}</span>
              </div>
              <div className="flex justify-between">
                <span>Mark price</span>
                <span className={`transition-all duration-300 ${priceHighlightClass}`}>
                  {formatValue(markPrice)} {contract?.quoteAsset}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Stop-loss</span>
                <span>{position.stopLoss != null ? `${formatValue(position.stopLoss)} ${contract?.quoteAsset}` : "--"}</span>
              </div>
              <div className="flex justify-between">
                <span>Take-profit</span>
                <span>{position.takeProfit != null ? `${formatValue(position.takeProfit)} ${contract?.quoteAsset}` : "--"}</span>
              </div>
              <div
                className={`flex justify-between text-base ${
                  engine.account.unrealizedPnl >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                <span>Unrealized PnL</span>
                <span>${formatValue(engine.account.unrealizedPnl)}</span>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/75">
            <div>
              Funding impacts long/short carry. Positive rates pay shorts; negative rates pay longs.
            </div>
            <div className="mt-2">
              Maintenance margin threshold: {contract?.maintenanceMarginPct ?? 0}% of notional.
            </div>
          </div>
        </div>

        <aside className="space-y-3 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.3)]">
          <div className="text-sm font-semibold text-white">Account metrics</div>
          <div className="space-y-2 text-sm">
            {accountStats.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <span className="text-slate-300/75">{item.label}</span>
                <span className={`font-semibold text-white ${item.tone ?? ""}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(37,99,235,0.35)]">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white">Recent executions</div>
            <div className="text-xs text-slate-300/75">
              {engine.trades.length > 0 ? `${engine.trades.length} records` : "No fills yet"}
            </div>
          </div>
          {engine.trades.length === 0 ? (
            <div className="text-sm text-slate-300/80">Trades will appear after you open or close a position.</div>
          ) : (
            <div className="space-y-2 text-sm">
              {engine.trades.slice(0, 10).map((trade) => {
                const tradeContract = contractMap[trade.symbol];
                return (
                  <div
                    key={trade.id}
                    className="grid grid-cols-[140px_1fr_1fr_1fr_1fr] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                  >
                  <span className="text-xs text-slate-400">
                    {new Date(trade.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="font-semibold text-white flex items-center gap-2">
                    {trade.symbol}
                    {trade.trigger ? (
                      <span className="rounded-full border border-indigo-400/60 bg-indigo-500/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-indigo-200">
                        {trade.trigger.replace("_", " ")}
                      </span>
                    ) : null}
                  </span>
                  <span className={trade.side === "LONG" ? "text-emerald-300" : "text-rose-300"}>
                    {trade.side}
                  </span>
                  <span>
                    {formatValue(trade.size)} {tradeContract?.baseAsset ?? ""}
                  </span>
                  <span>
                    {formatValue(trade.price)} {tradeContract?.quoteAsset ?? ""}
                  </span>
                  <span
                    className={
                      trade.realizedPnl >= 0
                        ? "text-emerald-300 text-right"
                          : "text-rose-300 text-right"
                      }
                    >
                      {trade.status === "OPENED"
                        ? "--"
                        : `${trade.realizedPnl >= 0 ? "+" : ""}$${formatValue(trade.realizedPnl)}`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] space-y-3 text-sm text-slate-200">
          <div className="text-sm font-semibold text-white">Risk checklist</div>
          <ul className="space-y-2 text-xs text-slate-300/80">
            <li>- Maintain margin ratio above maintenance to avoid liquidation.</li>
            <li>- Funding is applied every 8 hours to mark-to-market equity.</li>
            <li>- Adjust leverage to tune required margin before opening a position.</li>
            <li>- Closing a position realizes PnL back into available balance.</li>
          </ul>
        </div>
      </section>

      <Dialog
        open={confirmOpen && pendingAction !== null}
        onClose={closeDialog}
        title={confirmationTitle}
        footer={
          <>
            <Button variant="ghost" onClick={closeDialog}>
              Cancel
            </Button>
            <Button onClick={confirmAndExecute}>{confirmationPrimaryLabel}</Button>
          </>
        }
      >
        <p className="whitespace-pre-line">{confirmationMessage}</p>
        <label className="mt-4 flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={skipConfirmation}
            onChange={(event) => setSkipConfirmation(event.target.checked)}
          />
          Do not show this confirmation again
        </label>
      </Dialog>
    </div>
  );
}
