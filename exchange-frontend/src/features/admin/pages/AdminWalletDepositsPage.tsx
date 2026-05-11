import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Button from "../../../ui/Button";
import {
  fetchAdminSweepQueue,
  retrySweepById,
  runEligibleSweeps,
  type AdminCustodialSweepRecord,
} from "../api/admin.api";
import { formatMoneyWithSymbol } from "../../../utils/money";

const shellCls = "space-y-4 text-slate-100";
const panelCls = "rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,18,34,0.94),rgba(7,12,24,0.98))] shadow-[0_30px_80px_-48px_rgba(45,93,255,0.35)]";
const inputCls = "h-10 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-400/40 focus:bg-white/[0.06]";
const mutedLabelCls = "text-[11px] uppercase tracking-[0.22em] text-slate-400";

function formatAmount(value: string | number | null | undefined, asset = "USDT") {
  return formatMoneyWithSymbol(value, asset);
}

function formatGas(value: string | number | null | undefined, asset = "") {
  if (value === null || value === undefined || value === "") return `--${asset ? ` ${asset}` : ""}`;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `--${asset ? ` ${asset}` : ""}`;
  return `${numeric.toFixed(6)}${asset ? ` ${asset}` : ""}`;
}

function shortenMiddle(value: string | null | undefined, head = 8, tail = 8) {
  const text = String(value || "").trim();
  if (!text) return "--";
  if (text.length <= head + tail + 3) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function titleize(value: string | null | undefined) {
  return String(value || "--")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isFailedStatus(status: string | null | undefined) {
  const normalized = String(status || "").toLowerCase();
  if (!normalized) return false;
  return normalized.includes("failed") || normalized.includes("insufficient");
}

function formatSweepError(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "--";
  const normalized = raw.toLowerCase();
  if (normalized.includes("tronweb is not a constructor")) {
    return "TRON client initialization failed. Restart the backend, then retry this sweep.";
  }
  if (normalized.includes("amountraw is not defined") || normalized.includes("amountraw")) {
    return "Sweep amount calculation failed. Refresh the queue and retry this sweep.";
  }
  return titleize(raw);
}

function formatSweepErrorDetail(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "No sweep transaction yet";
  const normalized = raw.toLowerCase();
  if (normalized.includes("tronweb is not a constructor")) {
    return "Backend was using an invalid TRON client constructor.";
  }
  if (normalized.includes("amountraw is not defined") || normalized.includes("amountraw")) {
    return "The backend returned an internal sweep amount reference error for this row.";
  }
  return raw;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function getStatusTone(value: string | null | undefined) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("failed") || normalized.includes("insufficient")) {
    return "border-rose-400/25 bg-rose-500/10 text-rose-100";
  }
  if (normalized.includes("confirmed") || normalized.includes("sent") || normalized.includes("success") || normalized.includes("ready")) {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
  }
  if (normalized.includes("pending") || normalized.includes("checking") || normalized.includes("topup") || normalized.includes("processing")) {
    return "border-amber-400/25 bg-amber-500/10 text-amber-100";
  }
  return "border-white/10 bg-white/[0.04] text-slate-200";
}

function networkTone(network: string | null | undefined) {
  const normalized = String(network || "").toLowerCase();
  if (normalized === "tron") return "border-cyan-400/25 bg-cyan-400/10 text-cyan-100";
  if (normalized === "bsc") return "border-amber-400/25 bg-amber-400/10 text-amber-100";
  if (normalized === "ethereum") return "border-violet-400/25 bg-violet-400/10 text-violet-100";
  return "border-white/10 bg-white/[0.04] text-slate-200";
}

const sweepNetworkActions = [
  { key: "ethereum", label: "Run ERC20 Sweep", shortLabel: "ERC20" },
  { key: "bsc", label: "Run BEP20 Sweep", shortLabel: "BEP20" },
  { key: "tron", label: "Run TRC20 Sweep", shortLabel: "TRC20" },
] as const;

function MetricTile({
  label,
  value,
  note,
  detail,
  to,
}: {
  label: string;
  value: string;
  note: string;
  detail?: string;
  to?: string;
}) {
  const content = (
    <div className={`rounded-[24px] border border-white/8 bg-white/[0.035] px-4 py-4 ${to ? "transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.06]" : ""}`}>
      <div className={mutedLabelCls}>{label}</div>
      <div className="mt-3">
        <AmountDisplay value={value} size="hero" />
      </div>
      <div className="mt-2 text-sm text-slate-400">{note}</div>
      {detail ? <div className="mt-2 break-all text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
  if (to) return <Link to={to}>{content}</Link>;
  return content;
}

function AmountDisplay({
  value,
  size = "body",
}: {
  value: string;
  size?: "hero" | "body";
}) {
  const text = String(value || "").trim();
  const parts = text.match(/^(.*?)(?:\s+([A-Za-z]{2,10}))?$/);
  const amount = (parts?.[1] || text).trim();
  const symbol = (parts?.[2] || "").trim();
  const isHero = size === "hero";

  return (
    <div className={`flex flex-wrap items-end gap-2 ${isHero ? "min-h-[3rem]" : ""}`}>
      <span
        className={
          isHero
            ? "text-[clamp(2rem,2.2vw,3rem)] font-black leading-none tracking-[-0.04em] text-white [text-shadow:0_0_18px_rgba(255,255,255,0.16),0_0_38px_rgba(56,189,248,0.10)]"
            : "text-lg font-semibold leading-none tracking-[-0.03em] text-white [text-shadow:0_0_14px_rgba(56,189,248,0.10)]"
        }
      >
        {amount}
      </span>
      {symbol ? (
        <span
          className={
            isHero
              ? "mb-1 rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.12)]"
              : "rounded-full border border-cyan-400/20 bg-cyan-400/[0.07] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.10)]"
          }
        >
          {symbol}
        </span>
      ) : null}
    </div>
  );
}

function AmountBlock({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className={mutedLabelCls}>{label}</div>
      <div className="mt-2 break-all">
        <AmountDisplay value={value} />
      </div>
      {detail ? <div className="mt-1 break-all text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
}

function DataBlock({
  label,
  value,
  detail,
  tone = "text-white",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <div className={mutedLabelCls}>{label}</div>
      <div className={`mt-2 break-all text-sm font-medium ${tone}`}>{value}</div>
      {detail ? <div className="mt-1 break-all text-xs text-slate-500">{detail}</div> : null}
    </div>
  );
}

export default function AdminWalletDepositsPage() {
  const [filters, setFilters] = useState({ page: 1, limit: 100, network: "", status: "", userId: "" });
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin", "sweep-queue", filters],
    queryFn: () =>
      fetchAdminSweepQueue({
        page: filters.page,
        limit: filters.limit,
        network: filters.network || undefined,
        status: filters.status || undefined,
        userId: filters.userId || undefined,
      }),
    enabled: false,
  });

  const refresh = async () => {
    setHasLoadedOnce(true);
    await refetch();
  };

  useEffect(() => {
    void refresh();
    // initial one-time load only; filters stay manual afterward
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runEligibleMutation = useMutation({
    mutationFn: async (network?: string) => runEligibleSweeps(network ? { network } : undefined),
    onSuccess: refresh,
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string | number) => retrySweepById(id),
    onSuccess: refresh,
  });

  const items: AdminCustodialSweepRecord[] = data?.items ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 };
  const historyStats = useMemo(() => {
    const totals = {
      completedCount: 0,
      pendingCount: 0,
      failedCount: 0,
      totalUsdt: 0,
      ethereumUsdt: 0,
      bscUsdt: 0,
      tronUsdt: 0,
    };

    for (const item of items) {
      const amount = Number(item.usdtAmountDecimal || 0);
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      const status = String(item.status || "").toLowerCase();
      const network = String(item.network || "").toLowerCase();

      if (status.includes("confirm") || status.includes("complete") || status.includes("success")) totals.completedCount += 1;
      else if (status.includes("failed")) totals.failedCount += 1;
      else totals.pendingCount += 1;

      totals.totalUsdt += safeAmount;
      if (network === "ethereum") totals.ethereumUsdt += safeAmount;
      if (network === "bsc") totals.bscUsdt += safeAmount;
      if (network === "tron") totals.tronUsdt += safeAmount;
    }

    return totals;
  }, [items]);
  const gasStats = useMemo(() => {
    const totals = {
      ethereum: 0,
      bsc: 0,
      tron: 0,
      total: 0,
    };

    for (const item of items) {
      const amount = Number(item.estimatedGasFeeDecimal || 0);
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      const network = String(item.network || "").toLowerCase();

      totals.total += safeAmount;
      if (network === "ethereum") totals.ethereum += safeAmount;
      if (network === "bsc") totals.bsc += safeAmount;
      if (network === "tron") totals.tron += safeAmount;
    }

    return totals;
  }, [items]);

  return (
    <div className={shellCls}>
      <section className={`${panelCls} overflow-hidden`}>
        <div className="border-b border-white/8 bg-[linear-gradient(90deg,rgba(8,14,28,0.96),rgba(10,18,34,0.88))] px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-cyan-100">
                Sweep History
              </div>              
            </div>
            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[620px]">
              <MetricTile
                label="Completed"
                value={String(historyStats.completedCount)}
                note="Sweep rows already confirmed or completed."
              />
              <MetricTile
                label="Pending"
                value={String(historyStats.pendingCount)}
                note="Sweep rows still waiting for the next action."
              />
              <MetricTile
                label="Failed"
                value={String(historyStats.failedCount)}
                note="Rows that need manual retry or investigation."
              />
            </div>
          </div>
        </div>

        <div className="grid gap-4 px-5 py-5 sm:px-6">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                label="Total USDT"
                value={formatAmount(historyStats.totalUsdt.toFixed(6))}
                note="Combined sweep amount across loaded history rows."
              />
              <MetricTile
                label="ERC20"
                value={formatAmount(historyStats.ethereumUsdt.toFixed(6))}
                note="Ethereum network sweep total."
              />
              <MetricTile
                label="BEB20"
                value={formatAmount(historyStats.bscUsdt.toFixed(6))}
                note="BSC network sweep total."
              />
              <MetricTile
                label="TRC20"
                value={formatAmount(historyStats.tronUsdt.toFixed(6))}
                note="TRON network sweep total."
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricTile
                label="ERC-20 Gas Fee"
                value={formatGas(gasStats.ethereum, "ETH")}
                note="Open ERC-20 gas funding history."
                to="/admin/wallet-management/admin-wallet/gas-funding?network=ethereum"
              />
              <MetricTile
                label="BEB-20 Gas Fee"
                value={formatGas(gasStats.bsc, "BNB")}
                note="Open BEB-20 gas funding history."
                to="/admin/wallet-management/admin-wallet/gas-funding?network=bsc"
              />
              <MetricTile
                label="TRC-20 Gas Fee"
                value={formatGas(gasStats.tron, "TRX")}
                note="Open TRC-20 gas funding history."
                to="/admin/wallet-management/admin-wallet/gas-funding?network=tron"
              />
            </div>

            <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className={mutedLabelCls}>Sweep Controls</div>
                  <div className="mt-1 text-sm text-slate-300">Filter the sweep history by network, status, or user, then run eligible sweeps per network when needed.</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" onClick={refresh}>
                    {isFetching ? "Loading..." : hasLoadedOnce ? "Refresh" : "Load Sweeps"}
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-3">
                {sweepNetworkActions.map((networkAction) => {
                  const isRunning = runEligibleMutation.isPending && runEligibleMutation.variables === networkAction.key;
                  return (
                    <Button
                      key={networkAction.key}
                      size="sm"
                      className="justify-center"
                      onClick={() => runEligibleMutation.mutate(networkAction.key)}
                      disabled={runEligibleMutation.isPending}
                    >
                      {isRunning ? `Running ${networkAction.shortLabel}...` : networkAction.label}
                    </Button>
                  );
                })}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_160px]">
                <select
                  className={inputCls}
                  value={filters.network}
                  onChange={(event) => setFilters((prev) => ({ ...prev, network: event.target.value, page: 1 }))}
                >
                  <option value="">All networks</option>
                  <option value="ethereum">Ethereum</option>
                  <option value="bsc">BSC</option>
                  <option value="tron">TRON</option>
                </select>
                <input
                  className={inputCls}
                  placeholder="Filter by status"
                  value={filters.status}
                  onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value, page: 1 }))}
                />
                <input
                  className={inputCls}
                  placeholder="Filter by user ID"
                  value={filters.userId}
                  onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value, page: 1 }))}
                />
                <select
                  className={inputCls}
                  value={String(filters.limit)}
                  onChange={(event) => setFilters((prev) => ({ ...prev, limit: Number(event.target.value), page: 1 }))}
                >
                  <option value="20">20 / page</option>
                  <option value="50">50 / page</option>
                  <option value="100">100 / page</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={`${panelCls} p-4 sm:p-5`}>
        <div className="flex flex-col gap-3 border-b border-white/8 pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className={mutedLabelCls}>All Sweep & History</div>
            <h3 className="mt-1 text-xl font-semibold text-white">Per-user transfer history board</h3>
            <p className="mt-2 text-sm text-slate-400">
              Each row shows the source wallet, destination treasury wallet, gas state, sweep state, and transaction history.
            </p>
          </div>
          <div className="rounded-full border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-slate-300">
            {items.length} loaded rows
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {isLoading || isFetching ? <div className="text-slate-300/80">Loading sweep queue...</div> : null}

          {!hasLoadedOnce && !isLoading && !isFetching ? (
            <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-5 text-slate-300/80">
              Sweeps will not auto-load. Use <span className="font-medium text-white">Load Sweeps</span> to fetch the current queue with the selected filters.
            </div>
          ) : null}

          {hasLoadedOnce && !isLoading && !isFetching &&
            items.map((item, index) => {
              const actionBusy = retryMutation.isPending && retryMutation.variables === item.id;
              const showRetry = isFailedStatus(item.status);
              const completedRow = String(item.status || "").toLowerCase().includes("confirm")
                || String(item.status || "").toLowerCase().includes("complete")
                || String(item.status || "").toLowerCase().includes("success");

              return (
                <article
                  key={item.id}
                  className={`rounded-[24px] border p-4 shadow-[0_20px_60px_-42px_rgba(0,0,0,0.85)] ${
                    completedRow
                      ? "border-emerald-400/40 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.16),transparent_45%),linear-gradient(180deg,rgba(7,34,24,0.98),rgba(5,24,18,0.99))] shadow-[0_0_0_1px_rgba(52,211,153,0.12),0_0_32px_rgba(16,185,129,0.12),0_20px_60px_-42px_rgba(0,0,0,0.85)]"
                      : "border-white/10 bg-[linear-gradient(180deg,rgba(10,16,30,0.95),rgba(7,12,24,0.98))]"
                  }`}
                >
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="min-w-0 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-100">
                          S.No {index + 1}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-100">
                          Queue #{item.id}
                        </span>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200">
                          User {item.userId}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${networkTone(item.network)}`}>
                          {String(item.network || "--").toUpperCase()}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusTone(item.status)}`}>
                          {titleize(item.status)}
                        </span>
                        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${getStatusTone(item.gasStatus)}`}>
                          Gas {titleize(item.gasStatus)}
                        </span>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                        <DataBlock
                          label="Source User Wallet"
                          value={shortenMiddle(item.sourceWalletAddress)}
                          detail={item.sourceWalletAddress}
                          tone="text-slate-100"
                        />
                        <DataBlock
                          label="Destination Admin Wallet"
                          value={shortenMiddle(item.destinationAdminWalletAddress)}
                          detail={item.destinationAdminWalletAddress}
                          tone="text-slate-100"
                        />
                        <AmountBlock
                          label="USDT To Sweep"
                          value={formatAmount(item.usdtAmountDecimal)}
                          detail="Detected custodial balance queued for treasury transfer."
                        />
                        <AmountBlock
                          label="Estimated Native Gas"
                          value={formatGas(item.estimatedGasFeeDecimal, item.gasAsset || "")}
                          detail={item.gasAsset ? `Native asset ${item.gasAsset}` : "Gas asset unavailable"}
                        />
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                          <div className={mutedLabelCls}>Execution Story</div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <DataBlock
                              label="Gas Top-up Transaction"
                              value={item.gasTopupTxHash ? shortenMiddle(item.gasTopupTxHash) : "--"}
                              detail={item.gasTopupTxHash || "No native gas sent yet"}
                              tone={item.gasTopupTxHash ? "text-cyan-200" : "text-slate-500"}
                            />
                            <DataBlock
                              label="Sweep Transaction"
                              value={
                                item.sweepTxHash
                                  ? shortenMiddle(item.sweepTxHash)
                                  : item.errorMessage
                                  ? formatSweepError(item.errorMessage)
                                  : "--"
                              }
                              detail={
                                item.sweepTxHash
                                  ? `${item.sweepTxHash} | Logged ${formatDateTime(item.sweptAt || item.updatedAt || item.createdAt)}`
                                  : formatSweepErrorDetail(item.errorMessage)
                              }
                              tone={item.errorMessage ? "text-rose-200" : item.sweepTxHash ? "text-cyan-200" : "text-slate-500"}
                            />
                          </div>
                        </div>

                      </div>

                    </div>
                    {showRetry ? (
                      <aside className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                        <div className={mutedLabelCls}>Action Rail</div>
                        <div className="mt-3 space-y-3">
                          <Button
                            className="w-full justify-center"
                            size="sm"
                            variant="secondary"
                            onClick={() => retryMutation.mutate(item.id)}
                            disabled={actionBusy}
                          >
                            {retryMutation.isPending && retryMutation.variables === item.id ? "Retrying..." : "Retry"}
                          </Button>
                          <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3 text-xs text-slate-400">
                            Retry first checks explorer API for an existing user-to-admin transfer and only re-runs the sweep if nothing is found.
                          </div>
                        </div>
                      </aside>
                    ) : (
                      <div className="h-32" />                    
                    )}
                  </div>
                </article>
              );
            })}

          {hasLoadedOnce && !isLoading && !isFetching && items.length === 0 ? <div className="text-slate-300/80">No sweep rows found.</div> : null}
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-white/8 pt-4 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Page {pagination.page} of {Math.max(pagination.totalPages, 1)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-xl border border-white/10 px-3 py-2 transition hover:bg-white/[0.04] disabled:opacity-50"
              disabled={pagination.page <= 1}
              onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded-xl border border-white/10 px-3 py-2 transition hover:bg-white/[0.04] disabled:opacity-50"
              disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages}
              onClick={() =>
                setFilters((prev) => ({ ...prev, page: Math.min(Math.max(pagination.totalPages, 1), prev.page + 1) }))
              }
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
