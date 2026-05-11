import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { isAxiosError } from "axios";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth.store";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import { DEFAULT_SITE_LOGO, useAuthBranding } from "../branding";

type StatusState =
  | "idle"
  | "connecting"
  | "otp"
  | "verifyingOtp"
  | "resendingOtp"
  | "google"
  | "error"
  | "success";

export default function Login() {
  const { siteName, siteLogoUrl } = useAuthBranding();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [status, setStatus] = useState<StatusState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"credentials" | "otp">("credentials");
  const [otpCode, setOtpCode] = useState("");
  const [otpInfo, setOtpInfo] = useState<{ message?: string; expiresAt?: string | null; factorType?: "email" | "authenticator" } | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccessMessage, setOtpSuccessMessage] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const nav = useNavigate();
  const loc = useLocation();
  const googleError = new URLSearchParams(loc.search).get("google_error");
  const from = (loc.state as any)?.from?.pathname || "/app";
  const login = useAuth((s) => s.login);
  const loginWithGoogle = useAuth((s) => s.loginWithGoogle);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const stateMessage = (loc.state as { resetMessage?: string } | null)?.resetMessage;
    const emailFromQuery = new URLSearchParams(loc.search).get("email");
    if (emailFromQuery) {
      setEmail(emailFromQuery);
    }
    if (stateMessage) {
      setResetMessage(stateMessage);
      nav(loc.pathname, { replace: true, state: {} });
    }
  }, [loc.pathname, loc.search, loc.state, nav]);

  useEffect(() => {
    if (!googleError) return;
    setError(`Google sign-in failed: ${googleError}`);
    setStatus("error");
  }, [googleError]);

  const resendSecondsRemaining = useMemo(() => {
    if (!resendAvailableAt) return null;
    const diff = Math.floor((new Date(resendAvailableAt).getTime() - now.getTime()) / 1000);
    return Math.max(0, diff);
  }, [resendAvailableAt, now]);

  const resendCountdownLabel =
    resendSecondsRemaining !== null ? `00:${resendSecondsRemaining.toString().padStart(2, "0")}` : "--:--";

  const credentialBusy = status === "connecting" || status === "google";
  const otpBusy = status === "verifyingOtp";
  const resendDisabled = status === "resendingOtp" || (resendSecondsRemaining !== null && resendSecondsRemaining > 0);

  const extractErrorMessage = (err: unknown, fallback: string) => {
    if (isAxiosError(err)) {
      const data = err.response?.data;
      const errorCode =
        data && typeof data === "object"
          ? typeof (data as any).code === "string"
            ? (data as any).code
            : typeof (data as any).errorCode === "string"
              ? (data as any).errorCode
              : null
          : null;
      if (errorCode === "ADMIN_PORTAL_ONLY") {
        return "Admin accounts must use the admin login portal.";
      }
      if (errorCode === "ACCOUNT_DELETED") {
        return "Invalid username or password. Please contact admin.";
      }
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

  const completeLogin = () => {
    sessionStorage.setItem("twoFactorVerified", "1");
    setStatus("success");
    nav(from, { replace: true });
  };

  const startOtpChallenge = (message?: string, expiresAt?: string | null, factorType?: "email" | "authenticator") => {
    const cooldownEndsAt = new Date(Date.now() + 60 * 1000).toISOString();
    setPhase("otp");
    setOtpInfo({
      message: message ?? "",
      expiresAt,
      factorType,
    });
    setOtpCode("");
    setOtpError(null);
    setResendAvailableAt(factorType === "email" ? cooldownEndsAt : null);
    setStatus("otp");
    sessionStorage.setItem("twoFactorVerified", "0");
  };

  const submitCredentials = async () => {
    setError(null);
    setOtpError(null);
    setOtpSuccessMessage(null);
    setResetMessage(null);
    setStatus("connecting");
    try {
      const result = await login(email, password, remember);
      if (result.status === "otp_required") {
        startOtpChallenge(result.message, result.expiresAt, result.factorType);
        return;
      }
      completeLogin();
    } catch (err) {
      setStatus("error");
      setError(
        extractErrorMessage(
          err,
          "Unable to sign in with those credentials. Please try again."
        )
      );
    }
  };

  const submitOtp = async () => {
    const trimmed = otpCode.trim();
    if (!trimmed || trimmed.length !== 6) {
      setOtpError(
        otpInfo?.factorType === "authenticator"
          ? "Enter the current 6-digit code from your authenticator app."
          : "Enter the 6-digit OTP sent to your email."
      );
      return;
    }
    setOtpError(null);
    setOtpSuccessMessage(null);
    setStatus("verifyingOtp");
    try {
      const result = await login(email, password, remember, trimmed);
      if (result.status === "otp_required") {
        if (result.factorType === "authenticator") {
          setOtpSuccessMessage("Email verified successfully. Redirecting to Google Authenticator verification...");
          setStatus("success");
          window.setTimeout(() => {
            startOtpChallenge(result.message, result.expiresAt, result.factorType);
            setOtpSuccessMessage(null);
          }, 1200);
          return;
        }
        startOtpChallenge(result.message, result.expiresAt, result.factorType);
        setOtpError("OTP expired, we sent a new code.");
        return;
      }
      completeLogin();
    } catch (err) {
      setStatus("otp");
      setOtpError(extractErrorMessage(err, "Unable to verify the OTP."));
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (phase === "otp") {
      submitOtp();
    } else {
      submitCredentials();
    }
  };

  const handleResendOtp = async () => {
    if (resendDisabled) return;
    setOtpError(null);
    setOtpSuccessMessage(null);
    setStatus("resendingOtp");
    try {
      const result = await login(email, password, remember);
      if (result.status === "otp_required") {
        startOtpChallenge(result.message, result.expiresAt, result.factorType);
        return;
      }
      completeLogin();
    } catch (err) {
      setStatus("otp");
      setOtpError(extractErrorMessage(err, "Unable to resend the OTP right now."));
    }
  };

  const handleSwitchAccount = () => {
    setPhase("credentials");
    setStatus("idle");
    setOtpInfo(null);
    setOtpCode("");
    setOtpError(null);
    setOtpSuccessMessage(null);
    setResendAvailableAt(null);
    sessionStorage.removeItem("twoFactorVerified");
  };

  const handleGoogle = async () => {
    setError(null);
    setStatus("google");
    try {
      await loginWithGoogle();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Google sign-in failed to start.");
    }
  };

  const activeError = phase === "otp" ? otpError : error;

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
            <h1 className="mt-3 text-[2rem] font-semibold leading-none text-white sm:text-[2.35rem]">
              {phase === "otp" ? "Enter your OTP" : "Sign in"}
            </h1>
            <p className="mt-3 max-w-[22rem] text-sm leading-6 text-slate-300/80">
              {phase === "otp"
                ? otpInfo?.factorType === "authenticator"
                  ? "Email verification is complete. Enter the current 6-digit code from your authenticator app."
                  : "We sent a 6-digit verification code to your email, so enter it below before it expires."
                : ""}
            </p>
          </div>

          {resetMessage && (
            <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {resetMessage}
            </div>
          )}

          {phase === "credentials" ? (
            <div className="space-y-4.5">
              <div>
                <div className="mb-2 text-xs font-medium text-slate-200">Email</div>
                <Input
                  placeholder="Email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  required
                  disabled={credentialBusy}
                  className="h-12 rounded-2xl border-slate-500/40 bg-[#11151c]"
                />
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-slate-200">Password</div>
                <Input
                  placeholder="Password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  disabled={credentialBusy}
                  className="h-12 rounded-2xl border-slate-500/40 bg-[#11151c]"
                />
              </div>
              <div className="pt-1">
                <div className="flex flex-col items-start gap-3 text-xs text-slate-300/80 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    className="h-4 w-4 rounded border border-white/20 bg-transparent accent-cyan-500"
                    disabled={credentialBusy}
                  />
                  Remember me
                </label>
                <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 sm:w-auto sm:justify-end">
                  <Link
                    to={email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : "/forgot-password"}
                    className="text-slate-300 transition hover:text-white"
                  >
                    Forgotten password?
                  </Link>
                  <Link to="/register" className="text-indigo-300 hover:text-indigo-200">
                    Need an account?
                  </Link>
                </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4.5">
              <Input
                placeholder={otpInfo?.factorType === "authenticator" ? "Enter 6-digit authenticator code" : "Enter 6-digit OTP"}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otpCode}
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, "");
                  setOtpCode(next);
                }}
                required
                disabled={otpBusy}
                className="h-12 rounded-2xl border-slate-500/40 bg-[#11151c]"
              />
              {otpInfo?.message ? <div className="text-xs text-slate-300/80">{otpInfo.message}</div> : null}
            </div>
          )}

          {otpSuccessMessage && (
            <div className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {otpSuccessMessage}
            </div>
          )}

          {activeError && (
            <div className="mt-4 rounded-2xl border border-rose-400/35 bg-[linear-gradient(135deg,rgba(127,29,29,0.32),rgba(76,5,25,0.18))] px-4 py-3.5 text-rose-100 shadow-[0_10px_30px_-18px_rgba(244,63,94,0.65)]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rose-300/35 bg-rose-400/15 text-rose-200">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v5" />
                    <path d="M12 16h.01" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-200/80">
                    Sign-in failed
                  </div>
                  <div className="mt-1 text-sm font-medium leading-5 text-rose-50">{activeError}</div>
                </div>
              </div>
            </div>
          )}

          <Button
            type="submit"
            className="mt-4 h-12 w-full rounded-2xl text-base sm:mt-5 sm:text-lg"
            size="lg"
            disabled={phase === "credentials" ? credentialBusy : otpBusy}
          >
            {phase === "credentials"
              ? status === "connecting"
                ? "Signing in..."
                : "Sign in"
              : status === "verifyingOtp"
                ? "Verifying OTP..."
                : "Verify & Sign in"}
          </Button>

          {phase === "credentials" ? (
            <>
              <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
                <div className="h-px flex-1 bg-white/10" />
                <span>or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>
              <Button
                type="button"
                variant="secondary"
                className="h-12 w-full rounded-2xl"
                onClick={handleGoogle}
                disabled={credentialBusy}
              >
                {status === "google" ? "Connecting to Google..." : "Continue with Google"}
              </Button>
            </>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {otpInfo?.factorType !== "authenticator" ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full rounded-2xl"
                  onClick={handleResendOtp}
                  disabled={resendDisabled}
                >
                  {status === "resendingOtp"
                    ? "Sending new code..."
                    : resendDisabled && resendSecondsRemaining !== null
                      ? "Resend in " + resendCountdownLabel
                      : "Resend code"}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                className="w-full rounded-2xl"
                onClick={handleSwitchAccount}
              >
                Use different method
              </Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
