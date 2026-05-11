import api from "../../../app/axios";
import { SIGNAL_ENDPOINTS } from "../../../app/apiRoutes";

type ApiEnvelope<T> = { data: T };

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export async function fetchWalletSummaryBalance(): Promise<string> {
  const response = await api.get(SIGNAL_ENDPOINTS.walletSummary);
  const raw = asRecord(unwrap(response.data));
  return String(raw.main_wallet_balance ?? raw.mainWalletBalance ?? raw.available_balance ?? "0");
}
