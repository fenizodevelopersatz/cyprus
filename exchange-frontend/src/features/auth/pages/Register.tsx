import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth.store";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import CountrySelect from "../components/CountrySelect";
import { getCountryByCode } from "../data/countries";
import { useSystemStatus } from "../../systemStatus/SystemStatusGate";
import { DEFAULT_SITE_LOGO, useAuthBranding } from "../branding";

type Mode = "idle" | "working" | "google" | "success" | "error";

export default function Register() {
  const { siteName, siteLogoUrl } = useAuthBranding();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [error, setError] = useState<string | null>(null);
  const register = useAuth((s) => s.register);
  const loginWithGoogle = useAuth((s) => s.loginWithGoogle);
  const nav = useNavigate();
  const loc = useLocation();
  useSystemStatus();

  useEffect(() => {
    const stateReferral = (loc.state as { referralCode?: string } | null)?.referralCode;
    const storedReferral = sessionStorage.getItem("pendingReferralCode") || sessionStorage.getItem("inviteReferralCode");
    const nextReferral = stateReferral || storedReferral;
    if (nextReferral && !referralCode) {
      setReferralCode(nextReferral);
    }
  }, [loc.state, referralCode]);

  const passwordValidationMessage = (() => {
    const trimmed = password.trim();
    if (!trimmed) return null;
    if (trimmed.length < 6) return "Password must be at least 6 characters.";
    return null;
  })();

  const confirmPasswordMessage = (() => {
    if (!confirmPassword) return null;
    if (password !== confirmPassword) return "Confirm password must match your password.";
    return null;
  })();

  const onSubmit = async (e: any) => {
    e.preventDefault();
    if (passwordValidationMessage) {
      setMode("idle");
      setError(passwordValidationMessage);
      return;
    }
    if (password !== confirmPassword) {
      setMode("idle");
      setError("Confirm password must match your password.");
      return;
    }
    setMode("working");
    setError(null);
    try {
      const trimmedName = name.trim();
      const trimmedEmail = email.trim();
      const selectedCountry = getCountryByCode(countryCode);
      if (!selectedCountry) {
        setMode("idle");
        setError("Country is required.");
        return;
      }
      const trimmedReferral = referralCode.trim();
      await register({
        name: trimmedName,
        email: trimmedEmail,
        password,
        country: selectedCountry.name,
        countryCode: selectedCountry.code,
        referralCode: trimmedReferral || undefined,
      });
      setMode("success");
      setTimeout(() => nav("/login", { replace: true }), 800);
    } catch (err) {
      setMode("error");
      type ErrorWithResponse = { response?: { data?: { message?: string } } };
      const responseMsg =
        typeof err === "object" && err !== null && "response" in err
          ? (err as ErrorWithResponse).response?.data?.message
          : undefined;
      setError(responseMsg ?? "Registration failed. Please verify your details and try again.");
    }
  };

  const handleGoogle = async () => {
    setMode("google");
    setError(null);
    try {
      await loginWithGoogle();
    } catch (err) {
      setMode("error");
      setError(err instanceof Error ? err.message : "Google OAuth failed to start.");
    }
  };

  const disabled = mode === "working" || mode === "google";

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(38,54,102,0.45),transparent_32%),linear-gradient(180deg,#0d1220_0%,#151b31_100%)]" />
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-[#1b1f2a]/95 p-8 text-slate-100 shadow-[0_30px_80px_-45px_rgba(0,0,0,0.65)]"
      >
        <div>
          <img
            src={siteLogoUrl}
            alt={`${siteName} logo`}
            className="h-10 w-auto object-contain"
            onError={(event) => {
              event.currentTarget.src = DEFAULT_SITE_LOGO;
            }}
          />
          <h1 className="mt-3 text-[2rem] font-semibold leading-none whitespace-nowrap text-white sm:text-[2.35rem]">Create account</h1>
        </div>
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required disabled={disabled} />
        <Input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          disabled={disabled}
        />
        <CountrySelect value={countryCode} onChange={setCountryCode} required disabled={disabled} />
        <div className="space-y-1">
          <Input
            placeholder="Referral code (Optional)"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value)}
            disabled={disabled}
          />          
        </div>
        <Input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          disabled={disabled}
        />
        <div className="space-y-1">
          <Input
            placeholder="Confirm password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={disabled}
          />
          {passwordValidationMessage ? (
            <p className="text-xs text-amber-200/90">{passwordValidationMessage}</p>
          ) : null}
          {confirmPasswordMessage ? (
            <p className="text-xs text-rose-200/90">{confirmPasswordMessage}</p>
          ) : null}
        </div>
        <Button disabled={disabled} type="submit" className="w-full" size="lg">
          {mode === "working" ? "Creating..." : "Create account"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={handleGoogle}
          disabled={disabled}
        >
          {mode === "google" ? "Connecting to Google…" : "Sign up with Google"}
        </Button>
        {mode === "success" && (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Account scaffolded! Redirecting you to sign-in.
          </div>
        )}
        {error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}
        <div className="text-sm text-slate-300/80">
          Already have an account?{" "}
          <Link to="/login" className="text-indigo-300 hover:underline">
            Sign in
          </Link>
        </div>
      </form>
    </div>
  );
}
