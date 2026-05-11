import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import Dialog from "../../../ui/Dialog";
import {
  createAdminStakingPackage,
  fetchAdminStakingOverview,
  fetchAdminStakingPackages,
  fetchAdminStakingPositions,
  fetchAdminStakingEarnings,
  adminPayoutPosition,
  adminRunStakingPayouts,
  type AdminStakingPackage,
  type CreateAdminStakingPackagePayload,
  type UpdateAdminStakingPackagePayload,
  updateAdminStakingPackage,
} from "../api/admin.api";

const cardCls =
  "rounded-2xl border border-white/10 bg-gradient-to-b from-white/5 to-white/10 p-5 shadow-[0_25px_70px_-45px_rgba(16,185,129,0.5)]";
const pillCls = "text-[11px] uppercase tracking-[0.28em] text-slate-300/80";

const defaultForm: CreateAdminStakingPackagePayload = {
  label: "",
  asset: "BTC",
  aprPercent: 5,
  lockDays: 0,
  minAmount: "",
  maxAmount: "",
  isFeatured: false,
  status: "ACTIVE",
  sortOrder: 10,
  description: "",
};

type EarningsFilterForm = {
  rangeDays: number;
  asset: string;
  userId: string;
  status: string;
};

const createDefaultEarningsFilters = (): EarningsFilterForm => ({
  rangeDays: 30,
  asset: "",
  userId: "",
  status: "",
});

const formatUsd = (value?: number) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return "--";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Number(value)
  );
};

const formatRelative = (iso?: string) => {
  if (!iso) return "--";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "--";
  return new Date(ts).toLocaleString();
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error) {
    const maybeAxios = error as { response?: { data?: unknown; statusText?: string }; message?: string };
    const payload = maybeAxios.response?.data;
    if (payload) {
      if (typeof payload === "string") return payload;
      if (typeof payload === "object") {
        if ("message" in payload && typeof (payload as any).message === "string") return (payload as any).message;
        if ("error" in payload && typeof (payload as any).error === "string") return (payload as any).error;
      }
    }
    if (maybeAxios.message) return maybeAxios.message;
    if (maybeAxios.response?.statusText) return maybeAxios.response.statusText;
  }
  return "Request failed";
};

export default function AdminStakingPage() {
  const queryClient = useQueryClient();
  const [packageStatusFilter, setPackageStatusFilter] = useState<string>("ALL");
  const [positionFilters, setPositionFilters] = useState({
    status: "ACTIVE",
    userId: "",
    packageId: "",
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<AdminStakingPackage | null>(null);
  const [formState, setFormState] = useState<CreateAdminStakingPackagePayload>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [earningsFiltersDraft, setEarningsFiltersDraft] = useState<EarningsFilterForm>(() => createDefaultEarningsFilters());
  const [earningsFilters, setEarningsFilters] = useState<EarningsFilterForm>(() => createDefaultEarningsFilters());
  const [payoutBatchLimit, setPayoutBatchLimit] = useState(50);
  const [activePayoutId, setActivePayoutId] = useState<number | string | null>(null);

  const overviewQuery = useQuery({
    queryKey: ["admin", "staking", "overview"],
    queryFn: fetchAdminStakingOverview,
    refetchInterval: 20_000,
  });

  const packagesQuery = useQuery({
    queryKey: ["admin", "staking", "packages", packageStatusFilter],
    queryFn: () =>
      fetchAdminStakingPackages(
        packageStatusFilter === "ALL" ? undefined : { status: packageStatusFilter || undefined }
      ),
    refetchInterval: 30_000,
  });

  const sanitizedPositionFilters = useMemo(() => {
    return {
      status: positionFilters.status || undefined,
      userId: positionFilters.userId ? Number(positionFilters.userId) : undefined,
      packageId: positionFilters.packageId ? Number(positionFilters.packageId) : undefined,
    };
  }, [positionFilters]);

  const normalizedEarningsFilters = useMemo(() => {
    const rangeDays = Math.min(180, Math.max(7, earningsFilters.rangeDays || 30));
    const filters: { rangeDays: number; asset?: string; userId?: number; status?: string } = { rangeDays };
    const asset = earningsFilters.asset.trim();
    if (asset) filters.asset = asset.toUpperCase();
    const userIdRaw = earningsFilters.userId.trim();
    if (userIdRaw) {
      const parsed = Number(userIdRaw);
      if (!Number.isNaN(parsed)) filters.userId = parsed;
    }
    if (earningsFilters.status) filters.status = earningsFilters.status;
    return filters;
  }, [earningsFilters]);

  const normalizedPayoutLimit = useMemo(
    () => Math.min(500, Math.max(1, Number(payoutBatchLimit) || 50)),
    [payoutBatchLimit]
  );

  const positionsQuery = useQuery({
    queryKey: [
      "admin",
      "staking",
      "positions",
      sanitizedPositionFilters.status ?? "all",
      sanitizedPositionFilters.userId ?? "any",
      sanitizedPositionFilters.packageId ?? "any",
    ],
    queryFn: () => fetchAdminStakingPositions(sanitizedPositionFilters),
    refetchInterval: 25_000,
  });

  const earningsQuery = useQuery({
    queryKey: [
      "admin",
      "staking",
      "earnings",
      normalizedEarningsFilters.rangeDays,
      normalizedEarningsFilters.asset ?? "all",
      normalizedEarningsFilters.userId ?? "any",
      normalizedEarningsFilters.status ?? "any",
    ],
    queryFn: () => fetchAdminStakingEarnings(normalizedEarningsFilters),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateAdminStakingPackagePayload) => createAdminStakingPackage(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "staking"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number | string; payload: UpdateAdminStakingPackagePayload }) =>
      updateAdminStakingPackage(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "staking"] });
    },
  });

  const refetchStakingSnapshots = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "staking", "overview"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "staking", "earnings"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "staking", "positions"] });
  };

  const payoutPositionMutation = useMutation({
    mutationFn: (positionId: number | string) => adminPayoutPosition(positionId),
    onMutate: (positionId) => {
      setActivePayoutId(positionId);
    },
    onSuccess: (result) => {
      if (result.payout.executed) {
        window.alert(
          `Paid ${result.payout.amount} ${result.payout.asset} to position #${result.position.id}.`
        );
      } else {
        window.alert("Already up to date. No rewards were due for this position.");
      }
      refetchStakingSnapshots();
    },
    onError: (error) => {
      window.alert(getErrorMessage(error));
    },
    onSettled: () => {
      setActivePayoutId(null);
    },
  });

  const runPayoutsMutation = useMutation({
    mutationFn: (limit: number | undefined) => adminRunStakingPayouts(limit),
    onSuccess: (result) => {
      const executed = result.payouts?.length ?? 0;
      window.alert(`Checked ${result.checked} positions. Ran ${executed} payouts.`);
      refetchStakingSnapshots();
    },
    onError: (error) => {
      window.alert(getErrorMessage(error));
    },
  });

  const overview = overviewQuery.data;
  const packages = packagesQuery.data ?? [];
  const positions = positionsQuery.data ?? [];
  const earningsReport = earningsQuery.data;

  const summaryCards = overview
    ? [
        {
          label: "Total Value Staked",
          value: formatUsd(overview.summary.totalValueUsd),
          helper: "Across all staking pools",
        },
        {
          label: "Average APR",
          value: `${overview.summary.averageApr?.toFixed?.(2) ?? "0.00"}%`,
          helper: "Flexible + fixed pools",
        },
        {
          label: "Active Lockups",
          value: `${overview.summary.activeLockups ?? 0}`,
          helper: "Live user positions",
        },
        {
          label: "Next Rewards Cycle",
          value: overview.summary.nextRewardCycle?.secondsUntil
            ? new Date(Date.now() + overview.summary.nextRewardCycle.secondsUntil * 1000).toLocaleTimeString()
            : "--",
          helper: overview.summary.nextRewardCycle?.intervalHours
            ? `Every ${overview.summary.nextRewardCycle.intervalHours} hours`
            : "Cadence not reported",
        },
      ]
    : [];

  const earningsSummaryCards = useMemo(() => {
    if (!earningsReport) return [];
    const summary = earningsReport.summary;
    const lockedUsd =
      (summary as { lockedUsd?: number; totalLockedUsd?: number }).lockedUsd ??
      (summary as { lockedUsd?: number; totalLockedUsd?: number }).totalLockedUsd;
    return [
      { label: "Locked (USD)", value: formatUsd(lockedUsd), helper: "Filtered population" },
      { label: "Realized rewards", value: formatUsd(summary.realizedRewardsUsd), helper: "Payouts completed" },
      { label: "Pending rewards", value: formatUsd(summary.pendingRewardsUsd), helper: "Currently accruing" },
      { label: "Projected 30d", value: formatUsd(summary.projected30dUsd), helper: "Current APR projection" },
      { label: "Daily rewards", value: formatUsd(summary.dailyRewardsUsd), helper: "USD equivalent" },
      {
        label: "Participants",
        value: summary.participants?.toLocaleString?.() ?? "0",
        helper: "Unique staking users",
      },
    ];
  }, [earningsReport]);
  const earningsBreakdown = earningsReport?.breakdown ?? [];
  const earningsTopUsers = earningsReport?.topUsers ?? [];
  const earningsPriceEntries = earningsReport ? Object.entries(earningsReport.priceMap ?? {}) : [];
  const earningsHistoryPoints = earningsReport?.realizedHistory.points ?? [];
  const earningsRecentPayouts = earningsReport?.recentPayouts ?? [];
  const appliedEarningsFilters = earningsReport?.filters;
  const earningsHistoryStats = useMemo(() => {
    if (!earningsHistoryPoints.length) {
      return { total: 0, average: 0, max: 0 };
    }
    const total = earningsHistoryPoints.reduce((acc, point) => acc + Number(point.realizedRewardsUsd ?? 0), 0);
    const max = earningsHistoryPoints.reduce(
      (acc, point) => Math.max(acc, Number(point.realizedRewardsUsd ?? 0)),
      0
    );
    return {
      total,
      average: total / earningsHistoryPoints.length,
      max,
    };
  }, [earningsHistoryPoints]);

  const openCreateModal = (pkg?: AdminStakingPackage) => {
    if (pkg) {
      setEditingPackage(pkg);
      setFormState({
        label: pkg.label,
        asset: pkg.asset,
        aprPercent: pkg.aprPercent,
        lockDays: pkg.lockDays,
        minAmount: pkg.minAmount ?? "",
        maxAmount: pkg.maxAmount ?? "",
        isFeatured: Boolean(pkg.isFeatured),
        status: pkg.status ?? "ACTIVE",
        sortOrder: pkg.sortOrder ?? 10,
        description: pkg.description ?? "",
      });
    } else {
      setEditingPackage(null);
      setFormState(defaultForm);
    }
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (createMutation.isPending || updateMutation.isPending) return;
    setModalOpen(false);
  };

  const handleFormChange = (field: keyof CreateAdminStakingPackagePayload, value: string | number | boolean) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleEarningsDraftChange = (field: keyof EarningsFilterForm, value: string | number) => {
    setEarningsFiltersDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleApplyEarningsFilters = (event?: FormEvent) => {
    event?.preventDefault();
    setEarningsFilters({ ...earningsFiltersDraft });
  };

  const handleResetEarningsFilters = () => {
    const defaults = createDefaultEarningsFilters();
    setEarningsFiltersDraft(defaults);
    setEarningsFilters(defaults);
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const payload: CreateAdminStakingPackagePayload = {
      ...formState,
      aprPercent: Number(formState.aprPercent) || 0,
      lockDays: Number(formState.lockDays) || 0,
      sortOrder: Number(formState.sortOrder) || 0,
      minAmount: formState.minAmount ?? "",
      maxAmount: formState.maxAmount ?? "",
    };
    try {
      if (editingPackage) {
        await updateMutation.mutateAsync({ id: editingPackage.id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(getErrorMessage(err));
    }
  };

  const handleArchive = (pkg: AdminStakingPackage) => {
    updateMutation.mutate({ id: pkg.id, payload: { status: pkg.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" } });
  };

  const handleFeature = (pkg: AdminStakingPackage) => {
    updateMutation.mutate({ id: pkg.id, payload: { isFeatured: !pkg.isFeatured } });
  };

  const handleRunPayouts = () => {
    runPayoutsMutation.mutate(normalizedPayoutLimit);
  };

  const handlePayRewards = (positionId: number | string) => {
    payoutPositionMutation.mutate(positionId);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline gap-3">
        <div>
          <div className={pillCls}>Staking</div>
          <h2 className="text-2xl font-semibold text-white">Admin Staking Control</h2>
        </div>
        {overview?.summary.nextRewardCycle?.nextAt && (
          <div className="text-xs text-slate-400">
            Synced {formatRelative(overview.summary.nextRewardCycle.nextAt)}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <label className="flex items-center gap-2">
            <span>Batch limit</span>
            <Input
              type="number"
              min={1}
              max={500}
              value={payoutBatchLimit}
              onChange={(e) => setPayoutBatchLimit(Number(e.target.value))}
              className="w-20 rounded-2xl border-white/10 bg-white/5 text-xs"
            />
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              overviewQuery.refetch();
              packagesQuery.refetch();
              positionsQuery.refetch();
              earningsQuery.refetch();
            }}
          >
            Refresh data
          </Button>
          <Button size="sm" onClick={handleRunPayouts} disabled={runPayoutsMutation.isPending}>
            {runPayoutsMutation.isPending ? "Processing payouts..." : "Process payouts"}
          </Button>
          <Button size="sm" onClick={() => openCreateModal()}>
            Create Pool
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {overviewQuery.isLoading &&
          Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className={`${cardCls} animate-pulse`}>
              <div className="h-4 w-20 rounded bg-white/10" />
              <div className="mt-3 h-8 w-24 rounded bg-white/15" />
            </div>
          ))}
        {summaryCards.map((card) => (
          <div key={card.label} className={cardCls}>
            <div className={pillCls}>{card.label}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{card.value}</div>
            <p className="text-sm text-slate-300/80 mt-1">{card.helper}</p>
          </div>
        ))}
        <div className={cardCls}>
          <div className={pillCls}>Rewards Distributed</div>
          <div className="mt-2 text-3xl font-semibold text-white">
            {formatUsd(earningsReport?.summary?.realizedRewardsUsd)} total paid
          </div>
          <p className="text-sm text-slate-300/80 mt-1">
            {formatUsd(earningsReport?.summary?.pendingRewardsUsd)} estimated queued
          </p>
        </div>
      </div>

      <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className={pillCls}>Rewards intelligence</div>
            <h3 className="text-lg font-semibold text-white">Network earnings</h3>
          </div>
          <form
            className="ml-auto flex flex-wrap items-end gap-3 text-xs text-slate-300/80"
            onSubmit={handleApplyEarningsFilters}
          >
            <label className="flex flex-col">
              <span>Range (days)</span>
              <select
                value={earningsFiltersDraft.rangeDays}
                onChange={(e) => handleEarningsDraftChange("rangeDays", Number(e.target.value))}
                className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-white focus:border-emerald-400 focus:outline-none"
              >
                {[7, 30, 60, 90, 120, 180].map((option) => (
                  <option key={option} value={option} className="bg-slate-900 text-white">
                    {option}d
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col">
              <span>Asset</span>
              <Input
                value={earningsFiltersDraft.asset}
                onChange={(e) => handleEarningsDraftChange("asset", e.target.value)}
                placeholder="USDT"
                className="mt-1 w-24 text-xs"
              />
            </label>
            <label className="flex flex-col">
              <span>User ID</span>
              <Input
                value={earningsFiltersDraft.userId}
                onChange={(e) => handleEarningsDraftChange("userId", e.target.value)}
                placeholder="123"
                className="mt-1 w-24 text-xs"
              />
            </label>
            <label className="flex flex-col">
              <span>Status</span>
              <select
                value={earningsFiltersDraft.status}
                onChange={(e) => handleEarningsDraftChange("status", e.target.value)}
                className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </label>
            <div className="flex gap-2">
              <Button type="button" size="xs" variant="ghost" onClick={handleResetEarningsFilters}>
                Reset
              </Button>
              <Button type="submit" size="xs" disabled={earningsQuery.isFetching}>
                Apply
              </Button>
            </div>
          </form>
        </div>
        {earningsQuery.isLoading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-slate-300/80">
            Gathering earnings data...
          </div>
        ) : earningsQuery.error ? (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {getErrorMessage(earningsQuery.error)}
          </div>
        ) : earningsReport ? (
          <>
            {appliedEarningsFilters && (
              <div className="flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">
                <span className="rounded-full border border-white/10 px-3 py-1">
                  Range {appliedEarningsFilters.rangeDays}d
                </span>
                {appliedEarningsFilters.asset && (
                  <span className="rounded-full border border-white/10 px-3 py-1">
                    Asset {appliedEarningsFilters.asset}
                  </span>
                )}
                {appliedEarningsFilters.status && (
                  <span className="rounded-full border border-white/10 px-3 py-1">
                    Status {appliedEarningsFilters.status}
                  </span>
                )}
                {appliedEarningsFilters.userId && (
                  <span className="rounded-full border border-white/10 px-3 py-1">
                    User #{appliedEarningsFilters.userId}
                  </span>
                )}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {earningsSummaryCards.map((card) => (
                <div key={card.label} className={cardCls}>
                  <div className={pillCls}>{card.label}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{card.value}</div>
                  <p className="text-xs text-slate-300/80">{card.helper}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className={pillCls}>Breakdown</div>
                <h4 className="text-lg font-semibold text-white">Per-asset rewards</h4>
                <div className="mt-3 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
                      <tr>
                        <th className="px-3 py-2">Asset</th>
                        <th className="px-3 py-2">Principal</th>
                        <th className="px-3 py-2">Pending</th>
                        <th className="px-3 py-2">Realized</th>
                        <th className="px-3 py-2">Daily USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earningsBreakdown.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                            No positions match the applied filters.
                          </td>
                        </tr>
                      )}
                      {earningsBreakdown.map((entry) => (
                        <tr key={entry.asset} className="border-t border-white/5 text-slate-200">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-white">{entry.asset}</div>
                            <div className="text-xs text-slate-400">
                              {entry.activePositions} active / {entry.completedPositions} completed
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {entry.principal} ({formatUsd(entry.principalUsd)})
                          </td>
                          <td className="px-3 py-2">{formatUsd(entry.pendingRewardsUsd)}</td>
                          <td className="px-3 py-2">{formatUsd(entry.realizedRewardsUsd)}</td>
                          <td className="px-3 py-2">{formatUsd(entry.dailyRewardsUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className={pillCls}>Top users</div>
                  <h4 className="text-lg font-semibold text-white">Reward leaders</h4>
                  <div className="mt-3 space-y-2 text-sm">
                    {earningsTopUsers.length === 0 && <div className="text-slate-400">No users in this cohort.</div>}
                    {earningsTopUsers.map((user) => (
                      <div key={user.userId} className="rounded-2xl border border-white/10 px-3 py-2">
                        <div className="text-white font-semibold">{user.email}</div>
                        <div className="text-xs text-slate-400">{user.fullName ?? `User #${user.userId}`}</div>
                        <div className="mt-1 text-[11px] text-slate-300/80">
                          {user.positions} positions • Locked {formatUsd(user.totalLockedUsd)}
                        </div>
                        <div className="text-xs text-emerald-200">
                          Rewards {formatUsd(user.realizedRewardsUsd + user.pendingRewardsUsd)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className={pillCls}>Price snapshot</div>
                  <h4 className="text-lg font-semibold text-white">Oracle references</h4>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {earningsPriceEntries.length === 0 && (
                      <div className="text-sm text-slate-400">No pricing provided.</div>
                    )}
                    {earningsPriceEntries.map(([asset, price]) => (
                      <div key={asset} className="rounded-2xl border border-white/10 px-3 py-2 text-sm">
                        <div className="text-white font-semibold">{asset}</div>
                        <div className="text-slate-300/80">{formatUsd(price)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className={pillCls}>Realized history</div>
                <h4 className="text-lg font-semibold text-white">USD payouts</h4>
                {earningsHistoryPoints.length === 0 ? (
                  <div className="mt-3 text-sm text-slate-400">No realized payouts for this window.</div>
                ) : (
                  <div className="mt-4 flex flex-col gap-4 lg:flex-row">
                    <div className="flex-1 space-y-2 max-h-60 overflow-y-auto pr-1 text-sm">
                      {earningsHistoryPoints.slice(-30).map((point) => {
                        const amount = Number(point.realizedRewardsUsd ?? 0);
                        const pct = earningsHistoryStats.max ? Math.max((amount / earningsHistoryStats.max) * 100, 4) : 0;
                        return (
                          <div
                            key={point.date}
                            className="rounded-2xl border border-white/5 bg-white/3 px-3 py-2 shadow-[0_10px_30px_-20px_rgba(16,185,129,0.7)]"
                          >
                            <div className="flex items-center justify-between text-xs text-slate-400">
                              <span>{new Date(point.date).toLocaleDateString()}</span>
                              <span>{formatUsd(amount)}</span>
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-300/80 lg:w-56">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Range stats</div>
                      <div className="mt-3 space-y-3">
                        <div>
                          <div className="text-slate-400">Total paid</div>
                          <div className="text-2xl font-semibold text-white">{formatUsd(earningsHistoryStats.total)}</div>
                        </div>
                        <div>
                          <div className="text-slate-400">Average per day</div>
                          <div className="text-xl font-semibold text-white">
                            {formatUsd(earningsHistoryStats.average)}
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-400">Best day</div>
                          <div className="text-xl font-semibold text-emerald-200">
                            {formatUsd(earningsHistoryStats.max)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className={pillCls}>Recent payouts</div>
                <h4 className="text-lg font-semibold text-white">Latest settlements</h4>
                <div className="mt-3 max-h-48 overflow-y-auto text-sm">
                  {earningsRecentPayouts.length === 0 && <div className="text-slate-400">No recent payouts.</div>}
                  {earningsRecentPayouts.map((payout) => (
                    <div key={`${payout.positionId}-${payout.unstakedAt ?? payout.stakedAt}`} className="border-b border-white/5 py-2">
                      <div className="flex items-center justify-between text-white">
                        <span>Position #{payout.positionId}</span>
                        <span>{formatUsd(payout.rewardsPaidUsd)}</span>
                      </div>
                      <div className="text-xs text-slate-400">
                        {payout.user?.email ?? `User #${payout.user?.id ?? "?"}`} • {payout.package?.label ?? payout.asset}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {formatRelative(payout.stakedAt)} → {payout.unstakedAt ? formatRelative(payout.unstakedAt) : "Active"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400">
            No network earnings reported yet.
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className={pillCls}>Coin / Staking Programs</div>
            <h3 className="text-lg font-semibold text-white">Pool catalogue</h3>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-slate-400">Status</label>
            <select
              value={packageStatusFilter}
              onChange={(e) => setPackageStatusFilter(e.target.value)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            >
              <option value="ALL">All</option>
              <option value="ACTIVE">Active</option>
              <option value="DRAFT">Draft</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </div>
        </div>
        <div className="overflow-auto rounded-2xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">APR %</th>
                <th className="px-4 py-3">Lock Days</th>
                <th className="px-4 py-3">Min / Max</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Active Positions</th>
                <th className="px-4 py-3">TVL</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {packagesQuery.isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                    Loading pools...
                  </td>
                </tr>
              )}
              {!packagesQuery.isLoading && packages.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                    No pools found for this filter.
                  </td>
                </tr>
              )}
              {packages.map((pkg) => (
                <tr key={pkg.id} className="border-t border-white/5 text-slate-200">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{pkg.label}</div>
                    <div className="text-xs text-slate-400">{pkg.description ?? "-"}</div>
                  </td>
                  <td className="px-4 py-3">{pkg.asset}</td>
                  <td className="px-4 py-3">{pkg.aprPercent.toFixed(2)}%</td>
                  <td className="px-4 py-3">{pkg.lockDays > 0 ? `${pkg.lockDays}d` : "Flexible"}</td>
                  <td className="px-4 py-3">
                    {pkg.minAmount ?? "0"} / {pkg.maxAmount ?? "unlimited"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        pkg.status === "ACTIVE"
                          ? "bg-emerald-500/20 text-emerald-200"
                          : pkg.status === "DRAFT"
                          ? "bg-amber-500/20 text-amber-200"
                          : "bg-slate-500/20 text-slate-200"
                      }`}
                    >
                      {pkg.status ?? "UNKNOWN"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{pkg.stats?.activePositions ?? 0}</td>
                  <td className="px-4 py-3">{formatUsd(pkg.stats?.totalLockedUsd ?? 0)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="xs" variant="secondary" onClick={() => openCreateModal(pkg)}>
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        variant={pkg.isFeatured ? "secondary" : "ghost"}
                        onClick={() => handleFeature(pkg)}
                        disabled={updateMutation.isPending}
                      >
                        {pkg.isFeatured ? "Unfeature" : "Feature"}
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleArchive(pkg)}
                        disabled={updateMutation.isPending}
                      >
                        {pkg.status === "ARCHIVED" ? "Activate" : "Archive"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className={pillCls}>Recent Activity</div>
          <h3 className="text-lg font-semibold text-white mb-3">Latest stakes</h3>
          <div className="space-y-3 text-sm">
            {overview?.recentPositions?.length ? (
              overview.recentPositions.map((pos) => (
                <div key={pos.id} className="rounded-2xl border border-white/10 px-4 py-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Pkg #{pos.packageId}</span>
                    <span>{formatRelative(pos.stakedAt)}</span>
                  </div>
                  <div className="mt-1 text-white font-semibold">
                    {pos.amount} {pos.asset}
                  </div>
                  <div className="text-xs text-slate-400">
                    {pos.aprPercent}% APR - {pos.lockDays > 0 ? `${pos.lockDays}d lock` : "Flexible"}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-slate-300/80 text-sm">No recent activity yet.</div>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className={pillCls}>Earnings / Positions</div>
              <h3 className="text-lg font-semibold text-white">Global positions</h3>
            </div>
            <div className="ml-auto flex flex-wrap gap-2 text-xs text-slate-400">
              <label>
                Status
                <select
                  value={positionFilters.status}
                  onChange={(e) => setPositionFilters((prev) => ({ ...prev, status: e.target.value }))}
                  className="ml-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-white"
                >
                  <option value="">All</option>
                  <option value="ACTIVE">Active</option>
                  <option value="COMPLETED">Completed</option>
                </select>
              </label>
              <Input
                value={positionFilters.userId}
                onChange={(e) => setPositionFilters((prev) => ({ ...prev, userId: e.target.value }))}
                placeholder="User ID"
                className="w-24 text-xs"
              />
              <Input
                value={positionFilters.packageId}
                onChange={(e) => setPositionFilters((prev) => ({ ...prev, packageId: e.target.value }))}
                placeholder="Package ID"
                className="w-28 text-xs"
              />
              <Button size="xs" variant="ghost" onClick={() => positionsQuery.refetch()}>
                Apply
              </Button>
            </div>
          </div>
          <div className="overflow-auto rounded-2xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
                <tr>
                  <th className="px-3 py-3">User</th>
                  <th className="px-3 py-3">Package</th>
                  <th className="px-3 py-3">Amount</th>
                  <th className="px-3 py-3">APR</th>
                  <th className="px-3 py-3">Rewards</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Staked</th>
                  <th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {positionsQuery.isLoading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                      Loading positions...
                    </td>
                  </tr>
                )}
                {!positionsQuery.isLoading && positions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                      No positions match these filters.
                    </td>
                  </tr>
                )}
                {positions.map((pos) => (
                  <tr key={pos.id} className="border-t border-white/5 text-slate-200">
                    <td className="px-3 py-3">
                      <div className="font-semibold text-white">{pos.user.email}</div>
                      <div className="text-xs text-slate-400">ID {pos.user.id}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-semibold text-white">{pos.package.label}</div>
                      <div className="text-xs text-slate-400">#{pos.package.id}</div>
                    </td>
                    <td className="px-3 py-3">
                      {pos.amount} {pos.asset}
                    </td>
                    <td className="px-3 py-3">{pos.aprPercent.toFixed(2)}%</td>
                    <td className="px-3 py-3 text-xs">
                      Est: {pos.estimatedRewards ?? "0"} <br />
                      Paid: {pos.rewardsPaid ?? "0"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs ${
                          pos.status === "ACTIVE"
                            ? "bg-emerald-500/20 text-emerald-200"
                            : "bg-indigo-500/20 text-indigo-200"
                        }`}
                      >
                        {pos.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400">
                      {formatRelative(pos.stakedAt)}
                      <br />
                      Unlocks {formatRelative(pos.unlockAt ?? undefined)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        size="xs"
                        onClick={() => handlePayRewards(pos.id)}
                        disabled={payoutPositionMutation.isPending}
                      >
                        {payoutPositionMutation.isPending && activePayoutId === pos.id
                          ? "Paying..."
                          : "Pay rewards"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Dialog
        open={modalOpen}
        onClose={closeModal}
        title={editingPackage ? "Edit Pool" : "Create Pool"}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={createMutation.isPending || updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submitForm}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save pool"}
            </Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={submitForm}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-400">
              Pool title
              <Input
                value={formState.label}
                onChange={(e) => handleFormChange("label", e.target.value)}
                className="mt-1"
                required
              />
            </label>
            <label className="text-xs text-slate-400">
              Asset
              <Input
                value={formState.asset}
                onChange={(e) => handleFormChange("asset", e.target.value.toUpperCase())}
                className="mt-1"
                required
              />
            </label>
            <label className="text-xs text-slate-400">
              APR %
              <Input
                type="number"
                value={formState.aprPercent}
                onChange={(e) => handleFormChange("aprPercent", Number(e.target.value))}
                className="mt-1"
                step="0.01"
                required
              />
            </label>
            <label className="text-xs text-slate-400">
              Lock days
              <Input
                type="number"
                value={formState.lockDays}
                onChange={(e) => handleFormChange("lockDays", Number(e.target.value))}
                className="mt-1"
                min={0}
                required
              />
            </label>
            <label className="text-xs text-slate-400">
              Min amount
              <Input
                value={formState.minAmount}
                onChange={(e) => handleFormChange("minAmount", e.target.value)}
                className="mt-1"
                placeholder="0"
              />
            </label>
            <label className="text-xs text-slate-400">
              Max amount
              <Input
                value={formState.maxAmount ?? ""}
                onChange={(e) => handleFormChange("maxAmount", e.target.value)}
                className="mt-1"
                placeholder="Unlimited"
              />
            </label>
            <label className="text-xs text-slate-400">
              Sort order
              <Input
                type="number"
                value={formState.sortOrder}
                onChange={(e) => handleFormChange("sortOrder", Number(e.target.value))}
                className="mt-1"
              />
            </label>
            <label className="text-xs text-slate-400">
              Status
              <select
                value={formState.status}
                onChange={(e) => handleFormChange("status", e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="DRAFT">DRAFT</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={formState.isFeatured}
              onChange={(e) => handleFormChange("isFeatured", e.target.checked)}
              className="h-4 w-4 rounded border border-white/25 bg-transparent"
            />
            Feature this campaign on the user staking hub
          </label>
          <label className="text-xs text-slate-400">
            Description
            <textarea
              value={formState.description}
              onChange={(e) => handleFormChange("description", e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
            />
          </label>
          {formError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {formError}
            </div>
          )}
        </form>
      </Dialog>
    </div>
  );
}
