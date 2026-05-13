import { isAxiosError } from "axios";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Button from "../../../ui/Button";
import { useAuth } from "../../auth/state/auth.store";
import { useAdminAuth } from "../state/AdminAuthProvider";

export default function AdminLoginPage() {
  const loginAdmin = useAuth((state) => state.loginAdmin);
  const { refresh, error, session, loading: authLoading } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const loc = useLocation();
  const redirectPath = (loc.state as any)?.from?.pathname ?? "/admin";

  useEffect(() => {
    if (session) {
      navigate(redirectPath, { replace: true });
    }
  }, [session, navigate, redirectPath]);

  const handleSubmit = async (evt: FormEvent) => {
    evt.preventDefault();
    setSubmitError(null);
    setLoading(true);
    try {
      await loginAdmin(email, password);
      const session = await refresh();
      if (!session) throw new Error("Admin role required for this console");
      navigate(redirectPath, { replace: true });
    } catch (err: unknown) {
      if (isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 403) {
          setSubmitError("Incorrect email or password, or insufficient permissions");
        } else if (status && status >= 400 && status < 500) {
          setSubmitError("Incorrect email or password");
        } else {
          setSubmitError(
            ((err.response?.data as any)?.message as string | undefined) ??
              err.message ??
              "Unable to sign in"
          );
        }
      } else if (err instanceof Error) {
        setSubmitError(err.message);
      } else {
        setSubmitError("Unable to sign in");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl shadow-[0_20px_60px_-40px_rgba(16,185,129,0.9)]">
        <div className="mb-6 text-center">
          <div className="text-xs uppercase tracking-[0.28em] text-emerald-200/80">Primerica Admin</div>
          <h1 className="text-2xl font-semibold text-white mt-2">Admin Sign In</h1>
          <p className="text-sm text-slate-300/80 mt-1">Use an account with the admin role.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm">
            <span className="text-slate-300/80">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
              className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 focus:border-emerald-400/60 focus:outline-none"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300/80">Password</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
              className="mt-1 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 focus:border-emerald-400/60 focus:outline-none"
            />
          </label>
          {(submitError || (!loading && !authLoading && error)) && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {submitError || error}
            </div>
          )}
          <Button type="submit" className="w-full justify-center" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
