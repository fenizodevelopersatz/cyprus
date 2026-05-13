import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePaperEngine } from "../../../hooks/usePaperEngine";
import type { PricePoint } from "../../../utils/paperEngine";
import { fetchSignalHistory } from "../../exchange/api/signal.api";
import {
  fetchDashboardHistory,
  fetchDashboardNews,
  fetchDashboardOrders,
  fetchDashboardPositions,
  fetchDashboardPromotions,
  fetchDashboardSummary,
  fetchDashboardTickers,
  fetchDashboardTopMovers,
  type DashboardHistoryPoint,
  type DashboardNewsArticle,
  type DashboardOrder,
  type DashboardPosition,
  type DashboardPromo,
  type DashboardSummary,
  type DashboardTicker,
} from "../api/dashboard.api";
import { DEFAULT_NEWS, DEFAULT_PROMOTIONS } from "../constants";


const MOCK = import.meta.env.VITE_MOCK_MODE === "1";
const DEFAULT_SYMBOL = "BTCUSDT";
const REFRESH_INTERVAL_MS = 15000;

type DashboardHistory = {
  timestamp: number;
  price: number;
};

export type DashboardHookResult = {
  isMock: boolean;
  loading: boolean;
  error?: string;
  summary?: DashboardSummary;
  positions: DashboardPosition[];
  orders: DashboardOrder[];
  tickers: DashboardTicker[];
  movers: DashboardTicker[];
  promos: DashboardPromo[];
  news: DashboardNewsArticle[];
  history: DashboardHistory[];
  baseSymbol: string;
  missingResources: string[];
  refetch: () => void;
};

const normaliseHistory = (history: DashboardHistoryPoint[]): DashboardHistory[] =>
  history.map((point) => ({
    timestamp:
      typeof point.timestamp === "number"
        ? point.timestamp
        : new Date(point.timestamp).getTime(),
    price: point.price,
  }));

const parseError = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const errObj = error as {
      message?: string;
      response?: { data?: { message?: string } };
    };
    return errObj.response?.data?.message ?? errObj.message ?? "Failed to load dashboard data.";
  }
  return "Failed to load dashboard data.";
};

const isNotFoundError = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      "response" in error &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((error as any).response?.status === 404 || (error as any).response?.statusCode === 404)
  );

const resolveSignalOrderStatus = (order: Awaited<ReturnType<typeof fetchSignalHistory>>[number]): string => {
  const status = String(order.tradeStatus ?? "").trim().toUpperCase();
  if (status === "CLOSED") {
    return "CLOSED";
  }

  if (order.sellCreatedAt) {
    return "CLOSED";
  }

  return "OPEN";
};

const mapSignalHistoryToDashboardOrders = (
  rows: Awaited<ReturnType<typeof fetchSignalHistory>>
): DashboardOrder[] =>
  rows
    .map((row) => {
      const resolvedStatus = resolveSignalOrderStatus(row);
      const derivedQuantity =
        row.executedQty && row.executedQty > 0
          ? row.executedQty
          : row.buyPrice && row.buyPrice > 0
            ? row.investmentAmount / row.buyPrice
            : 0;

      return {
        id: `signal-${row.id}`,
        symbol: row.symbol ?? DEFAULT_SYMBOL,
        side: "BUY",
        type: "SIGNAL",
        quantity: derivedQuantity,
        status: resolvedStatus,
        createdAt: row.buyCreatedAt ?? row.appliedAt,
        signalToken: row.signalToken,
        buyPrice: row.buyPrice,
        sellPrice: row.sellPrice,
        buyCreatedAt: row.buyCreatedAt ?? row.appliedAt,
        sellCreatedAt: row.sellCreatedAt,
        investmentAmount: row.investmentAmount,
        profitAmount: resolvedStatus === "CLOSED" ? row.profitAmount : undefined,
        returnAmount: resolvedStatus === "CLOSED" ? row.totalReturnUsdt : undefined,
        walletBalance:
          resolvedStatus === "CLOSED"
            ? row.walletBalanceAfterSell ?? row.newBalance
            : row.walletBalanceAfterBuy,
        timeSlot: row.slotLabel || row.slotKey,
        source: "signal",
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

const buildMockState = (
  engine: ReturnType<typeof usePaperEngine>
): Omit<DashboardHookResult, "isMock" | "loading" | "refetch" | "error"> & { loading: boolean } => {
  const baseSymbol = engine.syms[0]?.symbol ?? DEFAULT_SYMBOL;
  const historyPoints = engine.getHistory(baseSymbol, 60).map((point: PricePoint) => ({
    timestamp: point.time,
    price: point.price,
  }));
  const tickers = engine.syms.map((info) => {
    const ticker = engine.getTicker(info.symbol);
    return {
      symbol: info.symbol,
      last: ticker.last,
      changePct: ticker.changePct,
      volume: ticker.volume,
    };
  });
  const movers = tickers.slice(0, 3);
  const positions = Object.values(engine.positions)
    .filter((position) => position.qty !== 0)
    .map((position) => {
      const ticker = engine.getTicker(position.symbol);
      return {
        symbol: position.symbol,
        quantity: position.qty,
        avgPrice: position.avgPrice,
        markPrice: ticker.last,
        unrealizedPnl: (ticker.last - position.avgPrice) * position.qty,
      };
    });
  const orders = engine.orders.map((order) => ({
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    quantity: order.qty,
    status: order.status,
    createdAt: new Date(order.createdAt).toISOString(),
  }));
  const summary: DashboardSummary = {
    mainWalletBalance: engine.equity,
    totalEquity: engine.equity,
    balances: Object.entries(engine.balances).map(([asset, available]) => ({
      asset,
      available,
    })),
    openPositions: positions.length,
    workingOrders: orders.filter((order) => order.status === "NEW").length,
    baseSymbol,
  };
  const promos = DEFAULT_PROMOTIONS.map((promo) => ({ ...promo }));
  const news: DashboardNewsArticle[] = DEFAULT_NEWS.map((article) => ({ ...article }));

  return {
    summary,
    positions,
    orders,
    tickers,
    movers,
    promos,
    news,
    history: historyPoints,
    baseSymbol,
    missingResources: [],
    loading: false,
  };
};

export const useDashboardData = (): DashboardHookResult => {
  const engine = MOCK ? usePaperEngine() : undefined;
  const [state, setState] = useState<DashboardHookResult>({
    isMock: MOCK,
    loading: !MOCK,
    summary: undefined,
    positions: [],
    orders: [],
    tickers: [],
    movers: [],
    promos: [],
    news: [],
    history: [],
    baseSymbol: DEFAULT_SYMBOL,
    error: undefined,
    missingResources: [],
    refetch: () => undefined,
  });
  const [refreshIndex, setRefreshIndex] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (MOCK) return;

    const requestId = ++requestIdRef.current;
    let cancelled = false;

    setState((prev) => ({
      ...prev,
      loading: true,
      error: undefined,
    }));

    (async () => {
      try {
        const missingResources: string[] = [];

        let summary: DashboardSummary | undefined;
        try {
          summary = await fetchDashboardSummary();
        } catch (err) {
          if (isNotFoundError(err)) {
            missingResources.push("summary");
            summary = {
              mainWalletBalance: 0,
              totalEquity: 0,
              balances: [],
              openPositions: 0,
              workingOrders: 0,
              baseSymbol: DEFAULT_SYMBOL,
            };
          } else {
            throw err;
          }
        }

        const [positionsResult, ordersResult, signalHistoryResult, tickersResult, topMoversResult, promosResult, newsResult] = await Promise.allSettled([
          fetchDashboardPositions(),
          fetchDashboardOrders(6),
          fetchSignalHistory(),
          fetchDashboardTickers(),
          fetchDashboardTopMovers(),
          fetchDashboardPromotions(),
          fetchDashboardNews(),
        ]);

        const extract = <T,>(
          result: PromiseSettledResult<T>,
          resourceName: string,
          fallback: T
        ): { value: T; missing?: string } => {
          if (result.status === "fulfilled") {
            return { value: result.value };
          }
          if (isNotFoundError(result.reason)) {
            return { value: fallback, missing: resourceName };
          }
          throw result.reason;
        };

        const positionsExtract = extract(positionsResult, "positions", [] as DashboardPosition[]);
        const ordersExtract = extract(ordersResult, "orders", [] as DashboardOrder[]);
        const signalHistoryExtract = extract(signalHistoryResult, "signalHistory", [] as Awaited<ReturnType<typeof fetchSignalHistory>>);
        const tickersExtract = extract(tickersResult, "tickers", [] as DashboardTicker[]);
        const topMoversExtract = extract(topMoversResult, "topMovers", [] as DashboardTicker[]);
        const promosExtract = extract(promosResult, "promotions", [] as DashboardPromo[]);
        const newsExtract = extract(newsResult, "news", [] as DashboardNewsArticle[]);

        [positionsExtract, ordersExtract, signalHistoryExtract, tickersExtract, topMoversExtract, promosExtract, newsExtract].forEach((item) => {
          if (item.missing) missingResources.push(item.missing);
        });

        const positions = positionsExtract.value;
        const signalOrders = mapSignalHistoryToDashboardOrders(signalHistoryExtract.value);
        const orders = signalOrders.length > 0 ? signalOrders : ordersExtract.value;
        const resolvedTopMovers = topMoversExtract.value;
        const tickersSource = tickersExtract.value.length > 0 ? tickersExtract.value : resolvedTopMovers;
        const tickers = tickersSource;
        const movers = resolvedTopMovers.length > 0 ? resolvedTopMovers : tickersSource.slice(0, 3);
        const promos = promosExtract.value;
        const news = newsExtract.value;

        const topMoverFallback =
          summary?.topMover ?? movers[0] ?? tickers[0] ?? undefined;

        if (summary && !summary.topMover && topMoverFallback) {
          summary = {
            ...summary,
            topMover: {
              symbol: topMoverFallback.symbol,
              last: topMoverFallback.last,
              changePct: topMoverFallback.changePct,
            },
          };
        }

        const preferredTicker = tickers.find((ticker) => ticker.symbol === DEFAULT_SYMBOL);
        const baseSymbol =
          preferredTicker?.symbol ??
          summary?.baseSymbol ??
          tickers[0]?.symbol ??
          summary?.topMover?.symbol ??
          DEFAULT_SYMBOL;

        let history: DashboardHistoryPoint[] = [];
        try {
          history = await fetchDashboardHistory(baseSymbol, { interval: "1m", limit: 60 });
        } catch (err) {
          if (isNotFoundError(err)) {
            missingResources.push("history");
            history = [];
          } else {
            throw err;
          }
        }

        if (cancelled || requestId !== requestIdRef.current) return;

        setState((prev) => ({
          ...prev,
          isMock: false,
          loading: false,
          summary,
          positions,
          orders,
          tickers,
          movers,
          promos,
          news,
          history: normaliseHistory(history),
          baseSymbol,
          error: undefined,
          missingResources,
        }));
      } catch (error) {
        if (cancelled || requestId !== requestIdRef.current) return;
        setState((prev) => ({
          ...prev,
          loading: false,
          error: parseError(error),
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshIndex]);

  useEffect(() => {
    if (MOCK) return;
    const timer = window.setInterval(() => {
      setRefreshIndex((index) => index + 1);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [MOCK]);

  const refetch = useCallback(() => {
    if (MOCK) return;
    setRefreshIndex((index) => index + 1);
  }, []);

  const mockSnapshot = useMemo(() => {
    if (!MOCK || !engine) return null;
    return buildMockState(engine);
  }, [engine]);

  if (MOCK && mockSnapshot) {
    return {
      isMock: true,
      loading: mockSnapshot.loading,
      summary: mockSnapshot.summary,
      positions: mockSnapshot.positions,
      orders: mockSnapshot.orders,
      tickers: mockSnapshot.tickers,
      movers: mockSnapshot.movers,
      promos: mockSnapshot.promos,
      news: mockSnapshot.news,
      history: mockSnapshot.history,
      baseSymbol: mockSnapshot.baseSymbol,
      missingResources: [],
      refetch: () => undefined,
      error: undefined,
    };
  }

  return {
    ...state,
    refetch,
  };
};
