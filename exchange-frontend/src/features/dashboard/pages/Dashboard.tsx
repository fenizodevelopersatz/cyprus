import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../../../ui/Button";
import Dialog from "../../../ui/Dialog";
import { useAuth } from "../../../features/auth/state/auth.store";
import { DEFAULT_SITE_LOGO, useAuthBranding } from "../../../features/auth/branding";
import Marquee from "../../../ui/Marquee";
import { useDashboardData } from "../hooks/useDashboardData";
import { DEFAULT_NEWS, DEFAULT_PROMOTIONS } from "../constants";
import TradingViewChart from "../../exchange/components/TradingViewChart";
import { detectEligiblePackage } from "../../exchange/signal/signal.helpers";
import { getUserProfile } from "../../settings/api/account.api";
import { fetchReferralDashboard, fetchReferralIncomeHistory } from "../../referrals/api/referrals.api";
import { submitTelegramAccessRequest } from "../api/dashboard.api";

const numberFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantityFormatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
const integerFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const formatRelativeTime = (iso?: string) => {
  if (!iso) return "--";
  const published = new Date(iso).getTime();
  if (Number.isNaN(published)) return "--";
  const diffMinutes = Math.max(Math.round((Date.now() - published) / (1000 * 60)), 0);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
};

const formatOrderTime = (iso?: string | null) => {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatShortDateTime = (iso?: string | null) => {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatShortDate = (iso?: string | null) => {
  if (!iso) return "--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
};

const getOrderStatusTone = (status?: string) => {
  const normalized = status?.toUpperCase?.() ?? "";
  return normalized === "OPEN" || normalized === "NEW"
    ? "bg-amber-500/15 text-amber-100"
    : "bg-emerald-500/15 text-emerald-200";
};

const isClosedOrderStatus = (status?: string) => {
  const normalized = String(status ?? "").trim().toUpperCase();
  return normalized === "CLOSED" || normalized === "CLOSE" || normalized === "FILLED" || normalized === "COMPLETED" || normalized === "SUCCESS";
};

const resolveUserLevelImage = (currentLevelRank?: number | null) => {
  const rank = Math.max(0, Math.min(10, Number(currentLevelRank ?? 0) || 0));
  return rank === 0 ? "/level/lv0.jpeg" : `/level/lv${rank}.jpg`;
};

const formatUserLevelBadge = (currentLevelCode?: string | null, currentLevelRank?: number | null) => {
  if (currentLevelCode && String(currentLevelCode).trim()) return String(currentLevelCode).trim().toUpperCase();
  const rank = Number(currentLevelRank ?? 0);
  if (Number.isFinite(rank) && rank > 0) return `Lv${rank}`;
  return "Lv0";
};

const getUserDisplayName = (user?: { name?: string; displayName?: string; email?: string } | null) => {
  const preferred = user?.displayName?.trim() || user?.name?.trim();
  const base = preferred || user?.email || "Trader";
  return base ? `${base.charAt(0).toUpperCase()}${base.slice(1)}` : "Trader";
};

const promotionHighlights: Record<string, string[]> = {
  vaults: ["Auto-compound enabled", "Stable-pair yield focus", "Flexible redemption windows"],
  p2p: ["Merchant-friendly release flow", "Regional routing upgrades", "Lower settlement friction"],
  launchpad: ["Time-sensitive allocation", "Priority whitelist review", "Fast funding handoff"],
  signals: ["Priority signal delivery", "Cleaner entry windows", "Higher-value trade prompts"],
};

const PROMOTION_REWARD_LADDER = [100, 300, 800, 2000, 5000, 12000, 25000, 100000, 200000, 500000, 1000000, 2000000];
const dashboardAssetIconMap: Record<string, string> = {
  BTC: "https://s2.coinmarketcap.com/static/img/coins/64x64/1.png",
  ETH: "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
  BNB: "https://s2.coinmarketcap.com/static/img/coins/64x64/1839.png",
  SOL: "https://s2.coinmarketcap.com/static/img/coins/64x64/5426.png",
  XRP: "https://s2.coinmarketcap.com/static/img/coins/64x64/52.png",
  DOGE: "https://s2.coinmarketcap.com/static/img/coins/64x64/74.png",
  ADA: "https://s2.coinmarketcap.com/static/img/coins/64x64/2010.png",
  TRX: "https://s2.coinmarketcap.com/static/img/coins/64x64/1958.png",
  LTC: "https://s2.coinmarketcap.com/static/img/coins/64x64/2.png",
  TON: "https://s2.coinmarketcap.com/static/img/coins/64x64/11419.png",
  AVAX: "https://s2.coinmarketcap.com/static/img/coins/64x64/5805.png",
};

const achievementMessage =
  "Build a stronger team, grow your investment journey, and unlock more platform rewards as your level rises across the exchange.";

const getOneTimePromotionReward = (levelRank: number) => {
  const normalizedRank = Math.max(0, Math.min(PROMOTION_REWARD_LADDER.length, Number(levelRank) || 0));
  if (normalizedRank === 0) return 0;
  return PROMOTION_REWARD_LADDER[normalizedRank - 1] ?? 0;
};

const getAchievementStarCount = (levelRank: number) => Math.max(0, Math.min(12, Number(levelRank) || 0));

const formatMlmMoney = (amount: number) => `$${numberFormatter.format(amount)}`;

const sumPromotionRewards = (promotionHistory?: Array<{ rewardAmount?: string | number | null }> | null) =>
  (promotionHistory ?? []).reduce((sum, item) => {
    const amount = Number(item?.rewardAmount ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

const sumRecurringBonusRewards = (bonusPayoutHistory?: Array<{ payoutAmount?: string | number | null }> | null) =>
  (bonusPayoutHistory ?? []).reduce((sum, item) => {
    const amount = Number(item?.payoutAmount ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);

type DashboardMlmSnapshot = {
  levelCode: string;
  levelRank: number;
  totalTeamSize: number;
  eligibleTeamSize: number;
  referralReward: number;
  tenDaySalary: number;
  tenDaySalaryNextDueAt?: string | null;
  promotionReward: number;
  birthdayReward: number;
  minimumEligibleBalance: number;
  lastUpdatedAt?: string | null;
};

export default function Dashboard() {
  const user = useAuth((state) => state.user);
  const { siteLogoUrl } = useAuthBranding();
  const { loading, error, summary, orders, tickers, movers, promos, news, baseSymbol, missingResources, refetch } =
    useDashboardData();
  const [achievementOpen, setAchievementOpen] = useState(false);
  const [levelPreviewOpen, setLevelPreviewOpen] = useState(false);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false);
  const [telegramUsernameInput, setTelegramUsernameInput] = useState("");
  const [telegramSubmitting, setTelegramSubmitting] = useState(false);
  const [telegramSubmitError, setTelegramSubmitError] = useState<string | null>(null);
  const [mlmSnapshot, setMlmSnapshot] = useState<DashboardMlmSnapshot>({
    levelCode: "Lv0",
    levelRank: 0,
    totalTeamSize: 0,
    eligibleTeamSize: 0,
    referralReward: 0,
    tenDaySalary: 0,
    tenDaySalaryNextDueAt: null,
    promotionReward: 0,
    birthdayReward: 0,
    minimumEligibleBalance: 300,
    lastUpdatedAt: null,
  });

  const promoBanners = promos.length > 0 ? promos : DEFAULT_PROMOTIONS;
  const newsArticles =
    news.length > 0
      ? news.map((article) => ({ ...article, tag: article.tag ?? article.source, time: formatRelativeTime(article.publishedAt) }))
      : DEFAULT_NEWS.map((article) => ({ ...article, time: formatRelativeTime(article.publishedAt) }));

  const totalEquity = summary?.totalEquity ?? 0;
  const userLevelBadge = mlmSnapshot.levelCode || formatUserLevelBadge(user?.currentLevelCode, user?.currentLevelRank);
  const userLevelImage = resolveUserLevelImage(user?.currentLevelRank);
  const userDisplayName = getUserDisplayName(user);
  const currentLevelRank = Math.max(0, Number(user?.currentLevelRank ?? 0) || 0);
  const achievementStarCount = getAchievementStarCount(mlmSnapshot.levelRank || currentLevelRank);
  const promotionReward = mlmSnapshot.promotionReward;
  const tradingProfit = useMemo(
    () =>
      orders.reduce((sum, order) => {
        if (order.source === "signal" && !isClosedOrderStatus(order.status)) {
          return sum;
        }
        const profit = Number(order.profitAmount ?? 0);
        return sum + (Number.isFinite(profit) ? profit : 0);
      }, 0),
    [orders]
  );
  const achievementInitials = useMemo(() => {
    const source = userDisplayName || user?.email || "U";
    return source
      .split(/\s+/)
      .map((part) => part[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [userDisplayName, user?.email]);
  const telegramAccess = summary?.telegramAccess;
  const telegramApprovalStatus = String(telegramAccess?.approvalStatus || "not_submitted").toLowerCase();
  const telegramApproved = telegramApprovalStatus === "approved";
  const telegramPending = telegramApprovalStatus === "pending";
  const telegramRejected = telegramApprovalStatus === "rejected";
  const finalWalletBalance = summary?.mainWalletBalance ?? totalEquity;
  const effectiveUserLevel = Math.max(0, Number(mlmSnapshot.levelRank || currentLevelRank || 0));
  const dashboardSignalEligibility = detectEligiblePackage(finalWalletBalance, effectiveUserLevel);
  const dailySignalCount = dashboardSignalEligibility.allowedSignalsPerDay;
  const dailySignalValue = String(dailySignalCount);
  const tickerSource = tickers.length > 0 ? tickers : movers;
  const sortableTickers = tickerSource.slice().sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const topMovers = sortableTickers.slice(0, 3);
  if (topMovers.length === 0 && summary?.topMover) topMovers.push({ symbol: summary.topMover.symbol, last: summary.topMover.last, changePct: summary.topMover.changePct, volume: 0 });
  const marqueeItems = tickerSource.length > 0 ? tickerSource : topMovers;
  const btcTicker =
    tickerSource.find((ticker) => ticker.symbol === "BTCUSDT") ||
    movers.find((ticker) => ticker.symbol === "BTCUSDT") ||
    topMovers.find((ticker) => ticker.symbol === "BTCUSDT") ||
    null;
  const baseTicker = tickerSource.find((ticker) => ticker.symbol === baseSymbol) || marqueeItems[0] || summary?.topMover || null;
  const chartSymbol = baseTicker?.symbol || baseSymbol || "BTCUSDT";
  const featuredTicker = btcTicker || topMovers[0] || null;
  const topMoverSublabelClass = featuredTicker?.changePct >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]";
  const topMoverPercentClass = featuredTicker?.changePct >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]";
  const mlmLastUpdatedLabel = mlmSnapshot.lastUpdatedAt ? formatRelativeTime(mlmSnapshot.lastUpdatedAt) : "auto refresh 15s";
  const tenDaySalarySublabel = mlmSnapshot.tenDaySalaryNextDueAt
    ? `Qualify now, first recurring pay after 10 days. Next payout ${formatShortDate(mlmSnapshot.tenDaySalaryNextDueAt)}.`
    : "Qualify now, first recurring pay after 10 days.";
  useEffect(() => {
    let active = true;

    const loadProfilePhoto = async () => {
      try {
        const profile = await getUserProfile();
        if (!active) return;
        setProfilePhotoUrl(profile.profile_photo || null);
      } catch {
        if (!active) return;
        setProfilePhotoUrl(null);
      }
    };

    void loadProfilePhoto();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadReferralMetrics = async () => {
      try {
        const [dashboard, incomeHistory] = await Promise.all([
          fetchReferralDashboard(),
          fetchReferralIncomeHistory({ page: 1, limit: 100 }),
        ]);
        if (!active) return;
        const levelSettings = (dashboard.mlm.levelSettings ?? [])
          .filter((level) => level.isEnabled)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const matchedByRank = levelSettings.find((level) => Number(level.sortOrder) === currentLevelRank);
        const matchedByCode = levelSettings.find(
          (level) => String(level.levelCode || "").trim().toUpperCase() === String(user?.currentLevelCode || "").trim().toUpperCase()
        );

        const reward = matchedByRank?.promotionRewardUsdt ?? matchedByCode?.promotionRewardUsdt ?? getOneTimePromotionReward(currentLevelRank);
        const promotionHistoryTotal = sumPromotionRewards(dashboard.mlm.promotionHistory);
        const recurringBonusHistoryTotal = sumRecurringBonusRewards(dashboard.mlm.bonusPayoutHistory);
        const currentBonusPercent = Number(matchedByRank?.bonusPercent ?? matchedByCode?.bonusPercent ?? 0);
        const currentEligibleTeamBalance = Number(dashboard.mlm.summary?.teamEligibleBalance ?? 0);
        const projectedTenDaySalary = currentBonusPercent > 0 && currentEligibleTeamBalance > 0
          ? (currentEligibleTeamBalance * currentBonusPercent) / 100
          : 0;
        const incomeTotals = incomeHistory.items.reduce(
          (acc, item) => {
            const amount = Number(item.amount || 0);
            if (!Number.isFinite(amount)) return acc;
            if (item.incomeType === "direct_sponsor_commission" || item.incomeType === "joined_commission") acc.referralReward += amount;
            if (item.incomeType === "level_bonus_10day") acc.tenDaySalary += amount;
            if (item.incomeType === "level_promotion_reward") acc.promotionReward += amount;
            if (item.incomeType === "birthday_reward") acc.birthdayReward += amount;
            return acc;
          },
          { referralReward: 0, tenDaySalary: 0, promotionReward: 0, birthdayReward: 0 }
        );

        setMlmSnapshot({
          levelCode: formatUserLevelBadge(dashboard.mlm.currentLevel, dashboard.mlm.currentLevelRank),
          levelRank: Number(dashboard.mlm.currentLevelRank) || currentLevelRank,
          totalTeamSize: Number(dashboard.mlm.summary?.teamTotalMembers) || 0,
          eligibleTeamSize: Number(dashboard.mlm.summary?.teamEligibleMembers) || 0,
          referralReward: incomeTotals.referralReward,
          tenDaySalary: projectedTenDaySalary || recurringBonusHistoryTotal || incomeTotals.tenDaySalary,
          tenDaySalaryNextDueAt: dashboard.mlm.nextBonusDueAt ?? null,
          promotionReward: incomeTotals.promotionReward || promotionHistoryTotal || Number(reward) || 0,
          birthdayReward: incomeTotals.birthdayReward,
          minimumEligibleBalance: Number(dashboard.mlm.minimumEligibleBalance) || 300,
          lastUpdatedAt:
            dashboard.mlm.summary?.lastCalculatedAt ??
            dashboard.mlm.positionStatus?.lastCheckedAt ??
            new Date().toISOString(),
        });
      } catch {
        if (!active) return;
        setMlmSnapshot((prev) => ({
          ...prev,
          levelCode: formatUserLevelBadge(user?.currentLevelCode, user?.currentLevelRank),
          levelRank: currentLevelRank,
          totalTeamSize: 0,
          eligibleTeamSize: 0,
          referralReward: prev.referralReward,
          tenDaySalary: prev.tenDaySalary,
          tenDaySalaryNextDueAt: prev.tenDaySalaryNextDueAt ?? null,
          promotionReward: prev.promotionReward || getOneTimePromotionReward(currentLevelRank),
          birthdayReward: prev.birthdayReward,
          minimumEligibleBalance: prev.minimumEligibleBalance || 300,
          lastUpdatedAt: prev.lastUpdatedAt ?? new Date().toISOString(),
        }));
      }
    };

    void loadReferralMetrics();

    return () => {
      active = false;
    };
  }, [currentLevelRank, tradingProfit, user?.currentLevelCode, user?.currentLevelRank]);

  const handleTelegramAccessClick = async () => {
    if (!telegramAccess?.telegramChannelUrl) return;
    if (telegramApproved) {
      window.open(telegramAccess.telegramChannelUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (telegramPending) return;
    setTelegramSubmitError(null);
    setTelegramUsernameInput((telegramAccess?.telegramUsername || "").replace(/^@/, ""));
    setTelegramDialogOpen(true);
  };

  const handleTelegramSubmit = async () => {
    setTelegramSubmitting(true);
    setTelegramSubmitError(null);
    try {
      await submitTelegramAccessRequest({ telegramUsername: telegramUsernameInput.trim() });
      setTelegramDialogOpen(false);
      refetch();
    } catch (error) {
      setTelegramSubmitError(error instanceof Error ? error.message : "Unable to submit Telegram information.");
    } finally {
      setTelegramSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 overflow-x-hidden">
      <MarketTickerStrip tickers={marqueeItems} />

      <section className="space-y-5 md:hidden">
        <header className="exchange-card exchange-card-strong p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setLevelPreviewOpen(true)}
                className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-yellow)] bg-[rgba(252,213,53,0.12)] transition hover:scale-[1.03] active:scale-[0.98]"
                aria-label={`Open ${userLevelBadge} badge preview`}
              >
                <img src={userLevelImage} alt={userLevelBadge} className="h-full w-full object-cover" />
              </button>
              <div>
                <div className="micro-label text-[10px]">Overview</div>
                <div className="mt-1 text-[1.2rem] font-extrabold text-white">{userDisplayName}</div>
              </div>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setAchievementOpen(true)}>
              Achieve
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link to="/app/funding"><Button size="sm" className="w-full">Deposit</Button></Link>
            <Link to="/app/exchange"><Button size="sm" className="w-full">Trade</Button></Link>
          </div>
        </header>

        {error && <div className="rounded-[14px] border border-[rgba(246,70,93,0.25)] bg-[rgba(246,70,93,0.12)] px-4 py-3 text-[12px] text-[var(--danger)]">{error}</div>}
        {missingResources.length > 0 && (
          <div className="rounded-[14px] border border-[rgba(252,213,53,0.22)] bg-[rgba(252,213,53,0.12)] px-4 py-3 text-[12px] text-[var(--accent-yellow)]">
            Missing endpoints: {missingResources.join(", ")}
          </div>
        )}

        <section className="grid grid-cols-2 gap-3">
          <MetricCard label="Total Wallet Balance" value={`$${numberFormatter.format(finalWalletBalance)}`} valueClassName="text-[var(--success)]" compact />
          <MetricCard label="Trading Profit" value={formatMlmMoney(tradingProfit)} valueClassName="text-[var(--success)]" compact />
          <MetricCard label="Referral Reward" value={formatMlmMoney(mlmSnapshot.referralReward)} valueClassName="text-[var(--success)]" compact />
          <MetricCard
            label="Salary / 10 Days"
            value={formatMlmMoney(mlmSnapshot.tenDaySalary)}
            sublabel={tenDaySalarySublabel}
            valueClassName="text-[var(--success)]"
            compact
          />
          <MetricCard label="Promotion Reward" value={formatMlmMoney(mlmSnapshot.promotionReward)} valueClassName="text-[var(--success)]" compact />
          <MetricCard label="Birthday Reward" value={formatMlmMoney(mlmSnapshot.birthdayReward)} valueClassName="text-[var(--success)]" compact />
          <MetricCard
            label="Total Team Size"
            value={
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div>{integerFormatter.format(mlmSnapshot.totalTeamSize)}</div>
                  <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    Total users
                  </div>
                </div>
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1.5 text-right">
                  <div className="text-[12px] font-semibold leading-none text-[var(--success)]">
                    {integerFormatter.format(mlmSnapshot.eligibleTeamSize)}
                  </div>
                  <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.14em] text-emerald-200/80">
                    Eligible team &gt; ${integerFormatter.format(mlmSnapshot.minimumEligibleBalance)}
                  </div>
                </div>
              </div>
            }            
            valueClassName="text-[var(--success)]"
            compact
          />
          <MetricCard
            label="Daily Signal"
            value={dailySignalValue}
            valueClassName="text-[var(--success)]"
            compact
          />
          <MetricCard
            label="Top Mover"
            value={featuredTicker ? `${featuredTicker.symbol}` : "--"}
            sublabel={featuredTicker ? `${featuredTicker.changePct >= 0 ? "+" : ""}${featuredTicker.changePct.toFixed(2)}%` : "--"}
            sublabelClassName={topMoverSublabelClass}
            compact
          />
          <TrackedMarketsCard tickers={marqueeItems} compact />
        </section>

        {telegramAccess ? (
        <section className="exchange-card exchange-card-strong p-4">
          <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="micro-label text-[10px]">Telegram Access</div>
                  <div className="mt-1 text-base font-semibold text-white">Join Telegram Channel</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">Deposit minimum 100 USDT to get access for daily trade signal through the telegram.</p>
                  {dashboardSignalEligibility.package ? (
                    <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                      Eligible count: {dailySignalCount}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0">
                  <EligibilityBadge eligible={Boolean(telegramAccess.isEligible)} />
                </div>
              </div>
              {telegramAccess.telegramChannelUrl ? (
                <>
                  <Button
                    type="button"
                    onClick={() => void handleTelegramAccessClick()}
                    disabled={telegramPending}
                    className="w-full sm:w-auto"
                  >
                    {telegramApproved ? "Open Telegram Channel" : telegramPending ? "Approval Pending" : "Join Telegram Channel"}
                  </Button>
                  {!telegramApproved && telegramAccess.registeredEmail ? (
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {telegramPending
                        ? `Submitted ${telegramAccess.telegramUsername || ""} for manual approval.`
                        : telegramRejected
                        ? `Rejected${telegramAccess.rejectNote ? `: ${telegramAccess.rejectNote}` : ""}.`
                        : "One-time info collection is required before manual approval."}
                    </div>
                  ) : null}
                  {telegramApproved ? (
                    <div className="text-[11px] text-emerald-200">
                      Signal access is live now. Qualify now.
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="exchange-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="section-title text-[1rem]">Market Pulse</div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">{baseTicker ? baseTicker.symbol : baseSymbol}</div>
            </div>
            <div className="text-right text-[12px] text-[var(--text-secondary)]">
              Last <span className="font-semibold text-white">{numberFormatter.format(baseTicker?.last ?? 0)}</span>
            </div>
          </div>
          <div className="mt-3 h-48">
            {!chartSymbol && loading ? (
              <div className="flex h-full items-center justify-center text-[12px] text-[var(--text-muted)]">Loading market data...</div>
            ) : (
              <TradingViewChart symbol={chartSymbol} compact interval="15" />
            )}
          </div>
        </section>

        <div className="exchange-card p-4">
          <div className="section-title text-[1rem]">Quick Actions</div>
          <div className="mt-3 grid gap-2">
            <QuickAction label="Deposit USDT" description="Deposit USDT to activate your account." to="/app/funding" />
            <QuickAction label="Create trade signal" description="Receive signal in Telegram every day." to="/app/settings" />
            <QuickAction label="Start live trade" description="Enter into featured trade for guaranteed profit." to="/app/exchange" />
          </div>
        </div>

        <div className="exchange-card p-4">
          <div className="section-title text-[1rem]">Top Movers</div>
          <div className="mt-3 space-y-2 text-[12px]">
            {topMovers.length === 0 ? (
              <div className="text-[12px] text-[var(--text-muted)]">No market data available.</div>
            ) : (
              topMovers.map((ticker) => (
                <div key={ticker.symbol} className="flex items-center justify-between rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-3 py-2.5">
                  <div>
                    <div className="font-semibold text-white">{ticker.symbol}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">Vol {numberFormatter.format(ticker.volume ?? 0)}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-white">{numberFormatter.format(ticker.last ?? 0)}</div>
                    <div className={ticker.changePct >= 0 ? "text-[10px] text-[var(--success)]" : "text-[10px] text-[var(--danger)]"}>
                      {ticker.changePct >= 0 ? "+" : ""}{ticker.changePct.toFixed(2)}%
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="exchange-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="micro-label text-[10px]">Market intel</div>
              <div className="section-title mt-1 text-[1rem]">Latest crypto headlines</div>
            </div>
            <Link to="/app/markets" className="text-[11px] text-[var(--accent-yellow)] hover:text-[var(--accent-yellow-hover)]">Newsroom</Link>
          </div>
          <div className="mt-4 space-y-3">
            {newsArticles.slice(0, 3).map((article) => (
              <article key={article.id} className="rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-4">
                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  <span className="rounded-lg border border-[var(--border-yellow)] bg-[rgba(252,213,53,0.12)] px-2 py-0.5 text-[var(--accent-yellow)]">{article.tag}</span>
                  <span>{article.time}</span>
                </div>
                <div className="mt-2 text-[0.95rem] font-semibold leading-6 text-white">{article.title}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">{article.summary}</p>
              </article>
            ))}
          </div>
        </div>

        <section className="exchange-card p-4 text-slate-100">
          <div className="mb-3 flex items-center justify-between">
            <div className="section-title text-[1rem]">Recent Orders</div>
            <Link to="/app/orders" className="text-[11px] text-[var(--accent-yellow)]">Manage</Link>
          </div>
          {orders.length === 0 ? (
            <div className="text-[12px] text-[var(--text-muted)]">No order activity yet. Place a trade to see a timeline.</div>
          ) : (
            <div className="mobile-data-stack !grid">
              {orders.slice(0, 4).map((order) => (
                <div key={`mobile-home-${order.id}`} className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-white">{order.symbol}</span>
                    <span className={order.source === "signal" ? `inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${getOrderStatusTone(order.status)}` : order.side === "BUY" ? "badge-success" : "badge-danger"}>
                      {order.source === "signal" ? order.status.toUpperCase?.() ?? order.status : order.side}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
                    <span>Created</span><span className="text-right">{new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{order.source === "signal" ? "Buy / Sell" : "Type"}</span>
                    <span className="text-right">{order.source === "signal" ? `${formatOrderTime(order.buyCreatedAt)} / ${order.sellCreatedAt ? formatOrderTime(order.sellCreatedAt) : "Open"}` : order.type}</span>
                    <span>Qty</span><span className="text-right">{quantityFormatter.format(order.quantity)}</span>
                    <span>Status</span>
                    <span className="text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${getOrderStatusTone(order.status)}`}>
                        {order.status.toUpperCase?.() ?? order.status}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>

      <div className="hidden space-y-4 md:block xl:space-y-5">
      <header className="exchange-card exchange-card-strong p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLevelPreviewOpen(true)}
              className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border-yellow)] bg-[rgba(252,213,53,0.12)] transition hover:scale-[1.03] active:scale-[0.98]"
              aria-label={`Open ${userLevelBadge} badge preview`}
            >
              <img src={userLevelImage} alt={userLevelBadge} className="h-full w-full object-cover" />
            </button>
            <div>
              <div className="micro-label">Overview</div>
              <div className="section-title mt-1"><small>welcome, </small> <strong>{userDisplayName}</strong></div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                Wallet totals refresh automatically so every page stays aligned with your latest exchange balance.
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
                <span className="rounded-full border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-2.5 py-1 text-white">Level {mlmSnapshot.levelRank}</span>
                <span>{mlmLastUpdatedLabel}</span>
              </div>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
            {/* <Button variant="secondary" size="sm" onClick={handleDashboardRefresh}>              
            </Button> */}
            <Button variant="secondary" size="sm" onClick={() => setAchievementOpen(true)}>
              Achieve
            </Button>
            <Link to="/app/funding"><Button size="sm">Deposit</Button></Link>
            <Link to="/app/exchange"><Button size="sm">Trade</Button></Link>            
          </div>
        </div>
      </header>

      {error && <div className="rounded-[14px] border border-[rgba(246,70,93,0.25)] bg-[rgba(246,70,93,0.12)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}
      {missingResources.length > 0 && (
        <div className="rounded-[14px] border border-[rgba(252,213,53,0.22)] bg-[rgba(252,213,53,0.12)] px-4 py-3 text-sm text-[var(--accent-yellow)]">
          Some dashboard endpoints returned 404: {missingResources.join(", ")}. Update your backend routes or adjust `src/app/apiRoutes.ts` to match the live API.
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Wallet Balance" value={`$${numberFormatter.format(finalWalletBalance)}`} valueClassName="text-[var(--success)]" />
        <MetricCard label="Trading Profit" value={formatMlmMoney(tradingProfit)} valueClassName="text-[var(--success)]" />
        <MetricCard label="Referral Reward" value={formatMlmMoney(mlmSnapshot.referralReward)} valueClassName="text-[var(--success)]" />
        <MetricCard
          label="Salary / 10 Days"
          value={formatMlmMoney(mlmSnapshot.tenDaySalary)}
          sublabel={tenDaySalarySublabel}
          valueClassName="text-[var(--success)]"
        />
        <MetricCard label="Promotion Reward" value={formatMlmMoney(mlmSnapshot.promotionReward)} valueClassName="text-[var(--success)]" />
        <MetricCard label="Birthday Reward" value={formatMlmMoney(mlmSnapshot.birthdayReward)} valueClassName="text-[var(--success)]" />
        <MetricCard
          label="Total Team Size"
          value={
            <div className="flex items-end justify-between gap-4">
              <div>
                <div>{integerFormatter.format(mlmSnapshot.totalTeamSize)}</div>
                <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  Total users
                </div>
              </div>
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-right">
                <div className="text-[1rem] font-semibold leading-none text-[var(--success)]">
                  {integerFormatter.format(mlmSnapshot.eligibleTeamSize)}
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-200/80">
                  Eligible team &gt; ${integerFormatter.format(mlmSnapshot.minimumEligibleBalance)}
                </div>
              </div>
            </div>
          }          
          valueClassName="text-[var(--success)]"
        />
        <MetricCard
          label="Daily Signal"
          value={dailySignalValue}
          valueClassName="text-[var(--success)]"
        />
        <MetricCard
          label="24h Top Mover"
          value={
            featuredTicker ? (
              <span className="flex flex-wrap items-baseline gap-2">
                <span>{featuredTicker.symbol}</span>
                <span className={topMoverPercentClass}>
                  {featuredTicker.changePct >= 0 ? "+" : ""}
                  {featuredTicker.changePct.toFixed(2)}%
                </span>
              </span>
            ) : "--"
          }          
          sublabelClassName={topMoverSublabelClass}
        />
        <div className="md:col-span-2 xl:col-span-3">
          <TrackedMarketsCard tickers={marqueeItems} />
        </div>
      </section>

      {telegramAccess ? (
        <section className="exchange-card exchange-card-strong p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="micro-label">Telegram Access</div>
              <div className="mt-1 text-lg font-semibold text-white">Join Telegram Channel</div>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Deposit minimum 100 USDT to get access for daily trade signal through the telegram</p>
              {dashboardSignalEligibility.package ? (
                <div className="mt-2 text-xs text-[var(--text-muted)]">
                  Eligible count: {dailySignalCount}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col items-start gap-3 sm:items-end">
              <EligibilityBadge eligible={Boolean(telegramAccess.isEligible)} />
              {telegramAccess.telegramChannelUrl ? (
                <>
                  <Button type="button" onClick={() => void handleTelegramAccessClick()} disabled={telegramPending}>
                    {telegramApproved ? "Open Telegram Channel" : telegramPending ? "Approval Pending" : "Join Telegram Channel"}
                  </Button>
                  {!telegramApproved ? (
                    <div className="text-xs text-[var(--text-muted)]">
                      {telegramPending
                        ? `Submitted ${telegramAccess.telegramUsername || ""} for manual approval.`
                        : telegramRejected
                        ? `Rejected${telegramAccess.rejectNote ? `: ${telegramAccess.rejectNote}` : ""}.`
                        : "Submit your Telegram username once for admin approval."}
                    </div>
                  ) : null}
                  {telegramApproved ? (
                    <div className="text-xs text-emerald-200">
                      Signal access is live now. Qualify now.
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="exchange-card flex h-full flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="section-title">Market Pulse</div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">{baseTicker ? baseTicker.symbol : baseSymbol} mid-price (live)</div>
            </div>
            <div className="text-right text-sm text-[var(--text-secondary)]">
              Last <span className="font-semibold text-white">{numberFormatter.format(baseTicker?.last ?? 0)}</span>
            </div>
          </div>
          <div className="h-64 flex-1">
            {!chartSymbol && loading ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-muted)]">Loading market data...</div>
            ) : (
              <TradingViewChart symbol={chartSymbol} interval="15" />
            )}
          </div>
        </div>

        <div className="exchange-card flex h-full flex-col p-4">
          <div className="section-title">Quick Actions</div>
          <div className="mt-3 grid flex-1 gap-3">
            <QuickAction label="Deposit USDT" description="Deposit USDT to activate your account." to="/app/funding" />
            <QuickAction label="Create trade signal" description="Receive signal in Telegram every day." to="/app/settings" />
            <QuickAction label="Start live trade" description="Enter into featured trade for guaranteed profit." to="/app/exchange" />
          </div>
        </div>
      </section>

      <section className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="exchange-card flex h-full flex-col p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="micro-label">Promotions</div>
              <div className="section-title mt-1">Opportunities live right now</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                Reference panel for current platform offers, signal access perks, and wallet-growth features.
              </div>
            </div>
            <Link to="/app/markets" className="text-xs text-[var(--accent-yellow)] hover:text-[var(--accent-yellow-hover)]">View all offers</Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {promoBanners.map((banner) => (
              <Link
                key={banner.id}
                to={banner.to ?? "/app/markets"}
                className="flex h-full flex-col rounded-[14px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-4 transition hover:border-[var(--border-yellow)] hover:bg-[rgba(255,255,255,0.04)]"
              >
                <div className={`mb-3 h-1 rounded-full bg-gradient-to-r ${banner.accent ?? "from-[#FCD535] via-[#f0b90b] to-[#7a5b00]"}`} />
                <div className="text-base font-semibold text-white">{banner.title}</div>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{banner.subtitle}</p>
                <div className="mt-3 space-y-1.5">
                  {(promotionHighlights[banner.id as keyof typeof promotionHighlights] ?? [
                    "Featured platform opportunity",
                    "Fast access from dashboard",
                    "Open to eligible users",
                  ]).map((item) => (
                    <div key={item} className="flex items-center gap-2 text-xs text-slate-300/80">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-yellow)]" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-1 text-xs font-semibold text-[var(--accent-yellow)]">{banner.cta}</div>
              </Link>
            ))}
          </div>          
        </div>

        <div className="exchange-card flex min-w-0 h-full flex-col p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="micro-label">Market intel</div>
              <div className="section-title mt-1">Latest crypto headlines</div>
            </div>
            <Link to="/app/markets" className="text-xs text-[var(--accent-yellow)] hover:text-[var(--accent-yellow-hover)]">Newsroom</Link>
          </div>
          <div className="mt-4 space-y-4 sm:max-h-[340px] sm:overflow-y-auto sm:pr-1">
            {newsArticles.map((article) => (
              <article key={article.id} className="rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-4 transition hover:border-[var(--border-yellow)] hover:bg-[rgba(255,255,255,0.04)]">
                <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
                  <span className="rounded-lg border border-[var(--border-yellow)] bg-[rgba(252,213,53,0.12)] px-2 py-0.5 text-[var(--accent-yellow)]">{article.tag}</span>
                  <span>{article.time}</span>
                </div>
                <div className="mt-2 text-base font-semibold text-white">{article.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{article.summary}</p>
                <div className="mt-3 text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">via {article.source}</div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <div className="exchange-card p-4 text-slate-100">
          <div className="mb-3 flex items-center justify-between">
            <div className="section-title">Top Movers</div>
            <Link to="/app/markets" className="text-xs text-[var(--accent-yellow)]">Markets</Link>
          </div>
          <div className="space-y-2 text-sm">
            {topMovers.length === 0 ? (
              <div className="text-sm text-[var(--text-muted)]">No market data available.</div>
            ) : (
              topMovers.map((ticker) => (
                <div key={ticker.symbol} className="flex items-center justify-between rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-3 py-2">
                  <div>
                    <div className="font-semibold text-white">{ticker.symbol}</div>
                    <div className="text-xs text-[var(--text-muted)]">Vol {numberFormatter.format(ticker.volume ?? 0)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium text-white">{numberFormatter.format(ticker.last ?? 0)}</div>
                    <div className={ticker.changePct >= 0 ? "text-xs text-[var(--success)]" : "text-xs text-[var(--danger)]"}>
                      {ticker.changePct >= 0 ? "+" : ""}{ticker.changePct.toFixed(2)}%
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="exchange-card p-4 text-slate-100">
        <div className="mb-3 flex items-center justify-between">
          <div className="section-title">Recent Orders</div>
          <Link to="/app/exchange?symbol=BTCUSDT" className="text-xs text-[var(--accent-yellow)]">Manage orders</Link>
        </div>
        {orders.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)]">No order activity yet. Place a trade to see a timeline.</div>
        ) : (
          <>
            <div className="desktop-data-table overflow-x-auto">
              <table className="data-table min-w-[620px]">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Symbol</th>
                    <th>{orders[0]?.source === "signal" ? "Time Slot" : "Side"}</th>
                    <th>{orders[0]?.source === "signal" ? "Buy / Sell" : "Type"}</th>
                    <th>Qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 6).map((order) => (
                    <tr key={order.id}>
                      <td>{new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="text-white">{order.symbol}</td>
                      <td className={order.source === "signal" ? "text-white" : order.side === "BUY" ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                        {order.source === "signal" ? order.timeSlot ?? "--" : order.side}
                      </td>
                      <td>
                        {order.source === "signal"
                          ? `${formatOrderTime(order.buyCreatedAt)} / ${order.sellCreatedAt ? formatOrderTime(order.sellCreatedAt) : "Open"}`
                          : order.type}
                      </td>
                      <td>{quantityFormatter.format(order.quantity)}</td>
                      <td>
                        <span className={`inline-flex rounded-full px-3 py-1 text-[10px] font-semibold ${getOrderStatusTone(order.status)}`}>
                          {order.status.toUpperCase?.() ?? order.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-data-stack">
              {orders.slice(0, 6).map((order) => (
                <div key={`mobile-${order.id}`} className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-white">{order.symbol}</span>
                    <span className={order.source === "signal" ? `inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${getOrderStatusTone(order.status)}` : order.side === "BUY" ? "badge-success" : "badge-danger"}>
                      {order.source === "signal" ? order.status.toUpperCase?.() ?? order.status : order.side}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
                    <span>Created</span><span className="text-right">{new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>{order.source === "signal" ? "Buy / Sell" : "Type"}</span>
                    <span className="text-right">{order.source === "signal" ? `${formatOrderTime(order.buyCreatedAt)} / ${order.sellCreatedAt ? formatOrderTime(order.sellCreatedAt) : "Open"}` : order.type}</span>
                    <span>Qty</span><span className="text-right">{quantityFormatter.format(order.quantity)}</span>
                    <span>Status</span>
                    <span className="text-right">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${getOrderStatusTone(order.status)}`}>
                        {order.status.toUpperCase?.() ?? order.status}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      </div>

      <Dialog
        open={telegramDialogOpen}
        onClose={() => {
          if (telegramSubmitting) return;
          setTelegramDialogOpen(false);
        }}
        title="Telegram Info Collection"
        panelClassName="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Submit your Telegram username and registered email once. Admin will review it manually, and after approval you will not see this collection popup again.
          </p>
          <div className="rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Registered Email</div>
            <div className="mt-2 text-sm font-medium text-white">{telegramAccess?.registeredEmail || user?.email || "--"}</div>
          </div>
          <label className="block">
            <div className="mb-2 text-xs uppercase tracking-[0.18em] text-[var(--text-muted)]">Telegram Username</div>
            <input
              value={telegramUsernameInput}
              onChange={(event) => setTelegramUsernameInput(event.target.value.replace(/\s+/g, ""))}
              placeholder="@username"
              className="w-full rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-4 py-3 text-sm text-white focus:border-[var(--accent-yellow)] focus:outline-none"
            />
          </label>
          {telegramSubmitError ? (
            <div className="rounded-2xl border border-[rgba(246,70,93,0.25)] bg-[rgba(246,70,93,0.12)] px-4 py-3 text-sm text-[var(--danger)]">
              {telegramSubmitError}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTelegramDialogOpen(false)} disabled={telegramSubmitting}>
              Cancel
            </Button>
            <Button onClick={() => void handleTelegramSubmit()} disabled={telegramSubmitting || telegramUsernameInput.trim().length === 0}>
              {telegramSubmitting ? "Submitting..." : "Submit for Approval"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={achievementOpen}
        onClose={() => setAchievementOpen(false)}
        title="Achievement Card"
        panelClassName="max-w-md border-[#a77a18] bg-[radial-gradient(circle_at_top,rgba(255,215,96,0.2),transparent_20%),linear-gradient(180deg,#070708_0%,#131316_100%)] p-4 sm:p-5"
      >
        <div className="rounded-[30px] border border-[#7b5a10] bg-[radial-gradient(circle_at_top,rgba(255,224,133,0.12),transparent_18%),linear-gradient(180deg,#0d0d10_0%,#060607_100%)] p-3 shadow-[0_0_0_1px_rgba(255,214,79,0.12),0_18px_50px_rgba(0,0,0,0.45)]">
          <div className="relative overflow-hidden rounded-[26px] border border-[#d7b24c] px-4 py-5 text-center">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,rgba(255,214,79,0.08)_18%,transparent_40%,rgba(255,214,79,0.05)_100%)]" />
            <div className="pointer-events-none absolute left-3 top-3 h-10 w-10 border-l-2 border-t-2 border-[#d7b24c]/85" />
            <div className="pointer-events-none absolute right-3 top-3 h-10 w-10 border-r-2 border-t-2 border-[#d7b24c]/85" />
            <div className="pointer-events-none absolute bottom-3 left-3 h-10 w-10 border-b-2 border-l-2 border-[#d7b24c]/85" />
            <div className="pointer-events-none absolute bottom-3 right-3 h-10 w-10 border-b-2 border-r-2 border-[#d7b24c]/85" />

            <div className="relative text-[10px] font-semibold uppercase tracking-[0.32em] text-[#f0d27a]">Achievement unlocked</div>
            <div className="relative mx-auto mt-4 flex h-32 w-32 items-center justify-center rounded-full border-[6px] border-[#f0cf67] bg-[radial-gradient(circle_at_top,rgba(255,215,96,0.16),rgba(16,16,18,0.92))] shadow-[0_0_0_6px_rgba(255,214,79,0.08),0_0_35px_rgba(255,214,79,0.18)]">
              <div className="flex h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-full border-4 border-[#14151a] bg-[#17181d] text-xl font-black text-[#ffd54f]">
                {profilePhotoUrl ? (
                  <img src={profilePhotoUrl} alt={userDisplayName} className="h-full w-full object-cover" />
                ) : (
                  achievementInitials
                )}
              </div>
            </div>

            {achievementStarCount > 0 ? (
              <div className="relative mx-auto mt-3 flex max-w-[220px] flex-wrap items-center justify-center gap-2 rounded-full bg-[linear-gradient(90deg,#22336f,#7a5f1d,#22336f)] px-4 py-1.5 text-[#ffe7a0] shadow-[0_10px_24px_rgba(0,0,0,0.35)]">
                {Array.from({ length: achievementStarCount }).map((_, index) => (
                  <span key={`achievement-star-top-${index}`} className="text-sm leading-none">
                    {"\u2605"}
                  </span>
                ))}
              </div>
            ) : null}

            <div className="relative mt-5 text-[0.9rem] font-semibold uppercase tracking-[0.14em] text-[#f5dc90]">User Name</div>
            <div className="relative mt-2 rounded-2xl border border-[#8a6a1f] bg-[linear-gradient(90deg,rgba(26,38,88,0.78),rgba(45,61,130,0.58))] px-4 py-3 text-lg font-bold text-white">
              {userDisplayName}
            </div>

            <div className="relative mt-5 text-[0.9rem] font-semibold uppercase tracking-[0.14em] text-[#f5dc90]">Current Position Level</div>
            <div className="relative mt-2 text-4xl font-black text-[#ffd54f]">{userLevelBadge}</div>
            <div className="relative mt-1 text-sm font-medium text-[#dcb44a]">
              {currentLevelRank > 0 ? `${currentLevelRank} level manager` : "New member milestone"}
            </div>

            {promotionReward > 0 ? (
              <div className="relative mt-4 text-lg font-bold text-[#f8df93]">
                Promotion Reward <span className="text-[#ff544f]">{promotionReward} USDT</span>
              </div>
            ) : null}

            <p className="relative mt-5 text-sm leading-6 text-[#f2e5b8]">
              {achievementMessage}
            </p>

            <div className="relative mt-4 text-xs uppercase tracking-[0.22em] text-[#a9965c]">
              Primerica Exchange Growth Journey
            </div>
            <div className="relative mt-5 flex items-center justify-between gap-3 border-t border-[#6e5316]/70 pt-3">
              <div className="flex items-center gap-2 rounded-full border border-[#8a6a1f]/80 bg-[rgba(255,214,79,0.06)] px-3 py-1.5">
                <img
                  src={siteLogoUrl || DEFAULT_SITE_LOGO}
                  alt="Primerica Exchange"
                  className="h-5 w-auto max-w-[96px] object-contain"
                  onError={(event) => {
                    event.currentTarget.src = DEFAULT_SITE_LOGO;
                  }}
                />
              </div>
              {achievementStarCount > 0 ? (
                <div className="flex max-w-[160px] flex-wrap items-center justify-end gap-1 rounded-full border border-[#8a6a1f]/80 bg-[rgba(255,214,79,0.06)] px-3 py-1.5 text-[13px] leading-none text-[#f0d27a]">
                  {Array.from({ length: achievementStarCount }).map((_, index) => (
                    <span key={`achievement-star-bottom-${index}`}>{"\u2605"}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={levelPreviewOpen}
        onClose={() => setLevelPreviewOpen(false)}
        title="Level Badge"
        panelClassName="max-w-sm border-[var(--border-yellow)] bg-[linear-gradient(180deg,rgba(10,13,20,0.98)_0%,rgba(19,22,29,0.98)_100%)] p-4 sm:p-5"
      >
        <div className="rounded-[24px] border border-[var(--border-soft)] bg-[radial-gradient(circle_at_top,rgba(252,213,53,0.16),transparent_36%),var(--bg-card-soft)] p-5 text-center">
          <div className="micro-label">Current Level</div>
          <div className="mt-4 flex justify-center">
            <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-[32px] border border-[var(--border-yellow)] bg-[rgba(252,213,53,0.12)] shadow-[0_18px_40px_rgba(0,0,0,0.28)] sm:h-48 sm:w-48">
              <img src={userLevelImage} alt={userLevelBadge} className="h-full w-full object-cover" />
            </div>
          </div>
          <div className="mt-4 text-2xl font-extrabold text-white">{userLevelBadge}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">
            Level {mlmSnapshot.levelRank} member badge
          </div>
        </div>
      </Dialog>
    </div>
  );
}

function MarketTickerStrip({
  tickers,
}: {
  tickers: Array<{ symbol: string; last: number; changePct: number }>;
}) {
  return (
    <section className="overflow-hidden rounded-[20px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,rgba(19,22,29,0.98)_0%,rgba(16,19,24,0.96)_100%)] shadow-[0_12px_30px_rgba(0,0,0,0.22)]">
      <div className="flex items-center gap-3 border-b border-[rgba(255,255,255,0.05)] px-3 py-2.5 sm:px-4">
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.95)]" />
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[var(--text-muted)] sm:text-[11px]">
          Market ticker
        </div>
      </div>
      {tickers.length === 0 ? (
        <div className="px-3 py-3 text-[12px] text-[var(--text-muted)] sm:px-4">No live tickers available.</div>
      ) : (
        <Marquee
          direction="left"
          speed={90}
          className="px-2 py-2 sm:px-3 sm:py-2.5"
        >
          <div className="flex items-center gap-2.5 sm:gap-4">
            {tickers.map((ticker) => (
              <div
                key={ticker.symbol}
                className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--border-soft)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] sm:px-4 sm:text-xs"
              >
                <span className="font-semibold text-white">{ticker.symbol}</span>
                <span className="text-[var(--text-secondary)]">{numberFormatter.format(ticker.last ?? 0)}</span>
                <span className={ticker.changePct >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                  {ticker.changePct >= 0 ? "+" : ""}
                  {ticker.changePct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </Marquee>
      )}
    </section>
  );
}

function MetricCard({
  label,
  value,
  sublabel,
  compact = false,
  sublabelClassName,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  sublabel?: string;
  compact?: boolean;
  sublabelClassName?: string;
  valueClassName?: string;
}) {
  return (
    <div className="exchange-card p-4">
      <div className="micro-label">{label}</div>
      <div className={`mt-2 font-bold ${valueClassName ?? "text-white"} ${compact ? "text-[0.92rem] leading-5" : "text-[clamp(1.08rem,1rem+0.35vw,1.45rem)] leading-tight"}`}>{value}</div>
      {sublabel ? <div className={`mt-1 ${sublabelClassName ?? "text-[var(--text-muted)]"} ${compact ? "text-[11px]" : "text-xs"}`}>{sublabel}</div> : null}
    </div>
  );
}

function TrackedMarketsCard({ tickers, compact = false }: { tickers: Array<{ symbol: string }>; compact?: boolean }) {
  const trackedPairs = tickers
    .map((ticker) => ticker.symbol)
    .filter(Boolean);

  return (
    <div className="exchange-card p-4">
      <div className="micro-label">Available Pairs</div>
      <div
        className={`mt-3 overflow-y-auto pr-1 ${compact ? "max-h-24" : "max-h-32"}`}
      >
        {trackedPairs.length > 0 ? (
          <div className="space-y-2">
            {trackedPairs.map((symbol) => (
              <div
                key={symbol}
                className={`flex items-center gap-2.5 rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card-soft)] px-3 py-2 font-medium text-[var(--success)] ${compact ? "text-[11px]" : "text-xs"}`}
              >
                <DashboardPairIcon symbol={symbol} compact={compact} />
                <span>{symbol}</span>
              </div>
            ))}
          </div>
        ) : (
          <span className={`${compact ? "text-[11px]" : "text-xs"} text-[var(--text-muted)]`}>Waiting for market feed</span>
        )}
      </div>
    </div>
  );
}

function DashboardPairIcon({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const normalized = String(symbol || "").trim().toUpperCase();
  const asset = normalized.replace(/USDT$|USD$|BUSD$|USDC$/, "") || normalized.slice(0, 3) || "C";
  const imageUrl = dashboardAssetIconMap[asset];
  const sizeClass = compact ? "h-5 w-5 text-[9px]" : "h-6 w-6 text-[10px]";

  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt={`${asset} logo`}
        className={`${sizeClass} shrink-0 rounded-full object-cover shadow-[0_6px_16px_rgba(0,0,0,0.22)]`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[rgba(252,213,53,0.1)] font-bold text-[var(--accent-yellow)]`}
    >
      {asset.slice(0, 1)}
    </div>
  );
}

function QuickAction({ label, description, to }: { label: string; description: string; to: string }) {
  return (
    <Link to={to} className="rounded-[12px] border border-[var(--border-soft)] px-3 py-3 text-slate-100 transition hover:border-[var(--border-yellow)]">
      <div className="font-medium text-white">{label}</div>
      <div className="text-xs text-[var(--text-muted)]">{description}</div>
    </Link>
  );
}

function EligibilityBadge({ eligible }: { eligible: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold  tracking-[0.14em] ${
        eligible
          ? "border border-emerald-400/30 bg-emerald-500/12 text-emerald-200"
          : "border border-rose-400/30 bg-rose-500/12 text-rose-200"
      }`}
    >
      {eligible ? "Eligible" : "Not eligible"}
    </span>
  );
}
