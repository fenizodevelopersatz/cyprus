import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAdminAuth } from "../state/AdminAuthProvider";

export default function AdminProtected() {
  const token = localStorage.getItem("adminAccessToken");
  const { session, loading, error } = useAdminAuth();
  const loc = useLocation();

  if (!token) {
    return <Navigate to="/admin/login" state={{ from: loc }} replace />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-emerald-500/40 bg-emerald-500/10 px-6 py-5 text-sm shadow-lg shadow-emerald-500/30">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          <div className="uppercase tracking-[0.32em] text-emerald-200/80 text-[11px]">CryptoSignal Admin</div>
          <div className="font-medium text-white">Validating admin session...</div>
        </div>
      </div>
    );
  }

  if (!session || error) {
    return <Navigate to="/admin/login" state={{ from: loc, error }} replace />;
  }

  return <Outlet />;
}
