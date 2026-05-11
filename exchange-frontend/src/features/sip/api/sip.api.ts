import api from "../../../app/axios";
import { SIP_ENDPOINTS } from "../../../app/apiRoutes";

type ApiEnvelope<T> = {
  status?: boolean;
  code?: number;
  message?: string;
  data: T;
};

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

export type SipContributionType = "AMOUNT" | "QUANTITY" | string;
export type SipFrequency = "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY" | string;

export type SipHeroSection = {
  title: string;
  body: string;
};

export type SipHeroCta = {
  label: string;
  helper?: string;
};

export type SipHeroContent = {
  title: string;
  subtitle?: string;
  sections?: SipHeroSection[];
  cta?: SipHeroCta;
};

export type SipSettings = {
  supportedFiats: string[];
  defaultFrequency: SipFrequency;
  scheduleOptions: SipFrequency[];
  minFiatAmount?: number | string | null;
  maxFiatAmount?: number | string | null;
  minAssetQuantity?: string | number | null;
  maxAssetQuantity?: string | number | null;
  fxHints?: Record<string, number>;
};

export type SipPlan = {
  id: number;
  asset: string;
  quoteCurrency: string;
  nickname: string;
  description?: string | null;
  status: string;
  allowedFrequencies: SipFrequency[];
  allowAmountInput: boolean;
  allowQuantityInput: boolean;
  minFiatAmount?: string | number | null;
  maxFiatAmount?: string | number | null;
  minAssetQuantity?: string | number | null;
  maxAssetQuantity?: string | number | null;
  lastPriceFiat?: number | null;
};

export type SipCoin = {
  asset: string;
  symbol: string;
  lastPriceUsd?: number | null;
  fiatPrices: Record<string, number>;
};

export type SipCatalog = {
  enabled: boolean;
  hero?: SipHeroContent;
  settings: SipSettings;
  coins: SipCoin[];
  plans: SipPlan[];
};

export type SipPreviewRequest = {
  planId?: number | string;
  asset: string;
  contributionType: SipContributionType;
  frequency: SipFrequency;
  amountFiat?: string | number;
  amountAsset?: string | number;
  quoteCurrency?: string;
  walletSource?: string;
};

export type SipContributionLimits = {
  minFiat?: number | string | null;
  maxFiat?: number | string | null;
  minAsset?: number | string | null;
  maxAsset?: number | string | null;
};

export type SipWalletCheck = {
  asset: string;
  available?: string | number;
  required?: string | number;
  sufficient: boolean;
};

export type SipPreviewResponse = {
  plan?: SipPlan;
  asset: string;
  quoteCurrency: string;
  contributionType: SipContributionType;
  frequency: SipFrequency;
  amountFiat?: string;
  amountAsset?: string;
  assetPriceFiat?: number;
  limits?: SipContributionLimits;
  walletCheck?: SipWalletCheck;
  reserveAsset?: string;
  reserveAssetAmount?: string;
};

export type SipCreateSubscriptionRequest = SipPreviewRequest & {
  startAt: string;
  autoPauseOnFail?: boolean;
  walletSource?: string;
  amountFiat?: string | number;
  amountAsset?: string | number;
};

export type SipSubscription = {
  id: number;
  userId?: number | string;
  planId: number;
  asset: string;
  quoteCurrency: string;
  contributionType: SipContributionType;
  amountFiat?: string;
  amountAsset?: string;
  frequency: SipFrequency;
  startAt: string;
  nextRunAt?: string | null;
  status: string;
  failCount?: number;
  autoPauseOnFail?: boolean;
  walletSource?: string;
  reserveAsset?: string;
  reserveBalance?: string;
  reserveStatus?: string;
  plan?: Pick<SipPlan, "id" | "nickname" | "asset" | "quoteCurrency" | "description" | "status">;
  metadata?: Record<string, unknown>;
};

export type SipOrder = {
  id: number;
  subscriptionId: number;
  planId: number;
  asset: string;
  quoteCurrency: string;
  contributionType: SipContributionType;
  amountFiat?: string;
  amountAsset?: string;
  status: string;
  executedAt?: string | null;
  nextRunAt?: string | null;
  failureReason?: string | null;
  priceExecutedFiat?: number | null;
};

export async function fetchSipCatalog(): Promise<SipCatalog> {
  const { data } = await api.get<SipCatalog | ApiEnvelope<SipCatalog>>(SIP_ENDPOINTS.catalog());
  return unwrap(data);
}

export async function previewSipSubscription(payload: SipPreviewRequest): Promise<SipPreviewResponse> {
  const { data } = await api.post<SipPreviewResponse | ApiEnvelope<SipPreviewResponse>>(
    SIP_ENDPOINTS.preview(),
    payload
  );
  return unwrap(data);
}

export async function createSipSubscription(
  payload: SipCreateSubscriptionRequest
): Promise<SipSubscription> {
  const { data } = await api.post<SipSubscription | ApiEnvelope<SipSubscription>>(
    SIP_ENDPOINTS.subscriptions(),
    payload
  );
  return unwrap(data);
}

export async function fetchSipSubscriptions(): Promise<SipSubscription[]> {
  const { data } = await api.get<SipSubscription[] | ApiEnvelope<SipSubscription[]>>(
    SIP_ENDPOINTS.subscriptions()
  );
  return unwrap(data);
}

export async function fetchSipOrders(params?: { limit?: number; status?: string; recent?: boolean }) {
  if (params?.recent ?? true) {
    const { data } = await api.get<SipOrder[] | ApiEnvelope<SipOrder[]>>(
      SIP_ENDPOINTS.recentOrders(params?.limit)
    );
    return unwrap(data);
  }
  const { data } = await api.get<SipOrder[] | ApiEnvelope<SipOrder[]>>(SIP_ENDPOINTS.orders(params));
  return unwrap(data);
}

export async function fetchSipHistory(params?: { limit?: number; status?: string; subscriptionId?: string | number }) {
  const { data } = await api.get<SipOrder[] | ApiEnvelope<SipOrder[]>>(SIP_ENDPOINTS.history(params));
  return unwrap(data);
}

export async function pauseSipSubscription(id: string | number) {
  const { data } = await api.post<SipSubscription | ApiEnvelope<SipSubscription>>(
    SIP_ENDPOINTS.subscriptionPause(id)
  );
  return unwrap(data);
}

export async function resumeSipSubscription(id: string | number) {
  const { data } = await api.post<SipSubscription | ApiEnvelope<SipSubscription>>(
    SIP_ENDPOINTS.subscriptionResume(id)
  );
  return unwrap(data);
}

export async function cancelSipSubscription(id: string | number) {
  const { data } = await api.post<SipSubscription | ApiEnvelope<SipSubscription>>(
    SIP_ENDPOINTS.subscriptionCancel(id)
  );
  return unwrap(data);
}
