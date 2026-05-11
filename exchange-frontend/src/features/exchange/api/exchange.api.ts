import api from "../../../app/axios";
import { EXCHANGE_ENDPOINTS } from "../../../app/apiRoutes";

type ApiEnvelope<T> = { data: T };

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(parsed) ? Number(parsed) : fallback;
};

type UnknownRecord = Record<string, unknown>;

const ensureRecord = (value: unknown): UnknownRecord => (value && typeof value === "object" ? (value as UnknownRecord) : {});
const ensureArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export type ExchangeSymbol = {
  symbol: string;
  base: string;
  quote: string;
  status: string;
  pricePrecision: number;
  quantityPrecision: number;
  minQty: number;
  maxQty: number;
  minNotional: number;
  tickSize: number;
  stepSize: number;
  makerFee?: number;
  takerFee?: number;
};

export type ExchangeTicker = {
  symbol: string;
  last: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
  volumeQuote: number;
  marketCap?: number;
  updatedAt?: string;
};

export type OrderBookLevel = {
  price: number;
  qty: number;
  total?: number;
};

export type ExchangeOrderBook = {
  lastUpdateId?: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
};

export type ExchangeTrade = {
  id: string;
  price: number;
  qty: number;
  quoteQty?: number;
  side: "buy" | "sell";
  ts: number;
};

export type WalletBalance = {
  asset: string;
  free: number;
  locked: number;
};

export type ExchangeOrder = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET" | string;
  price: number | null;
  qty: number;
  filled: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  clientOrderId?: string;
};

export type ExchangeSnapshot = {
  symbol: string;
  ticker: ExchangeTicker;
  orderbook: ExchangeOrderBook;
  trades: ExchangeTrade[];
  wallets: WalletBalance[];
  openOrders: ExchangeOrder[];
  history?: ExchangeHistoryPoint[];
};

export type ExchangeHistoryPoint = {
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  price: number;
  volume?: number;
  time: number;
};

const mapHistoryPoint = (value: unknown): ExchangeHistoryPoint => {
  const raw = ensureRecord(value);
  const open = toNumber(raw.open ?? raw.o);
  const high = toNumber(raw.high ?? raw.h);
  const low = toNumber(raw.low ?? raw.l);
  const close = toNumber(raw.close ?? raw.c ?? raw.price);
  return {
    open,
    high,
    low,
    close,
    price: toNumber(raw.price ?? close),
    volume: raw.volume !== undefined ? toNumber(raw.volume ?? raw.v) : undefined,
    time:
      typeof raw.time === "number"
        ? raw.time
        : typeof raw.openTime === "number"
        ? raw.openTime
        : typeof raw.closeTime === "number"
        ? raw.closeTime
        : toNumber(raw.t ?? raw.T ?? Date.now()),
  };
};

const randomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
};

export const mapSymbol = (value: unknown): ExchangeSymbol => {
  const raw = ensureRecord(value);
  const filters = ensureRecord(raw.filters);
  const precision = ensureRecord(raw.precision);
  return {
    symbol: String(raw.symbol ?? raw.pair ?? ""),
    base: String(raw.base ?? raw.baseAsset ?? raw.baseCurrency ?? ""),
    quote: String(raw.quote ?? raw.quoteAsset ?? raw.quoteCurrency ?? ""),
    status: String(raw.status ?? "UNKNOWN"),
    pricePrecision: toNumber(
      raw.pricePrecision ?? raw.priceDecimals ?? precision.priceDecimals ?? precision.price,
      2
    ),
    quantityPrecision: toNumber(
      raw.quantityPrecision ?? raw.quantityDecimals ?? raw.stepSizeDecimals ?? precision.quantityDecimals ?? precision.quantity,
      3
    ),
    minQty: toNumber(raw.minQty ?? filters.minQty ?? precision.minQty),
    maxQty: toNumber(raw.maxQty ?? filters.maxQty, Infinity),
    minNotional: toNumber(raw.minNotional ?? filters.minNotional ?? precision.minNotional),
    tickSize: toNumber(raw.tickSize ?? filters.tickSize ?? precision.tickSize ?? 0.01),
    stepSize: toNumber(raw.stepSize ?? filters.stepSize ?? precision.stepSize ?? 0.0001),
    makerFee: raw.makerFee !== undefined ? toNumber(raw.makerFee) : undefined,
    takerFee: raw.takerFee !== undefined ? toNumber(raw.takerFee) : undefined,
  };
};

const toIsoString = (v: unknown): string | undefined => {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v).toISOString();
  return undefined;
};

export const mapTicker = (value: unknown): ExchangeTicker => {
  const raw = ensureRecord(value);
  const last = toNumber(raw.last ?? raw.lastPrice ?? raw.c);
  const open = toNumber(raw.open ?? raw.openPrice ?? raw.o);
  const high = toNumber(raw.high ?? raw.highPrice ?? raw.h);
  const low = toNumber(raw.low ?? raw.lowPrice ?? raw.l);
  const rawChange = raw.change ?? raw.priceChange ?? raw.p;
  const change = rawChange !== undefined ? toNumber(rawChange) : last - open;
  const changePct =
    raw.changePct !== undefined || raw.priceChangePercent !== undefined || raw.P !== undefined
      ? toNumber(raw.changePct ?? raw.priceChangePercent ?? raw.P)
      : open === 0
        ? 0
        : (change / open) * 100;
  return {
    symbol: String(raw.symbol ?? raw.s ?? ""),
    last,
    open,
    high,
    low,
    change,
    changePct,
    volume: toNumber(raw.volume ?? raw.v),
    volumeQuote: toNumber(raw.volumeQuote ?? raw.quoteVolume ?? raw.q),
    marketCap:
      raw.marketCap !== undefined || raw.market_cap !== undefined || raw.cap !== undefined
        ? toNumber(raw.marketCap ?? raw.market_cap ?? raw.cap)
        : undefined,
    // updatedAt: raw.updatedAt ?? raw.closeTime ?? raw.time ?? undefined,
    updatedAt: toIsoString(raw.updatedAt ?? raw.closeTime ?? raw.time),
  };
};

export const mapLevel = (value: unknown): OrderBookLevel => {
  if (Array.isArray(value)) {
    return {
      price: toNumber(value[0]),
      qty: toNumber(value[1]),
      total: value.length > 2 ? toNumber(value[2]) : undefined,
    };
  }
  const entry = ensureRecord(value);
  return {
    price: toNumber(entry.price),
    qty: toNumber(entry.qty ?? entry.quantity),
    total: entry.total !== undefined ? toNumber(entry.total) : undefined,
  };
};

export const mapOrderBook = (value: unknown): ExchangeOrderBook => {
  const raw = ensureRecord(value);
  const bids = ensureArray(raw.bids ?? raw.B).map(mapLevel);
  const asks = ensureArray(raw.asks ?? raw.A).map(mapLevel);
  const lastUpdate = raw.lastUpdateId ?? raw.u;
  return {
    lastUpdateId: typeof lastUpdate === "number" ? lastUpdate : undefined,
    bids,
    asks,
  };
};

export const mapTrade = (value: unknown): ExchangeTrade => {
  const raw = ensureRecord(value);
  const isBuyerMaker = raw.isBuyerMaker;
  const side =
    typeof raw.side === "string"
      ? raw.side
      : isBuyerMaker === false
      ? "buy"
      : "sell";
  return {
    id: String(raw.id ?? raw.tradeId ?? raw.t ?? randomId()),
    price: toNumber(raw.price ?? raw.p),
    qty: toNumber(raw.qty ?? raw.quantity ?? raw.q ?? raw.baseQty),
    quoteQty: raw.quoteQty !== undefined ? toNumber(raw.quoteQty ?? raw.Q ?? raw.quoteQuantity) : undefined,
    side: side.toLowerCase() === "buy" ? "buy" : "sell",
    ts: typeof raw.ts === "number" ? raw.ts : toNumber(raw.time ?? raw.T ?? Date.now()),
  };
};

export const mapWallet = (value: unknown): WalletBalance => {
  const raw = ensureRecord(value);
  return {
    asset: String(raw.asset ?? raw.symbol ?? ""),
    free: toNumber(raw.free ?? raw.available ?? raw.balance ?? 0),
    locked: toNumber(raw.locked ?? raw.hold ?? 0),
  };
};

export const mapOrder = (value: unknown): ExchangeOrder => {
  const raw = ensureRecord(value);
  const createdAtNumber = typeof raw.time === "number" ? raw.time : undefined;
  const updatedAtNumber = typeof raw.updateTime === "number" ? raw.updateTime : undefined;
  return {
    id: String(raw.id ?? raw.orderId ?? raw.clientOrderId ?? randomId()),
    symbol: String(raw.symbol ?? raw.s ?? ""),
    side: String(raw.side ?? raw.S ?? "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
    type: String(raw.type ?? raw.T ?? "LIMIT"),
    price: raw.price !== undefined ? toNumber(raw.price) : null,
    qty: toNumber(raw.qty ?? raw.quantity ?? raw.origQty ?? raw.q),
    filled: toNumber(raw.filled ?? raw.executedQty ?? raw.f),
    status: String(raw.status ?? raw.X ?? "NEW"),
    createdAt:
      typeof raw.createdAt === "string"
        ? raw.createdAt
        : createdAtNumber
        ? new Date(createdAtNumber).toISOString()
        : new Date().toISOString(),
    updatedAt:
      typeof raw.updatedAt === "string"
        ? raw.updatedAt
        : updatedAtNumber
        ? new Date(updatedAtNumber).toISOString()
        : undefined,
    clientOrderId: raw.clientOrderId ? String(raw.clientOrderId) : undefined,
  };
};

export const fetchMarkets = async (): Promise<ExchangeSymbol[]> => {
  const response = await api.get(EXCHANGE_ENDPOINTS.markets);
  const payload = unwrap<unknown>(response.data);
  const payloadRecord = ensureRecord(payload);
  const marketsRaw =
    Array.isArray(payload)
      ? payload
      : Array.isArray(payloadRecord.markets)
      ? payloadRecord.markets
      : ensureArray(payloadRecord.data);
  return marketsRaw.map(mapSymbol);
};

export const fetchTicker = async (symbol: string): Promise<ExchangeTicker> => {
  const response = await api.get(EXCHANGE_ENDPOINTS.ticker(symbol));
  return mapTicker(unwrap<unknown>(response.data));
};

export const fetchOrderBook = async (symbol: string, depth?: number): Promise<ExchangeOrderBook> => {
  const response = await api.get(EXCHANGE_ENDPOINTS.orderbook(symbol, depth));
  return mapOrderBook(unwrap<unknown>(response.data));
};

export const fetchTrades = async (symbol: string, limit?: number): Promise<ExchangeTrade[]> => {
  const response = await api.get(EXCHANGE_ENDPOINTS.trades(symbol, limit));
  const payload = unwrap<unknown>(response.data);
  return ensureArray(payload).map(mapTrade);
};

export const fetchWallets = async (): Promise<WalletBalance[]> => {
  const response = await api.get(EXCHANGE_ENDPOINTS.wallets);
  const payload = unwrap<unknown>(response.data);
  return ensureArray(payload).map(mapWallet);
};

export const fetchOpenOrders = async (): Promise<ExchangeOrder[]> => {
  const response = await api.get(EXCHANGE_ENDPOINTS.openOrders);
  const payload = unwrap<unknown>(response.data);
  return ensureArray(payload).map(mapOrder);
};

export const fetchExchangeSnapshot = async (symbol: string): Promise<ExchangeSnapshot> => {
  const response = await api.get(EXCHANGE_ENDPOINTS.snapshot(symbol));
  const payload = ensureRecord(unwrap<unknown>(response.data));
  return {
    symbol: String(payload?.symbol ?? symbol),
    ticker: mapTicker(payload?.ticker ?? {}),
    orderbook: mapOrderBook(payload?.orderbook ?? {}),
    trades: Array.isArray(payload?.trades) ? payload.trades.map(mapTrade) : [],
    wallets: Array.isArray(payload?.wallets) ? payload.wallets.map(mapWallet) : [],
    openOrders: Array.isArray(payload?.openOrders) ? payload.openOrders.map(mapOrder) : [],
    history: Array.isArray(payload?.history) ? payload.history.map(mapHistoryPoint) : undefined,
  };
};

export type CreateOrderPayload = {
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET";
  price?: number;
  quantity: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
  clientOrderId?: string;
};

export const placeOrder = async (payload: CreateOrderPayload): Promise<ExchangeOrder> => {
  const response = await api.post(EXCHANGE_ENDPOINTS.orders, payload);
  return mapOrder(unwrap<unknown>(response.data));
};

export const cancelOrder = async (orderId: string, symbol: string): Promise<ExchangeOrder> => {
  const response = await api.post(EXCHANGE_ENDPOINTS.cancel, { orderId, symbol });
  return mapOrder(unwrap<unknown>(response.data));
};
