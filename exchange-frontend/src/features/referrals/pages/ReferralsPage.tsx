import { useCallback, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useNavigate } from "react-router-dom";
import Button from "../../../ui/Button";
import Dialog from "../../../ui/Dialog";
import Input from "../../../ui/Input";
import { useReferralData } from "../hooks/useReferralData";
import UnilevelTreeCard from "../components/UnilevelTreeCard";
import { formatMoneyWithSymbol } from "../../../utils/money";
import { getLevelImageSrc, getLevelLabel } from "../../../utils/levelImages";

const statusClassNames: Record<string, string> = {
  rewarded: "text-emerald-300",
  verified: "text-indigo-300",
  pending: "text-amber-200",
};

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "--";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const metricSkeletons = Array.from({ length: 4 }, (_, index) => index);

const LevelBadge = ({ levelCode, levelRank, size = "md" }: { levelCode?: string | null; levelRank?: number | null; size?: "sm" | "md" }) => {
  const imageSrc = getLevelImageSrc(levelCode, levelRank);
  const label = getLevelLabel(levelCode, levelRank);
  const sizeClass = size === "sm" ? "h-9 w-9 rounded-xl" : "h-10 w-10 rounded-xl";

  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden border border-white/10 bg-white/5 ${sizeClass}`}>
      <img src={imageSrc} alt={label} className="h-full w-full object-cover" />
    </div>
  );
};

const CertificateStars = () => (
  <div className="flex items-center justify-center gap-2 text-[#f6d56f]">
    {[0, 1, 2].map((star) => (
      <svg
        key={star}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-6 w-6 drop-shadow-[0_0_8px_rgba(246,213,111,0.45)]"
        fill="currentColor"
      >
        <path d="M12 2.8 14.86 8.6l6.4.93-4.63 4.5 1.1 6.36L12 17.4l-5.73 3 1.1-6.36-4.63-4.5 6.4-.93L12 2.8Z" />
      </svg>
    ))}
  </div>
);

const LevelCertificateCard = ({
  levelImage,
  levelLabel,
  levelRank,
  nextLevelCode,
  nextLevelRequirement,
}: {
  levelImage: string;
  levelLabel: string;
  levelRank: number;
  nextLevelCode: string;
  nextLevelRequirement: { promotionRewardUsdt: number } | null;
}) => (
  <div className="relative overflow-hidden rounded-[30px] border border-[#8a6a24] bg-[radial-gradient(circle_at_top,rgba(246,213,111,0.14),transparent_34%),linear-gradient(180deg,#131313_0%,#090909_100%)] p-4 shadow-[0_28px_90px_-50px_rgba(246,213,111,0.55)] sm:p-5">
    <div className="pointer-events-none absolute inset-3 rounded-[24px] border border-[#f6d56f]" />
    <div className="pointer-events-none absolute inset-x-5 top-5 h-5 border-t border-[#f6d56f]/85">
      <div className="absolute left-0 top-0 h-5 w-5 border-l border-[#f6d56f]/85" />
      <div className="absolute right-0 top-0 h-5 w-5 border-r border-[#f6d56f]/85" />
    </div>
    <div className="pointer-events-none absolute inset-x-5 bottom-5 h-5 border-b border-[#f6d56f]/85">
      <div className="absolute bottom-0 left-0 h-5 w-5 border-l border-[#f6d56f]/85" />
      <div className="absolute bottom-0 right-0 h-5 w-5 border-r border-[#f6d56f]/85" />
    </div>

    <div className="relative z-10 flex items-start justify-between gap-3">
      <img src="/icons/logo.png" alt="Site logo" className="h-10 w-auto object-contain sm:h-12" />
      <div className="rounded-full border border-[#f6d56f]/35 bg-[#10203d]/75 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#f6d56f]">
        Rank {levelRank || 0}
      </div>
    </div>

    <div className="relative z-10 mt-4 flex flex-col items-center text-center">
      <div className="relative flex h-28 w-28 items-center justify-center rounded-full border-[5px] border-[#f6d56f] bg-[radial-gradient(circle,#232323_0%,#111_72%)] p-1 shadow-[0_0_25px_rgba(246,213,111,0.28)] sm:h-32 sm:w-32">
        <div className="absolute inset-[-10px] rounded-full border-2 border-dotted border-[#f6d56f]/65" />
        <img src={levelImage} alt={levelLabel} className="relative h-full w-full rounded-full object-cover" />
      </div>

      <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.3em] text-[#d5c59c]">
        Current Level
      </div>
      <div className="mt-2 text-2xl font-black tracking-[0.02em] text-[#f8df8b] sm:text-[2rem]">
        {levelLabel}
      </div>
      <div className="mt-2 max-w-[22rem] rounded-[16px] border border-[#f6d56f]/45 bg-[linear-gradient(90deg,rgba(16,32,61,0.95),rgba(34,58,108,0.95))] px-4 py-2 text-sm font-semibold text-[#f2dfae]">
        {nextLevelRequirement ? `Next target ${nextLevelCode}` : "Top level achieved"}
      </div>

      <div className="mt-5">
        <CertificateStars />
      </div>

      <div className="mt-5 text-[11px] uppercase tracking-[0.22em] text-[#d5c59c]">
        Promotion Reward
      </div>
      <div className="mt-1 text-xl font-bold text-white">
        {nextLevelRequirement ? formatMoneyWithSymbol(nextLevelRequirement.promotionRewardUsdt) : "Unlocked"}
      </div>
    </div>
  </div>
);

export default function ReferralsPage() {
  const navigate = useNavigate();
  const [copyState, setCopyState] = useState<"code" | "url" | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [isShareSheetOpen, setIsShareSheetOpen] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const {
    loading,
    error,
    dashboard,
    refresh,
    exportCsv,
    exporting,
    history,
    historyPagination,
    historyLoading,
    historyError,
    historyPage,
    setHistoryPage,
  } = useReferralData();

  const metrics = dashboard?.metrics ?? [];
  const mlm = dashboard?.mlm;
  const primary = dashboard?.primaryCode;
  const levelSettings = useMemo(
    () => (mlm?.levelSettings ?? []).filter((level) => level.isEnabled).sort((a, b) => a.sortOrder - b.sortOrder),
    [mlm?.levelSettings]
  );
  const levelCodeOrder = useMemo(() => levelSettings.map((level) => level.levelCode), [levelSettings]);
  const levelRequirements = useMemo(
    () =>
      Object.fromEntries(
        levelSettings.map((level) => [
          level.levelCode,
          {
            label: level.qualificationText,
            directRequirement: level.directRequirement,
            directLevelCode: level.directLevelCode,
            teamRequirement: level.teamRequirement,
            bonusPercent: level.bonusPercent,
            promotionRewardUsdt: level.promotionRewardUsdt,
          },
        ])
      ),
    [levelSettings]
  );

  const referralCode = primary?.code ?? "—";
  const campaignUrl = primary?.url ?? "";
  const qrValue = useMemo(() => campaignUrl.trim(), [campaignUrl]);
  const canShowQr = qrValue.length > 0;
  const oneTimeRewardsTotal = useMemo(
    () => (mlm?.promotionHistory ?? []).reduce((sum, item) => sum + Number(item.rewardAmount || 0), 0),
    [mlm?.promotionHistory]
  );
  const recurringBonusHistory = mlm?.recurringBonusHistory ?? [];
  const recurringBonusTotal = useMemo(
    () => {
      const payoutHistoryTotal = (mlm?.bonusPayoutHistory ?? []).reduce((sum, item) => sum + Number(item.payoutAmount || 0), 0);
      if (payoutHistoryTotal > 0) return payoutHistoryTotal;
      return recurringBonusHistory.reduce((sum, item) => sum + Number(item.bonusAmount || 0), 0);
    },
    [mlm?.bonusPayoutHistory, recurringBonusHistory]
  );
  const nextLevelCode = useMemo(() => {
    if (!levelCodeOrder.length) return "Lv1";
    if (!mlm?.currentLevel) return levelCodeOrder[0] ?? "Lv1";
    const currentIndex = levelCodeOrder.indexOf(mlm.currentLevel);
    if (currentIndex < 0) return levelCodeOrder[0] ?? "Lv1";
    return levelCodeOrder[Math.min(currentIndex + 1, levelCodeOrder.length - 1)] ?? mlm.currentLevel;
  }, [levelCodeOrder, mlm?.currentLevel]);
  const nextLevelRequirement = levelRequirements[nextLevelCode] ?? null;
  const currentLevelRequirement = mlm?.currentLevel ? levelRequirements[mlm.currentLevel] ?? null : null;
  const qualifiedDirectCount = useMemo(() => {
    if (!mlm || !nextLevelRequirement) return 0;
    switch (nextLevelRequirement.directLevelCode) {
      case "Lv1":
        return mlm.positionStatus?.directLv1Count ?? mlm.summary.directEligibleMembers;
      case "Lv7":
        return mlm.positionStatus?.directLv7Count ?? 0;
      case "Lv8":
        return mlm.positionStatus?.directLv8Count ?? 0;
      case "Lv9":
        return mlm.positionStatus?.directLv9Count ?? 0;
      default:
        return mlm.summary.directEligibleMembers;
    }
  }, [mlm, nextLevelRequirement]);
  const lastSyncLabel = primary?.updatedAt
    ? `Last updated ${formatDateTime(primary.updatedAt)}`
    : undefined;
  const recurringBonusLabel = nextLevelRequirement
    ? `${nextLevelCode} recurring ${nextLevelRequirement.bonusPercent.toFixed(2)}% every 10 days`
    : "Top level reached";
  const currentLevelImage = getLevelImageSrc(mlm?.currentLevel, mlm?.currentLevelRank);
  const currentLevelLabel = getLevelLabel(mlm?.currentLevel, mlm?.currentLevelRank);

  const copyToClipboard = useCallback(async (value: string, target: "code" | "url") => {
    if (!value) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.top = "-1000px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyState(target);
      window.setTimeout(() => setCopyState(null), 2000);
    } catch (err) {
      console.error("Failed to copy referral data", err);
    }
  }, []);

  const shareReferral = useCallback(async () => {
    const shareUrl = campaignUrl || window.location.href;
    const shareText = `Join my Primerica referral team with code ${referralCode}`;
    setShareError(null);

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Primerica Referral",
          text: shareText,
          url: shareUrl,
        });
        return;
      }

      setIsShareSheetOpen(true);
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        setShareError("Sharing is not available right now.");
      }
    }
  }, [campaignUrl, referralCode]);

  const shareLinks = useMemo(() => {
    const shareUrl = campaignUrl || (typeof window !== "undefined" ? window.location.href : "");
    const shareText = `Join my Primerica referral team with code ${referralCode}`;
    return [
      {
        label: "WhatsApp",
        href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`,
        icon: (
          <path d="M16.6 13.4c-.3-.2-1.8-.9-2-.9-.3-.1-.5-.1-.7.2s-.8.9-.9 1c-.2.2-.3.2-.6.1-.3-.2-1.1-.4-2.1-1.3-.8-.7-1.3-1.5-1.5-1.8-.2-.3 0-.5.1-.6l.5-.5c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5s-.7-1.7-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.7.3-.2.2-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.8 4.4 3.9.6.3 1.1.5 1.5.6.6.2 1.2.2 1.7.1.5-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.2-.6-.4Z" />
        ),
      },
      {
        label: "Telegram",
        href: `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
        icon: (
          <>
            <path d="M21 4 3 11l7 2 2 7 9-16Z" />
            <path d="m10 13 6-6" />
          </>
        ),
      },
      {
        label: "X",
        href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
        icon: (
          <>
            <path d="m4 4 16 16" />
            <path d="M20 4 4 20" />
          </>
        ),
      },
      {
        label: "LinkedIn",
        href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
        icon: (
          <>
            <path d="M7 9v8" />
            <path d="M11 12v5" />
            <path d="M11 12a3 3 0 0 1 6 0v5" />
            <path d="M7 6h.01" />
          </>
        ),
      },
    ];
  }, [campaignUrl, referralCode]);

  const hasMetrics = metrics.length > 0;
  const hasHistory = history.length > 0;
  const totalInvitesMetric = metrics.find((item) => item.key === "totalInvites");
  const totalInvitesValue =
    String(mlm?.summary.teamTotalMembers ?? totalInvitesMetric?.formattedValue ?? dashboard?.referrals?.length ?? 0);
  const directInvitesValue = String(mlm?.summary.directTotalMembers ?? dashboard?.referrals?.length ?? 0);
  const bonusPayoutHistory = mlm?.bonusPayoutHistory?.length ? mlm.bonusPayoutHistory : recurringBonusHistory;
  const mobileTreeNodes = useMemo(() => {
    const nodes = mlm?.tree.nodes ?? [];
    if (!nodes.length) return [];

    const rootNode =
      nodes.find((node) => node.isRoot) ??
      (mlm?.tree.rootUserId ? nodes.find((node) => node.id === mlm.tree.rootUserId) : undefined) ??
      nodes[0];

    const children = nodes
      .filter((node) => node.pid === rootNode?.id)
      .sort((a, b) => a.id - b.id)
      .slice(0, 2);

    const preview = [rootNode, ...children].filter(Boolean);
    preview.push({
      id: -1,
      name: "Invite",
      email: "",
      levelCode: null,
      levelRank: 0,
      status: "invite",
      walletBalance: "0",
      directCount: 0,
      depth: 0,
      eligible: false,
      isRoot: false,
    });

    return preview.slice(0, 4);
  }, [mlm?.tree.nodes, mlm?.tree.rootUserId]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-3 text-slate-100 sm:space-y-6 sm:px-4 xl:px-6">
      <section className="space-y-4 text-[13px] lg:hidden">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/app")}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--accent-yellow)]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18 9 12l6-6" />
              </svg>
            </button>
            <div className="text-[1.35rem] font-bold text-[var(--accent-yellow)]">Referrals</div>
          </div>          
        </header>

        <div>          
          <div className="mt-2 text-[1.8rem] font-black uppercase leading-[0.9] text-white">
            Invite Friends.
            <br />
            <span className="text-[var(--accent-yellow)]">Earn Crypto.</span>
          </div>
        </div>

        <section className="space-y-3">          
          <div className="rounded-[22px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,#171b20_0%,#14181d_100%)] p-4">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[#d5c59c]">Referral ID</div>
            <div className="mt-3 rounded-[16px] bg-[#0f1318] p-3">
              <div className="break-all text-[1rem] font-extrabold tracking-[0.02em] text-[var(--accent-yellow)]">{referralCode}</div>
            </div>
            <div className="mt-3 rounded-[16px] bg-[#0f1318] p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Invite link</div>
              <div className="mt-2 break-all text-[0.92rem] font-semibold text-white">{campaignUrl || referralCode}</div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <button type="button" onClick={() => copyToClipboard(referralCode, "code")} className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-[#171b20] text-[#d9cfb3]">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M8 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V7Zm-4 4a2 2 0 0 1 2-2v8a4 4 0 0 0 4 4h6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10Z" /></svg>
                <span className="ml-2 text-[11px] font-semibold">{copyState === "code" ? "Copied" : "Copy ID"}</span>
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard(campaignUrl || referralCode, "url")}
                className="flex min-h-10 items-center justify-center gap-2 rounded-[12px] bg-[#171b20] px-3 text-[#d9cfb3]"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 1 0-7.07-7.07L11.4 4.5" />
                  <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L12.6 19.5" />
                </svg>
                <span className="text-[11px] font-semibold">{copyState === "url" ? "Copied" : "Copy link"}</span>
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {campaignUrl ? (
                <>
                  {shareLinks.slice(0, 3).map((item) => (
                    <a
                      key={item.label}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-[var(--border-soft)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[10px] font-semibold text-[var(--text-secondary)]"
                    >
                      {item.label}
                    </a>
                  ))}
                </>
              ) : null}
            </div>
            {shareError ? <div className="mt-2 text-[10px] text-[var(--danger)]">{shareError}</div> : null}
            <button
              type="button"
              onClick={shareReferral}
              className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-[15px] bg-[linear-gradient(180deg,#ffe27a_0%,#fcd535_100%)] px-4 py-3 text-[0.88rem] font-bold text-[#111] shadow-[0_14px_32px_rgba(252,213,53,0.14)]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="m19 5-7 7-7-3-2 2 9 4 9-9z" />
                <path d="M16 5h3v3" />
              </svg>
              Invite Friends Now
            </button>
          </div>
        </section>

        <section className="grid gap-3">
          <div className="rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,#1d2126_0%,#171a1f_100%)] p-3.5 shadow-[0_14px_30px_rgba(252,213,53,0.06)]">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[#d5c59c]">Overall Team Count</div>
            <div className="mt-2 flex items-end justify-between gap-3">
              <div className="text-[1.65rem] font-black leading-none text-white">{totalInvitesValue}</div>
              <div className="rounded-full border border-[rgba(14,203,129,0.22)] bg-[rgba(14,203,129,0.12)] px-2.5 py-1 text-[10px] font-bold text-[var(--success)]">
                {directInvitesValue} direct
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--bg-card)] p-3.5">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">One-time rewards</div>
              <div className="mt-2 whitespace-nowrap text-[1rem] font-bold leading-none text-white">{formatMoneyWithSymbol(oneTimeRewardsTotal)}</div>
              <div className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">{(mlm?.promotionHistory ?? []).length} achieved level rewards</div>
            </div>
            <div className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--bg-card)] p-3.5">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Recurring bonus total</div>
              <div className="mt-2 whitespace-nowrap text-[1rem] font-bold leading-none text-white">{formatMoneyWithSymbol(recurringBonusTotal)}</div>
              <div className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">{bonusPayoutHistory.length} bonus payouts</div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#d5c59c]">Referral Tree</div>
          </div>
          {mlm ? <UnilevelTreeCard tree={mlm.tree} mode="mobile" /> : null}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#d5c59c]">Recent Income</div>
            <div className="text-[11px] text-[var(--text-muted)]">Last 30 Days</div>
          </div>
          <div className="overflow-hidden rounded-[20px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,#1d2126_0%,#171a1f_100%)] shadow-[0_14px_30px_rgba(0,0,0,0.18)]">
            <div className="overflow-x-auto">
              <div className="min-w-[480px]">
                <div className="grid grid-cols-[132px_112px_112px_100px] border-b border-[var(--border-soft)] px-3 py-2.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  <span>Type</span>
                  <span>Source</span>
                  <span className="text-right">Amount</span>
                  <span className="text-right">Status</span>
                </div>
                {hasHistory ? history.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[132px_112px_112px_100px] items-center border-b border-[rgba(255,255,255,0.04)] px-3 py-2.5 text-[10px] text-[var(--text-secondary)] last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold uppercase text-white">{item.incomeType.replace(/_/g, " ")}</div>
                      <div className="mt-0.5 text-[9px] text-[var(--text-muted)]">{formatDateTime(item.date)}</div>
                    </div>
                    <div className="truncate text-[9px] text-[var(--text-secondary)]">
                      {item.sourceUserName || item.sourceUserEmail || item.sourceUserLabel || item.sourceUser || "--"}
                    </div>
                    <div className="text-right font-semibold text-white">+{Number(item.amount).toFixed(2)}</div>
                    <div className="text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${item.status.toLowerCase() === "pending" ? "bg-[rgba(252,213,53,0.14)] text-[var(--warning)]" : "bg-[rgba(14,203,129,0.14)] text-[var(--success)]"}`}>
                        {item.status.toLowerCase() === "pending" ? "Pending" : "Settled"}
                      </span>
                    </div>
                  </div>
                )) : (
                  <div className="px-3 py-4 text-xs text-[var(--text-muted)]">
                    No referral income found yet.
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgba(213,197,156,0.55)]">View All Transactions</div>
        </section>

        {bonusPayoutHistory.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[13px] font-semibold uppercase tracking-[0.16em] text-[#d5c59c]">Bonus Payout History</div>
              <div className="text-[11px] text-[var(--text-muted)]">Live Values</div>
            </div>
            <div className="space-y-2.5">
              {bonusPayoutHistory.slice(0, 4).map((item) => (
                <div
                  key={item.id}
                  className="rounded-[18px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,#171b20_0%,#14181d_100%)] px-3.5 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <LevelBadge levelCode={item.levelCode} levelRank={item.levelRank} size="sm" />
                      <div>
                        <div className="text-[13px] font-semibold text-white">{getLevelLabel(item.levelCode, item.levelRank)}</div>
                        <div className="mt-1 text-[9px] leading-4 text-[var(--text-muted)]">
                          {formatDateTime(item.periodStartedAt)} to {formatDateTime(item.periodEndedAt)}
                        </div>
                      </div>
                    </div>
                    <div className="text-[13px] font-bold text-[var(--accent-yellow)]">{formatMoneyWithSymbol(item.payoutAmount)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {isShareSheetOpen ? (
          <div className="fixed inset-0 z-[95] bg-[rgba(0,0,0,0.72)]">
            <div className="absolute inset-x-0 bottom-0 rounded-t-[28px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,#181a20_0%,#12151a_100%)] p-5 shadow-[0_-20px_60px_rgba(0,0,0,0.45)]">
              <div className="mx-auto h-1.5 w-14 rounded-full bg-[rgba(255,255,255,0.12)]" />
              <div className="mt-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Share Invite</div>
                  <div className="mt-1 text-lg font-bold text-white">Invite your team</div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsShareSheetOpen(false)}
                  className="rounded-full border border-[var(--border-soft)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 rounded-[18px] border border-[var(--border-soft)] bg-[#0f1318] px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Referral Link</div>
                <div className="mt-2 break-all text-sm font-semibold text-[var(--accent-yellow)]">{campaignUrl || referralCode}</div>
              </div>

              <div className="mt-5 grid grid-cols-4 gap-3">
                {shareLinks.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col items-center gap-2 rounded-[18px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.04)] px-2 py-3 text-center"
                  >
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(252,213,53,0.1)] text-[var(--accent-yellow)]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        {item.icon}
                      </svg>
                    </span>
                    <span className="text-[10px] font-semibold text-[var(--text-secondary)]">{item.label}</span>
                  </a>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  copyToClipboard(campaignUrl || referralCode, "url");
                  setIsShareSheetOpen(false);
                }}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-[15px] border border-white/10 bg-[rgba(252,213,53,0.08)] px-4 py-3 text-sm font-semibold text-[var(--accent-yellow)]"
              >
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="currentColor"><path d="M8 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V7Zm-4 4a2 2 0 0 1 2-2v8a4 4 0 0 0 4 4h6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10Z" /></svg>
                Copy Invite Link
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <div className="hidden space-y-4 lg:block xl:space-y-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">Referral Hub</h1>
            {/* <Button variant="ghost" size="xs" onClick={refresh} disabled={loading}>
              Refresh
            </Button> */}
          </div>
          <p className="text-sm text-slate-300/85">
            Track invitation performance, monitor referred trading volume, and share custom campaign links with partners.
          </p>
          {lastSyncLabel && <div className="text-xs text-slate-400 mt-1">{lastSyncLabel}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <Button variant="ghost" size="xs" onClick={refresh} disabled={loading}>
              Refresh
            </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          <span>{error}</span>
          <Button size="xs" variant="ghost" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        {hasMetrics
          ? metrics.map((stat) => {
              const isRewardsCard = stat.key === "rewardsEarned";
              const isRecurringCard = stat.key === "pendingPayout";
              const cardLabel = isRewardsCard
                ? "One-time rewards"
                : isRecurringCard
                ? "Recurring bonus total"
                : stat.label;
              const cardValue = isRewardsCard
                ? formatMoneyWithSymbol(oneTimeRewardsTotal)
                : isRecurringCard
                ? formatMoneyWithSymbol(recurringBonusTotal)
                : stat.formattedValue;
              const cardMeta = isRewardsCard
                ? `${(mlm?.promotionHistory ?? []).length} achieved level rewards`
                : isRecurringCard
                ? `${(mlm?.bonusPayoutHistory ?? []).length} recurring payouts`
                : stat.deltaLabel;

              return (
                <div
                  key={stat.key}
                  className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]"
                >
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-300/65">{cardLabel}</div>
                  <div className="mt-2 break-words text-2xl font-semibold text-white">{cardValue}</div>
                  {cardMeta && (
                    <div
                      className={`mt-auto pt-3 text-xs ${
                        stat.trend === "down" ? "text-rose-300/90" : "text-emerald-300/90"
                      }`}
                    >
                      {cardMeta}
                    </div>
                  )}
                </div>
              );
            })
          : metricSkeletons.map((index) => (
              <div
                key={`metric-placeholder-${index}`}
                className="animate-pulse rounded-3xl border border-white/10 bg-white/4 p-5 backdrop-blur-xl"
              >
                <div className="h-3 w-24 rounded bg-white/10" />
                <div className="mt-4 h-6 w-32 rounded bg-white/20" />
                <div className="mt-2 h-3 w-20 rounded bg-white/10" />
              </div>
            ))}
            <div className="flex h-full flex-col rounded-3xl border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(13,23,48,0.92),rgba(8,47,73,0.72))] p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(34,211,238,0.45)]">
            <div className="text-xs uppercase tracking-[0.16em] text-cyan-100/70">Recurring bonus</div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {currentLevelRequirement ? `${currentLevelRequirement.bonusPercent.toFixed(2)}%` : "--"}
            </div>
            <div className="mt-auto pt-3 text-xs text-cyan-50/75">
              {mlm?.currentLevel ? `${mlm.currentLevel} level bonus` : "- level bonus"}
            </div>
          </div>
      </section>

      {mlm && (
        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/65">Current MLM level</div>
            <div className="mt-3 flex items-center gap-3">
              <div className="h-14 w-14 overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_14px_32px_rgba(0,0,0,0.24)]">
                <img src={currentLevelImage} alt={currentLevelLabel} className="h-full w-full object-cover" />
              </div>
              <div className="text-2xl font-semibold text-white">{currentLevelLabel}</div>
            </div>
            <div className="mt-auto pt-3 text-xs text-slate-400">
              Rank {mlm.currentLevelRank || 0}
              {nextLevelRequirement ? ` | Next target ${nextLevelCode}` : ""}
            </div>
          </div>
          <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/65">
              {nextLevelRequirement?.directLevelCode ? `Qualified directs (${nextLevelRequirement.directLevelCode})` : "Eligible directs"}
            </div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {qualifiedDirectCount}
              {nextLevelRequirement ? (
                <span className="ml-2 text-sm font-medium text-slate-400">/ {nextLevelRequirement.directRequirement}</span>
              ) : null}
            </div>
            <div className="mt-auto pt-3 text-xs text-slate-400">
              {nextLevelRequirement?.directLevelCode
                ? `${nextLevelRequirement.label}`
                : `Wallet balance >= ${formatMoneyWithSymbol(mlm.minimumEligibleBalance)}`}
            </div>
          </div>
          <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/65">Eligible team members</div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {mlm.summary.teamEligibleMembers}
              {nextLevelRequirement ? (
                <span className="ml-2 text-sm font-medium text-slate-400">/ {nextLevelRequirement.teamRequirement}</span>
              ) : null}
            </div>
            <div className="mt-auto pt-3 text-xs text-slate-400">
              Min {formatMoneyWithSymbol(mlm.minimumEligibleBalance)} wallet each
            </div>
          </div>
          <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/65">Next level reward</div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {nextLevelRequirement ? formatMoneyWithSymbol(nextLevelRequirement.promotionRewardUsdt) : "--"}
            </div>
            <div className="mt-auto pt-3 text-xs text-slate-400">{recurringBonusLabel}</div>
          </div>     
        </section>
      )}

      {mlm && <UnilevelTreeCard tree={mlm.tree} />}

      {/* <section className="grid gap-4 lg:grid-cols-[2fr_1fr]"> */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-5 rounded-3xl border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(37,99,235,0.35)] sm:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Your primary referral code</div>
              <div className="break-all text-2xl font-semibold tracking-wide text-white">{referralCode}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => copyToClipboard(referralCode, "code")}>
                {copyState === "code" ? "Copied!" : "Copy"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsQrOpen(true)} disabled={!canShowQr}>
                View QR
              </Button>
            </div>
          </div>

          <div className="grid gap-4">       
            <div className="space-y-2">
              <label className="text-xs text-slate-300/75">Campaign URL</label>
              <div className="flex flex-col gap-2 rounded-xl border border-white/15 bg-white/8 px-3 py-2 sm:flex-row sm:items-center">
                <Input readOnly value={campaignUrl} className="min-w-0 border-none bg-transparent text-sm text-white break-all" />
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(campaignUrl, "url")}>
                  {copyState === "url" ? "Copied!" : "Copy URL"}
                </Button>
              </div>
              <div className="text-xs text-slate-400">
                Share the URL directly or embed it in your campaigns.
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.28)] sm:p-6">
          <div className="flex h-full flex-col justify-between gap-5">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Quick share</div>
              <div className="text-lg font-semibold text-white">Distribute your referral link faster</div>
              <p className="text-sm leading-6 text-slate-300/75">
                Copy the code, open the QR, or send your campaign URL directly from one place while keeping the dashboard spacing consistent.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <Button size="sm" onClick={shareReferral} className="w-full">
                Share invite
              </Button>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(campaignUrl || referralCode, "url")} className="w-full">
                {copyState === "url" ? "Copied!" : "Copy campaign URL"}
              </Button>
            </div>
          </div>
        </div>

        <Dialog
          open={isQrOpen}
          onClose={() => setIsQrOpen(false)}
          title="Campaign QR code"
          panelClassName="max-w-lg"
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => copyToClipboard(qrValue, "url")} disabled={!canShowQr}>
                {copyState === "url" ? "Copied!" : "Copy URL"}
              </Button>
              <Button size="sm" onClick={() => setIsQrOpen(false)}>
                Close
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-300/80">
              Scan this QR code to open your referral campaign URL directly.
            </p>
            <div className="flex justify-center rounded-2xl border border-white/10 bg-white p-5">
              {canShowQr ? (
                <QRCodeSVG
                  value={qrValue}
                  size={220}
                  level="M"
                  includeMargin
                  bgColor="#ffffff"
                  fgColor="#111827"
                />
              ) : (
                <div className="flex min-h-[220px] items-center justify-center text-sm text-slate-500">
                  Campaign URL is unavailable.
                </div>
              )}
            </div>
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-400">Campaign URL</div>
              <div className="break-all rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100">
                {qrValue || "Unavailable"}
              </div>
            </div>
          </div>
        </Dialog>

        {/* <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.3)]">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Promotion toggle</div>
            <p className="mt-2 text-sm text-slate-300/80">
              Automatically boost rewards during weekly campaigns to keep traders engaged.
            </p>
            <Button
              variant={promoActive ? "primary" : "secondary"}
              size="sm"
              className="mt-3"
              onClick={() => setPromoActive(!promoActive)}
              disabled={updatingPromo}
            >
              {promotionLabel}
            </Button>
          </div>

          <div className="space-y-2 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.3)] text-sm text-slate-200">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Tier matrix</div>
            {hasTiers ? (
              <ul className="mt-2 space-y-2">
                {tiers.map((row) => (
                  <li key={row.tier} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-white">{row.tier}</span>
                      <span className="text-xs text-slate-300/75">{row.requirementLabel}</span>
                    </div>
                    <div className="text-xs text-emerald-300/90">{row.rewardLabel}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 text-xs text-slate-300/70">No tier data available.</div>
            )}
          </div>
        </aside> */}
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Referral income history</div>
            <p className="text-xs text-slate-300/70">Paginated unilevel income ledger for your referrals and join rewards.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
              Refresh
            </Button>
            <Button variant="ghost" size="sm" onClick={exportCsv} disabled={exporting}>
              {exporting ? "Preparing..." : "Export CSV"}
            </Button>
          </div>
        </div>

        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="min-w-[880px] lg:min-w-0">
            <div className="mb-2 grid grid-cols-[170px_160px_220px_140px_160px_1fr_140px] px-3 text-[11px] uppercase tracking-[0.14em] text-slate-300/70">
              <span>Txn ID</span>
              <span>Income Type</span>
              <span>From User</span>
              <span>Status</span>
              <span>Date</span>
              <span className="text-right">Amount</span>
              <span className="text-right">Balance</span>
            </div>
            <div className="space-y-2 text-sm">
              {historyError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {historyError}
                </div>
              )}
              {historyLoading && !hasHistory ? (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/4 px-4 py-6 text-center text-sm text-slate-300/70">
                  Loading referral income history...
                </div>
              ) : hasHistory ? (
                history.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[170px_160px_220px_140px_160px_1fr_140px] items-center rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-slate-200"
                  >
                    <span className="break-all text-xs text-cyan-300">{item.txnId}</span>
                    <span className="text-xs text-slate-200">{item.incomeType.replace(/_/g, " ").toUpperCase()}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs text-slate-100">
                        {item.sourceUserName || item.sourceUserEmail || item.sourceUserLabel || item.sourceUser || "--"}
                      </span>
                      {(item.sourceUserEmail || item.sourceUser) && (
                        <span className="block truncate text-[11px] text-slate-400">
                          {item.sourceUserEmail || item.sourceUser}
                        </span>
                      )}
                    </span>
                    <span className={`text-xs font-semibold ${statusClassNames[item.status.toLowerCase()] ?? "text-slate-300/80"}`}>
                      {item.status.toUpperCase()}
                    </span>
                    <span className="text-xs text-slate-300/75">{formatDateTime(item.date)}</span>
                    <span className="text-right">{Number(item.amount).toFixed(2)} USDT</span>
                    <span className="text-right text-xs text-emerald-300">{Number(item.newBalance).toFixed(2)} USDT</span>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/4 px-4 py-6 text-center text-sm text-slate-300/70">
                  No referral income found yet.
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-white/10 pt-4 text-sm text-slate-300/80 sm:flex-row sm:items-center sm:justify-between">
            <div>
              Page {historyPagination.page} of {historyPagination.totalPages} · {historyPagination.total} records
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={historyPage <= 1 || historyLoading}
                onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={historyPage >= historyPagination.totalPages || historyLoading}
                onClick={() => setHistoryPage((page) => page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      </section>

      {mlm && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] sm:p-6">
            <div className="mb-4 text-sm font-semibold text-white">Promotion History</div>
            <div className="space-y-2">
              {mlm.promotionHistory.length ? (
                mlm.promotionHistory.map((item) => (
                  <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <LevelBadge levelCode={item.levelCode} levelRank={item.levelRank} size="sm" />
                        <span>{getLevelLabel(item.levelCode, item.levelRank)}</span>
                      </div>
                      <span>{formatMoneyWithSymbol(item.rewardAmount)}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{formatDateTime(item.achievedAt)}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/4 px-4 py-6 text-center text-sm text-slate-300/70">
                  No promotion rewards yet.
                </div>
              )}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] sm:p-6">
            <div className="mb-4 text-sm font-semibold text-white">Bonus Payout History</div>
            <div className="space-y-2">
              {mlm.bonusPayoutHistory.length ? (
                mlm.bonusPayoutHistory.map((item) => (
                  <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <LevelBadge levelCode={item.levelCode} levelRank={item.levelRank} size="sm" />
                        <span>{getLevelLabel(item.levelCode, item.levelRank)}</span>
                      </div>
                      <span>{formatMoneyWithSymbol(item.payoutAmount)}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {formatDateTime(item.periodStartedAt)} to {formatDateTime(item.periodEndedAt)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/15 bg-white/4 px-4 py-6 text-center text-sm text-slate-300/70">
                  No recurring MLM bonus payouts yet.
                </div>
              )}
            </div>
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
