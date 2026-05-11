import api from "../../../app/axios";
import { CONTENT_ENDPOINTS } from "../../../app/apiRoutes";

export type SystemStatusResponse = {
  maintenanceMode: boolean;
  requireReferralCode: boolean;
  maintenanceMessage?: string | null;
};

export async function fetchSystemStatus(): Promise<SystemStatusResponse> {
  const { data } = await api.get(CONTENT_ENDPOINTS.systemStatus);
  const payload =
    data && typeof data === "object" && "data" in (data as Record<string, unknown>)
      ? (data as any).data
      : data;
  if (payload && typeof payload === "object") {
    return {
      maintenanceMode: Boolean((payload as any).maintenanceMode),
      requireReferralCode: Boolean((payload as any).requireReferralCode),
      maintenanceMessage: (payload as any).maintenanceMessage ?? null,
    };
  }
  return { maintenanceMode: false, requireReferralCode: false, maintenanceMessage: null };
}
