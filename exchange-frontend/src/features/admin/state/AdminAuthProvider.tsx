import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isAxiosError } from "axios";
import type { AdminSession } from "../api/admin.api";
import { fetchAdminSession } from "../api/admin.api";

type AdminAuthContextValue = {
  session: AdminSession | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<AdminSession | null>;
  logout: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextValue | undefined>(undefined);

const hasAdminRole = (session: AdminSession | null) =>
  Boolean(session?.roles?.some((role) => role.toLowerCase() === "admin"));

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<AdminSession | null> => {
    const token = localStorage.getItem("adminAccessToken");
    if (!token) {
      setSession(null);
      setError(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    try {
      const next = await fetchAdminSession();
      if (!hasAdminRole(next)) {
        throw new Error("Admin role required");
      }
      setSession(next);
      setError(null);
      return next;
    } catch (err: any) {
      const status = isAxiosError(err) ? err.response?.status : undefined;
      const shouldClearSession = status === 401 || status === 403;
      if (shouldClearSession) {
        localStorage.removeItem("adminAccessToken");
        localStorage.removeItem("adminRefreshToken");
      }
      setSession(null);
      setError(
        shouldClearSession
          ? null
          : err?.message ?? "Unable to load admin session"
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    localStorage.removeItem("adminAccessToken");
    localStorage.removeItem("adminRefreshToken");
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      loading,
      error,
      refresh,
      logout,
    }),
    [session, loading, error, refresh, logout]
  );

  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used within AdminAuthProvider");
  return ctx;
}
