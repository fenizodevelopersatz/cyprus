import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import Button from "../../../ui/Button";
import Dialog from "../../../ui/Dialog";
import UnilevelTreeCard from "../../referrals/components/UnilevelTreeCard";
import {
  exportAdminReferralCsv,
  fetchAdminReferralDashboard,
  fetchAdminReferralIncomeHistory,
  fetchAdminUsers,
} from "../api/admin.api";
import { formatMoneyWithSymbol } from "../../../utils/money";
import { getLevelImageSrc, getLevelLabel } from "../../../utils/levelImages";

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "--";
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
};

const statusClassNames: Record<string, string> = {
  rewarded: "text-emerald-300",
  verified: "text-indigo-300",
  pending: "text-amber-200",
  success: "text-emerald-300",
};

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function AdminReferralDetailPage() {
  const navigate = useNavigate();
  const { userId = "" } = useParams();
  const numericUserId = Number(userId);
  const [historyPage, setHistoryPage] = useState(1);
  const [copyState, setCopyState] = useState<"code" | "url" | null>(null);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const userQuery = useQuery({
    queryKey: ["admin", "referrals", "user-summary", numericUserId],
    queryFn: async () => {
      const response = await fetchAdminUsers({ search: String(numericUserId), page: 1, limit: 50 });
      return response.items.find((item) => String(item.id) === String(numericUserId)) ?? null;
    },
    enabled: Number.isFinite(numericUserId) && numericUserId > 0,
  });

  const dashboardQuery = useQuery({
    queryKey: ["admin", "referrals", "dashboard", numericUserId],
    queryFn: () => fetchAdminReferralDashboard(numericUserId),
    enabled: Number.isFinite(numericUserId) && numericUserId > 0,
  });

  const historyQuery = useQuery({
    queryKey: ["admin", "referrals", "history", numericUserId, historyPage],
    queryFn: () => fetchAdminReferralIncomeHistory(numericUserId, { page: historyPage, limit: 10 }),
    enabled: Number.isFinite(numericUserId) && numericUserId > 0,
  });

  const dashboard = dashboardQuery.data;
  const history = historyQuery.data?.items ?? [];
  const historyPagination = historyQuery.data?.pagination ?? { page: 1, totalPages: 1, total: 0, limit: 10 };
  const mlm = dashboard?.mlm;
  const primary = dashboard?.primaryCode;
  const fallbackReferralCode = userQuery.data?.referralCode?.trim() || "";
  const fallbackReferralUrl =
    userQuery.data?.referralUrl?.trim() ||
    (fallbackReferralCode && typeof window !== "undefined"
      ? `${window.location.origin}/invite/${encodeURIComponent(fallbackReferralCode)}`
      : "");
  const referralCode = primary?.code?.trim() || fallbackReferralCode || "--";
  const campaignUrl = primary?.url?.trim() || fallbackReferralUrl || "";
  const qrValue = campaignUrl.trim();
  const canShowQr = qrValue.length > 0;
  const metrics = dashboard?.metrics ?? [];

  const currentLevelImage = getLevelImageSrc(mlm?.currentLevel, mlm?.currentLevelRank);
  const currentLevelLabel = getLevelLabel(mlm?.currentLevel, mlm?.currentLevelRank);

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

  const nextLevelCode = useMemo(() => {
    if (!levelCodeOrder.length) return "Lv1";
    if (!mlm?.currentLevel) return levelCodeOrder[0] ?? "Lv1";
    const currentIndex = levelCodeOrder.indexOf(mlm.currentLevel);
    if (currentIndex < 0) return levelCodeOrder[0] ?? "Lv1";
    return levelCodeOrder[Math.min(currentIndex + 1, levelCodeOrder.length - 1)] ?? mlm.currentLevel;
  }, [levelCodeOrder, mlm?.currentLevel]);

  const nextLevelRequirement = levelRequirements[nextLevelCode] ?? null;
  const currentLevelRequirement = mlm?.currentLevel ? levelRequirements[mlm.currentLevel] ?? null : null;

  const oneTimeRewardsTotal = useMemo(
    () => (mlm?.promotionHistory ?? []).reduce((sum, item) => sum + Number(item.rewardAmount || 0), 0),
    [mlm?.promotionHistory]
  );

  const recurringBonusTotal = useMemo(
    () => (mlm?.bonusPayoutHistory ?? []).reduce((sum, item) => sum + Number(item.payoutAmount || 0), 0),
    [mlm?.bonusPayoutHistory]
  );

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

  const recurringBonusLabel = nextLevelRequirement
    ? `${nextLevelCode} recurring ${nextLevelRequirement.bonusPercent.toFixed(2)}% every 10 days`
    : "Top level reached";

  const copyToClipboard = useCallback(async (value: string, target: "code" | "url") => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopyState(target);
    window.setTimeout(() => setCopyState(null), 1800);
  }, []);

  const exportCsv = useCallback(async () => {
    if (!numericUserId) return;
    setExporting(true);
    try {
      const blob = await exportAdminReferralCsv(numericUserId);
      downloadBlob(blob, `admin-referrals-${numericUserId}.csv`);
    } finally {
      setExporting(false);
    }
  }, [numericUserId]);

  if (!Number.isFinite(numericUserId) || numericUserId <= 0) {
    return <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-6 text-rose-100">Invalid referral user ID.</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/referrals")}>
          Back to Referral Users
        </Button>
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Admin Referrals</div>
          <h2 className="text-2xl font-semibold text-white">
            Referral Hub for {userQuery.data?.displayName || userQuery.data?.name || userQuery.data?.email || `User #${numericUserId}`}
          </h2>
        </div>
      </header>

      {dashboardQuery.isLoading ? (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-slate-300">Loading referral hub...</div>
      ) : dashboardQuery.error ? (
        <div className="rounded-3xl border border-rose-500/20 bg-rose-500/10 p-6 text-rose-100">
          {dashboardQuery.error instanceof Error ? dashboardQuery.error.message : "Failed to load referral hub."}
        </div>
      ) : dashboard ? (
        <>
          <section className="rounded-3xl border border-white/10 bg-white/6 p-6 shadow-[0_25px_80px_-45px_rgba(37,99,235,0.35)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="text-xl font-semibold text-white">Referral Hub</div>
                <p className="mt-1 text-sm text-slate-300/75">
                  Track invitation performance, monitor referred trading volume, and inspect the selected user referral network from admin.
                </p>
                <div className="mt-2 text-xs text-slate-400">
                  User #{numericUserId}
                  {primary?.updatedAt ? ` | Last updated ${formatDateTime(primary.updatedAt)}` : ""}
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void dashboardQuery.refetch()}>
                Refresh
              </Button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                label={metrics.find((item) => item.key === "totalInvites")?.label || "Total invites"}
                value={String(mlm?.summary.teamTotalMembers ?? metrics.find((item) => item.key === "totalInvites")?.formattedValue ?? 0)}
                helper={metrics.find((item) => item.key === "totalInvites")?.deltaLabel || undefined}
              />
              <MetricTile label="One-time rewards" value={formatMoneyWithSymbol(oneTimeRewardsTotal)} helper={`${mlm?.promotionHistory.length ?? 0} achieved level rewards`} />
              <MetricTile label="Recurring bonus total" value={formatMoneyWithSymbol(recurringBonusTotal)} helper={`${mlm?.bonusPayoutHistory.length ?? 0} recurring payouts`} />
              <MetricTile
                label="Recurring bonus"
                value={currentLevelRequirement ? `${currentLevelRequirement.bonusPercent.toFixed(2)}%` : "--"}
                helper={mlm?.currentLevel ? `${mlm.currentLevel} level bonus` : "- level bonus"}
                accent
              />
            </div>

            {mlm ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricTile
                  label="Current MLM level"
                  value={currentLevelLabel}
                  helper={`Rank ${mlm.currentLevelRank || 0}${nextLevelRequirement ? ` | Next target ${nextLevelCode}` : ""}`}
                  media={<img src={currentLevelImage} alt={currentLevelLabel} className="h-14 w-14 rounded-2xl object-cover" />}
                />
                <MetricTile
                  label={nextLevelRequirement?.directLevelCode ? `Qualified directs (${nextLevelRequirement.directLevelCode})` : "Eligible directs"}
                  value={nextLevelRequirement ? `${qualifiedDirectCount} / ${nextLevelRequirement.directRequirement}` : String(qualifiedDirectCount)}
                  helper={nextLevelRequirement?.label || `Wallet balance >= ${formatMoneyWithSymbol(mlm.minimumEligibleBalance)}`}
                />
                <MetricTile
                  label="Eligible team members"
                  value={nextLevelRequirement ? `${mlm.summary.teamEligibleMembers} / ${nextLevelRequirement.teamRequirement}` : String(mlm.summary.teamEligibleMembers)}
                  helper={`Min ${formatMoneyWithSymbol(mlm.minimumEligibleBalance)} wallet each`}
                />
                <MetricTile
                  label="Next level reward"
                  value={nextLevelRequirement ? formatMoneyWithSymbol(nextLevelRequirement.promotionRewardUsdt) : "--"}
                  helper={recurringBonusLabel}
                />
              </div>
            ) : null}
          </section>

          {mlm ? <UnilevelTreeCard tree={mlm.tree} /> : null}

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="space-y-5 rounded-3xl border border-white/10 bg-white/6 p-4 shadow-[0_25px_80px_-45px_rgba(37,99,235,0.35)] sm:p-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Primary referral code</div>
                  <div className="break-all text-2xl font-semibold tracking-wide text-white">{referralCode}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void copyToClipboard(referralCode, "code")}>
                    {copyState === "code" ? "Copied!" : "Copy"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setIsQrOpen(true)} disabled={!canShowQr}>
                    View QR
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-slate-300/75">Campaign URL</label>
                <div className="flex flex-col gap-2 rounded-xl border border-white/15 bg-white/8 px-3 py-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 break-all text-sm text-white">{campaignUrl || "--"}</div>
                  <Button variant="ghost" size="sm" onClick={() => void copyToClipboard(campaignUrl, "url")} disabled={!campaignUrl}>
                    {copyState === "url" ? "Copied!" : "Copy URL"}
                  </Button>
                </div>
                <div className="text-xs text-slate-400">Admin can copy the selected user campaign URL directly from here.</div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/6 p-4 shadow-[0_25px_80px_-45px_rgba(79,70,229,0.28)] sm:p-6">
              <div className="flex h-full flex-col justify-between gap-5">
                <div className="space-y-2">
                  <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Quick actions</div>
                  <div className="text-lg font-semibold text-white">Review and export referral data faster</div>
                  <p className="text-sm leading-6 text-slate-300/75">
                    Copy the referral code, inspect the QR, or export the current user referral history for audit and support workflows.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                  <Button size="sm" className="w-full" onClick={() => void dashboardQuery.refetch()}>
                    Refresh referral hub
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => void exportCsv()} disabled={exporting}>
                    {exporting ? "Preparing..." : "Export CSV"}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/6 p-4 shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Referral income history</div>
                <p className="text-xs text-slate-300/70">Paginated unilevel income ledger for the selected user referrals and join rewards.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => void historyQuery.refetch()}>
                  Refresh
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void exportCsv()} disabled={exporting}>
                  {exporting ? "Preparing..." : "Export CSV"}
                </Button>
              </div>
            </div>

            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <div className="min-w-[880px]">
                <div className="mb-2 grid grid-cols-[170px_160px_220px_140px_160px_140px_140px] px-3 text-[11px] uppercase tracking-[0.14em] text-slate-300/70">
                  <span>Txn ID</span>
                  <span>Income Type</span>
                  <span>From User</span>
                  <span>Status</span>
                  <span>Date</span>
                  <span className="text-right">Amount</span>
                  <span className="text-right">Balance</span>
                </div>

                <div className="space-y-2 text-sm">
                  {historyQuery.isLoading ? (
                    <div className="rounded-xl border border-dashed border-white/15 bg-white/4 px-4 py-6 text-center text-sm text-slate-300/70">
                      Loading referral income history...
                    </div>
                  ) : history.length > 0 ? (
                    history.map((item) => (
                      <div
                        key={item.id}
                        className="grid grid-cols-[170px_160px_220px_140px_160px_140px_140px] items-center rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-slate-200"
                      >
                        <span className="break-all text-xs text-cyan-300">{item.txnId}</span>
                        <span className="text-xs text-slate-200">{item.incomeType.replace(/_/g, " ").toUpperCase()}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs text-slate-100">
                            {item.sourceUserName || item.sourceUserEmail || item.sourceUserLabel || item.sourceUser || "--"}
                          </span>
                          {(item.sourceUserEmail || item.sourceUser) && (
                            <span className="block truncate text-[11px] text-slate-400">{item.sourceUserEmail || item.sourceUser}</span>
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
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 text-sm text-slate-300/80 sm:flex-row sm:items-center sm:justify-between">
              <div>
                Page {historyPagination.page} of {historyPagination.totalPages} - {historyPagination.total} records
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={historyPage <= 1 || historyQuery.isFetching}
                  onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={historyPage >= historyPagination.totalPages || historyQuery.isFetching}
                  onClick={() => setHistoryPage((page) => page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </section>

          {mlm ? (
            <section className="grid gap-4 lg:grid-cols-2">
              <HistoryCard
                title="Promotion History"
                emptyMessage="No promotion rewards yet."
                items={mlm.promotionHistory.map((item) => ({
                  id: item.id,
                  levelCode: item.levelCode,
                  levelRank: item.levelRank,
                  amountLabel: formatMoneyWithSymbol(item.rewardAmount),
                  dateLabel: formatDateTime(item.achievedAt),
                }))}
              />
              <HistoryCard
                title="Bonus Payout History"
                emptyMessage="No recurring MLM bonus payouts yet."
                items={mlm.bonusPayoutHistory.map((item) => ({
                  id: item.id,
                  levelCode: item.levelCode,
                  levelRank: item.levelRank,
                  amountLabel: formatMoneyWithSymbol(item.payoutAmount),
                  dateLabel: `${formatDateTime(item.periodStartedAt)} to ${formatDateTime(item.periodEndedAt)}`,
                }))}
              />
            </section>
          ) : null}

          <Dialog
            open={isQrOpen}
            onClose={() => setIsQrOpen(false)}
            title="Campaign QR code"
            panelClassName="max-w-lg"
          >
            <div className="space-y-4">
              <p className="text-sm text-slate-300/80">Scan this QR code to open the selected user referral campaign URL directly.</p>
              <div className="flex justify-center rounded-2xl border border-white/10 bg-white p-5">
                {canShowQr ? (
                  <QRCodeSVG value={qrValue} size={220} level="M" includeMargin bgColor="#ffffff" fgColor="#111827" />
                ) : (
                  <div className="flex min-h-[220px] items-center justify-center text-sm text-slate-500">Campaign URL is unavailable.</div>
                )}
              </div>
              <div className="break-all rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-100">
                {qrValue || "Unavailable"}
              </div>
            </div>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

function MetricTile({
  label,
  value,
  helper,
  accent = false,
  media,
}: {
  label: string;
  value: string;
  helper?: string;
  accent?: boolean;
  media?: ReactNode;
}) {
  return (
    <div className={`rounded-3xl border p-5 ${accent ? "border-cyan-400/20 bg-[linear-gradient(180deg,rgba(13,23,48,0.92),rgba(8,47,73,0.72))]" : "border-white/10 bg-white/6"}`}>
      <div className="text-xs uppercase tracking-[0.16em] text-slate-300/65">{label}</div>
      <div className="mt-3 flex items-center gap-3">
        {media}
        <div className="text-2xl font-semibold text-white">{value}</div>
      </div>
      {helper ? <div className="mt-3 text-xs text-slate-400">{helper}</div> : null}
    </div>
  );
}

function LevelBadge({ levelCode, levelRank }: { levelCode?: string | null; levelRank?: number | null }) {
  const imageSrc = getLevelImageSrc(levelCode, levelRank);
  const label = getLevelLabel(levelCode, levelRank);
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
      <img src={imageSrc} alt={label} className="h-full w-full object-cover" />
    </div>
  );
}

function HistoryCard({
  title,
  emptyMessage,
  items,
}: {
  title: string;
  emptyMessage: string;
  items: Array<{ id: number; levelCode: string; levelRank: number; amountLabel: string; dateLabel: string }>;
}) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/6 p-4 shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] sm:p-6">
      <div className="mb-4 text-sm font-semibold text-white">{title}</div>
      <div className="space-y-2">
        {items.length ? (
          items.map((item) => (
            <div key={item.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <LevelBadge levelCode={item.levelCode} levelRank={item.levelRank} />
                  <span>{getLevelLabel(item.levelCode, item.levelRank)}</span>
                </div>
                <span>{item.amountLabel}</span>
              </div>
              <div className="mt-1 text-xs text-slate-400">{item.dateLabel}</div>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-white/15 bg-white/4 px-4 py-6 text-center text-sm text-slate-300/70">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
