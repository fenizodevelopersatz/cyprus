import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../features/auth/state/auth.store";
import { getStoredAccessToken } from "../features/auth/state/session.storage";

type SessionRenderState = {
  token: string | null;
  user: ReturnType<typeof useAuth.getState>["user"];
  verifying: boolean;
  verificationFailed: boolean;
};

function SessionStatus({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
      <div className="flex flex-col items-center gap-3 rounded-3xl border border-indigo-500/40 bg-indigo-500/10 px-6 py-5 text-sm shadow-lg shadow-indigo-500/30">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
        <div className="text-[11px] uppercase tracking-[0.32em] text-indigo-200/80">CryptoSignal</div>
        <div className="font-medium text-white">{label}</div>
      </div>
    </div>
  );
}

function SessionLoader({ children }: { children: (state: SessionRenderState) => ReactNode }) {
  const token = getStoredAccessToken();
  const user = useAuth((state) => state.user);
  const loadMe = useAuth((state) => state.loadMe);
  const logout = useAuth((state) => state.logout);
  const [verifying, setVerifying] = useState(() => Boolean(token && !user));
  const [verificationFailed, setVerificationFailed] = useState(false);

  useEffect(() => {
    if (!token) {
      setVerifying(false);
      setVerificationFailed(false);
      return;
    }

    if (user) {
      setVerifying(false);
      setVerificationFailed(false);
      return;
    }

    let active = true;
    setVerifying(true);

    (async () => {
      try {
        await loadMe();
        if (!active) return;
        setVerificationFailed(false);
      } catch {
        if (!active) return;
        setVerificationFailed(true);
        logout();
      } finally {
        if (active) setVerifying(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [token, user, loadMe, logout]);

  return <>{children({ token, user, verifying, verificationFailed })}</>;
}

export function Protected() {
  const mockMode = import.meta.env.VITE_MOCK_MODE === "1";
  const location = useLocation();

  if (mockMode) return <Outlet />;

  return (
    <SessionLoader>
      {({ token, verifying, verificationFailed }) => {
        if (!token || verificationFailed) {
          return <Navigate to="/login" state={{ from: location }} replace />;
        }

        if (verifying) {
          return <SessionStatus label="Validating session..." />;
        }

        return <Outlet />;
      }}
    </SessionLoader>
  );
}

export function PublicOnly() {
  const mockMode = import.meta.env.VITE_MOCK_MODE === "1";

  if (mockMode) return <Outlet />;

  return (
    <SessionLoader>
      {({ token, user, verifying, verificationFailed }) => {
        if (verifying) {
          return <SessionStatus label="Restoring session..." />;
        }

        if (token && user && !verificationFailed) {
          return <Navigate to="/app" replace />;
        }

        return <Outlet />;
      }}
    </SessionLoader>
  );
}
