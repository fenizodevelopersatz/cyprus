import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import Dialog from "../../../ui/Dialog";
import {
  createStakingPosition,
  fetchStakingOverview,
  fetchStakingEarnings,
  type StakingActivityItem,
  type StakingEarningsReport,
  type StakingOverviewResponse,
  type StakingPool,
  type StakingPosition,
  unstakePosition,
} from "../api/staking.api";

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const rewardFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 4,
  maximumFractionDigits: 8,
});

const formatUsd = (value?: number | null) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "--";
  return currencyFormatter.format(value);
};

const formatCountdown = (seconds?: number) => {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds) || seconds < 0) return "--:--:--";
  const total = Math.max(Math.floor(seconds), 0);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hrs, mins, secs].map((unit) => String(unit).padStart(2, "0")).join(":");
};

const formatRelativeTime = (iso?: string) => {
  if (!iso) return "--";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "--";
  const diffMs = Date.now() - ts;
  const diffMinutes = Math.max(Math.round(diffMs / (1000 * 60)), 0);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

const formatDateTime = (iso?: string | null) => {
  if (!iso) return "Flexible";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "Flexible";
  return new Date(ts).toLocaleString();
};

const formatLockRemaining = (iso?: string | null) => {
  if (!iso) return "Flexible";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "Flexible";
  const diff = ts - Date.now();
  if (diff <= 0) return "Unlock available";
  const minutes = Math.floor(diff / (1000 * 60));
  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error) {
    const maybeAxios = error as { response?: { data?: unknown; statusText?: string } };
    const data = maybeAxios.response?.data;
    if (data !== undefined && data !== null) {
      if (typeof data === "string") return data;
      if (typeof data === "object") {
        if ("message" in data && typeof (data as any).message === "string") return (data as any).message;
        if ("error" in data && typeof (data as any).error === "string") return (data as any).error;
      }
    }
    if (maybeAxios.response?.statusText) return maybeAxios.response.statusText;
  }
  if (error instanceof Error) return error.message;
  return "Request failed";
};

const initialLoaderCls = "flex min-h-[60vh] items-center justify-center text-slate-200";
const EARNINGS_RANGE_OPTIONS = [7, 30, 60, 90] as const;

export default function StakingPage() {
  const [overview, setOverview] = useState<StakingOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null);
  const [stakeAmount, setStakeAmount] = useState("0.00");
  const [autoCompound, setAutoCompound] = useState(true);
  const [stakeModalOpen, setStakeModalOpen] = useState(false);
  const [stakePending, setStakePending] = useState(false);
  const [stakeError, setStakeError] = useState<string | null>(null);
  const [unstakePendingId, setUnstakePendingId] = useState<number | null>(null);
  const [unstakeError, setUnstakeError] = useState<string | null>(null);
  const [earningsModalOpen, setEarningsModalOpen] = useState(false);
  const [earningsRange, setEarningsRange] = useState(30);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState<string | null>(null);
  const [earningsReport, setEarningsReport] = useState<StakingEarningsReport | null>(null);

  const loadOverview = useCallback(
    async (options?: { silent?: boolean }) => {
      if (options?.silent) {
        setReloading(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const payload = await fetchStakingOverview();
        setOverview(payload);
        if (!selectedPoolId && payload.pools.length > 0) {
          setSelectedPoolId(payload.pools[0].id);
          if (payload.pools[0].minAmount) {
            setStakeAmount(payload.pools[0].minAmount);
          }
        }
      } catch (err) {
        setError(getErrorMessage(err));
      } finally {
        if (options?.silent) {
          setReloading(false);
        } else {
          setLoading(false);
        }
      }
    },
    [selectedPoolId]
  );

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!overview?.pools?.length) return;
    if (!selectedPoolId) return;
    const exists = overview.pools.some((pool) => pool.id === selectedPoolId);
    if (!exists) {
      setSelectedPoolId(overview.pools[0].id);
    }
  }, [overview, selectedPoolId]);

  const summary = overview?.summary;
  const pools = overview?.pools ?? [];
  const positions = overview?.positions ?? [];
  const activity = overview?.activity ?? [];
  const earningsSummaryCards = useMemo(() => {
    if (!earningsReport) return [];
    const summary = earningsReport.summary;
    return [
      {
        label: "Total locked (USD)",
        value: formatUsd(summary.totalLockedUsd),
        helper: "Backend price snapshot",
      },
      {
        label: "Realized rewards",
        value: formatUsd(summary.realizedRewardsUsd),
        helper: "Lifecycle payouts",
      },
      {
        label: "Pending rewards",
        value: formatUsd(summary.pendingRewardsUsd),
        helper: "Currently accruing",
      },
      {
        label: "Projected 30d",
        value: formatUsd(summary.projected30dUsd),
        helper: "Projection with APR",
      },
      {
        label: "Daily rewards",
        value: formatUsd(summary.dailyRewardsUsd),
        helper: "USD equivalent",
      },
      {
        label: "Positions",
        value: `${summary.activePositions ?? 0}/${summary.totalPositions ?? 0}`,
        helper: "Active / total",
      },
    ];
  }, [earningsReport]);

  const selectedPool: StakingPool | null = useMemo(() => {
    if (!pools.length) return null;
    if (!selectedPoolId) return pools[0];
    return pools.find((pool) => pool.id === selectedPoolId) ?? pools[0];
  }, [pools, selectedPoolId]);

  const stakeAmountNumeric = useMemo(() => {
    const parsed = parseFloat(stakeAmount);
    return Number.isFinite(parsed) ? parsed : 0;
  }, [stakeAmount]);

  const simulatorDaily = selectedPool ? (stakeAmountNumeric * selectedPool.aprPercent) / 100 / 365 : 0;
  const simulatorThirtyDay = simulatorDaily * 30;

  const handleOpenStakeModal = () => {
    if (!selectedPool) return;
    setStakeError(null);
    setStakeModalOpen(true);
  };

  const handleCloseStakeModal = () => {
    if (stakePending) return;
    setStakeError(null);
    setStakeModalOpen(false);
  };

  const handleStakeSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!selectedPool) return;
    if (!stakeAmount || stakeAmountNumeric <= 0) {
      setStakeError("Enter an amount greater than zero.");
      return;
    }
    setStakePending(true);
    setStakeError(null);
    try {
      await createStakingPosition({
        packageId: selectedPool.id,
        amount: stakeAmount,
        autoCompound,
      });
      await loadOverview({ silent: true });
      setStakeModalOpen(false);
    } catch (err) {
      setStakeError(getErrorMessage(err));
    } finally {
      setStakePending(false);
    }
  };

  const handleUnstake = async (position: StakingPosition) => {
    if (!position.canUnstake) return;
    setUnstakeError(null);
    setUnstakePendingId(position.id);
    try {
      await unstakePosition(position.id);
      await loadOverview({ silent: true });
    } catch (err) {
      setUnstakeError(getErrorMessage(err));
    } finally {
      setUnstakePendingId(null);
    }
  };

  const loadEarnings = useCallback(
    async (rangeOverride?: number) => {
      const targetRange = rangeOverride ?? earningsRange;
      setEarningsLoading(true);
      setEarningsError(null);
      try {
        const payload = await fetchStakingEarnings({ rangeDays: targetRange });
        setEarningsReport(payload);
        setEarningsRange(targetRange);
      } catch (err) {
        setEarningsError(getErrorMessage(err));
      } finally {
        setEarningsLoading(false);
      }
    },
    [earningsRange]
  );

  const openEarningsModal = () => {
    setEarningsModalOpen(true);
    void loadEarnings(earningsRange);
  };

  const closeEarningsModal = () => {
    if (earningsLoading) return;
    setEarningsModalOpen(false);
  };

  const handleEarningsRangeSelect = (range: number) => {
    if (range === earningsRange) {
      void loadEarnings(range);
      return;
    }
    setEarningsRange(range);
    void loadEarnings(range);
  };

  const initialLoading = loading && !overview;

  if (initialLoading) {
    return (
      <div className={initialLoaderCls}>
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-indigo-500/40 bg-indigo-500/10 px-6 py-5 text-sm shadow-lg shadow-indigo-500/30">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
          <div className="text-xs uppercase tracking-[0.32em] text-indigo-100/70">Primerica</div>
          <div className="text-base font-medium text-white">Loading staking data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Staking Hub</h1>
          <p className="text-sm text-slate-300/85">
            Allocate idle assets into Primerica staking pools, monitor rewards, and unlock boosted campaigns.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => loadOverview({ silent: true })} disabled={reloading}>
            {reloading ? "Refreshing..." : "Refresh"}
          </Button>
          <Button variant="secondary" size="sm" onClick={openEarningsModal} disabled={earningsLoading}>
            Rewards &amp; history
          </Button>
          <Button size="sm" onClick={handleOpenStakeModal} disabled={!selectedPool}>
            Stake now
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Total value staked"
          value={summary ? formatUsd(summary.totalValueUsd) : "--"}
          helper="Network TVL across all pools"
        />
        <SummaryCard
          label="Average APR"
          value={
            summary?.averageApr !== undefined
              ? `${percentFormatter.format(summary.averageApr)}%`
              : "--"
          }
          helper="Flexible and fixed pools combined"
        />
        <SummaryCard
          label="Next rewards cycle"
          value={formatCountdown(summary?.nextRewardCycle?.secondsUntil)}
          helper={
            summary?.nextRewardCycle?.intervalHours
              ? `Distributes every ${summary.nextRewardCycle.intervalHours} hours`
              : "Reward cadence unavailable"
          }
        />
        <SummaryCard
          label="Active lockups"
          value={`${summary?.activeLockups ?? 0} positions`}
          helper="Across your subscribed assets"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.35)] space-y-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Available pools</div>
            <p className="text-sm text-slate-300/80">
              Choose a pool to view projected rewards and staking requirements.
            </p>
          </div>
          <div className="space-y-3 max-h-[480px] overflow-auto pr-1">
            {pools.map((pool) => {
              const isActive = selectedPool?.id === pool.id;
              const aprChip = `${percentFormatter.format(pool.aprPercent)}% APR`;
              const lockCopy = pool.lockDays > 0 ? `${pool.lockDays}-day lock` : "Flexible";
              const tvl =
                pool.stats?.totalLockedUsd !== undefined
                  ? formatUsd(pool.stats.totalLockedUsd)
                  : pool.stats?.totalLocked
                  ? `${pool.stats.totalLocked} ${pool.asset}`
                  : "--";
              return (
                <button
                  key={pool.id}
                  type="button"
                  onClick={() => setSelectedPoolId(pool.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    isActive
                      ? "border-indigo-400/60 bg-indigo-500/15 text-white shadow-[0_20px_60px_-40px_rgba(99,102,241,0.6)]"
                      : "border-white/10 bg-white/5 text-slate-300/85 hover:border-indigo-400/40"
                  } ${pool.isFeatured ? "border-sky-400/70" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-white">{pool.label}</div>
                    {pool.status && (
                      <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-200/70">
                        {pool.status}
                      </span>
                    )}
                    {pool.isFeatured && (
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                        Featured
                      </span>
                    )}
                    <span className="ml-auto rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs text-emerald-200">
                      {aprChip}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-300/70">{lockCopy} - TVL {tvl}</div>
                  <div className="mt-2 text-xs text-slate-100/90">{pool.description}</div>
                  {pool.stats?.activePositions !== undefined && (
                    <div className="mt-2 text-[11px] uppercase tracking-[0.2em] text-slate-400/80">
                      {pool.stats.activePositions} active positions
                    </div>
                  )}
                </button>
              );
            })}
            {!pools.length && (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300/80">
                No staking pools are available yet. Configure /api/staking/pools to expose live campaigns.
              </div>
            )}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.3)] space-y-4">
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Stake simulator</div>
              <p className="text-sm text-slate-300/80">Estimate rewards before committing assets.</p>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-300/70">Amount</label>
              <Input
                value={stakeAmount}
                onChange={(event) => setStakeAmount(event.target.value)}
                className="text-sm"
                placeholder="0.00"
              />
            </div>
            <div className="text-xs text-slate-300/70">
              Pool: <span className="text-white font-semibold">{selectedPool?.label ?? "No pool available"}</span>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 space-y-1">
              <div className="flex justify-between">
                <span>Daily rewards</span>
                <span>
                  {selectedPool ? `${rewardFormatter.format(simulatorDaily)} ${selectedPool.asset}` : "--"}
                </span>
              </div>
              <div className="flex justify-between">
                <span>30-day projection</span>
                <span>
                  {selectedPool ? `${rewardFormatter.format(simulatorThirtyDay)} ${selectedPool.asset}` : "--"}
                </span>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300/70">
              <input
                type="checkbox"
                checked={autoCompound}
                onChange={(event) => setAutoCompound(event.target.checked)}
                className="h-4 w-4 rounded border border-white/25 bg-transparent"
              />
              Auto-compound rewards back into the pool (recommended)
            </label>
            <div className="flex gap-3">
              <Button size="sm" onClick={handleOpenStakeModal} disabled={!selectedPool}>
                Stake {selectedPool?.asset ?? ""}
              </Button>
              <Button size="sm" variant="secondary" disabled>
                Unstake
              </Button>
            </div>
            <p className="text-[11px] text-slate-400">
              The simulator provides projected returns using the current APR. Payout cadence can change per cycle.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] space-y-3 text-sm text-slate-200">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Latest activity</div>
            <div className="space-y-2">
              {activity.length === 0 && (
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/80">
                  No staking activity yet. Stake an asset to see confirmations, reward payouts, and unstakes here.
                </div>
              )}
              {activity.map((item) => (
                <ActivityItem key={item.id} item={item} />
              ))}
            </div>
          </div>
        </aside>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(99,102,241,0.35)] space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Active positions</div>
            <p className="text-sm text-slate-300/80">
              Monitor live lockups, accrued rewards, and determine when capital is available for redeployment.
            </p>
          </div>
          {unstakeError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-100">
              {unstakeError}
            </div>
          )}
          <div className="ml-auto text-xs text-slate-400">
            {positions.length} position{positions.length === 1 ? "" : "s"}
          </div>
        </div>

        {positions.length === 0 && (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300/85">
            You do not have any active staking positions. Pick a pool above to start earning rewards.
          </div>
        )}

        <div className="space-y-4">
          {positions.map((position) => {
            const lockTooltip = position.canUnstake ? undefined : formatLockRemaining(position.unlockAt);
            const progress = Math.min(Math.max(position.progressPercent ?? 0, 0), 100);
            return (
              <div
                key={position.id}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{position.asset}</div>
                    <div className="text-2xl font-semibold text-white">{position.amount}</div>
                    <div className="text-xs text-slate-400">
                      {percentFormatter.format(position.aprPercent)}% APR -{" "}
                      {position.lockDays > 0 ? `${position.lockDays}-day lock` : "Flexible"}
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-xs text-slate-400">Daily reward</div>
                    <div className="text-lg font-semibold text-emerald-200">{position.dailyReward}</div>
                    <div className="text-xs text-slate-400">Est. cycle {position.estimatedRewards}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-300/80">
                  <span>Staked {formatDateTime(position.stakedAt)}</span>
                  <span>Unlocks {formatDateTime(position.unlockAt)}</span>
                  <span>Status: {position.status}</span>
                  {position.autoCompound && <span className="text-emerald-300">Auto-compounding</span>}
                  {position.matured && <span className="text-amber-300">Matured</span>}
                </div>
                <div className="mt-3 h-2 rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-300/80">
                  <span>
                    Rewards accrued: <span className="text-white">{position.rewardsAccrued}</span>
                  </span>
                  <span>
                    Rewards paid: <span className="text-white">{position.rewardsPaid}</span>
                  </span>
                  <Button
                    size="sm"
                    variant={position.canUnstake ? "secondary" : "ghost"}
                    className="ml-auto"
                    disabled={!position.canUnstake || unstakePendingId === position.id}
                    title={lockTooltip}
                    onClick={() => handleUnstake(position)}
                  >
                    {unstakePendingId === position.id ? "Processing..." : "Unstake"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Dialog
        open={earningsModalOpen}
        onClose={closeEarningsModal}
        title="Rewards & earnings"
        footer={
          <Button variant="ghost" onClick={closeEarningsModal} disabled={earningsLoading}>
            Close
          </Button>
        }
      >
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm text-slate-200">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300/80">
            <span>Range</span>
            {EARNINGS_RANGE_OPTIONS.map((option) => {
              const isActive = earningsRange === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleEarningsRangeSelect(option)}
                  className={`rounded-full px-3 py-1 transition ${
                    isActive
                      ? "bg-indigo-500/20 text-white border border-indigo-400/50"
                      : "bg-white/5 text-slate-300 border border-white/10 hover:border-indigo-400/40"
                  }`}
                >
                  {option}d
                </button>
              );
            })}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => loadEarnings(earningsRange)}
              disabled={earningsLoading}
            >
              Refresh
            </Button>
            {earningsLoading && <span className="text-emerald-200">Syncing data…</span>}
          </div>
          {earningsError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {earningsError}
            </div>
          )}
          {earningsLoading && !earningsReport && (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
              Fetching earnings report…
            </div>
          )}
          {earningsReport ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                {earningsSummaryCards.map((card) => (
                  <div
                    key={card.label}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-[0.16em] text-slate-400"
                  >
                    <div>{card.label}</div>
                    <div className="mt-1 text-2xl font-semibold normal-case text-white">{card.value}</div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-emerald-300/80">{card.helper}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/80">Breakdown by asset</div>
                {earningsReport.breakdown.length ? (
                  <div className="mt-2 space-y-2">
                    {earningsReport.breakdown.map((entry) => (
                      <div
                        key={entry.asset}
                        className="rounded-xl border border-white/10 bg-white/3 px-3 py-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-white">
                          <span className="font-semibold">{entry.asset}</span>
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-200">
                            {percentFormatter.format(entry.averageApr)}% APR
                          </span>
                          <span className="ml-auto text-slate-300/80">
                            {entry.activePositions} active / {entry.completedPositions} completed
                          </span>
                        </div>
                        <div className="mt-1 grid gap-2 sm:grid-cols-3">
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Principal</div>
                            <div className="text-white">
                              {entry.principal} ({formatUsd(entry.principalUsd)})
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Pending</div>
                            <div className="text-amber-200">
                              {entry.pendingRewards} ({formatUsd(entry.pendingRewardsUsd)})
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Realized</div>
                            <div className="text-emerald-200">
                              {entry.realizedRewards} ({formatUsd(entry.realizedRewardsUsd)})
                            </div>
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-300/80">
                          Daily rewards: {formatUsd(entry.dailyRewardsUsd)}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-300/80">No asset breakdown yet.</div>
                )}
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/80">Realized history</div>
                  <div className="mt-2 max-h-48 overflow-y-auto text-xs text-slate-200">
                    {earningsReport.realizedHistory.points.length ? (
                      earningsReport.realizedHistory.points.slice(-10).map((point) => (
                        <div key={point.date} className="flex items-center justify-between border-b border-white/5 py-1">
                          <span>{new Date(point.date).toLocaleDateString()}</span>
                          <span className="text-emerald-300">{formatUsd(point.realizedRewardsUsd)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-slate-300/80">No payouts in this window.</div>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/80">Recent payouts</div>
                  <div className="mt-2 max-h-48 overflow-y-auto text-xs text-slate-200">
                    {earningsReport.recentPayouts.length ? (
                      earningsReport.recentPayouts.map((payout) => (
                        <div key={`${payout.positionId}-${payout.unstakedAt ?? payout.stakedAt}`} className="border-b border-white/5 py-1">
                          <div className="flex items-center justify-between text-white">
                            <span>Position #{payout.positionId}</span>
                            <span>{formatUsd(payout.rewardsPaidUsd)}</span>
                          </div>
                          <div className="text-slate-400">
                            {payout.asset} • {percentFormatter.format(payout.aprPercent)}% APR
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {formatDateTime(payout.stakedAt)} → {payout.unstakedAt ? formatDateTime(payout.unstakedAt) : "Active"}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-slate-300/80">No payouts in the last cycles.</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-300/80">Price snapshot</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {Object.entries(earningsReport.priceMap).map(([asset, price]) => (
                    <div key={asset} className="rounded-xl border border-white/10 px-3 py-2 text-xs">
                      <div className="text-white">{asset}</div>
                      <div className="text-slate-300/80">{formatUsd(price)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : !earningsLoading ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/80">
              No earnings data available yet. Stake a pool to generate history.
            </div>
          ) : null}
        </div>
      </Dialog>

      <Dialog
        open={stakeModalOpen}
        onClose={handleCloseStakeModal}
        title="Stake assets"
        footer={
          <>
            <Button variant="ghost" onClick={handleCloseStakeModal} disabled={stakePending}>
              Cancel
            </Button>
            <Button onClick={handleStakeSubmit} disabled={stakePending || stakeAmountNumeric <= 0 || !selectedPool}>
              {stakePending ? "Staking..." : "Confirm stake"}
            </Button>
          </>
        }
      >
        {selectedPool ? (
          <form className="space-y-4" onSubmit={handleStakeSubmit}>
            <div className="space-y-2">
              <label className="text-xs text-slate-300/70">Pool</label>
              <select
                value={selectedPool.id}
                onChange={(event) => setSelectedPoolId(Number(event.target.value))}
                className="w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
              >
                {pools.map((pool) => (
                  <option key={pool.id} value={pool.id} className="bg-slate-800 text-white">
                    {pool.label} - {percentFormatter.format(pool.aprPercent)}% APR
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-slate-300/70">Amount</label>
              <Input
                value={stakeAmount}
                onChange={(event) => setStakeAmount(event.target.value)}
                placeholder={selectedPool.minAmount ?? "0.00"}
              />
              {selectedPool.minAmount && (
                <div className="text-[11px] text-slate-400">
                  Minimum: {selectedPool.minAmount} {selectedPool.asset}
                  {selectedPool.maxAmount ? ` - Max ${selectedPool.maxAmount}` : ""}
                </div>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300/70">
              <input
                type="checkbox"
                checked={autoCompound}
                onChange={(event) => setAutoCompound(event.target.checked)}
                className="h-4 w-4 rounded border border-white/25 bg-transparent"
              />
              Auto-compound future rewards
            </label>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/80">
              You are staking {stakeAmount || "0.00"} {selectedPool.asset} into{" "}
              <span className="text-white">{selectedPool.label}</span>. Rewards are credited every{" "}
              {summary?.nextRewardCycle?.intervalHours ?? 12} hours.
            </div>
            {stakeError && (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                {stakeError}
              </div>
            )}
          </form>
        ) : (
          <div className="text-sm text-slate-300/80">
            No staking pool is selected. Please create one in the admin console before staking.
          </div>
        )}
      </Dialog>
    </div>
  );
}

type SummaryCardProps = {
  label: string;
  value: string;
  helper: string;
};

function SummaryCard({ label, value, helper }: SummaryCardProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(99,102,241,0.35)]">
      <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="text-xs text-emerald-300/90">{helper}</div>
    </div>
  );
}

function ActivityItem({ item }: { item: StakingActivityItem }) {
  const action = item.action?.toLowerCase() ?? "";
  const amountCls = action.includes("unstake") ? "text-rose-300" : "text-emerald-300";
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-white">{item.asset}</span>
        <span className="text-xs text-slate-400">{formatRelativeTime(item.timestamp)}</span>
      </div>
      <div className="text-xs text-slate-300/80 capitalize">{item.action}</div>
      <div className={`text-xs ${amountCls}`}>
        {item.amount} {item.rewards ? `| +${item.rewards} rewards` : ""}
      </div>
    </div>
  );
}
