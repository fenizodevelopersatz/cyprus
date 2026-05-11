import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, PORTFOLIO_WS_PATH } from "../../../app/apiRoutes";
import { getStoredAccessToken } from "../../auth/state/session.storage";
import {
  fetchPortfolioActivity,
  fetchPortfolioEquityHistory,
  fetchPortfolioSnapshot,
  mapPortfolioActivity,
  mapPortfolioAllocation,
  mapPortfolioBalance,
  mapPortfolioPosition,
  mapPortfolioSnapshot,
  mapPortfolioTimelinePoint,
} from "../api/portfolio.api";
import type {
  PortfolioActivity,
  PortfolioAllocation,
  PortfolioBalance,
  PortfolioPosition,
  PortfolioSnapshot,
  PortfolioSipLiability,
  PortfolioTimelinePoint,
} from "../api/portfolio.api";

type WsStatus = "idle" | "connecting" | "open" | "error";

type ChartPoint = {
  timestamp: number;
  time: string;
  value: number;
};


const MAX_TIMELINE_POINTS = 240;
const MAX_ACTIVITY_ITEMS = 24;

const parseError = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const err = error as {
      message?: string;
      response?: { data?: { message?: string }; status?: number };
    };
    return (
      err.response?.data?.message ??
      err.message ??
      (typeof err.response?.status === "number"
        ? `Portfolio service responded with ${err.response.status}.`
        : "Portfolio service unavailable.")
    );
  }
  return "Portfolio service unavailable.";
};

const ensureRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const buildWsUrl = (): string | null => {
  try {
    const base = new URL(API_BASE_URL);
    base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
    base.pathname = `${base.pathname.replace(/\/?$/, "")}${PORTFOLIO_WS_PATH}`;
    const token = getStoredAccessToken();
    if (token) base.searchParams.set("token", token);
    return base.toString();
  } catch {
    return null;
  }
};

const toChartPoint = (point: PortfolioTimelinePoint): ChartPoint => {
  const timestamp = point.timestamp;
  return {
    timestamp,
    time: new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    value: point.value,
  };
};

const seedChart = (points: PortfolioTimelinePoint[]): ChartPoint[] =>
  points
    .map(toChartPoint)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_TIMELINE_POINTS);

const upsertTimelinePoint = (points: ChartPoint[], next: PortfolioTimelinePoint): ChartPoint[] => {
  const chartPoint = toChartPoint(next);
  const existingIndex = points.findIndex((point) => point.timestamp === chartPoint.timestamp);
  if (existingIndex === -1) {
    const updated = [...points, chartPoint].sort((a, b) => a.timestamp - b.timestamp);
    return updated.slice(-MAX_TIMELINE_POINTS);
  }
  const updated = [...points];
  updated[existingIndex] = chartPoint;
  return updated;
};

const refreshTimelineValue = (points: ChartPoint[], value: number): ChartPoint[] => {
  if (!points.length) return points;
  const updated = [...points];
  const lastIndex = updated.length - 1;
  updated[lastIndex] = { ...updated[lastIndex], value };
  return updated;
};

const mergePosition = (positions: PortfolioPosition[], next: PortfolioPosition): PortfolioPosition[] => {
  const index = positions.findIndex((item) => item.symbol === next.symbol);
  if (next.qty === 0) {
    if (index === -1) return positions;
    const copy = [...positions];
    copy.splice(index, 1);
    return copy;
  }
  if (index === -1) return [...positions, next];
  const copy = [...positions];
  copy[index] = next;
  return copy;
};

const mergeBalance = (balances: PortfolioBalance[], next: PortfolioBalance): PortfolioBalance[] => {
  const index = balances.findIndex((item) => item.asset === next.asset);
  if (index === -1) return [...balances, next];
  const copy = [...balances];
  copy[index] = next;
  return copy;
};

const mergeActivity = (activity: PortfolioActivity[], next: PortfolioActivity): PortfolioActivity[] => {
  const existingIndex = activity.findIndex((item) => item.id === next.id);
  const updated = existingIndex === -1 ? [next, ...activity] : (() => {
    const copy = [...activity];
    copy[existingIndex] = { ...copy[existingIndex], ...next };
    return copy;
  })();
  updated.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return updated.slice(0, MAX_ACTIVITY_ITEMS);
};

const normaliseAllocation = (
  allocation: PortfolioAllocation[] | undefined,
  positions: PortfolioPosition[],
  balances: PortfolioBalance[],
  equity: number
): PortfolioAllocation[] => {
  const entries =
    allocation && allocation.length
      ? allocation.map((entry) => ({
          ...entry,
          symbol: entry.symbol.toUpperCase(),
          pct: entry.pct > 1 && entry.pct <= 100 ? entry.pct : entry.pct * 100,
        }))
      : (() => {
          const parts: PortfolioAllocation[] = [];
          const totals: Record<string, number> = {};

          positions.forEach((position) => {
            const value =
              position.usdValue !== undefined
                ? position.usdValue
                : position.markPrice * position.qty;
            if (!Number.isFinite(value) || value <= 0) return;
            totals[position.symbol.toUpperCase()] =
              (totals[position.symbol.toUpperCase()] ?? 0) + value;
          });

          balances.forEach((balance) => {
            const value =
              balance.usdValue !== undefined ? balance.usdValue : balance.total;
            if (!Number.isFinite(value) || value <= 0) return;
            totals[balance.asset.toUpperCase()] =
              (totals[balance.asset.toUpperCase()] ?? 0) + value;
          });

          const totalValue =
            equity && Number.isFinite(equity) && equity > 0
              ? equity
              : Object.values(totals).reduce((sum, value) => sum + value, 0);

          if (!Number.isFinite(totalValue) || totalValue <= 0) return parts;

          return Object.entries(totals)
            .map(([symbol, value]) => ({
              symbol,
              value,
              pct: (value / totalValue) * 100,
            }))
            .sort((a, b) => b.value - a.value);
        })();

  return entries.map((entry) => ({
    ...entry,
    pct: Number.isFinite(entry.pct) ? entry.pct : 0,
  }));
};

const prepareActivity = (items: PortfolioActivity[]): PortfolioActivity[] =>
  items
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_ACTIVITY_ITEMS);

export type PortfolioHookState = {
  loading: boolean;
  error?: string;
  equity: number;
  unrealizedPnl: number;
  positions: PortfolioPosition[];
  balances: PortfolioBalance[];
  sipLiabilities: PortfolioSipLiability[];
  allocation: PortfolioAllocation[];
  equityTimeline: ChartPoint[];
  activity: PortfolioActivity[];
  wsStatus: WsStatus;
  updatedAt?: string;
  refresh: () => void;
};

export function usePortfolioData(): PortfolioHookState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [equity, setEquity] = useState(0);
  const [unrealizedPnl, setUnrealizedPnl] = useState(0);
  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [balances, setBalances] = useState<PortfolioBalance[]>([]);
  const [sipLiabilities, setSipLiabilities] = useState<PortfolioSipLiability[]>([]);
  const [activity, setActivity] = useState<PortfolioActivity[]>([]);
  const [timeline, setTimeline] = useState<ChartPoint[]>([]);
  const [rawAllocation, setRawAllocation] = useState<PortfolioAllocation[]>();
  const [updatedAt, setUpdatedAt] = useState<string>();
  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
  const [refreshToken, setRefreshToken] = useState(0);
  const reconnectRef = useRef<number | undefined>(undefined);
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
  }, []);

  const allocation = useMemo(
    () => normaliseAllocation(rawAllocation, positions, balances, equity),
    [rawAllocation, positions, balances, equity]
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const snapshot = await fetchPortfolioSnapshot();
        if (cancelled) return;
        applySnapshot(snapshot);
        setError(undefined);

        const needsTimeline = snapshot.timeline.length === 0;
        const needsActivity = snapshot.activity.length === 0;

        const timelinePromise = needsTimeline
          ? fetchPortfolioEquityHistory()
          : Promise.resolve<PortfolioTimelinePoint[]>([]);
        const activityPromise = needsActivity
          ? fetchPortfolioActivity()
          : Promise.resolve<PortfolioActivity[]>([]);

        const [timelineFallback, activityFallback] = await Promise.allSettled([
          timelinePromise,
          activityPromise,
        ]);

        if (!cancelled && needsTimeline && timelineFallback.status === "fulfilled" && timelineFallback.value.length) {
          setTimeline(seedChart(timelineFallback.value));
        }
        if (!cancelled && needsActivity && activityFallback.status === "fulfilled" && activityFallback.value.length) {
          setActivity(prepareActivity(activityFallback.value));
        }
      } catch (err) {
        if (!cancelled) {
          setError(parseError(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const applySnapshot = (snapshot: PortfolioSnapshot) => {
      setEquity(snapshot.equity);
      setUnrealizedPnl(snapshot.unrealizedPnl);
      setPositions(snapshot.positions);
      setBalances(snapshot.balances);
      setSipLiabilities(snapshot.sipLiabilities ?? []);
      setActivity(prepareActivity(snapshot.activity));
      setTimeline(seedChart(snapshot.timeline));
      setRawAllocation(snapshot.allocation);
      setUpdatedAt(snapshot.updatedAt);
    };

    load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  useEffect(() => {
    const url = buildWsUrl();
    if (!url) return undefined;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setWsStatus("connecting");

    const socket = new WebSocket(url);
    wsRef.current = socket;
    let closedByUser = false;

    const clearReconnect = () => {
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = undefined;
      }
    };

    socket.onopen = () => {
      setWsStatus("open");
      clearReconnect();
    };

    socket.onerror = () => {
      setWsStatus("error");
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const record = ensureRecord(payload);
        const typeRaw = record.type ?? record.event ?? record.channel ?? record.action ?? "";
        const type = String(typeRaw ?? "").toLowerCase();
        const data =
          record.data ?? record.payload ?? record.value ?? record.snapshot ?? payload;

        switch (type) {
          case "portfolio:snapshot":
          case "snapshot":
            handleSnapshot(data);
            break;
          case "portfolio:equity":
          case "equity":
            handleEquity(data);
            break;
          case "portfolio:position":
          case "position":
            handlePosition(data);
            break;
          case "portfolio:balance":
          case "balance":
            handleBalance(data);
            break;
          case "portfolio:activity":
          case "activity":
          case "order":
            handleActivity(data);
            break;
          case "portfolio:timeline":
          case "portfolio:equity-point":
          case "timeline":
          case "equity_point":
            handleTimeline(data);
            break;
          case "portfolio:allocation":
          case "allocation":
            handleAllocation(data);
            break;
          default:
            break;
        }
      } catch {
        // ignore malformed payloads
      }
    };

    socket.onclose = () => {
      wsRef.current = null;
      setWsStatus("idle");
      if (closedByUser) return;
      clearReconnect();
      reconnectRef.current = window.setTimeout(() => {
        refresh();
      }, 3_000);
    };

    const handleSnapshot = (payload: unknown) => {
      const snapshot = mapPortfolioSnapshot(payload);
      setEquity(snapshot.equity);
      setUnrealizedPnl(snapshot.unrealizedPnl);
      setPositions(snapshot.positions);
      setBalances(snapshot.balances);
      setSipLiabilities(snapshot.sipLiabilities ?? []);
      setActivity(prepareActivity(snapshot.activity));
      setTimeline(seedChart(snapshot.timeline));
      setRawAllocation(snapshot.allocation);
      setUpdatedAt(snapshot.updatedAt);
    };

    const handleEquity = (payload: unknown) => {
      const record = ensureRecord(payload);
      if (record.equity !== undefined) setEquity(Number(record.equity));
      if (record.unrealizedPnl !== undefined || record.unrealisedPnl !== undefined || record.pnl !== undefined) {
        setUnrealizedPnl(
          Number(
            record.unrealizedPnl ?? record.unrealisedPnl ?? record.pnl ?? record.value ?? 0
          )
        );
      }
      if (record.timestamp !== undefined || record.time !== undefined) {
        const point = mapPortfolioTimelinePoint(payload);
        if (point) setTimeline((prev) => upsertTimelinePoint(prev, point));
      } else if (record.value !== undefined) {
        setTimeline((prev) => refreshTimelineValue(prev, Number(record.value)));
      }
    };

    const handlePosition = (payload: unknown) => {
      const position = mapPortfolioPosition(payload);
      if (!position) return;
      setPositions((prev) => mergePosition(prev, position));
    };

    const handleBalance = (payload: unknown) => {
      const balance = mapPortfolioBalance(payload);
      if (!balance) return;
      setBalances((prev) => mergeBalance(prev, balance));
    };

    const handleActivity = (payload: unknown) => {
      const activityEntry = mapPortfolioActivity(payload);
      if (!activityEntry) return;
      setActivity((prev) => mergeActivity(prev, activityEntry));
    };

    const handleTimeline = (payload: unknown) => {
      const point = mapPortfolioTimelinePoint(payload);
      if (!point) return;
      setTimeline((prev) => upsertTimelinePoint(prev, point));
    };

    const handleAllocation = (payload: unknown) => {
      const allocation = Array.isArray(payload)
        ? payload
        : ensureRecord(payload).allocation ??
          ensureRecord(payload).allocations ??
          ensureRecord(payload).weights;
      if (!allocation) return;
      const mapped = Array.isArray(allocation)
        ? allocation
        : [];
      const entries = mapped
        .map((item) => mapPortfolioAllocation(item))
        .filter((item): item is PortfolioAllocation => Boolean(item));
      if (entries.length) setRawAllocation(entries);
    };

    return () => {
      closedByUser = true;
      clearReconnect();
      socket.close();
    };
  }, [refresh, refreshToken]);

  useEffect(
    () => () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
        reconnectRef.current = undefined;
      }
    },
    []
  );

  return {
    loading,
    error,
    equity,
    unrealizedPnl,
    positions,
    balances,
    sipLiabilities,
    allocation,
    equityTimeline: timeline,
    activity,
    wsStatus,
    updatedAt,
    refresh,
  };
}
