import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../../../app/axios";
import { API_BASE_URL } from "../../../app/apiRoutes";
import { getStoredAccessToken } from "../../auth/state/session.storage";
import {
  fetchExchangeSnapshot,
  fetchMarkets,
  mapTicker,
  mapTrade,
  type ExchangeHistoryPoint,
  type ExchangeSymbol,
  type ExchangeTicker,
} from "../../exchange/api/exchange.api";

const parseError = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const err = error as {
      message?: string;
      response?: { data?: { message?: string } };
    };
    return err.response?.data?.message ?? err.message ?? "Unable to load markets.";
  }
  return "Unable to load markets.";
};

export type MarketSummary = ExchangeSymbol & {
  ticker?: ExchangeTicker;
  history?: ExchangeHistoryPoint[];
};

type MarketsHookState = {
  loading: boolean;
  error?: string;
  markets: MarketSummary[];
  refresh: () => void;
  wsStatus: "idle" | "connecting" | "open" | "error";
};

type MarketTickerFeedItem = {
  symbol: string;
  baseAsset?: string;
  quoteAsset?: string;
  last?: number;
  open?: number;
  change?: number;
  changePct?: number;
  volume?: number;
  volumeQuote?: number;
  marketCap?: number;
  market_cap?: number;
  cap?: number;
  updatedAt?: string;
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

const mergeTicker = (prev: ExchangeTicker | undefined, next: ExchangeTicker): ExchangeTicker => {
  const merged: ExchangeTicker = {
    ...prev,
    ...next,
    symbol: next.symbol || prev?.symbol || "",
  };

  if (prev) {
    if ((next.changePct ?? 0) === 0 && (prev.changePct ?? 0) !== 0) {
      merged.changePct = prev.changePct;
    }
    if ((next.change ?? 0) === 0 && (prev.change ?? 0) !== 0) {
      merged.change = prev.change;
    }
    if ((next.open ?? 0) === 0 && (prev.open ?? 0) !== 0) {
      merged.open = prev.open;
    }
    if ((next.volumeQuote ?? 0) === 0 && (prev.volumeQuote ?? 0) !== 0) {
      merged.volumeQuote = prev.volumeQuote;
    }
    if ((next.volume ?? 0) === 0 && (prev.volume ?? 0) !== 0) {
      merged.volume = prev.volume;
    }
  }

  return merged;
};

const fetchMarketTickers = async (range: "1h" | "24h"): Promise<MarketTickerFeedItem[]> => {
  const response = await api.get("/markets/tickers", { params: { window: range } });
  const payload = response.data?.data ?? response.data;
  return Array.isArray(payload) ? payload : [];
};

export const useMarketsBoard = (range: "1h" | "24h" = "24h"): MarketsHookState => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [wsStatus, setWsStatus] = useState<"idle" | "connecting" | "open" | "error">("idle");

  const refresh = useCallback(() => setRefreshIndex((index) => index + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const symbols = await fetchMarkets();
        if (cancelled) return;
        const marketTickers = await fetchMarketTickers(range);
        const tickerMap = new Map(
          marketTickers.map((ticker) => [
            String(ticker.symbol || "").toUpperCase(),
            mapTicker({
              symbol: ticker.symbol,
              last: ticker.last,
              open: ticker.open,
              change: ticker.change,
              changePct: ticker.changePct,
              volume: ticker.volume,
              volumeQuote: ticker.volumeQuote ?? ticker.volume,
              marketCap: ticker.marketCap ?? ticker.market_cap ?? ticker.cap,
              updatedAt: ticker.updatedAt ?? Date.now(),
            }),
          ])
        );
        const prioritized = [...symbols].sort((a, b) => {
          const aIsUsdt = a.quote.toUpperCase() === "USDT" ? 1 : 0;
          const bIsUsdt = b.quote.toUpperCase() === "USDT" ? 1 : 0;
          if (aIsUsdt !== bIsUsdt) return bIsUsdt - aIsUsdt;
          return a.symbol.localeCompare(b.symbol);
        });
        const summaries = await Promise.all(
          prioritized.map(async (symbol) => {
            try {
              const snapshot = await fetchExchangeSnapshot(symbol.symbol);
              return {
                ...symbol,
                ticker: tickerMap.get(symbol.symbol) ?? snapshot.ticker,
                history: snapshot.history,
              } as MarketSummary;
            } catch {
              return { ...symbol, ticker: tickerMap.get(symbol.symbol) } as MarketSummary;
            }
          })
        );
        if (cancelled) return;
        setMarkets(summaries);
        setError(undefined);
      } catch (err) {
        if (cancelled) return;
        setError(parseError(err));
        setMarkets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshIndex, range]);

  const orderedMarkets = useMemo(() => markets, [markets]);

  useEffect(() => {
    if (!markets.length) return;

    const sockets: WebSocket[] = [];
    const reconnectTimers: number[] = [];
    let activeSockets = 0;
    let hasErrored = false;
    let disposed = false;

    const setStatusFromCounts = () => {
      if (hasErrored && activeSockets === 0) {
        setWsStatus("error");
        return;
      }
      if (activeSockets > 0) {
        setWsStatus("open");
        return;
      }
      setWsStatus("connecting");
    };

    const connectSymbol = (symbol: string) => {
      const url = buildWsUrl(symbol);
      if (!url) return;

      const socket = new WebSocket(url);
      sockets.push(socket);

      socket.onopen = () => {
        if (disposed) return;
        activeSockets += 1;
        setStatusFromCounts();
        const token = getStoredAccessToken();
        socket.send(JSON.stringify({ action: "subscribe", symbol, token }));
      };

      socket.onerror = () => {
        if (disposed) return;
        hasErrored = true;
        setWsStatus("error");
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as Record<string, unknown>;
          const eventTypeRaw = message.event ?? message.type;
          const eventType = typeof eventTypeRaw === "string" ? eventTypeRaw : "";
          const data = "data" in message ? (message as { data?: unknown }).data : undefined;

          if (eventType === "exchange:snapshot" || eventType === "snapshot") {
            const payload = ensureRecord(data ?? message);
            const nextTicker = mapTicker(payload.ticker ?? payload);
            setMarkets((prev) =>
              prev.map((market) =>
                market.symbol === symbol
                  ? {
                      ...market,
                      ticker: mergeTicker(market.ticker, nextTicker),
                    }
                  : market
              )
            );
            return;
          }

          if (eventType === "exchange:ticker" || eventType === "ticker") {
            const nextTicker = mapTicker(data ?? message);
            setMarkets((prev) =>
              prev.map((market) =>
                market.symbol === symbol
                  ? {
                      ...market,
                      ticker: mergeTicker(market.ticker, nextTicker),
                    }
                  : market
              )
            );
            return;
          }

          if (eventType === "exchange:trade" || eventType === "trade") {
            const trade = mapTrade(data ?? message);
            setMarkets((prev) =>
              prev.map((market) => {
                if (market.symbol !== symbol) return market;
                const base = market.ticker ?? {
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
                const low = base.low === undefined || base.low === 0 ? last : Math.min(base.low, last);
                return {
                  ...market,
                  ticker: {
                    ...base,
                    last,
                    high,
                    low,
                    updatedAt: new Date(trade.ts).toISOString(),
                  },
                };
              })
            );
          }
        } catch {
          // ignore malformed payloads
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        activeSockets = Math.max(activeSockets - 1, 0);
        setStatusFromCounts();
        const timer = window.setTimeout(() => {
          if (!disposed) connectSymbol(symbol);
        }, 3000);
        reconnectTimers.push(timer);
      };
    };

    setWsStatus("connecting");
    markets.forEach((market) => connectSymbol(market.symbol));

    return () => {
      disposed = true;
      reconnectTimers.forEach((timer) => window.clearTimeout(timer));
      sockets.forEach((socket) => {
        if (socket.readyState <= WebSocket.OPEN) {
          socket.close();
        }
      });
      setWsStatus("idle");
    };
  }, [markets.length, refreshIndex]);

  return { loading, error, markets: orderedMarkets, refresh, wsStatus };
};
