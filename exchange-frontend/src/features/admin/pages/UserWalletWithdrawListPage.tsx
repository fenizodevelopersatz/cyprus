import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAdminUserWalletWithdrawals,
  type AdminWithdrawal,
  type AdminWithdrawHistoryResponse,
} from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";

export default function UserWalletWithdrawListPage() {
  const [filters, setFilters] = useState({ userId: "", status: "", limit: 50, page: 1 });
  const { data, isLoading } = useQuery<AdminWithdrawHistoryResponse>({
    queryKey: ["admin", "user-wallet-withdraw-list", filters],
    queryFn: () =>
      fetchAdminUserWalletWithdrawals({
        userId: filters.userId || undefined,
        status: filters.status || undefined,
        limit: filters.limit,
        page: filters.page,
      }),
    refetchInterval: 15000,
  });

  const items: AdminWithdrawal[] = data?.items ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: filters.limit, total: 0, totalPages: 0 };
  const summaryCards = useMemo(
    () => [
      { label: "Total Outgoing USDT", value: data?.summary?.totalUsdt ?? "0" },
      { label: "ERC-20", value: data?.summary?.totalErc20 ?? "0" },
      { label: "BEP-20", value: data?.summary?.totalBep20 ?? "0" },
      { label: "TRC-20", value: data?.summary?.totalTrc20 ?? "0" },
    ],
    [data?.summary]
  );

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold text-white">User Wallet Withdraw List</h2>
        <p className="text-sm text-slate-300/80">Processed, completed, rejected, or cancelled withdrawals only.</p>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-cyan-400/15 bg-cyan-500/10 p-4">
            <div className="text-[11px] uppercase tracking-[0.2em] text-cyan-200/80">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold text-white">{formatCurrency(card.value)}</div>
          </div>
        ))}
      </section>

      <section className={panelCls}>
        <div className="grid gap-3 md:grid-cols-4">
          <input
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            placeholder="User ID"
            value={filters.userId}
            onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value, page: 1 }))}
          />
          <input
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            placeholder="Status"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value, page: 1 }))}
          />
          <select
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            value={String(filters.limit)}
            onChange={(event) => setFilters((prev) => ({ ...prev, limit: Number(event.target.value), page: 1 }))}
          >
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
          </select>
          <div className="flex items-center justify-end text-xs text-slate-400">
            Page {pagination.page} of {Math.max(pagination.totalPages, 1)} - {pagination.total} records
          </div>
        </div>
      </section>

      <section className={panelCls}>
        <div className="mb-3 grid grid-cols-[70px_140px_80px_100px_1.2fr_140px_110px_140px_140px_1fr] gap-2 border-b border-white/10 pb-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
          <span>ID</span>
          <span>Txn ID</span>
          <span>User</span>
          <span>Network</span>
          <span>Destination</span>
          <span>Amount</span>
          <span>Status</span>
          <span>Requested</span>
          <span>Completed</span>
          <span>Admin Tx Hash</span>
        </div>

        <div className="space-y-2 pt-3 text-sm">
          {isLoading && <div className="text-slate-300/80">Loading withdraw history...</div>}

          {!isLoading &&
            items.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[70px_140px_80px_100px_1.2fr_140px_110px_140px_140px_1fr] gap-2 rounded-2xl border border-white/10 px-3 py-3"
              >
                <span>{item.id}</span>
                <span className="break-all text-xs text-cyan-300">{item.txn_id || "--"}</span>
                <div className="group relative">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 text-left text-white transition hover:text-cyan-200"
                  >
                    <span>{item.userId}</span>
                    <span className="text-[10px] uppercase tracking-[0.14em] text-slate-500">view</span>
                  </button>
                  <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-4 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.75)] group-hover:block">
                    <div className="flex items-center gap-3">
                      {item.profilePhoto ? (
                        <img
                          src={item.profilePhoto}
                          alt={`${item.userName || item.email || `User #${item.userId}`} profile`}
                          className="h-14 w-14 rounded-full border border-white/10 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-slate-200">
                          {getUserAvatarLabel(item)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{item.userName || `User #${item.userId}`}</div>
                        <div className="truncate text-xs text-slate-400">{item.userStatus || "Unknown status"}</div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-slate-300">
                      <TooltipRow label="User ID" value={String(item.userId)} />
                      <TooltipRow label="KYC" value={item.kycVerified ? "Verified" : "Unverified"} />
                      <TooltipRow label="Current withdrawal" value={`${formatCurrency(getDisplayAmount(item))} ${item.asset || ""}`.trim()} />
                    </div>
                  </div>
                </div>
                <span>{normalizeNetworkLabel(item.chain)}</span>
                <div className="group relative min-w-0">
                  {item.to || item.address ? (
                    <>
                      <a
                        href={toExternalUrl(item.explorerUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-xs text-cyan-300 hover:text-cyan-200"
                      >
                        {item.to || item.address}
                      </a>
                      {getUserDetailsNote(item) ? (
                        <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-80 rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-xs text-slate-200 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.75)] group-hover:block">
                          <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">User notes</div>
                          <div className="mt-2 whitespace-pre-wrap leading-5 text-white">{getUserDetailsNote(item)}</div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">--</span>
                  )}
                </div>
                <div className="group relative">
                  <span className="cursor-help">{formatCurrency(getDisplayAmount(item))}</span>
                  {getAdminFinancialDetails(item).length ? (
                    <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-80 rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-xs shadow-[0_24px_80px_-32px_rgba(0,0,0,0.75)] group-hover:block">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Admin financial details</div>
                      <div className="mt-3 space-y-2">
                        {getAdminFinancialDetails(item).map((detail) => (
                          <TooltipRow key={detail.label} label={detail.label} value={detail.value} />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="group relative">
                  <span className={`text-xs font-semibold uppercase tracking-[0.12em] ${getStatusTextCls(item.status)}`}>
                    {item.status}
                  </span>
                  {getStatusTooltip(item) ? (
                    <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-2xl border border-white/10 bg-slate-950/95 p-4 text-xs shadow-[0_24px_80px_-32px_rgba(0,0,0,0.75)] group-hover:block">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                        {String(item.status || "").trim().toLowerCase() === "rejected" ? "Rejection reason" : "Status note"}
                      </div>
                      <div className="mt-2 whitespace-pre-wrap leading-5 text-white">{getStatusTooltip(item)}</div>
                    </div>
                  ) : null}
                </div>
                <span className="text-xs text-slate-400">{formatDateTime(item.requestedAt)}</span>
                <span className="text-xs text-slate-400">{formatDateTime(item.confirmedAt || item.updatedAt)}</span>
                <div className="min-w-0">
                  {item.txHash ? (
                    <a
                      href={toExternalUrl(item.txExplorerUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-xs text-cyan-300 hover:text-cyan-200"
                    >
                      {item.txHash}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">--</span>
                  )}
                </div>
              </div>
            ))}

          {!isLoading && items.length === 0 && <div className="text-slate-300/80">No processed withdrawals found.</div>}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-slate-400">
          <span>Showing page {pagination.page} of {Math.max(pagination.totalPages, 1)}</span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pagination.page <= 1}
              onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages}
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  page: Math.min(Math.max(pagination.totalPages, 1), prev.page + 1),
                }))
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

function formatCurrency(value: string | number | undefined) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "0.00";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDateTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "--";
}

function normalizeNetworkLabel(value?: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "ethereum" || normalized === "erc20" || normalized === "eth") return "ERC-20";
  if (normalized === "bsc" || normalized === "bep20") return "BEP-20";
  if (normalized === "tron" || normalized === "trc20") return "TRC-20";
  return value || "--";
}

function toExternalUrl(value?: string | null) {
  return value && /^https?:\/\//i.test(value) ? value : "#";
}

function getDisplayAmount(item: AdminWithdrawal) {
  const payoutAmount = Number(item.meta?.payoutAmount);
  if (Number.isFinite(payoutAmount) && payoutAmount > 0) return payoutAmount;
  const netAmount = Number(item.meta?.netAmount);
  if (Number.isFinite(netAmount) && netAmount > 0) return netAmount;
  return Number(item.amount || 0);
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-white">{value}</span>
    </div>
  );
}

function getUserAvatarLabel(item: AdminWithdrawal) {
  const source = item.userName || item.email || String(item.userId || "U");
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function getStatusTextCls(status?: string) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved" || normalized === "completed" || normalized === "confirmed") {
    return "text-emerald-300";
  }
  if (normalized === "rejected" || normalized === "failed" || normalized === "cancelled") {
    return "text-rose-300";
  }
  return "text-white";
}

function getUserDetailsNote(item: AdminWithdrawal) {
  return typeof item.meta?.userDetails === "string" && String(item.meta.userDetails).trim()
    ? String(item.meta.userDetails).trim()
    : "";
}

function getStatusTooltip(item: AdminWithdrawal) {
  if (typeof item.adminNotes === "string" && item.adminNotes.trim()) return item.adminNotes.trim();
  if (typeof item.meta?.adminNotes === "string" && String(item.meta.adminNotes).trim()) {
    return String(item.meta.adminNotes).trim();
  }
  if (typeof item.meta?.reason === "string" && String(item.meta.reason).trim()) {
    return String(item.meta.reason).trim();
  }
  return "";
}

function getAdminFinancialDetails(item: AdminWithdrawal) {
  const meta = item.meta || {};
  const requestedAmount = Number(meta.requestedAmount);
  const payoutAmount = Number(meta.payoutAmount);
  const netAmount = Number(meta.netAmount);
  const adminFeeAmount = Number(meta.adminFeeAmount);
  const adminFeePercent = Number(meta.adminFeePercent);
  const earlyPenaltyAmount = Number(meta.earlyPenaltyAmount);
  const earlyPenaltyPercent = Number(meta.earlyPenaltyPercent);
  const isRejected = String(item.status || "").trim().toLowerCase() === "rejected";
  const returnedAmount = isRejected
    ? Number.isFinite(requestedAmount) && requestedAmount > 0
      ? requestedAmount
      : Number(item.amount || 0)
    : null;

  const details: Array<{ label: string; value: string }> = [];

  if (Number.isFinite(requestedAmount) && requestedAmount > 0) {
    details.push({ label: "Requested", value: `${formatCurrency(requestedAmount)} ${item.asset || ""}`.trim() });
  }
  if (Number.isFinite(netAmount) && netAmount > 0) {
    details.push({ label: "Net amount", value: `${formatCurrency(netAmount)} ${item.asset || ""}`.trim() });
  } else if (Number.isFinite(payoutAmount) && payoutAmount > 0) {
    details.push({ label: "Paid amount", value: `${formatCurrency(payoutAmount)} ${item.asset || ""}`.trim() });
  }
  if (Number.isFinite(adminFeeAmount) && adminFeeAmount > 0) {
    details.push({
      label: "Admin fee",
      value: `${formatCurrency(adminFeeAmount)} ${item.asset || ""}${Number.isFinite(adminFeePercent) && adminFeePercent > 0 ? ` (${adminFeePercent}%)` : ""}`.trim(),
    });
  }
  if (Number.isFinite(earlyPenaltyAmount) && earlyPenaltyAmount > 0) {
    details.push({
      label: "Commission / penalty",
      value: `${formatCurrency(earlyPenaltyAmount)} ${item.asset || ""}${Number.isFinite(earlyPenaltyPercent) && earlyPenaltyPercent > 0 ? ` (${earlyPenaltyPercent}%)` : ""}`.trim(),
    });
  }
  if (returnedAmount !== null) {
    details.push({ label: "Returned on reject", value: `${formatCurrency(returnedAmount)} ${item.asset || ""}`.trim() });
  }

  return details;
}
