import api from "../../../app/axios";
import { DASHBOARD_ENDPOINTS } from "../../../app/apiRoutes";

export type DashboardSummary = {
  mainWalletBalance?: number;
  totalEquity: number;
  balances: Array<{
    asset: string;
    available: number;
    locked?: number;
  }>;
  openPositions: number;
  workingOrders: number;
  topMover?: {
    symbol: string;
    last: number;
    changePct: number;
  };
  baseSymbol?: string;
  telegramAccess?: {
    isEligible: boolean;
    matchedPackageTier: {
      id: number | string;
      packageName: string;
      minAmount: number;
      maxAmount: string | null;
      signalsPerDay: number;
    } | null;
    telegramChannelUrl: string | null;
  };
};

export type DashboardPosition = {
  symbol: string;
  quantity: number;
  avgPrice: number;
  markPrice: number;
  unrealizedPnl?: number;
};

export type DashboardOrder = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  quantity: number;
  status: string;
  createdAt: string;
  signalToken?: string;
  buyPrice?: number;
  sellPrice?: number;
  buyCreatedAt?: string;
  sellCreatedAt?: string | null;
  investmentAmount?: number;
  profitAmount?: number;
  returnAmount?: number;
  walletBalance?: number;
  timeSlot?: string;
  source?: "exchange" | "signal";
};

export type DashboardTicker = {
  symbol: string;
  last: number;
  changePct: number;
  volume?: number;
  volumeUsd?: number;
};

export type DashboardHistoryPoint = {
  timestamp: number | string;
  price: number;
};

export type DashboardPromo = {
  id: string;
  title: string;
  subtitle: string;
  cta: string;
  to?: string;
  accent?: string;
};

export type DashboardNewsArticle = {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  tag?: string;
};

type ApiEnvelope<T> = { data: T };

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const toNumber = (value: unknown, fallback = 0): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toTimestamp = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
};

const normaliseTickerEntry = (entry: unknown): DashboardTicker | null => {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const symbol = String(raw.symbol ?? raw.s ?? "");
  if (!symbol) return null;

  const last = toNumber(raw.last ?? raw.lastPrice ?? raw.price ?? raw.close ?? raw.c ?? raw.mid);
  const changePct = toNumber(raw.changePct ?? raw.priceChangePercent ?? raw.percent ?? raw.P);

  const baseVolume = raw.volume ?? raw.v ?? raw.baseVolume;
  const quoteVolume = raw.volumeUsd ?? raw.quoteVolume ?? raw.q ?? raw.volumeQuote;
  const primaryVolume = baseVolume ?? quoteVolume;

  const out: DashboardTicker = {
    symbol,
    last,
    changePct,
    volume: primaryVolume !== undefined ? toNumber(primaryVolume) : undefined,
    volumeUsd: quoteVolume !== undefined ? toNumber(quoteVolume) : undefined,
  };
  return out;
};


const normaliseTickerCollection = (payload: unknown): DashboardTicker[] => {
  const fromObj = (obj: Record<string, unknown>, key: "tickers" | "movers"): unknown[] =>
    Array.isArray(obj[key]) ? (obj[key] as unknown[]) : [];

  let arr: unknown[] = [];

  if (Array.isArray(payload)) {
    arr = payload as unknown[];
  } else if (payload && typeof payload === "object") {
    const o = payload as Record<string, unknown>;
    arr = fromObj(o, "tickers");
    if (arr.length === 0) arr = fromObj(o, "movers");
  }

  const mapped: (DashboardTicker | null)[] = arr.map((item) => normaliseTickerEntry(item));
  return mapped.filter((t): t is DashboardTicker => t !== null);
};

const normaliseHistoryCollection = (payload: unknown): DashboardHistoryPoint[] => {
  const collect = (): unknown[] => {
    if (Array.isArray(payload)) return payload as unknown[];
    if (typeof payload === "object" && payload !== null) {
      const data = payload as Record<string, unknown>;
      if (Array.isArray(data.candles)) return data.candles as unknown[];
      if (Array.isArray(data.history)) return data.history as unknown[];
      if (Array.isArray(data.series)) return data.series as unknown[];
      if (Array.isArray(data.points)) return data.points as unknown[];
    }
    return [];
  };

  const items = collect();

  const mapped: (DashboardHistoryPoint | null)[] = items.map((point) => {
    if (!point || typeof point !== "object") return null;
    const raw = point as Record<string, unknown>;

    const timestamp = toTimestamp(
      raw.timestamp ??
        raw.openTime ??
        raw.time ??
        raw.t ??
        (Array.isArray(point) ? (point as unknown[])[0] : undefined)
    );

    const price = toNumber(
      raw.price ??
        raw.close ??
        raw.last ??
        raw.mid ??
        raw.c ??
        (Array.isArray(point) ? (point as unknown[])[1] : undefined)
    );

    if (!Number.isFinite(price)) return null;
    return { timestamp, price }; // satisfies DashboardHistoryPoint (timestamp: number | string)
  });

  const cleaned = mapped.filter((item): item is DashboardHistoryPoint => item !== null);
  return cleaned.sort((a, b) => toNumber(a.timestamp) - toNumber(b.timestamp));
};
export const fetchDashboardSummary = async (): Promise<DashboardSummary> => {
  const response = await api.get(DASHBOARD_ENDPOINTS.summary);
  return unwrap<DashboardSummary>(response.data);
};

export const fetchDashboardPositions = async (): Promise<DashboardPosition[]> => {
  const response = await api.get(DASHBOARD_ENDPOINTS.positions);
  return unwrap<DashboardPosition[]>(response.data);
};

export const fetchDashboardOrders = async (limit = 6): Promise<DashboardOrder[]> => {
  const response = await api.get(DASHBOARD_ENDPOINTS.orders, { params: { limit } });
  return unwrap<DashboardOrder[]>(response.data);
};

export const fetchDashboardTickers = async (): Promise<DashboardTicker[]> => {
  const response = await api.get(DASHBOARD_ENDPOINTS.tickers);
  return normaliseTickerCollection(unwrap<unknown>(response.data));
};

export const fetchDashboardTopMovers = async (): Promise<DashboardTicker[]> => {
  const response = await api.get(DASHBOARD_ENDPOINTS.topMovers);
  return normaliseTickerCollection(unwrap<unknown>(response.data));
};

export const fetchDashboardHistory = async (
  symbol: string,
  params: Record<string, string | number | boolean> = { interval: "1m", limit: 60 }
): Promise<DashboardHistoryPoint[]> => {
  try {
    const response = await api.get(DASHBOARD_ENDPOINTS.marketPulse, {
      params: { symbol, ...params },
    });
    return normaliseHistoryCollection(unwrap<unknown>(response.data));
  } catch (error) {
    const status = typeof (error as { response?: { status?: number } })?.response?.status === "number"
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;
    if (status && status >= 400 && status < 500) {
      const fallback = await api.get(DASHBOARD_ENDPOINTS.legacyHistory(symbol), { params });
      return normaliseHistoryCollection(unwrap<unknown>(fallback.data));
    }
    throw error;
  }
};

export const fetchDashboardPromotions = async (): Promise<DashboardPromo[]> => {
  const response = await api.get(DASHBOARD_ENDPOINTS.promos);
  return unwrap<DashboardPromo[]>(response.data);
};

export const fetchDashboardNews = async (): Promise<DashboardNewsArticle[]> => {
  const response = await api.get(DASHBOARD_ENDPOINTS.news);
  return unwrap<DashboardNewsArticle[]>(response.data);
};
