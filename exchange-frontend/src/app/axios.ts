import axios from "axios";
import { API_BASE_URL } from "./apiRoutes";
import { getStoredAccessToken } from "../features/auth/state/session.storage";

const api = axios.create({ baseURL: API_BASE_URL });

function isAdminRequestUrl(requestUrl: string) {
  const normalized = String(requestUrl || "").trim();
  if (!normalized) return false;
  if (
    normalized.startsWith("/admin") ||
    normalized.startsWith("admin") ||
    normalized.startsWith("/api/admin") ||
    normalized.startsWith("api/admin")
  ) {
    return true;
  }

  try {
    const resolved = new URL(normalized, API_BASE_URL || window.location.origin);
    return resolved.pathname.startsWith("/admin") || resolved.pathname.startsWith("/api/admin");
  } catch {
    return normalized.includes("/admin") || normalized.includes("/api/admin");
  }
}

api.interceptors.request.use((cfg) => {
  const requestUrl = String(cfg.url || "");
  const isAdminRequest = isAdminRequestUrl(requestUrl);
  const t = isAdminRequest
    ? localStorage.getItem("adminAccessToken")
    : getStoredAccessToken();
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

// Optional: add a 401 -> refresh flow later
export default api;
