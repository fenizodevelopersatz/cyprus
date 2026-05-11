import api from "../../../app/axios";
import { ORDERS_ENDPOINTS } from "../../../app/apiRoutes";

export type OrderSide = "BUY" | "SELL";

export type OrderDTO = {
  id: string;
  symbol: string;
  side: OrderSide;
  type: string;
  price?: number | null;
  qty: number;
  status: "NEW" | "FILLED" | "CANCELED" | "PARTIALLY_FILLED" | string;
  filled: number;
  createdAt: number;
};

export type RecentTradeDTO = {
  id: string;
  symbol: string;
  side: OrderSide;
  type?: string;
  price: number;
  qty: number;
  createdAt: number;
  updatedAt?: number;
  tradeId?: string | number | null;
  matchId?: string | number | null;
};

export type OrdersSnapshotDTO = {
  openOrders: OrderDTO[];
  history: OrderDTO[];
  trades: RecentTradeDTO[];
  counts?: { open: number; filled: number; canceled: number };
};

const unwrapPayload = (raw: any): any => {
  if (raw && typeof raw === "object" && "data" in raw && raw.data !== raw) {
    return unwrapPayload(raw.data);
  }
  return raw;
};

const toMs = (value: any) => {
  if (value == null) return Date.now();
  if (typeof value === "number") return value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const normalizeOrder = (raw: any): OrderDTO => ({
  id: String(raw?.id ?? raw?.orderId ?? crypto.randomUUID?.() ?? Date.now()),
  symbol: raw?.symbol ?? "",
  side: (raw?.side ?? "BUY") as OrderSide,
  type: raw?.type ?? raw?.orderType ?? "LIMIT",
  price: raw?.price != null ? Number(raw.price) : undefined,
  qty: Number(raw?.qty ?? raw?.quantity ?? 0),
  status: raw?.status ?? "NEW",
  filled: Number(raw?.filled ?? raw?.filledQty ?? raw?.executedQty ?? 0),
  createdAt: toMs(raw?.createdAt ?? raw?.ts ?? raw?.timestamp),
});

const normalizeOrders = (list: any): OrderDTO[] => {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeOrder);
};

const normalizeTrade = (raw: any): RecentTradeDTO => ({
  id: String(raw?.id ?? raw?.tradeId ?? raw?.orderId ?? crypto.randomUUID?.() ?? Date.now()),
  symbol: raw?.symbol ?? "",
  side: (raw?.side ?? "BUY") as OrderSide,
  type: raw?.type ?? raw?.orderType ?? raw?.kind,
  price: Number(raw?.price ?? 0),
  qty: Number(raw?.qty ?? raw?.quantity ?? 0),
  createdAt: toMs(raw?.createdAt ?? raw?.ts ?? raw?.timestamp),
  updatedAt: raw?.updatedAt ? toMs(raw.updatedAt) : undefined,
  tradeId: raw?.tradeId ?? null,
  matchId: raw?.matchId ?? null,
});

const normalizeTrades = (list: any): RecentTradeDTO[] => {
  const payload = Array.isArray(list) ? list : [];
  return payload.map(normalizeTrade);
};

const normalizeSnapshot = (raw: any): OrdersSnapshotDTO => {
  const base = raw ?? {};
  const counts = base.counts ?? base.stats ?? undefined;
  return {
    openOrders: normalizeOrders(base.openOrders),
    history: normalizeOrders(base.history),
    trades: normalizeTrades(base.trades ?? base.recentTrades),
    counts: counts
      ? {
          open: Number(counts.open ?? 0),
          filled: Number(counts.filled ?? 0),
          canceled: Number(counts.canceled ?? 0),
        }
      : undefined,
  };
};

export async function fetchOrderSnapshot(params?: {
  openLimit?: number;
  historyLimit?: number;
  tradeLimit?: number;
}): Promise<OrdersSnapshotDTO> {
  const url = ORDERS_ENDPOINTS.snapshot(params);
  const { data } = await api.get(url);
  const payload = unwrapPayload(data);
  return normalizeSnapshot(payload);
}

export async function fetchOrders(params?: { status?: string; limit?: number }) {
  const url = ORDERS_ENDPOINTS.list(params);
  const { data } = await api.get(url);
  const payload = unwrapPayload(data);
  return normalizeOrders(payload);
}

export async function fetchRecentTrades(limit?: number) {
  const url = ORDERS_ENDPOINTS.recent(limit);
  const { data } = await api.get(url);
  const payload = unwrapPayload(data);
  return normalizeTrades(payload);
}

export async function postCancelOrder(orderId: string) {
  const { data } = await api.post(ORDERS_ENDPOINTS.cancel, { orderId });
  return unwrapPayload(data) ?? { ok: true };
}
