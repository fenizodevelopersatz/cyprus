import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FuturesAccount,
  FuturesContract,
  FuturesPosition,
  FuturesTrade,
  FuturesTick,
  FundingDTO,
  MarkPriceDTO,
  FuturesSide,
} from "../api/futures.api";
import {
  getAccount,
  getContracts,
  getFunding,
  getHistory,
  getMark,
  getPositions,
  getTrades,
  openPosition as apiOpenPosition,
  updateTriggers as apiUpdateTriggers,
  closePosition as apiClosePosition,
} from "../api/futures.api";

const MARK_REFRESH_INTERVAL_MS = 8_000;
const SNAPSHOT_CACHE_TTL_MS = 15_000;

type SymbolMeta = {
  lastSnapshot?: number;
  lastRealtime?: number;
};

type SymbolState = {
  mark?: MarkPriceDTO;
  funding?: FundingDTO;
  history: FuturesTick[];
  lastUpdatedAt: number;
};

export function useFuturesData() {
  const [contracts, setContracts] = useState<FuturesContract[]>([]);
  const [account, setAccount]     = useState<FuturesAccount>({
    equity: 0, balance: 0, availableMargin: 0, marginUsed: 0, unrealizedPnl: 0, realizedPnl: 0,
  });
  const [positions, setPositions] = useState<Record<string, FuturesPosition | undefined>>({});
  const [trades, setTrades]       = useState<FuturesTrade[]>([]);
  const [tradesNextCursor, setTradesNextCursor] = useState<number | null>(null);
  const [tradesLoadingMore, setTradesLoadingMore] = useState(false);
  const [bySymbol, setBySymbol]   = useState<Record<string, SymbolState>>({});
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const symbolMetaRef = useRef<Record<string, SymbolMeta>>({});
  const snapshotLocksRef = useRef<Record<string, Promise<void> | null>>({});
  const realtimeLocksRef = useRef<Record<string, Promise<void> | null>>({});

  const fetchTradesPage = useCallback(async (params?: { limit?: number; cursor?: string | number }) => {
    const res = await getTrades(params);
    return {
      items: Array.isArray(res.items) ? res.items : [],
      nextCursor: res.nextCursor ?? null,
    };
  }, []);

  const refreshTrades = useCallback(async () => {
    const { items, nextCursor } = await fetchTradesPage({ limit: 20 });
    setTrades(items);
    setTradesNextCursor(nextCursor);
  }, [fetchTradesPage]);

  const loadMoreTrades = useCallback(async () => {
    if (!tradesNextCursor) return;
    setTradesLoadingMore(true);
    try {
      const { items, nextCursor } = await fetchTradesPage({ limit: 20, cursor: tradesNextCursor });
      setTrades((prev) => [...prev, ...items]);
      setTradesNextCursor(nextCursor);
    } finally {
      setTradesLoadingMore(false);
    }
  }, [fetchTradesPage, tradesNextCursor]);

  const updateSymbolMeta = useCallback((symbol: string, patch: Partial<SymbolMeta>) => {
    symbolMetaRef.current[symbol] = {
      ...(symbolMetaRef.current[symbol] ?? {}),
      ...patch,
    };
  }, []);

  // load static-ish
  const bootstrap = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [c, a, p, tradesPage] = await Promise.all([
        getContracts(),
        getAccount(),
        getPositions(),
        fetchTradesPage({ limit: 20 }),
      ]);
      console.log("c",c);
      setContracts(c);
      setAccount(a);
      setPositions(Object.fromEntries(p.map((pos) => [pos.symbol, pos])));
      setTrades(tradesPage.items);
      setTradesNextCursor(tradesPage.nextCursor);
      // Preload symbol states for first contract
      const initial = c[0]?.symbol;
      if (initial) await hydrateSymbol(initial, { force: true });
    } catch (e: any) {
      setError(e?.message || "Failed to load futures data");
    } finally {
      setLoading(false);
    }
  }, []);

  const runSnapshotFetch = useCallback(async (symbol: string) => {
    try {
      const [mRaw, fRaw, hRaw] = await Promise.all([getMark(symbol), getFunding(symbol), getHistory(symbol, 200)]);

      const hist = Array.isArray(hRaw) ? hRaw : [];
      const priceFromMark = Number((mRaw as any)?.price ?? (mRaw as any)?.markPrice ?? (mRaw as any)?.p);
      const tsFromMark = Number(
        (mRaw as any)?.ts ??
          (mRaw as any)?.t ??
          ((mRaw as any)?.timestamp ? Date.parse((mRaw as any).timestamp) : Date.now()),
      );

      const fundingRate = Number((fRaw as any)?.rate ?? (fRaw as any)?.fundingRate ?? 0);
      const fundingTs = Number((fRaw as any)?.ts ?? (fRaw as any)?.t ?? Date.now());

      const last = hist.length ? hist[hist.length - 1] : undefined;
      const markObj = Number.isFinite(priceFromMark)
        ? { symbol, price: priceFromMark, ts: tsFromMark }
        : last
          ? { symbol, price: last.price, ts: last.ts }
          : undefined;

      setBySymbol((prev) => {
        const cur = prev[symbol] ?? { history: [], lastUpdatedAt: 0 };
        return {
          ...prev,
          [symbol]: {
            ...cur,
            mark: markObj,
            funding: { symbol, rate: Number.isFinite(fundingRate) ? fundingRate : 0, ts: fundingTs },
            history: hist,
            lastUpdatedAt: Date.now(),
          },
        };
      });
      updateSymbolMeta(symbol, { lastSnapshot: Date.now(), lastRealtime: Date.now() });
    } catch {}
  }, [updateSymbolMeta]);

  // per-symbol hydrate with caching
  const hydrateSymbol = useCallback(
    async (symbol: string, opts?: { force?: boolean }) => {
      if (!symbol) return;
      const meta = symbolMetaRef.current[symbol];
      const age = meta?.lastSnapshot ? Date.now() - meta.lastSnapshot : Number.POSITIVE_INFINITY;
      if (!opts?.force && age < SNAPSHOT_CACHE_TTL_MS) {
        return;
      }
      if (!snapshotLocksRef.current[symbol]) {
        snapshotLocksRef.current[symbol] = runSnapshotFetch(symbol).finally(() => {
          snapshotLocksRef.current[symbol] = null;
        });
      }
      return snapshotLocksRef.current[symbol];
    },
    [runSnapshotFetch],
  );

  // polling (account/positions/trades every 5–10s, marks every 2s)
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const runRealtimeFetch = useCallback(async (symbol: string) => {
    try {
      const [m, f] = await Promise.all([getMark(symbol), getFunding(symbol)]);
      setBySymbol((prev) => {
        const cur = prev[symbol] ?? { history: [], lastUpdatedAt: 0 };
        return {
          ...prev,
          [symbol]: {
            ...cur,
            mark: m,
            funding: f,
            lastUpdatedAt: Date.now(),
          },
        };
      });
      updateSymbolMeta(symbol, { lastRealtime: Date.now() });
    } catch {}
  }, [updateSymbolMeta]);

  const fetchMarkFundingThrottled = useCallback(
    async (symbol: string, opts?: { force?: boolean }) => {
      if (!symbol) return;
      const meta = symbolMetaRef.current[symbol];
      const age = meta?.lastRealtime ? Date.now() - meta.lastRealtime : Number.POSITIVE_INFINITY;
      if (!opts?.force && age < MARK_REFRESH_INTERVAL_MS) {
        return;
      }
      if (!realtimeLocksRef.current[symbol]) {
        realtimeLocksRef.current[symbol] = runRealtimeFetch(symbol).finally(() => {
          realtimeLocksRef.current[symbol] = null;
        });
      }
      return realtimeLocksRef.current[symbol];
    },
    [runRealtimeFetch],
  );

  // soft polling for account/positions/trades
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const [a, p, tradesPage] = await Promise.all([getAccount(), getPositions(), fetchTradesPage({ limit: 20 })]);
        setAccount(a);
        setPositions(Object.fromEntries(p.map((pos) => [pos.symbol, pos])));
        setTrades(tradesPage.items);
        setTradesNextCursor(tradesPage.nextCursor);
      } catch {}
    }, 10_000);
    return () => clearInterval(id);
  }, [fetchTradesPage]);

  // mark/funding refresher for selected symbol (caller provides symbol)
  const startSymbolPolling = useCallback(
    (symbol: string) => {
      let stopped = false;
      let timer: ReturnType<typeof window.setTimeout> | undefined;

      const tick = async (force?: boolean) => {
        if (stopped) return;
        await fetchMarkFundingThrottled(symbol, { force });
        if (stopped) return;
        timer = window.setTimeout(() => tick(false), MARK_REFRESH_INTERVAL_MS);
      };

      tick(true);

      return () => {
        stopped = true;
        if (timer) window.clearTimeout(timer);
      };
    },
    [fetchMarkFundingThrottled],
  );

  // actions
  const openPosition = useCallback(async (payload: {
    symbol: string; side: FuturesSide; size: number; leverage: number; stopLoss?: number; takeProfit?: number;
  }) => {
    await apiOpenPosition(payload);
    const [a, p] = await Promise.all([getAccount(), getPositions()]);
    setAccount(a);
    setPositions(Object.fromEntries(p.map((pos) => [pos.symbol, pos])));
    await refreshTrades();
    await hydrateSymbol(payload.symbol, { force: true });
  }, [hydrateSymbol, refreshTrades]);

  const updateTriggers = useCallback(async (payload: {
    symbol: string; stopLoss?: number; takeProfit?: number;
  }) => {
    await apiUpdateTriggers(payload);
    const [p] = await Promise.all([getPositions()]);
    setPositions(Object.fromEntries(p.map((pos) => [pos.symbol, pos])));
    await refreshTrades();
    await hydrateSymbol(payload.symbol, { force: true });
  }, [hydrateSymbol, refreshTrades]);

  const closePosition = useCallback(async (symbol: string) => {
    await apiClosePosition({ symbol });
    const [a, p] = await Promise.all([getAccount(), getPositions()]);
    setAccount(a);
    setPositions(Object.fromEntries(p.map((pos) => [pos.symbol, pos])));
    await refreshTrades();
    await hydrateSymbol(symbol, { force: true });
  }, [hydrateSymbol, refreshTrades]);




  // --- WS state (inside useFuturesData) ---
const wsRef = useRef<WebSocket | null>(null);
const wsStopRef = useRef<(() => void) | null>(null);

// Push a tick into state and keep history bounded to 200
const applyMark = useCallback((sym: string, price: number, ts?: number) => {
  if (!Number.isFinite(price)) return;
  const nowTs = ts ?? Date.now();
  setBySymbol((prev) => {
    const cur = prev[sym] ?? { history: [], lastUpdatedAt: 0 };
    const nextHist = [...cur.history, { ts: nowTs, price }];
    if (nextHist.length > 200) nextHist.splice(0, nextHist.length - 200);
    return {
      ...prev,
      [sym]: {
        ...cur,
        mark: { symbol: sym, price, ts: nowTs },
        history: nextHist,
        lastUpdatedAt: Date.now(),
      },
    };
  });
  updateSymbolMeta(sym, { lastRealtime: Date.now() });
}, [updateSymbolMeta]);


  
const toContractKey = useCallback((raw: string) => {
  if (!raw) return raw;
  const upper = String(raw).replace(/[^A-Z0-9]/gi, "").toUpperCase(); // strip separators
  // If it ends with PERP but has no hyphen, convert -> "-PERP"
  const withHyphen = upper.endsWith("PERP") && !upper.endsWith("-PERP")
    ? upper.replace(/PERP$/, "-PERP")
    : upper;

  // Try to find an exact contract match by symbol or rawSymbol
  const hit = contracts.find(
    (c) => c.symbol.toUpperCase() === withHyphen || c.rawSymbol?.toUpperCase() === withHyphen
  );
  return (hit?.symbol ?? withHyphen);
}, [contracts]);

// Start live WS for a symbol
const startSymbolLive = useCallback((sym: string) => {
  if (wsStopRef.current) wsStopRef.current();

  const base = (import.meta as any).env?.VITE_API_WS_URL || window.location.origin.replace(/^http/, "ws");
  const url = `${base}/ws/futures?symbol=${encodeURIComponent(sym)}`;

  let closed = false;
  let retry = 0;
  let socket: WebSocket | null = null;

  const open = () => {
    socket = new WebSocket(url);
    wsRef.current = socket;

    socket.onopen = () => { retry = 0; };

    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const rawSym = msg.symbol ?? msg.s ?? sym;
        const key = toContractKey(rawSym);                        // <-- normalize
        const price = Number(msg.price ?? msg.markPrice ?? msg.p);
        const ts = Number(msg.ts ?? msg.t ?? (msg.timestamp ? Date.parse(msg.timestamp) : Date.now()));
        if (key && Number.isFinite(price)) applyMark(key, price, ts);
      } catch {}
    };

    socket.onclose = () => {
      if (closed) return;
      retry += 1;
      const delay = Math.min(15000, 500 * 2 ** retry);
      setTimeout(() => !closed && open(), delay);
    };
  };

  open();

  const stop = () => {
    closed = true;
    if (socket && socket.readyState <= 1) socket.close();
    if (wsRef.current && wsRef.current !== socket && wsRef.current.readyState <= 1) {
      wsRef.current.close();
    }
    wsRef.current = null;
  };



  wsStopRef.current = stop;
  return stop;
}, [applyMark, toContractKey]);


  
  return {
    loading, error,
    contracts, account, positions, trades,
    tradesNextCursor,
    tradesLoadingMore,
    loadMoreTrades,
    refreshTrades,
    bySymbol,
    hydrateSymbol,
    startSymbolPolling,
    startSymbolLive,
    openPosition, updateTriggers, closePosition,
  };
}


