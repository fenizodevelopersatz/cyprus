import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { isAxiosError } from "axios";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth.store";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import { DEFAULT_SITE_LOGO, useAuthBranding } from "../branding";

type RecoveryStep = "request" | "verify";

export default function ForgotPassword() {
  const { siteName, siteLogoUrl } = useAuthBranding();
  const [recoveryStep, setRecoveryStep] = useState<RecoveryStep>("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"idle" | "requesting" | "resetting">("idle");
  const [now, setNow] = useState(() => new Date());

  const loc = useLocation();
  const nav = useNavigate();
  const requestPasswordReset = useAuth((s) => s.requestPasswordReset);
  const resetPassword = useAuth((s) => s.resetPassword);

  useEffect(() => {
    const emailFromQuery = new URLSearchParams(loc.search).get("email");
    if (emailFromQuery) {
      setEmail(emailFromQuery);
    }
  }, [loc.search]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const countdownLabel = useMemo(() => {
    if (!expiresAt) return "--:--";
    const diff = Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000);
    return `00:${Math.max(0, diff).toString().padStart(2, "0")}`;
  }, [expiresAt, now]);

  const extractErrorMessage = (err: unknown, fallback: string) => {
    if (isAxiosError(err)) {
      const data = err.response?.data;
      if (data && typeof data === "object") {
        if (typeof (data as any).message === "string") return (data as any).message as string;
        if (typeof (data as any).error === "string") return (data as any).error as string;
      }
      if (typeof data === "string") return data;
    }
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    return fallback;
  };

  const handleRequest = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Enter your email address.");
      return;
    }

    setBusy("requesting");
    setError(null);
    setMessage(null);
    try {
      const result = await requestPasswordReset({ email: trimmedEmail });
      setRecoveryStep("verify");
      setEmail(trimmedEmail);
      setExpiresAt(result.expiresAt ?? null);
      setMessage(result.message ?? "Password reset OTP sent to your email address.");
    } catch (err) {
      setError(extractErrorMessage(err, "Unable to start password reset."));
    } finally {
      setBusy("idle");
    }
  };

  const handleReset = async () => {
    const trimmedOtp = otp.trim();
    if (trimmedOtp.length !== 6) {
      setError("Enter the 6-digit OTP sent to your email.");
      return;
    }
    if (!password || password.length < 6) {
      setError("New password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setBusy("resetting");
    setError(null);
    setMessage(null);
    try {
      const result = await resetPassword({
        email: email.trim().toLowerCase(),
        otp: trimmedOtp,
        password,
      });
      nav(`/login?reset=success&email=${encodeURIComponent(email.trim().toLowerCase())}`, {
        replace: true,
        state: { resetMessage: result.message },
      });
    } catch (err) {
      setError(extractErrorMessage(err, "Unable to reset password."));
    } finally {
      setBusy("idle");
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (recoveryStep === "request") {
      await handleRequest();
      return;
    }
    await handleReset();
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-3 py-6 text-slate-100 sm:px-4 sm:py-12">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(38,54,102,0.45),transparent_32%),linear-gradient(180deg,#0d1220_0%,#151b31_100%)]" />

      <div className="w-full max-w-md">
        <form
          onSubmit={handleSubmit}
          className="rounded-[24px] border border-white/10 bg-[#1b1f2a]/95 p-5 shadow-[0_30px_80px_-45px_rgba(0,0,0,0.65)] sm:rounded-[28px] sm:p-8"
        >
          <div className="mb-6 sm:mb-8">
            <img
              src={siteLogoUrl}
              alt={`${siteName} logo`}
              className="h-12 w-auto max-w-[220px] object-contain"
              onError={(event) => {
                event.currentTarget.src = DEFAULT_SITE_LOGO;
              }}
            />
            <h1 className="mt-3 text-[2rem] font-semibold leading-none text-white sm:text-[2.35rem]">Reset your password</h1>
            <p className="mt-3 max-w-[22rem] text-sm leading-6 text-slate-300/80">
              {recoveryStep === "request"
                ? "Enter your email. We will check whether the account exists and send a reset OTP."
                : "Use the OTP from email, then create your new password."}
            </p>
          </div>

          <div className="space-y-4">
            <Input
              placeholder="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy !== "idle" || recoveryStep === "verify"}
              className="h-12 rounded-2xl border-slate-500/40 bg-[#11151c]"
            />

            {recoveryStep === "verify" && (
              <>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                  <div>{message ?? "Password reset OTP sent to your email address."}</div>
                  <div className="mt-2 text-xs text-slate-400">
                    OTP expires in <span className="font-mono text-white">{countdownLabel}</span>
                  </div>
                </div>
                <Input
                  placeholder="Enter 6-digit OTP"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                  disabled={busy !== "idle"}
                  className="h-12 rounded-2xl border-slate-500/40 bg-[#11151c]"
                />
                <Input
                  placeholder="New password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy !== "idle"}
                  className="h-12 rounded-2xl border-slate-500/40 bg-[#11151c]"
                />
                <Input
                  placeholder="Confirm new password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={busy !== "idle"}
                  className="h-12 rounded-2xl border-slate-500/40 bg-[#11151c]"
                />
              </>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <Button type="submit" className="h-12 w-full rounded-2xl" disabled={busy !== "idle"}>
              {recoveryStep === "request"
                ? busy === "requesting"
                  ? "Checking email..."
                  : "Send OTP"
                : busy === "resetting"
                  ? "Resetting password..."
                  : "Reset password"}
            </Button>
            {recoveryStep === "verify" && (
              <Button
                type="button"
                variant="secondary"
                className="h-12 w-full rounded-2xl"
                onClick={handleRequest}
                disabled={busy !== "idle"}
              >
                Resend OTP
              </Button>
            )}
          </div>

          <div className="mt-6 text-sm text-slate-300/80">
            Remembered it?{" "}
            <Link to="/login" className="text-indigo-300 hover:text-indigo-200">
              Back to sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
