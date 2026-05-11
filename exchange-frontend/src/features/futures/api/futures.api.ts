import api from "../../../app/axios";
import { FUTURES_ENDPOINTS } from "../../../app/apiRoutes";

// Types — align with your backend DTOs
export type FuturesSide = "LONG" | "SHORT";

export type FuturesContract = {
  symbol: string;        // UI symbol, e.g. "BTCUSDT-PERP"
  rawSymbol: string;     // exchange/base, e.g. "BTCUSDT"
  baseAsset: string;
  quoteAsset: string;
  tickSize: number;
  lotSize: number;
  markPrice?: number;
  minLeverage?: number;
  maxLeverage?: number;
  /** keep this EXACT name because UI uses maintenanceMarginPct */
  maintenanceMarginPct?: number;
  fundingRate?: number;
  fundingTimestamp?: number | null;
};

export type MarkPriceDTO = { symbol: string; price: number; ts?: number };
export type FundingDTO   = { symbol: string; rate: number; ts?: number };

export type FuturesTick = { ts: number; price: number };

export type FuturesAccount = {
  equity: number;
  balance: number;
  availableMargin: number;
  marginUsed: number;
  unrealizedPnl: number;
  realizedPnl: number;
};

export type FuturesPosition = {
  symbol: string;
  side: FuturesSide;
  size: number;
  entryPrice: number;
  leverage: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
};

export type FuturesTrade = {
  id: string;
  symbol: string;
  side: FuturesSide;
  size: number;
  price: number;
  realizedPnl: number;
  status: string;
  timestamp?: number;
  trigger?: "STOP_LOSS" | "TAKE_PROFIT" | null;
  closeReason?: string;
  closeReasonLabel?: string;
  autoClose?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

/** unwraps `{ data: T }` or `{ status, code, data: T }` or returns the input if already T */
function unwrap<T>(raw: any): T {
  if (raw && Array.isArray(raw)) return raw as unknown as T;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.data)) return raw.data as T;
    if (raw.data && typeof raw.data === "object") return raw.data as T;
  }
  return raw as T;
}

/** robust parser for history points coming as `{ price, ts }` or `{ price, timestamp }(string/number) */
// function toTicks(arr: any[]): FuturesTick[] {
//   if (!Array.isArray(arr)) return [];
//   return arr
//     .map((x) => {
//       const price = Number(x.price);
//       const tsRaw = x.ts ?? x.timestamp ?? x.time;
//       const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) : Number(tsRaw);
//       if (!Number.isFinite(price) || !Number.isFinite(ts)) return null;
//       return { price, ts } as FuturesTick;
//     })
//     .filter(Boolean) as FuturesTick[];
// }

/** map backend contracts to UI contracts (handle displaySymbol/rawSymbol and margin field name) */
// function normalizeContracts(list: any[]): FuturesContract[] {
//   if (!Array.isArray(list)) return [];
//   return list.map((c) => {
//     const display = c.displaySymbol ?? c.symbol ?? "";
//     return {
//       symbol: display,                     // e.g. "BNBUSDT-PERP"
//       rawSymbol: c.symbol ?? c.rawSymbol,  // e.g. "BNBUSDT"
//       baseAsset: c.baseAsset ?? c.base ?? "",
//       quoteAsset: c.quoteAsset ?? c.quote ?? "USDT",
//       tickSize: Number(c.tickSize ?? c.tick_size ?? 0.01),
//       lotSize: Number(c.lotSize ?? c.lot_size ?? 0.001),
//       markPrice: c.markPrice != null ? Number(c.markPrice) : undefined,
//       minLeverage: c.minLeverage != null ? Number(c.minLeverage) : undefined,
//       maxLeverage: c.maxLeverage != null ? Number(c.maxLeverage) : undefined,
//       maintenanceMarginPct: c.maintenanceMarginPct != null
//         ? Number(c.maintenanceMarginPct)
//         : (c.maintenanceMarginRate != null ? Number(c.maintenanceMarginRate) : undefined),
//       fundingRate: c.fundingRate != null ? Number(c.fundingRate) : undefined,
//       fundingTimestamp: c.fundingTimestamp != null ? Number(c.fundingTimestamp) : null,
//     } as FuturesContract;
//   });
// }

// Reads
export async function getContracts(): Promise<FuturesContract[]> {
  const { data } = await api.get(FUTURES_ENDPOINTS.contracts());
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export async function getMark(symbol: string): Promise<MarkPriceDTO> {
  const { data } = await api.get(FUTURES_ENDPOINTS.mark(symbol));
  // unwrap common shapes: {data:{...}} or direct object
  return (data?.data ?? data) as MarkPriceDTO;
}

export async function getFunding(symbol: string): Promise<FundingDTO> {
  const { data } = await api.get(FUTURES_ENDPOINTS.funding(symbol));
  return (data?.data ?? data) as FundingDTO;
}

export async function getHistory(symbol: string, limit = 200): Promise<FuturesTick[]> {
  const { data } = await api.get(FUTURES_ENDPOINTS.history(symbol, limit));
  const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
  // normalise just in case backend sends {time|ts|t, price|string}
  return arr.map((p: any) => ({
    ts: Number(p.ts ?? p.t ?? p.time ?? Date.now()),
    price: Number(p.price ?? p.p ?? 0),
  }));
}

export async function getAccount(): Promise<FuturesAccount> {
  const { data } = await api.get(FUTURES_ENDPOINTS.account());
  return (data?.data ?? data) as FuturesAccount;
}

export async function getPositions(): Promise<FuturesPosition[]> {
  const { data } = await api.get(FUTURES_ENDPOINTS.positions());
  return (Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : [])) as FuturesPosition[];
}

export type FuturesTradesResponse = {
  items: FuturesTrade[];
  nextCursor: number | null;
};

export async function getTrades(params?: { limit?: number; cursor?: string | number }): Promise<FuturesTradesResponse> {
  const { data } = await api.get(FUTURES_ENDPOINTS.trades(params));
  const payload = data?.data ?? data;
  if (payload && typeof payload === "object" && Array.isArray(payload.items)) {
    return {
      items: payload.items as FuturesTrade[],
      nextCursor: payload.nextCursor ?? null,
    };
  }
  const fallbackItems = Array.isArray(payload) ? payload : [];
  return { items: fallbackItems as FuturesTrade[], nextCursor: null };
}


// export async function getMark(symbol: string): Promise<MarkPriceDTO> {
//   const { data } = await api.get(FUTURES_ENDPOINTS.mark(symbol));
//   const m = unwrap<any>(data);
//   return {
//     symbol: m.symbol ?? symbol,
//     price: Number(m.price ?? m.markPrice ?? 0),
//     ts: m.ts ?? (m.timestamp ? Date.parse(m.timestamp) : undefined),
//   };
// }

// export async function getFunding(symbol: string): Promise<FundingDTO> {
//   const { data } = await api.get(FUTURES_ENDPOINTS.funding(symbol));
//   const f = unwrap<any>(data);
//   return {
//     symbol: f.symbol ?? symbol,
//     rate: Number(f.rate ?? f.fundingRate ?? 0),
//     ts: f.ts ?? (f.timestamp ? Date.parse(f.timestamp) : undefined),
//   };
// }

// export async function getHistory(symbol: string, limit = 200): Promise<FuturesTick[]> {
//   const { data } = await api.get(FUTURES_ENDPOINTS.history(symbol, limit));
//   const arr = unwrap<any[]>(data);
//   return toTicks(arr);
// }

// export async function getAccount(): Promise<FuturesAccount> {
//   const { data } = await api.get(FUTURES_ENDPOINTS.account());
//   return unwrap<FuturesAccount>(data);
// }

// export async function getPositions(): Promise<FuturesPosition[]> {
//   const { data } = await api.get(FUTURES_ENDPOINTS.positions());
//   return unwrap<FuturesPosition[]>(data);
// }

// export async function getTrades(): Promise<FuturesTrade[]> {
//   const { data } = await api.get(FUTURES_ENDPOINTS.trades());
//   return unwrap<FuturesTrade[]>(data);
// }

// Mutations
export async function openPosition(payload: {
  symbol: string;
  side: FuturesSide;
  size: number;
  leverage: number;
  stopLoss?: number;
  takeProfit?: number;
}) {
  const { data } = await api.post(FUTURES_ENDPOINTS.openPosition(), payload);
  return unwrap<any>(data);
}

export async function updateTriggers(payload: {
  symbol: string;
  stopLoss?: number;
  takeProfit?: number;
}) {
  const { data } = await api.post(FUTURES_ENDPOINTS.updateTriggers(), payload);
  return unwrap<any>(data);
}

export async function closePosition(payload: { symbol: string }) {
  const { data } = await api.post(FUTURES_ENDPOINTS.closePosition(), payload);
  return unwrap<any>(data);
}
