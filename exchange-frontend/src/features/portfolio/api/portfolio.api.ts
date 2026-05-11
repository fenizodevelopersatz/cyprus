import api from "../../../app/axios";
import { PORTFOLIO_ENDPOINTS } from "../../../app/apiRoutes";

export type PortfolioBalance = {
  asset: string;
  total: number;
  available?: number;
  locked?: number;
  usdValue?: number;
};

export type PortfolioPosition = {
  symbol: string;
  qty: number;
  avgPrice: number;
  markPrice: number;
  usdValue?: number;
  unrealizedPnl?: number;
};

export type PortfolioAllocation = {
  symbol: string;
  value: number;
  pct: number;
};

export type PortfolioSipLiability = {
  currency: string;
  asset: string;
  amountFiat: number;
  amountAsset: number;
};

export type PortfolioActivity = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  qty: number;
  price?: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
};

export type PortfolioTimelinePoint = {
  timestamp: number;
  value: number;
};

export type PortfolioSnapshot = {
  equity: number;
  unrealizedPnl: number;
  balances: PortfolioBalance[];
  positions: PortfolioPosition[];
  allocation?: PortfolioAllocation[];
  activity: PortfolioActivity[];
  timeline: PortfolioTimelinePoint[];
  sipLiabilities?: PortfolioSipLiability[];
  updatedAt?: string;
};

type ApiEnvelope<T> = { data: T };

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const ensureRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// const ensureArray = (value: unknown): unknown[] => {
//   if (Array.isArray(value)) return value;
//   if (!value || typeof value !== "object") return [];
//   const record = value as Record<string, unknown>;
//   if (Array.isArray(record.items)) return record.items;
//   if (Array.isArray(record.data)) return record.data;
//   return [];
// };

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value.replace(/[^0-9.+-eE]/g, ""));
    return Number.isFinite(numeric) ? numeric : fallback;
  }
  return fallback;
};

const toTimestamp = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
};

const toIso = (value: unknown): string => new Date(toTimestamp(value)).toISOString();

const mapSide = (value: unknown): "BUY" | "SELL" => {
  const normalised = String(value ?? "")
    .trim()
    .toUpperCase();
  return normalised === "SELL" ? "SELL" : "BUY";
};

const mapPortfolioBalance = (entry: unknown): PortfolioBalance | null => {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const asset = String(
    raw.asset ?? raw.currency ?? raw.code ?? raw.coin ?? raw.token ?? ""
  ).toUpperCase();
  if (!asset) return null;
  const total = toNumber(
    raw.total ??
      raw.balance ??
      raw.freeBalance ??
      (typeof raw.available === "number" && typeof raw.locked === "number"
        ? (raw.available as number) + (raw.locked as number)
        : undefined) ??
      0
  );
  const available = raw.available !== undefined ? toNumber(raw.available) : undefined;
  const locked = raw.locked !== undefined ? toNumber(raw.locked) : undefined;
  const usdValue = raw.usdValue !== undefined
    ? toNumber(raw.usdValue)
    : raw.valueUsd !== undefined
    ? toNumber(raw.valueUsd)
    : raw.notionalUsd !== undefined
    ? toNumber(raw.notionalUsd)
    : raw.value !== undefined
    ? toNumber(raw.value)
    : undefined;
  return {
    asset,
    total,
    available,
    locked,
    usdValue,
  };
};

const mapPortfolioPosition = (entry: unknown): PortfolioPosition | null => {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const symbol = String(raw.symbol ?? raw.pair ?? raw.asset ?? raw.ticker ?? "").toUpperCase();
  if (!symbol) return null;
  const qty = toNumber(raw.qty ?? raw.quantity ?? raw.size ?? raw.amount ?? 0);
  const avgPrice = toNumber(raw.avgPrice ?? raw.averagePrice ?? raw.entryPrice ?? raw.costBasis ?? 0);
  const markPrice = toNumber(
    raw.markPrice ?? raw.mark ?? raw.price ?? raw.lastPrice ?? raw.referencePrice ?? raw.marketPrice ?? avgPrice
  );
  const usdValue =
    raw.usdValue !== undefined
      ? toNumber(raw.usdValue)
      : raw.notional !== undefined
      ? toNumber(raw.notional)
      : raw.value !== undefined
      ? toNumber(raw.value)
      : toNumber(qty * markPrice);
  const unrealizedPnl = raw.unrealizedPnl !== undefined
    ? toNumber(raw.unrealizedPnl)
    : raw.pnl !== undefined
    ? toNumber(raw.pnl)
    : raw.unrealized !== undefined
    ? toNumber(raw.unrealized)
    : undefined;
  return {
    symbol,
    qty,
    avgPrice,
    markPrice,
    usdValue,
    unrealizedPnl,
  };
};

const mapPortfolioAllocation = (entry: unknown): PortfolioAllocation | null => {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const symbol = String(raw.symbol ?? raw.asset ?? raw.label ?? "").toUpperCase();
  if (!symbol) return null;
  const value = toNumber(raw.value ?? raw.usdValue ?? raw.amount ?? 0);
  const pctRaw = raw.pct ?? raw.percentage ?? raw.weight;
  const pct =
    pctRaw === undefined
      ? 0
      : (() => {
          const numeric = toNumber(pctRaw);
          return numeric > 1 && numeric <= 100 ? numeric : numeric * 100;
        })();
  return {
    symbol,
    value,
    pct,
  };
};

const mapPortfolioSipLiability = (entry: unknown): PortfolioSipLiability | null => {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const currency = String(raw.currency ?? raw.quoteCurrency ?? "USD").toUpperCase();
  const asset = String(raw.asset ?? raw.symbol ?? raw.quoteCurrency ?? "").toUpperCase();
  if (!asset) return null;
  return {
    currency,
    asset,
    amountFiat: toNumber(raw.amountFiat ?? raw.value ?? raw.fiat ?? 0),
    amountAsset: toNumber(raw.amountAsset ?? raw.amount ?? raw.qty ?? 0),
  };
};

const mapPortfolioActivity = (entry: unknown): PortfolioActivity | null => {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const symbol = String(raw.symbol ?? raw.pair ?? raw.asset ?? raw.ticker ?? "").toUpperCase();
  if (!symbol) return null;
  const id = String(
    raw.id ??
      raw.orderId ??
      raw.eventId ??
      raw.txId ??
      `${symbol}-${raw.createdAt ?? raw.timestamp ?? Math.random().toString(36).slice(2)}`
  );
  const qty = toNumber(raw.qty ?? raw.quantity ?? raw.size ?? raw.amount ?? 0);
  const price =
    raw.price !== undefined ? toNumber(raw.price) : raw.executionPrice !== undefined ? toNumber(raw.executionPrice) : undefined;
  const type = String(raw.type ?? raw.orderType ?? raw.eventType ?? "").toUpperCase();
  const status = String(raw.status ?? raw.state ?? raw.result ?? type ?? "").toUpperCase();
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt
      ? raw.createdAt
      : toIso(raw.createdAt ?? raw.timestamp ?? raw.time);
  const updatedAt =
    raw.updatedAt !== undefined ? toIso(raw.updatedAt) : undefined;
  return {
    id,
    symbol,
    side: mapSide(raw.side ?? raw.direction),
    type,
    qty,
    price,
    status,
    createdAt,
    updatedAt,
  };
};

const mapPortfolioTimelinePoint = (entry: unknown): PortfolioTimelinePoint | null => {
  if (!entry) return null;
  if (Array.isArray(entry)) {
    const [time, value] = entry;
    return {
      timestamp: toTimestamp(time),
      value: toNumber(value),
    };
  }
  if (typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const timestamp = toTimestamp(
    raw.timestamp ?? raw.time ?? raw.ts ?? raw.at ?? raw.createdAt ?? raw.updatedAt
  );
  const value = toNumber(
    raw.value ??
      raw.equity ??
      raw.balance ??
      raw.nav ??
      raw.total ??
      raw.amount ??
      raw.usdValue ??
      raw.price ??
      0
  );
  return {
    timestamp,
    value,
  };
};

const normaliseCollection = <T>(value: unknown, mapper: (entry: unknown) => T | null): T[] => {
  const source = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null
    ? (() => {
        const record = value as Record<string, unknown>;
        if (Array.isArray(record.items)) return record.items;
        if (Array.isArray(record.data)) return record.data;
        if (Array.isArray(record.results)) return record.results;
        return Object.values(record);
      })()
    : [];
  return source
    .map((entry) => mapper(entry))
    .filter((item): item is T => Boolean(item));
};

const mapPortfolioSnapshot = (payload: unknown): PortfolioSnapshot => {
  const record = ensureRecord(payload);

  const equity = toNumber(
    record.equity ?? record.totalEquity ?? record.nav ?? record.portfolioValue ?? 0
  );
  const unrealizedPnl = toNumber(
    record.unrealizedPnl ?? record.unrealized ?? record.pnl ?? record.unrealised ?? 0
  );
  const balances = normaliseCollection(record.balances ?? record.wallets ?? record.assets, mapPortfolioBalance);
  const positions = normaliseCollection(
    record.positions ?? record.holdings ?? record.openPositions ?? record.exposures,
    mapPortfolioPosition
  );
  const allocation =
    normaliseCollection(record.allocation ?? record.allocations ?? record.breakdown ?? record.weights, mapPortfolioAllocation) ??
    undefined;
  const activity = normaliseCollection(
    record.activity ?? record.activities ?? record.orders ?? record.events ?? record.logs,
    mapPortfolioActivity
  );
  const timelineSource =
    record.timeline ??
    record.equityTimeline ??
    record.history ??
    record.equityHistory ??
    record.navHistory ??
    record.chart ??
    record.series ??
    record.points;
  const timeline = normaliseCollection(timelineSource, mapPortfolioTimelinePoint).sort(
    (a, b) => a.timestamp - b.timestamp
  );

  const sipLiabilities = normaliseCollection(
    record.sipLiabilities ?? record.sip_liabilities ?? record.sip ?? record.sipCommitments,
    mapPortfolioSipLiability
  );

  const updatedAt =
    typeof record.updatedAt === "string"
      ? record.updatedAt
      : record.updatedAt !== undefined || record.timestamp !== undefined
      ? toIso(record.updatedAt ?? record.timestamp)
      : undefined;

  return {
    equity,
    unrealizedPnl,
    balances,
    positions,
    allocation: allocation && allocation.length ? allocation : undefined,
    activity,
    timeline,
    sipLiabilities: sipLiabilities.length ? sipLiabilities : undefined,
    updatedAt,
  };
};

export const fetchPortfolioSnapshot = async (): Promise<PortfolioSnapshot> => {
  const response = await api.get(PORTFOLIO_ENDPOINTS.snapshot);
  return mapPortfolioSnapshot(unwrap(response.data));
};

export const fetchPortfolioActivity = async (limit = 16): Promise<PortfolioActivity[]> => {
  const response = await api.get(PORTFOLIO_ENDPOINTS.activity(limit));
  return normaliseCollection(unwrap(response.data), mapPortfolioActivity);
};

export const fetchPortfolioEquityHistory = async (
  params: Record<string, string | number | boolean> = { limit: 120 }
): Promise<PortfolioTimelinePoint[]> => {
  const response = await api.get(PORTFOLIO_ENDPOINTS.equityHistory(params));
  return normaliseCollection(unwrap(response.data), mapPortfolioTimelinePoint).sort(
    (a, b) => a.timestamp - b.timestamp
  );
};

export {
  mapPortfolioSnapshot,
  mapPortfolioBalance,
  mapPortfolioPosition,
  mapPortfolioAllocation,
  mapPortfolioActivity,
  mapPortfolioTimelinePoint,
};
