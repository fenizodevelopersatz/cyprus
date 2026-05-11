import api from "../../../app/axios";
import { WALLET_ENDPOINTS } from "../../../app/apiRoutes";

type ApiEnvelope<T> = { data: T };

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const ensureRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const ensureArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
};

const randomId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

export type WalletBalance = {
  asset: string;
  available: number;
  hold: number;
  total: number;
  namespace: "spot" | "futures" | string;
  sip?: number;
};

export type SipLiability = {
  currency: string;
  asset: string;
  amountFiat: number;
  amountAsset: number;
};

export type DepositAddress = {
  chain: string;
  asset: string;
  address: string;
  label: string;
  fee?: number;
  memo?: string;
  qrCode?: string;
  updatedAt?: string;
};

export type FundingHistoryEntry = {
  id: string;
  type: string;
  asset: string;
  amount: number;
  network?: string;
  status: string;
  createdAt: string;
  txId?: string;
  txHash?: string;
  fromAddress?: string;
  toAddress?: string;
  methodLabel?: string;
  walletTarget?: string;
  reference?: string;
};

export type WithdrawalPayload = {
  address: string;
  amount: number;
  asset: string;
  chain: string;
  memo?: string;
};

export type DepositHistoryRefreshResponse = {
  sync?: {
    network: string;
    address: string;
    synced: number;
    skipped: number;
  };
  history: FundingHistoryEntry[];
};

const mapSipLiability = (value: unknown): SipLiability => {
  const raw = ensureRecord(value);
  return {
    currency: String(raw.currency ?? raw.quoteCurrency ?? "USD"),
    asset: String(raw.asset ?? raw.symbol ?? raw.quoteCurrency ?? ""),
    amountFiat: toNumber(raw.amountFiat),
    amountAsset: toNumber(raw.amountAsset ?? raw.amount),
  };
};

const mapBalancesPayload = (payload: unknown): { balances: WalletBalance[]; sipLiabilities: SipLiability[] } => {
  const results: WalletBalance[] = [];
  const wrapper = ensureRecord(payload);
  const sipLiabilities = ensureArray(wrapper.sip).map(mapSipLiability);

  Object.entries(wrapper).forEach(([namespace, value]) => {
    if (namespace === "sip") return;
    const namespaceBalances = ensureRecord(value);
    Object.entries(namespaceBalances).forEach(([asset, balance]) => {
      const entry = ensureRecord(balance);
      const available = toNumber(entry.available);
      const hold = toNumber(entry.hold ?? entry.locked);
      const sip = entry.sip !== undefined ? toNumber(entry.sip) : undefined;
      results.push({
        asset,
        available,
        hold,
        total: available + hold,
        namespace: namespace as WalletBalance["namespace"],
        sip,
      });
    });
  });

  return { balances: results, sipLiabilities };
};

const mapDepositAddress = (value: unknown): DepositAddress => {
  const raw = ensureRecord(value);
  let chain = String(raw.chain ?? raw.network ?? "").trim();
  if (!chain) {
    chain = String(raw.id ?? raw.slug ?? raw.label ?? raw.asset ?? Math.random().toString(36).slice(2, 8)).toLowerCase();
  }
  const asset = String(raw.asset ?? raw.symbol ?? "USDT");
  const fee = raw.fee !== undefined ? toNumber(raw.fee) : undefined;
  const label =
    typeof raw.label === "string"
      ? raw.label
      : `${asset} ${chain ? `(${chain})` : ""}`.trim();
  const rawQr =
    typeof raw.qrData === "string"
      ? raw.qrData
      : typeof raw.qr === "string"
      ? raw.qr
      : typeof raw.qrCode === "string"
      ? raw.qrCode
      : undefined;
  const qrCode =
    rawQr && rawQr.trim().length
      ? rawQr.trim().startsWith("data:image")
        ? rawQr.trim()
        : `data:image/png;base64,${rawQr.trim()}`
      : undefined;
  return {
    chain,
    asset,
    address: String(raw.address ?? raw.addr ?? ""),
    label,
    fee,
    memo: raw.memo !== undefined ? String(raw.memo) : undefined,
    qrCode,
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
  };
};

const mapHistoryEntry = (value: unknown): FundingHistoryEntry => {
  const raw = ensureRecord(value);
  const txHash =
    raw.txHash !== undefined
      ? String(raw.txHash)
      : raw.tx_hash !== undefined
      ? String(raw.tx_hash)
      : raw.hash !== undefined
      ? String(raw.hash)
      : undefined;
  return {
    id: String(raw.id ?? raw.txId ?? raw.reference ?? randomId()),
    type: String(raw.type ?? raw.side ?? "unknown"),
    asset: String(raw.asset ?? raw.symbol ?? ""),
    amount: toNumber(raw.amount ?? raw.value),
    network:
      raw.networkLabel !== undefined
        ? String(raw.networkLabel)
        : raw.network
        ? String(raw.network)
        : raw.chain
        ? String(raw.chain)
        : undefined,
    status: String(raw.status ?? raw.state ?? "pending"),
    createdAt: String(raw.createdAt ?? raw.timestamp ?? raw.time ?? new Date().toISOString()),
    txId: raw.txId ? String(raw.txId) : txHash,
    txHash,
    fromAddress:
      raw.fromAddress !== undefined
        ? String(raw.fromAddress)
        : raw.from_address !== undefined
        ? String(raw.from_address)
        : undefined,
    toAddress:
      raw.toAddress !== undefined
        ? String(raw.toAddress)
        : raw.to_address !== undefined
        ? String(raw.to_address)
        : undefined,
  };
};

export type FiatDeposit = {
  id: string;
  method: string;
  status: string;
  wallet: string;
  amount: number;
  currency: string;
  paymentIntentId?: string;
  paymentIntentSecret?: string;
  proofUrl?: string;
  referenceCode?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt?: string;
};

export type CreateFiatDepositPayload = {
  method: "stripe" | "bank";
  amount: number;
  currency: string;
  wallet: "spot" | "futures";
  proofUrl?: string;
  referenceCode?: string;
  notes?: string;
};

export type CreateStripeCheckoutPayload = {
  amount: number;
  wallet: "spot" | "futures";
};

export type StripeCheckoutResponse = {
  checkoutUrl: string;
  sessionId?: string;
};

export type WalletTransferPayload = {
  from: "spot" | "futures";
  to: "spot" | "futures";
  asset: string;
  amount: number;
};

const mapFiatDeposit = (value: unknown): FiatDeposit => {
  const raw = ensureRecord(value);
  return {
    id: String(raw.id ?? raw.reference ?? randomId()),
    method: String(raw.method ?? raw.provider ?? "bank"),
    status: String(raw.status ?? "pending"),
    wallet: String(raw.wallet ?? raw.target ?? "spot"),
    amount: toNumber(raw.amount),
    currency: String(raw.currency ?? "USD"),
    paymentIntentId: raw.paymentIntentId ? String(raw.paymentIntentId) : undefined,
    paymentIntentSecret: raw.paymentIntentSecret ? String(raw.paymentIntentSecret) : undefined,
    proofUrl: raw.proofUrl ? String(raw.proofUrl) : undefined,
    referenceCode: raw.referenceCode ? String(raw.referenceCode) : raw.reference ? String(raw.reference) : undefined,
    sessionId: raw.sessionId ? String(raw.sessionId) : undefined,
    createdAt: String(raw.createdAt ?? raw.timestamp ?? new Date().toISOString()),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined,
  };
};

export const fetchWalletBalances = async (): Promise<{ balances: WalletBalance[]; sipLiabilities: SipLiability[] }> => {
  const response = await api.get(WALLET_ENDPOINTS.balances);
  return mapBalancesPayload(unwrap(response.data));
};

export const fetchSupportedDepositAddresses = async (): Promise<DepositAddress[]> => {
  const response = await api.get(WALLET_ENDPOINTS.depositAddresses);
  const payload = unwrap(response.data);
  return ensureArray(payload).map(mapDepositAddress);
};

export const fetchDepositAddress = async (chain: string): Promise<DepositAddress> => {
  const response = await api.get(WALLET_ENDPOINTS.depositAddress(chain));
  return mapDepositAddress(unwrap(response.data));
};

export const fetchFundingHistory = async (limit = 20): Promise<FundingHistoryEntry[]> => {
  const response = await api.get(WALLET_ENDPOINTS.history(limit));
  const payload = unwrap(response.data);
  return ensureArray(payload).map(mapHistoryEntry);
};

export const refreshDepositHistory = async (
  network: string,
  limit = 25
): Promise<DepositHistoryRefreshResponse> => {
  const response = await api.post(WALLET_ENDPOINTS.refreshHistory, { network, limit });
  const payload = ensureRecord(unwrap(response.data));
  const syncRaw = ensureRecord(payload.sync);
  return {
    sync:
      Object.keys(syncRaw).length > 0
        ? {
            network: String(syncRaw.network ?? network),
            address: String(syncRaw.address ?? ''),
            synced: toNumber(syncRaw.synced),
            skipped: toNumber(syncRaw.skipped),
          }
        : undefined,
    history: ensureArray(payload.history).map(mapHistoryEntry),
  };
};

export const fetchFiatDeposits = async (params?: { status?: string }): Promise<FiatDeposit[]> => {
  const response = await api.get(WALLET_ENDPOINTS.fiatDeposits(params));
  const payload = unwrap(response.data);
  return ensureArray(payload).map(mapFiatDeposit);
};

export const createFiatDeposit = async (payload: CreateFiatDepositPayload): Promise<FiatDeposit> => {
  const response = await api.post(WALLET_ENDPOINTS.fiatDepositCreate, payload);
  return mapFiatDeposit(unwrap(response.data));
};

export const createStripeCheckoutSession = async (
  payload: CreateStripeCheckoutPayload
): Promise<StripeCheckoutResponse> => {
  const response = await api.post(WALLET_ENDPOINTS.fiatCheckout, payload);
  const payloadData = unwrap(response.data);
  const normalized = ensureRecord(payloadData);
  return {
    checkoutUrl: String(normalized.checkoutUrl ?? normalized.url ?? ""),
    sessionId: normalized.sessionId ? String(normalized.sessionId) : undefined,
  };
};

export const fetchStripeCheckoutSession = async (sessionId: string): Promise<FiatDeposit> => {
  const response = await api.get(WALLET_ENDPOINTS.fiatCheckoutSession(sessionId));
  return mapFiatDeposit(unwrap(response.data));
};

export const submitWithdrawal = async (payload: WithdrawalPayload): Promise<FundingHistoryEntry> => {
  const response = await api.post(WALLET_ENDPOINTS.withdrawals, payload);
  return mapHistoryEntry(unwrap(response.data));
};

export const requestWalletTransfer = async (payload: WalletTransferPayload) => {
  const response = await api.post(WALLET_ENDPOINTS.transfer, payload);
  return unwrap(response.data);
};
