import { API_BASE_URL } from "./apiRoutes";
import { getStoredAccessToken } from "../features/auth/state/session.storage";

function shouldUseApiBase(pathname: string): boolean {
  return (
    pathname.startsWith("/api/kyc/documents/") ||
    pathname.startsWith("/api/storage/kyc/")
  );
}

export function withAccessToken(url?: string | null): string {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const resolved = new URL(raw, API_BASE_URL || window.location.origin);
    const token = resolved.pathname.startsWith("/admin/")
      ? window.localStorage.getItem("adminAccessToken")
      : getStoredAccessToken();
    if (shouldUseApiBase(resolved.pathname)) {
      const apiBase = new URL(API_BASE_URL || window.location.origin);
      resolved.protocol = apiBase.protocol;
      resolved.host = apiBase.host;
    }
    if (!token) return resolved.toString();
    resolved.searchParams.set("token", token);
    return resolved.toString();
  } catch {
    const token = getStoredAccessToken();
    if (!token) return raw;
    const separator = raw.includes("?") ? "&" : "?";
    return `${raw}${separator}token=${encodeURIComponent(token)}`;
  }
}
