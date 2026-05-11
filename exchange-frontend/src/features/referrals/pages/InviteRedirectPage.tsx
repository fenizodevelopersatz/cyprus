import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

export default function InviteRedirectPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    if (code) {
      sessionStorage.setItem("inviteReferralCode", code);
      sessionStorage.setItem("pendingReferralCode", code);
    }
    navigate("/register", { replace: true, state: { referralCode: code ?? "" } });
  }, [code, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
      <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5 text-sm">
        Loading invite...
      </div>
    </div>
  );
}
