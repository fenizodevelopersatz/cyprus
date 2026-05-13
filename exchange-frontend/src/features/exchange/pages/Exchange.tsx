import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import Marquee from "../../../ui/Marquee";
import { subscribeToWalletRealtime } from "../../../app/walletRealtime";
import SignalCenter from "../components/SignalCenter";
import { fetchSignalWalletSummary } from "../api/signal.api";
import TradingViewChart from "../components/TradingViewChart";
import { useExchangeData } from "../hooks/useExchangeData";
import { useMarketsBoard } from "../../markets/hooks/useMarketsBoard";

const formatFullTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const numberFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percentFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatCompactValue = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: value >= 1_000_000_000 ? 2 : 1,
  }).format(value);
const formatSignedPercent = (value: number) => `${value >= 0 ? "+" : ""}${percentFormatter.format(value)}%`;
const pickNonZero = (...values: Array<number | null | undefined>) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value !== 0) return value;
  }
  return undefined;
};
const formatHeroPrice = (value: number, precision: number) => {
  if (!Number.isFinite(value)) return "--";
  const digits = value >= 1000 ? 2 : value >= 1 ? Math.min(Math.max(precision, 2), 4) : Math.min(Math.max(precision, 4), 6);
  return `$${new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)}`;
};

const exchangeAssetIconMap: Record<string, string> = {
  BTC: "https://s2.coinmarketcap.com/static/img/coins/64x64/1.png",
  ETH: "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
  BNB: "https://s2.coinmarketcap.com/static/img/coins/64x64/1839.png",
  SOL: "https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png",
  XRP: "https://s2.coinmarketcap.com/static/img/coins/64x64/52.png",
  DOGE: "https://s2.coinmarketcap.com/static/img/coins/64x64/74.png",
  ADA: "https://s2.coinmarketcap.com/static/img/coins/64x64/2010.png",
  TRX: "https://s2.coinmarketcap.com/static/img/coins/64x64/1958.png",
};

const MobilePriceInfo = ({ label, value }: { label: string; value: string }) => (
  <div className="space-y-0.5">
    <div className="text-[9px] leading-none text-[var(--text-muted)]">{label}</div>
    <div className="text-[11px] font-semibold leading-none text-white">{value}</div>
  </div>
);

type Side = "BUY" | "SELL";
type OrderType = "LIMIT" | "MARKET";
type ChartInterval = "1" | "15" | "60" | "240" | "1D";
type ExchangeOrderPayload = { symbol: string; side: Side; type: OrderType; quantity: number; price?: number };
type PendingOrder = { payload: ExchangeOrderPayload; executionPrice: number; notional: number; side: Side; type: OrderType; baseAsset: string; quoteAsset: string };

const SIGNAL_INTENT_EVENT = "exchange:signal-intent";
const DEFAULT_EXCHANGE_SYMBOL = "BTCUSDT";

export default function Exchange() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const initialSymbolParam = searchParams.get("symbol") ?? DEFAULT_EXCHANGE_SYMBOL;
  const { loading, error, markets, symbol, ticker, orderbook, trades, wallets, openOrders, userTrades, wsStatus, selectSymbol, refresh, cancelOrder } =
    useExchangeData(initialSymbolParam ?? undefined);
  const { markets: boardMarkets } = useMarketsBoard("24h");

  const [side, setSide] = useState<Side>("BUY");
  const [type, setType] = useState<OrderType>("LIMIT");
  const [priceInput, setPriceInput] = useState("");
  const [qtyInput, setQtyInput] = useState("0.01");
  const [chartInterval, setChartInterval] = useState<ChartInterval>("15");
  const [followMarketPrice, setFollowMarketPrice] = useState(true);
  const [pricePulse, setPricePulse] = useState<"up" | "down" | null>(null);
  const [marketPanelTab, setMarketPanelTab] = useState<"orderbook" | "trades">("orderbook");
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; title: string; message: string } | null>(null);
  const [walletTotalBalance, setWalletTotalBalance] = useState(0);
  const previousPriceRef = useRef<number | null>(null);
  const pricePulseTimeoutRef = useRef<number | undefined>(undefined);

  const marketMeta = useMemo(() => markets.find((m) => m.symbol === symbol), [markets, symbol]);
  const boardMarket = useMemo(() => boardMarkets.find((market) => market.symbol === symbol), [boardMarkets, symbol]);
  const pricePrecision = marketMeta?.pricePrecision ?? 2;
  const qtyPrecision = marketMeta?.quantityPrecision ?? 3;
  const baseAsset = marketMeta?.base ?? symbol?.replace(/USDT$/, "") ?? "BTC";
  const quoteAsset = marketMeta?.quote ?? "USDT";
  const minNotional = marketMeta?.minNotional ?? 0;
  const liveTicker = useMemo(() => {
    const boardTicker = boardMarket?.ticker;
    if (!ticker && !boardTicker) return undefined;
    return {
      ...(boardTicker ?? {}),
      ...(ticker ?? {}),
      symbol: ticker?.symbol || boardTicker?.symbol || symbol || DEFAULT_EXCHANGE_SYMBOL,
      last: pickNonZero(ticker?.last, boardTicker?.last) ?? 0,
      open: pickNonZero(ticker?.open, boardTicker?.open) ?? 0,
      high: pickNonZero(ticker?.high, boardTicker?.high, ticker?.last, boardTicker?.last) ?? 0,
      low: pickNonZero(ticker?.low, boardTicker?.low, ticker?.last, boardTicker?.last) ?? 0,
      change: pickNonZero(boardTicker?.change, ticker?.change) ?? 0,
      changePct: pickNonZero(boardTicker?.changePct, ticker?.changePct) ?? 0,
      volume: pickNonZero(boardTicker?.volume, ticker?.volume) ?? 0,
      volumeQuote: pickNonZero(boardTicker?.volumeQuote, ticker?.volumeQuote) ?? 0,
      updatedAt: ticker?.updatedAt || boardTicker?.updatedAt,
    };
  }, [boardMarket?.ticker, symbol, ticker]);

  useEffect(() => { if (initialSymbolParam && initialSymbolParam !== symbol) selectSymbol(initialSymbolParam); }, [initialSymbolParam, selectSymbol, symbol]);
  useEffect(() => {
    if (searchParams.get("symbol")) return;
    const params = new URLSearchParams(location.search);
    params.set("symbol", DEFAULT_EXCHANGE_SYMBOL);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }, [location.pathname, location.search, navigate, searchParams]);

  const setSymbolAndSyncUrl = useCallback((nextSymbol: string) => {
    selectSymbol(nextSymbol);
    const params = new URLSearchParams(location.search);
    params.set("symbol", nextSymbol);
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }, [location.pathname, location.search, navigate, selectSymbol]);

  useEffect(() => {
    if (!liveTicker) return;
    const formatted = liveTicker.last.toFixed(pricePrecision);
    if (type === "MARKET" || followMarketPrice) setPriceInput((current) => (current === formatted ? current : formatted));
  }, [liveTicker, pricePrecision, type, followMarketPrice]);
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const summary = await fetchSignalWalletSummary();
        if (cancelled) return;
        setWalletTotalBalance(summary.mainWalletBalance || summary.currentBalance || summary.availableBalance || 0);
      } catch {
        if (!cancelled) setWalletTotalBalance(0);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeToWalletRealtime((summary) => {
      const nextBalance = Number(summary.mainWalletBalance ?? summary.main_wallet_balance ?? summary.balance?.total ?? 0);
      if (Number.isFinite(nextBalance)) {
        setWalletTotalBalance(nextBalance);
      }
    });

    return unsubscribe;
  }, []);
  useEffect(() => { if (type === "MARKET") setFollowMarketPrice(true); }, [type]);
  useEffect(() => { setFollowMarketPrice(true); }, [symbol]);
  useEffect(() => {
    if (!liveTicker || typeof liveTicker.last !== "number") return;
    const previous = previousPriceRef.current;
    previousPriceRef.current = liveTicker.last;
    if (previous === null || previous === liveTicker.last) return;
    setPricePulse(liveTicker.last > previous ? "up" : "down");
    if (pricePulseTimeoutRef.current) window.clearTimeout(pricePulseTimeoutRef.current);
    pricePulseTimeoutRef.current = window.setTimeout(() => setPricePulse(null), 600);
  }, [liveTicker]);
  useEffect(() => () => { if (pricePulseTimeoutRef.current) window.clearTimeout(pricePulseTimeoutRef.current); }, []);

  const priceFormatter = useMemo(() => new Intl.NumberFormat(undefined, { minimumFractionDigits: pricePrecision, maximumFractionDigits: pricePrecision }), [pricePrecision]);
  const qtyFormatter = useMemo(() => new Intl.NumberFormat(undefined, { minimumFractionDigits: qtyPrecision, maximumFractionDigits: qtyPrecision }), [qtyPrecision]);
  const notionalDigits = useMemo(() => Math.min(6, Math.max(4, pricePrecision + Math.max(0, qtyPrecision - 2))), [pricePrecision, qtyPrecision]);
  const notionalFormatter = useMemo(() => new Intl.NumberFormat(undefined, { minimumFractionDigits: notionalDigits, maximumFractionDigits: notionalDigits }), [notionalDigits]);

  const asks = useMemo(() => {
    let cumulative = 0;
    return [...(orderbook.asks ?? [])].slice(0, 20).sort((a, b) => a.price - b.price).map((level) => {
      const qty = level.qty ?? 0;
      cumulative += qty;
      return { price: level.price, qty, total: level.total ?? cumulative };
    });
  }, [orderbook.asks]);
  const bids = useMemo(() => {
    let cumulative = 0;
    return (orderbook.bids ?? []).slice(0, 20).map((level) => {
      const qty = level.qty ?? 0;
      cumulative += qty;
      return { price: level.price, qty, total: level.total ?? cumulative };
    });
  }, [orderbook.bids]);
  const orderBookRows = useMemo(() => Array.from({ length: Math.max(asks.length, bids.length) }, (_, index) => ({ ask: asks[index], bid: bids[index] })), [asks, bids]);

  const availableQuote = wallets.find((wallet) => wallet.asset === quoteAsset)?.free ?? 0;
  const availableBase = wallets.find((wallet) => wallet.asset === baseAsset)?.free ?? 0;
  const totalWalletBalanceLabel = `${walletTotalBalance.toFixed(5)} USDT`;
  const qtyValue = parseFloat(qtyInput) || 0;
  const limitPriceValue = parseFloat(priceInput) || 0;
  const marketPrice = liveTicker?.last ?? limitPriceValue;
  const notional = (type === "MARKET" ? marketPrice : limitPriceValue) * qtyValue;
  const meetsMinNotional = !minNotional || notional === 0 || notional + Math.pow(10, -notionalDigits) >= minNotional;
  const changeValue = liveTicker?.change ?? 0;
  const changePct = liveTicker?.changePct ?? 0;
  const changePositive = changePct >= 0;
  const priceHighlightClass = pricePulse === "up" ? "text-[var(--success)]" : pricePulse === "down" ? "text-[var(--danger)]" : "text-white";
  const marqueeItems = useMemo(() => {
    const source = boardMarkets.length > 0 ? boardMarkets : [];
    const items = source
      .map((market) => {
        const marketSymbol = market.symbol?.trim();
        const marketTicker = market.ticker;
        if (!marketSymbol || !marketTicker) return null;

        const isActiveSymbol = marketSymbol === (liveTicker?.symbol || symbol);
        return {
          symbol: marketSymbol,
          last: isActiveSymbol ? (liveTicker?.last ?? marketTicker.last) : marketTicker.last,
          changePct: isActiveSymbol ? (liveTicker?.changePct ?? marketTicker.changePct) : marketTicker.changePct,
          isActive: isActiveSymbol,
        };
      })
      .filter((item): item is { symbol: string; last?: number; changePct?: number; isActive: boolean } => Boolean(item));

    if (items.length > 0) return items;
    if (!liveTicker) return [];

    return [
      {
        symbol: liveTicker.symbol || symbol || DEFAULT_EXCHANGE_SYMBOL,
        last: liveTicker.last ?? 0,
        changePct: liveTicker.changePct ?? 0,
        isActive: true,
      },
    ];
  }, [boardMarkets, symbol, liveTicker]);
  const dayRangeProgress = useMemo(() => {
    if (!liveTicker || liveTicker.high <= liveTicker.low) return 50;
    return Math.min(100, Math.max(0, ((liveTicker.last - liveTicker.low) / (liveTicker.high - liveTicker.low)) * 100));
  }, [liveTicker]);

  const buildPendingOrder = useCallback((): PendingOrder | null => {
    if (!symbol || !qtyValue || (type === "LIMIT" && !limitPriceValue)) return null;
    const payload: ExchangeOrderPayload = { symbol, side, type, quantity: qtyValue };
    if (type === "LIMIT") payload.price = limitPriceValue;
    const executionPrice = type === "MARKET" ? marketPrice : payload.price ?? marketPrice;
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) return null;
    return { payload, executionPrice, notional: payload.quantity * executionPrice, side, type, baseAsset, quoteAsset };
  }, [symbol, qtyValue, type, limitPriceValue, side, marketPrice, baseAsset, quoteAsset]);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const handlePlaceOrder = useCallback(() => {
    if (!meetsMinNotional && minNotional > 0) {
      setFeedback({ type: "error", title: "Order below minimum", message: `Minimum order size for ${symbol ?? "this pair"} is ${notionalFormatter.format(minNotional)} ${quoteAsset}.` });
      return;
    }
    const nextOrder = buildPendingOrder();
    if (!nextOrder) return;
    window.dispatchEvent(new CustomEvent(SIGNAL_INTENT_EVENT, { detail: { side: nextOrder.side, type: nextOrder.type, symbol: nextOrder.payload.symbol, quantity: nextOrder.payload.quantity, price: nextOrder.executionPrice } }));
    document.getElementById("signal-center")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setFeedback({ type: "info", title: "Signal flow activated", message: `${nextOrder.side === "BUY" ? "Buy" : "Sell"} ${nextOrder.type} now uses the signal window below.` });
  }, [buildPendingOrder, meetsMinNotional, minNotional, notionalFormatter, quoteAsset, symbol]);

  const handleCancelOrder = async (orderId: string) => {
    if (!symbol) return;
    try {
      await cancelOrder(orderId, symbol);
    } catch (err) {
      console.error("Failed to cancel order", err);
    }
  };

  const sellBlocked = side === "SELL" && availableBase <= 0;
  const orderDisabled = !qtyValue || (type === "LIMIT" && !limitPriceValue) || !meetsMinNotional || sellBlocked;

  if ((!symbol && !error) || (!liveTicker && loading && !error)) {
    return <LoadingState title="Connecting to exchange..." message="Fetching market data and wallet balances." />;
  }
  if (error && !symbol) {
    return <ErrorState error={error} onRetry={refresh} />;
  }




  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <ExchangeTickerStrip tickers={marqueeItems} />

      <section className="space-y-3 text-[12px] lg:hidden">
        <div className="exchange-card exchange-card-strong p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5">
                <ExchangePairIcon asset={baseAsset} />
                <div className="min-w-0">
                  <div className="text-[1.05rem] font-extrabold leading-none text-white">{baseAsset}/{quoteAsset}</div>                  
                </div>
              </div>

              <div className="mt-3.5">
                <div className={`text-[1.7rem] font-black leading-none tracking-tight ${priceHighlightClass}`}>{liveTicker ? formatHeroPrice(liveTicker.last, pricePrecision) : "--"}</div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                  <span className={changePositive ? "font-bold text-[var(--success)]" : "font-bold text-[var(--danger)]"}>
                    {liveTicker ? `${changePositive ? "+" : "-"}$${priceFormatter.format(Math.abs(changeValue))}` : "--"}
                  </span>
                  <span className={changePositive ? "badge-success" : "badge-danger"}>
                    {liveTicker ? `${changePositive ? "+" : ""}${changePct.toFixed(2)}%` : "--"}
                  </span>
                </div>
              </div>
            </div>

            <div className="w-[112px] shrink-0 text-right">
              <div className="text-[8px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Balance</div>
              <div className="mt-0.5 text-[1rem] font-extrabold leading-none text-white">{`$${walletTotalBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</div>
              <div className="mt-3 space-y-2">
                <MobilePriceInfo label="24h High" value={liveTicker ? `$${priceFormatter.format(liveTicker.high)}` : "--"} />
                <MobilePriceInfo label="24h Low" value={liveTicker ? `$${priceFormatter.format(liveTicker.low)}` : "--"} />
                <MobilePriceInfo label="24h Vol ($)" value={liveTicker ? `$${formatCompactValue(liveTicker.volumeQuote ?? (liveTicker.volume ?? 0) * (liveTicker.last ?? 0))}` : "--"} />
                <MobilePriceInfo label={`24h Vol (${baseAsset})`} value={liveTicker ? qtyFormatter.format(liveTicker.volume ?? 0) : "--"} />
              </div>
            </div>
          </div>

        </div>

        <div className="exchange-card overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-3 py-2.5">
            <div className="flex gap-2.5 text-[10px] font-semibold">
              {[
                { label: "1m", value: "1" as ChartInterval },
                { label: "15m", value: "15" as ChartInterval },
                { label: "1h", value: "60" as ChartInterval },
                { label: "4h", value: "240" as ChartInterval },
                { label: "1D", value: "1D" as ChartInterval },
              ].map((range) => (
                <button
                  key={range.value}
                  type="button"
                  onClick={() => setChartInterval(range.value)}
                  className={chartInterval === range.value ? "text-[var(--accent-yellow)]" : "text-[var(--text-muted)]"}
                >
                  {range.label}
                </button>
              ))}
            </div>
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 9h14" /><path d="M9 5v14" /><path d="M15 7v10" />
            </svg>
          </div>
          <div className="h-[300px] sm:h-[340px]">
            <TradingViewChart symbol={symbol || "BTCUSDT"} compact interval={chartInterval} />
          </div>
        </div>
      </section>

      <header className="hidden exchange-card exchange-card-strong p-4 sm:p-5 lg:block">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="flex items-center gap-3">
              <ExchangePairIcon asset={baseAsset} />
              <div>
              <div className="micro-label">Exchange</div>
              <div className="page-title mt-1">{symbol}</div>
              </div>
            </div>
            <select value={symbol} onChange={(event) => setSymbolAndSyncUrl(event.target.value)} className="h-11 rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-[var(--bg-input)] px-3 text-sm text-white focus:border-[var(--accent-yellow)] focus:outline-none">
              {markets.map((market) => <option key={market.symbol} value={market.symbol} className="bg-black text-white">{market.base}/{market.quote}</option>)}
            </select>
            <div className="wallet-pill px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em]">{wsStatus.toUpperCase()}</div>
          </div>
          <div className="flex w-full flex-wrap gap-3 lg:w-auto lg:justify-end">
            <Metric label="Last Price" value={liveTicker ? '$' + priceFormatter.format(liveTicker.last) : "--"} valueClass={priceHighlightClass} />
            <Metric
              label="24h Change"
              value={
                liveTicker ? (
                  <span className={changePositive ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                    <span>{`${changePositive ? "+" : "-"}$${priceFormatter.format(Math.abs(changeValue))} `}</span>
                    <span className={changePositive ? "text-[var(--success)]/80" : "text-[var(--danger)]/80"}>{`(${formatSignedPercent(changePct)})`}</span>
                  </span>
                ) : (
                  "--"
                )
              }
            />
            <Metric label="24h Volume" value={liveTicker ? `${liveTicker.volume.toFixed(2)} ${baseAsset}` : "--"} />
            <div className="flex items-end"><Button variant="secondary" size="sm" disabled={loading} onClick={refresh}>{loading ? "Refreshing..." : "Refresh"}</Button></div>
          </div>
        </div>
      </header>

      {error && <div className="rounded-[14px] border border-[rgba(246,70,93,0.25)] bg-[rgba(246,70,93,0.12)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}

      <div className="hidden exchange-card p-4 sm:p-5 lg:block">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <div className="micro-label">Chart</div>
            <div className="section-title mt-1">{symbol} advanced chart</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Live price</div>
            <div className={`text-xl font-semibold ${priceHighlightClass}`}>{liveTicker ? `$${priceFormatter.format(liveTicker.last)}` : "--"}</div>
          </div>
        </div>
        <div className="overflow-hidden rounded-[14px] border border-[var(--border-soft)] bg-[#0b0e11]">
          <div className="h-[280px] sm:h-[360px] lg:h-[440px] xl:h-[520px]">
            <TradingViewChart symbol={symbol || "BTCUSDT"} interval={chartInterval} />
          </div>
        </div>
      </div>

      <section className="grid gap-3 lg:hidden">
        <div className="exchange-card p-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex rounded-[12px] bg-[var(--bg-card-soft)] p-1">
              <button type="button" onClick={() => setSide("BUY")} className={`flex-1 rounded-[10px] px-3 py-2.5 text-[11px] font-bold ${side === "BUY" ? "bg-[rgba(14,203,129,0.16)] text-[var(--success)]" : "text-[var(--text-muted)]"}`}>BUY</button>
              <button type="button" onClick={() => setSide("SELL")} className={`flex-1 rounded-[10px] px-3 py-2.5 text-[11px] font-bold ${side === "SELL" ? "bg-[rgba(246,70,93,0.16)] text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>SELL</button>
            </div>
            <div className="flex rounded-[12px] bg-[var(--bg-card-soft)] p-1">
              <button type="button" onClick={() => setType("MARKET")} className={`flex-1 rounded-[10px] px-3 py-2.5 text-[11px] font-bold ${type === "MARKET" ? "bg-[rgba(252,213,53,0.16)] text-[var(--accent-yellow)]" : "text-[var(--text-muted)]"}`}>MARKET</button>
              <button type="button" onClick={() => setType("LIMIT")} className={`flex-1 rounded-[10px] px-3 py-2.5 text-[11px] font-bold ${type === "LIMIT" ? "bg-[rgba(252,213,53,0.16)] text-[var(--accent-yellow)]" : "text-[var(--text-muted)]"}`}>LIMIT</button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <div className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-2.5">
              <div className="micro-label">Price ({quoteAsset})</div>
              <Input type="number" value={priceInput} onChange={(event) => { setPriceInput(event.target.value); if (followMarketPrice) setFollowMarketPrice(false); }} disabled={type === "MARKET"} step={marketMeta?.tickSize ?? "0.01"} className="mt-1.5 h-10 text-sm" />
            </div>
            <div className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-2.5">
              <div className="micro-label">Amount ({baseAsset})</div>
              <Input type="number" value={qtyInput} onChange={(event) => setQtyInput(event.target.value)} step={marketMeta?.stepSize ?? "0.0001"} className="mt-1.5 h-10 text-sm" />
            </div>
          </div>
          <div className="mt-3 rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-3 py-2.5 text-[11px] text-[var(--text-secondary)]">
            <DetailRow label="Notional" value={notional ? `${notionalFormatter.format(notional)} ${quoteAsset}` : "--"} />
            <DetailRow label={`${quoteAsset} balance`} value={`${qtyFormatter.format(availableQuote)} ${quoteAsset}`} />
            <DetailRow label={`${baseAsset} balance`} value={`${qtyFormatter.format(availableBase)} ${baseAsset}`} />
            {!meetsMinNotional && notional > 0 && minNotional > 0 && <div className="mt-2 text-[var(--danger)]">Minimum order size is {notionalFormatter.format(minNotional)} {quoteAsset}.</div>}
            {sellBlocked && <div className="mt-2 text-[var(--danger)]">You have no available {baseAsset}.</div>}
          </div>
          <Button type="button" className="mt-3 w-full" size="lg" onClick={handlePlaceOrder} disabled={orderDisabled}>
            {side === "BUY" ? `BUY ${baseAsset}` : `SELL ${baseAsset}`}
          </Button>
        </div>

        <SignalCenter marketSocketStatus={wsStatus} compact compactSection="entry" />

        <Panel title="Market Depth" subtitle={symbol || "BTCUSDT"} strong>
          <div className="flex gap-2 rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-1">
            <MarketTabButton active={marketPanelTab === "orderbook"} label="Depth" onClick={() => setMarketPanelTab("orderbook")} />
            <MarketTabButton active={marketPanelTab === "trades"} label="Trades" onClick={() => setMarketPanelTab("trades")} />
          </div>
          {marketPanelTab === "orderbook" ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-2.5">
                <div className="micro-label text-[9px]">Ask Price / Size</div>
                <div className="mt-2 space-y-2">
                  {orderBookRows.slice(0, 4).map((row, index) => (
                    <div key={`mobile-ask-${index}`} className="grid grid-cols-[1fr_auto] gap-2 text-[10px] font-mono">
                      <span className="text-[var(--danger)]">{row.ask ? priceFormatter.format(row.ask.price) : "--"}</span>
                      <span className="text-right text-white">{row.ask ? qtyFormatter.format(row.ask.qty) : "--"}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-2.5">
                <div className="micro-label text-[9px]">Bid Price / Size</div>
                <div className="mt-2 space-y-2">
                  {orderBookRows.slice(0, 4).map((row, index) => (
                    <div key={`mobile-bid-${index}`} className="grid grid-cols-[1fr_auto] gap-2 text-[10px] font-mono">
                      <span className="text-[var(--success)]">{row.bid ? priceFormatter.format(row.bid.price) : "--"}</span>
                      <span className="text-right text-white">{row.bid ? qtyFormatter.format(row.bid.qty) : "--"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-2.5">
              <div className="space-y-2">
                {trades.slice(0, 4).map((trade) => (
                  <div key={`mobile-trade-panel-${trade.id}-${trade.ts}`} className="grid grid-cols-[70px_1fr_auto] items-center gap-2 text-[10px] font-mono">
                    <span className="text-[var(--text-muted)]">{formatFullTime(trade.ts)}</span>
                    <span className={trade.side === "buy" ? "text-[var(--success)]" : "text-[var(--danger)]"}>{priceFormatter.format(trade.price)}</span>
                    <span className="text-right text-white">{qtyFormatter.format(trade.qty)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <SignalCenter marketSocketStatus={wsStatus} compact compactSection="history" />
      </section>

      <section className="hidden gap-4 lg:grid xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <div className="exchange-card p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">{(["BUY", "SELL"] as Side[]).map((option) => <ToggleButton key={option} active={side === option} label={option} onClick={() => setSide(option)} tone={option === "BUY" ? "success" : "danger"} />)}</div>
              <div className="flex gap-2">{(["MARKET", "LIMIT"] as OrderType[]).map((option) => <ToggleButton key={option} active={type === option} label={option} onClick={() => setType(option)} />)}</div>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="micro-label">Price ({quoteAsset})</label>
                  {type === "LIMIT" && (
                    <button type="button" onClick={() => { setFollowMarketPrice((prev) => { const next = !prev; if (next && liveTicker) setPriceInput(liveTicker.last.toFixed(pricePrecision)); return next; }); }} className={followMarketPrice ? "text-xs font-semibold text-[var(--accent-yellow)]" : "text-xs text-[var(--text-muted)] hover:text-white"}>
                      {followMarketPrice ? "Following" : "Follow price"}
                    </button>
                  )}
                </div>
                <Input type="number" value={priceInput} onChange={(event) => { setPriceInput(event.target.value); if (followMarketPrice) setFollowMarketPrice(false); }} disabled={type === "MARKET"} step={marketMeta?.tickSize ?? "0.01"} />
              </div>
              <div>
                <label className="micro-label mb-1 block">Quantity ({baseAsset})</label>
                <Input type="number" value={qtyInput} onChange={(event) => setQtyInput(event.target.value)} step={marketMeta?.stepSize ?? "0.0001"} />
              </div>
              <div className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-3 py-3 text-xs text-[var(--text-secondary)]">
                <DetailRow label={`cost of the ${baseAsset}`} value={notional ? `${notionalFormatter.format(notional)} ${quoteAsset}` : "--"} />
                <DetailRow label="Wallet balance" value={totalWalletBalanceLabel} />
                {!meetsMinNotional && notional > 0 && minNotional > 0 && <div className="mt-2 text-[var(--danger)]">Minimum order size is {notionalFormatter.format(minNotional)} {quoteAsset}.</div>}
                {sellBlocked && <div className="mt-2 text-[var(--danger)]">You have no available {baseAsset}.</div>}
              </div>
              <Button type="button" className="w-full" size="lg" onClick={handlePlaceOrder} disabled={orderDisabled}>{side === "BUY" ? "Send Buy To Signal" : "Send Sell To Signal"}</Button>
              <p className="text-[11px] text-[var(--text-muted)]">This trading desk is simulation-only. Orders route into the signal workflow below.</p>
            </div>
          </div>
        </div>

        <aside className="min-w-0 grid gap-4">
          <Panel title="Market Depth" subtitle={symbol || "BTCUSDT"} strong>
            <div className="flex gap-2 rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-1">
              <MarketTabButton active={marketPanelTab === "orderbook"} label="Order Book" onClick={() => setMarketPanelTab("orderbook")} />
              <MarketTabButton active={marketPanelTab === "trades"} label="Trades" onClick={() => setMarketPanelTab("trades")} />
            </div>
            {marketPanelTab === "orderbook" ? (
              <>
                <div className="desktop-data-table min-w-0 max-h-[520px] overflow-x-auto overflow-y-auto rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)]">
                  <table className="data-table min-w-[540px]">
                    <thead>
                      <tr><th>Ask price</th><th className="text-right">Size</th><th className="text-right">Total</th><th>Bid price</th><th className="text-right">Size</th><th className="text-right">Total</th></tr>
                    </thead>
                    <tbody>
                      {orderBookRows.map((row, index) => (
                        <tr key={`market-${row.ask?.price ?? "ask"}-${row.bid?.price ?? "bid"}-${index}`} className="font-mono text-xs">
                          <td className="text-[var(--danger)]">{row.ask ? priceFormatter.format(row.ask.price) : "--"}</td>
                          <td className="text-right text-[var(--danger)]">{row.ask ? qtyFormatter.format(row.ask.qty) : "--"}</td>
                          <td className="text-right text-[var(--danger)]/80">{row.ask ? qtyFormatter.format(row.ask.total ?? 0) : "--"}</td>
                          <td className="text-[var(--success)]">{row.bid ? priceFormatter.format(row.bid.price) : "--"}</td>
                          <td className="text-right text-[var(--success)]">{row.bid ? qtyFormatter.format(row.bid.qty) : "--"}</td>
                          <td className="text-right text-[var(--success)]/80">{row.bid ? qtyFormatter.format(row.bid.total ?? 0) : "--"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mobile-data-stack">
                  {orderBookRows.slice(0, 8).map((row, index) => (
                    <div key={`market-mobile-${index}`} className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-3 text-xs">
                      <div className="grid grid-cols-2 gap-3">
                        <div><div className="micro-label">Ask</div><div className="mt-1 text-[var(--danger)]">{row.ask ? priceFormatter.format(row.ask.price) : "--"}</div><div className="text-[var(--text-muted)]">{row.ask ? qtyFormatter.format(row.ask.qty) : "--"}</div></div>
                        <div><div className="micro-label">Bid</div><div className="mt-1 text-[var(--success)]">{row.bid ? priceFormatter.format(row.bid.price) : "--"}</div><div className="text-[var(--text-muted)]">{row.bid ? qtyFormatter.format(row.bid.qty) : "--"}</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="max-h-[520px] overflow-auto rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-2">
                <div className="space-y-1">
                  {trades.slice(0, 50).map((trade) => (
                    <div key={`market-trade-${trade.id}-${trade.ts}`} className="grid grid-cols-[88px_1fr_1fr] items-center gap-2 rounded-[10px] px-2 py-1.5 text-xs font-mono hover:bg-[rgba(252,213,53,0.04)]">
                      <span className="text-[var(--text-muted)]">{formatFullTime(trade.ts)}</span>
                      <span className={trade.side === "buy" ? "text-[var(--success)]" : "text-[var(--danger)]"}>{priceFormatter.format(trade.price)}</span>
                      <span className="text-right text-white">{qtyFormatter.format(trade.qty)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </aside>
      </section>

      <div className="hidden lg:block"><SignalCenter marketSocketStatus={wsStatus} /></div>

      {feedback && (
        <div className={`fixed right-4 top-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-[14px] border px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] ${feedback.type === "info" ? "border-[var(--border-yellow)] bg-[var(--bg-card)] text-[var(--accent-yellow)]" : feedback.type === "success" ? "border-[rgba(14,203,129,0.25)] bg-[rgba(14,203,129,0.12)] text-[var(--success)]" : "border-[rgba(246,70,93,0.25)] bg-[rgba(246,70,93,0.12)] text-[var(--danger)]"}`}>
          <div className="text-sm font-semibold text-white">{feedback.title}</div>
          <div className="mt-1 text-xs text-[var(--text-secondary)]">{feedback.message}</div>
        </div>
      )}
    </div>
  );
}

function LoadingState({ title, message }: { title: string; message: string }) {
  return <div className="flex min-h-[60vh] items-center justify-center"><div className="exchange-card exchange-card-strong flex flex-col items-center gap-3 px-8 py-6"><div className="h-10 w-10 animate-spin rounded-full border-2 border-[var(--accent-yellow)] border-t-transparent" /><div className="micro-label">Exchange</div><div className="text-lg font-semibold text-white">{title}</div><p className="text-xs text-[var(--text-secondary)]">{message}</p></div></div>;
}
function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <div className="flex min-h-[60vh] items-center justify-center"><div className="exchange-card flex flex-col items-center gap-4 px-8 py-6 text-center"><div className="micro-label">Exchange</div><div className="text-lg font-semibold text-white">Exchange unavailable</div><p className="text-sm text-[var(--danger)]">{error}</p><Button variant="secondary" onClick={onRetry}>Retry</Button></div></div>;
}
function ExchangeTickerStrip({
  tickers,
}: {
  tickers: Array<{ symbol: string; last?: number; changePct?: number; isActive?: boolean }>;
}) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,rgba(19,22,29,0.98)_0%,rgba(16,19,24,0.96)_100%)] shadow-[0_12px_30px_rgba(0,0,0,0.22)]">
      <div className="flex items-center gap-3 border-b border-[rgba(255,255,255,0.05)] px-3 py-2.5 sm:px-4">
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.95)]" />
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)] sm:text-[11px]">
          Market ticker
        </div>
      </div>
      {tickers.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-[var(--text-muted)] sm:px-4">No live tickers available.</div>
      ) : (
        <Marquee direction="left" speed={90} className="px-2 py-2 sm:px-3 sm:py-2.5">
          <div className="flex items-center gap-2.5 sm:gap-4">
            {tickers.map((ticker) => (
              <div
                key={ticker.symbol}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] sm:px-4 sm:text-xs ${
                  ticker.isActive
                    ? "border-[var(--border-yellow)] bg-[rgba(252,213,53,0.1)]"
                    : "border-[var(--border-soft)] bg-[rgba(255,255,255,0.03)]"
                }`}
              >
                <span className="font-semibold text-white">{ticker.symbol}</span>
                <span className="text-[var(--text-secondary)]">{numberFormatter.format(ticker.last ?? 0)}</span>
                <span className={(ticker.changePct ?? 0) >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                  {(ticker.changePct ?? 0) >= 0 ? "+" : ""}
                  {(ticker.changePct ?? 0).toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </Marquee>
      )}
    </section>
  );
}
function Metric({ label, value, valueClass = "" }: { label: string; value: ReactNode; valueClass?: string }) {
  return <div className="min-w-[120px] rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-3 py-2"><div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{label}</div><div className={`mt-1 text-base font-semibold text-white ${valueClass}`}>{value}</div></div>;
}
function ExchangePairIcon({ asset }: { asset: string }) {
  const [failed, setFailed] = useState(false);
  const normalized = asset.trim().toUpperCase();
  const imageUrl = exchangeAssetIconMap[normalized];

  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt={`${normalized} logo`}
        className="h-11 w-11 shrink-0 rounded-full object-cover shadow-[0_10px_24px_rgba(0,0,0,0.28)]"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--bg-card-soft)] text-sm font-bold text-white">
      {normalized.slice(0, 1) || "C"}
    </div>
  );
}
function ToggleButton({ active, onClick, label, tone = "neutral" }: { active: boolean; onClick: () => void; label: string; tone?: "neutral" | "success" | "danger" }) {
  const activeTone = tone === "success" ? "bg-[var(--success)] text-[#04150e]" : tone === "danger" ? "bg-[var(--danger)] text-white" : "bg-[var(--accent-yellow)] text-[#111]";
  return <button type="button" onClick={onClick} className={`rounded-[10px] px-4 py-2 text-sm font-semibold transition ${active ? activeTone : "border border-[var(--border-soft)] bg-[var(--bg-card-soft)] text-[var(--text-secondary)] hover:border-[var(--border-yellow)] hover:text-white"}`}>{label}</button>;
}
function MarketTabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-[10px] px-4 py-2 text-sm font-semibold transition ${
        active
          ? "bg-[var(--accent-yellow)] text-[#111]"
          : "text-[var(--text-secondary)] hover:bg-[rgba(252,213,53,0.06)] hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
function DetailRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 py-1"><span>{label}</span><span className="text-white">{value}</span></div>; }
function Panel({ title, subtitle, strong = false, children }: { title: string; subtitle?: string; strong?: boolean; children: ReactNode }) {
  return <div className={`exchange-card p-4 ${strong ? "exchange-card-strong" : ""}`}><div className="mb-3 flex items-center justify-between gap-3"><div><div className="section-title">{title}</div>{subtitle ? <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[var(--text-muted)]">{subtitle}</div> : null}</div></div><div className="space-y-3">{children}</div></div>;
}
function EmptyText({ children }: { children: ReactNode }) { return <div className="text-sm text-[var(--text-muted)]">{children}</div>; }
