import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth.store";

function readHashParams() {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  return new URLSearchParams(hash);
}

export default function GoogleAuthComplete() {
  const navigate = useNavigate();
  const applySession = useAuth((state) => state.applySession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    (async () => {
      const params = readHashParams();
      const access = params.get("access") || "";
      const refresh = params.get("refresh") || "";

      if (!access) {
        if (active) setError("Google login did not return an access token.");
        return;
      }

      try {
        await applySession(access, refresh, true);
        sessionStorage.setItem("twoFactorVerified", "1");
        navigate("/app", { replace: true });
      } catch (err) {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Unable to restore Google session.";
        setError(message);
      }
    })();

    return () => {
      active = false;
    };
  }, [applySession, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
        <div className="text-xs uppercase tracking-[0.28em] text-slate-400">Google OAuth</div>
        <h1 className="mt-2 text-2xl font-semibold text-white">Completing sign-in</h1>
        <p className="mt-3 text-sm text-slate-300">
          {error || "Finishing your Google authentication and restoring your dashboard session."}
        </p>
      </div>
    </div>
  );
}
