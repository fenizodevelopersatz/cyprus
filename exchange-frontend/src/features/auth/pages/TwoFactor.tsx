import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import { getStoredAccessToken } from "../state/session.storage";

type LocationState = {
  email?: string;
  provider?: "password" | "google";
  next?: string;
};

const DEFAULT_CODE = "123456";

export default function TwoFactor() {
  const nav = useNavigate();
  const location = useLocation();
  const state = (location.state || {}) as LocationState;
  const [code, setCode] = useState<string[]>(Array(6).fill(""));
  const [status, setStatus] = useState<"idle" | "verifying" | "error" | "resent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(45);
  const inputsRef = useRef<HTMLInputElement[]>([]);

  useEffect(() => {
    const token = getStoredAccessToken();
    if (!token) {
      nav("/login", { replace: true });
    }
  }, [nav]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCountdown((prev) => (prev <= 0 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const maskedEmail = useMemo(() => {
    const email = state.email ?? "demo@exchange.test";
    const [user, domain] = email.split("@");
    if (!domain) return email;
    const mask = user.length <= 2 ? user[0] : `${user.slice(0, 2)}***`;
    return `${mask}@${domain}`;
  }, [state.email]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  const onChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;
    const next = [...code];
    next[index] = value;
    setCode(next);
    if (value && index < inputsRef.current.length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const onKeyDown = (index: number, evt: KeyboardEvent<HTMLInputElement>) => {
    if (evt.key === "Backspace" && !code[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handleSubmit = (evt: FormEvent) => {
    evt.preventDefault();
    const joined = code.join("");
    if (joined.length < 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setStatus("verifying");
    setError(null);
    window.setTimeout(() => {
      if (joined !== DEFAULT_CODE) {
        setStatus("error");
        setError("Invalid code. Try 123456 for the demo.");
        return;
      }
      sessionStorage.setItem("twoFactorVerified", "1");
      setStatus("idle");
      nav(state.next ?? "/app", { replace: true });
    }, 500);
  };

  const handleResend = () => {
    if (countdown > 0) return;
    setCountdown(45);
    setStatus("resent");
    setTimeout(() => setStatus("idle"), 1500);
  };

  const handleUseBackup = () => {
    setCode(Array(6).fill(""));
    inputsRef.current[0]?.focus();
    setError("Backup codes are coming soon. Use 123456 for now.");
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute top-10 left-1/3 h-72 w-72 rounded-full bg-indigo-500/30 blur-3xl" />
        <div className="absolute bottom-10 right-1/4 h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl" />
      </div>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-5 rounded-3xl border border-white/15 bg-white/8 p-8 shadow-[0_25px_80px_-45px_rgba(79,70,229,0.45)] backdrop-blur-xl"
      >
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-[0.28em] text-slate-300/80">
            Two-Factor
          </div>
          <h1 className="text-2xl font-semibold text-white">Verify your login</h1>
          <p className="text-sm text-slate-300/80">
            We sent a 6-digit code to <span className="text-white">{maskedEmail}</span>. Enter it below to unlock the dashboard.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2">
          {code.map((digit, index) => (
            <Input
              key={index}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(event) => onChange(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              ref={(el) => {
                if (el) inputsRef.current[index] = el;
              }}
              className="h-14 w-14 rounded-2xl border-white/20 bg-white/10 text-center text-xl font-semibold text-white"
            />
          ))}
        </div>

        {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}
        {status === "resent" && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            New code sent. Check your inbox.
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            Resend code in{" "}
            <span className="font-semibold text-white">
              00:{countdown.toString().padStart(2, "0")}
            </span>
          </span>
          <button
            type="button"
            className="text-indigo-300 hover:underline"
            onClick={handleUseBackup}
          >
            Use backup code
          </button>
        </div>

        <div className="space-y-3">
          <Button type="submit" size="lg" disabled={status === "verifying"}>
            {status === "verifying" ? "Verifying..." : "Confirm & Continue"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={countdown > 0}
            onClick={handleResend}
          >
            {countdown > 0 ? "Resend available soon" : "Resend code"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              sessionStorage.removeItem("twoFactorVerified");
              nav("/login", { replace: true });
            }}
          >
            Switch account
          </Button>
        </div>

        <div className="text-xs text-slate-400">
          Tip: In this demo, use <code className="font-mono text-white">123456</code> to pass verification. When you hook up the real API, replace the mock validator located in <code className="font-mono text-white">TwoFactor.tsx</code>.
        </div>
      </form>
    </div>
  );
}

