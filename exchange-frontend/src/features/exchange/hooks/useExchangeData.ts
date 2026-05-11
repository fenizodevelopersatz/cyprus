import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../../../app/apiRoutes";
import { getStoredAccessToken } from "../../auth/state/session.storage";
import {
  cancelOrder,
  fetchExchangeSnapshot,
  fetchMarkets,
  mapOrder,
  mapOrderBook,
  mapTicker,
  mapTrade,
  mapWallet,
  placeOrder,
} from "../api/exchange.api";
import { fetchRecentTrades as fetchUserRecentTrades, type RecentTradeDTO } from "../../orders/api/orders.api";
import type {
  ExchangeHistoryPoint,
  ExchangeOrder,
  ExchangeOrderBook,
  ExchangeSymbol,
  ExchangeTicker,
  ExchangeTrade,
  WalletBalance,
} from "../api/exchange.api";

type WsStatus = "idle" | "connecting" | "open" | "error";
const DEFAULT_EXCHANGE_SYMBOL = "BTCUSDT";

const parseError = (error: unknown) => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const err = error as {
      message?: string;
      response?: { data?: { message?: string } };
    };
    return err.response?.data?.message ?? err.message ?? "Exchange service unavailable.";
  }
  return "Exchange service unavailable.";
};

const buildWsUrl = (symbol: string): string | null => {
  try {
    const base = new URL(API_BASE_URL);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/?$/, "")}/ws/exchange`;
    base.searchParams.set("symbol", symbol);
    const token = getStoredAccessToken();
    if (token) base.searchParams.set("token", token);
    return base.toString();
  } catch {
    return null;
  }
};

const ensureRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const mergeOrder = (orders: ExchangeOrder[], next: ExchangeOrder) => {
  const index = orders.findIndex(
    (order) =>
      order.id === next.id ||
      (order.clientOrderId && next.clientOrderId && order.clientOrderId === next.clientOrderId)
  );
  if (index === -1) {
    return [next, ...orders].slice(0, 100);
  }
  const updated = [...orders];
  updated[index] = next;
  return updated;
};

const pruneOrders = (orders: ExchangeOrder[]) => orders.filter((order) => !["CANCELED", "FILLED", "EXPIRED"].includes(order.status.toUpperCase()));

const mergeWallet = (wallets: WalletBalance[], update: WalletBalance) => {
  const index = wallets.findIndex((wallet) => wallet.asset === update.asset);
  if (index === -1) return [...wallets, update];
  const copy = [...wallets];
  copy[index] = update;
  return copy;
};

const tradeKey = (trade: ExchangeTrade) => `${trade.id}-${trade.ts}`;

const dedupeTrades = (trades: ExchangeTrade[]) => {
  const seen = new Set<string>();
  const unique: ExchangeTrade[] = [];
  trades.forEach((trade) => {
    const key = tradeKey(trade);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(trade);
  });
  return unique;
};

const mergeTicker = (prev: ExchangeTicker | undefined, next: ExchangeTicker): ExchangeTicker => {
  if (!prev) return next;

  return {
    ...prev,
    ...next,
    symbol: next.symbol || prev.symbol,
    changePct: (next.changePct ?? 0) === 0 && (prev.changePct ?? 0) !== 0 ? prev.changePct : next.changePct,
    change: (next.change ?? 0) === 0 && (prev.change ?? 0) !== 0 ? prev.change : next.change,
    open: (next.open ?? 0) === 0 && (prev.open ?? 0) !== 0 ? prev.open : next.open,
    volume: (next.volume ?? 0) === 0 && (prev.volume ?? 0) !== 0 ? prev.volume : next.volume,
    volumeQuote: (next.volumeQuote ?? 0) === 0 && (prev.volumeQuote ?? 0) !== 0 ? prev.volumeQuote : next.volumeQuote,
  };
};

const mapHistoryPoint = (value: unknown): ExchangeHistoryPoint => {
  const point = ensureRecord(value);
  const price = typeof point.price === "number" ? point.price : Number(point.price ?? point.close ?? point.c ?? 0);
  const open = typeof point.open === "number" ? point.open : Number(point.open ?? point.o ?? price);
  const high = typeof point.high === "number" ? point.high : Number(point.high ?? point.h ?? price);
  const low = typeof point.low === "number" ? point.low : Number(point.low ?? point.l ?? price);
  const close = typeof point.close === "number" ? point.close : Number(point.close ?? point.c ?? price);
  const time =
    typeof point.time === "number"
      ? point.time
      : typeof point.openTime === "number"
      ? point.openTime
      : typeof point.closeTime === "number"
      ? point.closeTime
      : Number(point.t ?? point.T ?? Date.now());
  return {
    open,
    high,
    low,
    close,
    price,
    volume: typeof point.volume === "number" ? point.volume : Number(point.volume ?? point.v ?? 0),
    time,
  };
};

export type ExchangeHookState = {
  loading: boolean;
  error?: string;
  markets: ExchangeSymbol[];
  symbol: string;
  ticker?: ExchangeTicker;
  orderbook: ExchangeOrderBook;
  trades: ExchangeTrade[];
  history: ExchangeHistoryPoint[];
  wallets: WalletBalance[];
  openOrders: ExchangeOrder[];
  userTrades: RecentTradeDTO[];
  wsStatus: WsStatus;
  selectSymbol: (symbol: string) => void;
  refresh: () => void;
  submitOrder: typeof placeOrder;
  cancelOrder: (orderId: string, symbol: string) => Promise<ExchangeOrder>;
};

const EMPTY_BOOK: ExchangeOrderBook = { bids: [], asks: [] };

export const useExchangeData = (initialSymbol?: string): ExchangeHookState => {
  const [markets, setMarkets] = useState<ExchangeSymbol[]>([]);
  const [symbol, setSymbol] = useState(initialSymbol ?? DEFAULT_EXCHANGE_SYMBOL);
  const [ticker, setTicker] = useState<ExchangeTicker | undefined>();
  const [orderbook, setOrderbook] = useState<ExchangeOrderBook>(EMPTY_BOOK);
  const [trades, setTrades] = useState<ExchangeTrade[]>([]);
  const [history, setHistory] = useState<ExchangeHistoryPoint[]>([]);
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [openOrders, setOpenOrders] = useState<ExchangeOrder[]>([]);
  const [userTrades, setUserTrades] = useState<RecentTradeDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
  const [refreshIndex, setRefreshIndex] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | undefined>(undefined);

  const selectSymbol = useCallback((nextSymbol: string) => {
    setSymbol((prev) => (prev === nextSymbol ? prev : nextSymbol));
  }, []);

  const refresh = useCallback(() => {
    setRefreshIndex((index) => index + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const marketList = await fetchMarkets();
        if (!isMounted) return;
        setMarkets(marketList);
        if (!symbol && marketList.length > 0) {
          const fallbackSymbol =
            marketList.find((market) => market.symbol === DEFAULT_EXCHANGE_SYMBOL)?.symbol ??
            marketList[0].symbol;
          setSymbol(fallbackSymbol);
        }
      } catch (err) {
        if (!isMounted) return;
        setError(parseError(err));
      }
    })();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [snapshot, recentUserTrades] = await Promise.all([
          fetchExchangeSnapshot(symbol),
          fetchUserRecentTrades(25).catch(() => []),
        ]);
        if (cancelled) return;
        setTicker(snapshot.ticker);
        setOrderbook(snapshot.orderbook);
        setTrades(dedupeTrades(snapshot.trades));
        setHistory(snapshot.history ?? []);
        setWallets(snapshot.wallets);
        setOpenOrders(pruneOrders(snapshot.openOrders));
        setUserTrades(recentUserTrades ?? []);
        setError(undefined);
      } catch (err) {
        if (cancelled) return;
        setError(parseError(err));
        setTicker(undefined);
        setOrderbook(EMPTY_BOOK);
        setTrades([]);
        setHistory([]);
        setOpenOrders([]);
        setUserTrades([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, refreshIndex]);

  useEffect(() => {
    return () => {
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!symbol) return;
    const url = buildWsUrl(symbol);
    if (!url) return;

    if (reconnectRef.current) {
      window.clearTimeout(reconnectRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
    }

    setWsStatus("connecting");
    let closedByUser = false;
    const socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => {
      setWsStatus("open");
      const token = getStoredAccessToken();
      socket.send(
        JSON.stringify({
          action: "subscribe",
          symbol,
          token,
        })
      );
    };

    socket.onerror = () => {
      setWsStatus("error");
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as Record<string, unknown>;
        const eventTypeRaw = message.event ?? message.type;
        const eventType = typeof eventTypeRaw === "string" ? eventTypeRaw : "";
        const data = "data" in message ? (message as { data?: unknown }).data : undefined;
        switch (eventType) {
          case "exchange:snapshot":
          case "snapshot": {
            const payload = ensureRecord(data ?? message);
            setTicker(mapTicker(payload.ticker ?? payload));
            setOrderbook(mapOrderBook(payload.orderbook ?? payload.book ?? {}));
            setTrades(Array.isArray(payload.trades) ? dedupeTrades(payload.trades.map(mapTrade)) : []);
            if (Array.isArray(payload.history)) {
              setHistory(payload.history.map(mapHistoryPoint));
            }
            if (Array.isArray(payload.wallets)) {
              setWallets(payload.wallets.map(mapWallet));
            }
            if (Array.isArray(payload.openOrders)) {
              setOpenOrders(pruneOrders(payload.openOrders.map(mapOrder)));
            }
            break;
          }
          case "exchange:ticker":
          case "ticker": {
            setTicker((prev) => mergeTicker(prev, mapTicker(data ?? message)));
            break;
          }
          case "exchange:orderbook":
          case "orderbook": {
            setOrderbook(mapOrderBook(data ?? message));
            break;
          }
          case "exchange:trade":
          case "trade": {
            const trade = mapTrade(data ?? message);
            setTrades((prev) => {
              const filtered = prev.filter((existing) => tradeKey(existing) !== tradeKey(trade));
              return [trade, ...filtered].slice(0, 200);
            });
            setTicker((prev) => {
              const base = prev ?? {
                symbol,
                last: trade.price,
                open: trade.price,
                high: trade.price,
                low: trade.price,
                change: 0,
                changePct: 0,
                volume: 0,
                volumeQuote: 0,
              };
              const last = trade.price;
              const open = base.open ?? trade.price;
              const high = Math.max(base.high ?? last, last);
              const low =
                base.low === undefined || base.low === 0
                  ? last
                  : Math.min(base.low, last);
              return {
                ...base,
                last,
                high,
                low,
                updatedAt: new Date(trade.ts).toISOString(),
              };
            });
            setHistory((prev) => {
              if (!prev.length) return prev;
              const latest = prev[prev.length - 1];
              if (!latest) return prev;
              const updated = [...prev];
              if (trade.ts >= latest.time) {
                updated[updated.length - 1] = {
                  ...latest,
                  price: trade.price,
                  close: trade.price,
                  high: Math.max(latest.high ?? trade.price, trade.price),
                  low: Math.min(latest.low ?? trade.price, trade.price),
                };
              }
              return updated;
            });
            break;
          }
          case "exchange:order":
          case "order": {
            const order = mapOrder(data ?? message);
            setOpenOrders((prev) => pruneOrders(mergeOrder(prev, order)));
            break;
          }
          case "exchange:wallet":
          case "wallet": {
            const balance = mapWallet(data ?? message);
            setWallets((prev) => mergeWallet(prev, balance));
            break;
          }
          default:
            break;
        }
      } catch {
        // silently ignore malformed payloads
      }
    };

    socket.onclose = () => {
      wsRef.current = null;
      setWsStatus("idle");
      if (closedByUser) return;
      reconnectRef.current = window.setTimeout(() => {
        setWsStatus("connecting");
        setRefreshIndex((index) => index + 1); // refetch snapshot on reconnect attempt
      }, 3_000);
    };

    return () => {
      closedByUser = true;
      socket.close();
    };
  }, [symbol]);

  const submitOrder = useCallback(
    async (payload: Parameters<typeof placeOrder>[0]) => {
      const order = await placeOrder(payload);
      setOpenOrders((prev) => pruneOrders(mergeOrder(prev, order)));
      refresh();
      return order;
    },
    [refresh]
  );

  const cancelOrderAction = useCallback(async (orderId: string, orderSymbol: string) => {
    const order = await cancelOrder(orderId, orderSymbol);
    setOpenOrders((prev) => pruneOrders(mergeOrder(prev, order)));
    refresh();
    return order;
  }, [refresh]);

  const value = useMemo(
    () => ({
      loading,
      error,
      markets,
      symbol,
      ticker,
      orderbook,
      trades,
      history,
      wallets,
      openOrders,
      wsStatus,
      selectSymbol,
      refresh,
      submitOrder,
      userTrades,
      cancelOrder: cancelOrderAction,
    }),
    [
      loading,
      error,
      markets,
      symbol,
      ticker,
      orderbook,
      trades,
      history,
      wallets,
      openOrders,
      wsStatus,
      selectSymbol,
      refresh,
      submitOrder,
      userTrades,
      cancelOrderAction,
    ]
  );

  return value;
};
