import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import {
  exportAdminIncomeLedger,
  fetchAdminIncomeLedger,
  fetchAdminIncomeLedgerSummary,
  type AdminIncomeLedgerRow,
} from "../api/admin.api";

const shellCls =
  "relative overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,18,32,0.92),rgba(8,12,22,0.96))] p-5 shadow-[0_30px_90px_-45px_rgba(34,211,238,0.28)] backdrop-blur-xl";
const panelCls = shellCls;
const tableWrapCls = "overflow-x-auto rounded-[22px] border border-white/10 bg-slate-950/60";
const headCellCls =
  "sticky top-0 z-10 bg-slate-950/95 px-4 py-3 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400";
const bodyCellCls = "px-4 py-4 align-top text-slate-200";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const incomeTypeLabel: Record<string, string> = {
  direct_sponsor_commission: "Direct Sponsor",
  joined_commission: "Joined Commission",
  level_bonus_10day: "10-Day Level",
  level_promotion_reward: "Level Reward",
  signal_income: "Signal Income",
  admin_adjustment_credit: "admin_deposit",
  admin_adjustment_debit: "admin_withdraw",
};

const incomeGroups = [
  { key: "", label: "All Ledger" },
  { key: "referral", label: "Referral" },
  { key: "level", label: "Level Bonus" },
  { key: "signal", label: "Signal Income" },
  { key: "admin", label: "Admin Wallet" },
  { key: "top", label: "Top Earners" },
  { key: "recent", label: "Recent Entries" },
];

const statusOptions = ["", "SUCCESS", "PENDING", "FAILED"];
const typeOptions = ["", ...Object.keys(incomeTypeLabel)];
const limitOptions = [20, 50, 100];

type Filters = {
  page: number;
  limit: number;
  group: string;
  search: string;
  incomeType: string;
  level: string;
  status: string;
  fromDate: string;
  toDate: string;
};

type SortKey = "createdAt" | "amount" | "userName" | "status" | "incomeType" | "txn_id" | "sourceUser" | "reference";

const defaultFilters: Filters = {
  page: 1,
  limit: 20,
  group: "",
  search: "",
  incomeType: "",
  level: "",
  status: "",
  fromDate: "",
  toDate: "",
};

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatAmount(value: number) {
  return money.format(Number(value || 0));
}

function badgeClass(value: string) {
  const normalized = value.toLowerCase();
  if (normalized === "success") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (normalized === "failed") return "border-rose-400/30 bg-rose-500/10 text-rose-200";
  if (normalized === "pending") return "border-amber-400/30 bg-amber-500/10 text-amber-200";
  return "border-white/10 bg-white/5 text-slate-200";
}

function typeBadgeClass(value: string) {
  if (value === "signal_income") return "border-cyan-400/30 bg-cyan-500/10 text-cyan-200";
  if (value === "admin_adjustment_credit") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (value === "admin_adjustment_debit") return "border-rose-400/30 bg-rose-500/10 text-rose-200";
  if (value.includes("level")) return "border-violet-400/30 bg-violet-500/10 text-violet-200";
  return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
}

function formatSignedAmount(row: AdminIncomeLedgerRow) {
  const absolute = formatAmount(Math.abs(Number(row.amount || 0)));
  if (row.incomeType === "admin_adjustment_credit") return `+${absolute}`;
  if (row.incomeType === "admin_adjustment_debit") return `-${absolute}`;
  return absolute;
}

function amountClass(row: AdminIncomeLedgerRow) {
  if (row.incomeType === "admin_adjustment_credit") return "text-emerald-300";
  if (row.incomeType === "admin_adjustment_debit") return "text-rose-300";
  return "text-white";
}

export default function AdminCommissionHistoryPage() {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftSearch, setDraftSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [selectedRow, setSelectedRow] = useState<AdminIncomeLedgerRow | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["admin", "income-ledger-summary"],
    queryFn: fetchAdminIncomeLedgerSummary,
  });

  const ledgerQuery = useQuery({
    queryKey: ["admin", "income-ledger", filters],
    queryFn: () =>
      fetchAdminIncomeLedger({
        page: filters.page,
        limit: filters.limit,
        search: filters.search || undefined,
        incomeType: filters.incomeType || undefined,
        level: filters.level || undefined,
        status: filters.status || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
        group: filters.group || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const summary = summaryQuery.data;
  const items = ledgerQuery.data?.items ?? [];
  const pagination = ledgerQuery.data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 };
  const latestEntry = items[0];
  const avgIncomePerUser = summary && summary.totalBeneficiaryUsers > 0
    ? summary.totalCombinedIncome / summary.totalBeneficiaryUsers
    : 0;
  const topType = useMemo(() => {
    const rows = items;
    const totals = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.incomeType] = (acc[row.incomeType] ?? 0) + row.amount;
      return acc;
    }, {});
    const winner = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    return winner ? winner[0] : "-";
  }, [items]);
  const highestBeneficiaryCount = useMemo(() => {
    const counts = new Map<string | number, number>();
    for (const row of items) counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
    const winner = Array.from(counts.values()).sort((a, b) => b - a)[0] ?? 0;
    return winner;
  }, [items]);

  const cards = useMemo(
    () => [
      { label: "Total Direct Sponsor Income", value: formatAmount(summary?.totalDirectSponsorIncome ?? 0) },
      { label: "Total Joined Income", value: formatAmount(summary?.totalJoinedIncome ?? 0) },
      { label: "Total 10-Day Level Income", value: formatAmount(summary?.totalLevelBonus10DayIncome ?? 0) },
      { label: "Total One-Time Level Rewards", value: formatAmount(summary?.totalLevelPromotionRewardIncome ?? 0) },
      { label: "Total Signal Income", value: formatAmount(summary?.totalSignalIncome ?? 0) },
      { label: "Total Combined Income", value: formatAmount(summary?.totalCombinedIncome ?? 0) },
      { label: "Total Beneficiary Users", value: compact.format(summary?.totalBeneficiaryUsers ?? 0) },
    ],
    [summary]
  );

  const applySearch = () => setFilters((prev) => ({ ...prev, page: 1, search: draftSearch.trim() }));
  const reset = () => {
    setDraftSearch("");
    setFilters(defaultFilters);
  };

  const refresh = async () => {
    await Promise.all([summaryQuery.refetch(), ledgerQuery.refetch()]);
  };

  const handleExport = async () => {
    const blob = await exportAdminIncomeLedger({
      search: filters.search || undefined,
      incomeType: filters.incomeType || undefined,
      level: filters.level || undefined,
      status: filters.status || undefined,
      fromDate: filters.fromDate || undefined,
      toDate: filters.toDate || undefined,
      group: filters.group || undefined,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "income-ledger.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const loading = ledgerQuery.isLoading || summaryQuery.isLoading;
  const activeTab = filters.group || "";
  const sortedItems = useMemo(() => {
    const next = [...items];
    next.sort((a, b) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === "amount") return ((Number(av) || 0) - (Number(bv) || 0)) * direction;
      if (sortKey === "createdAt") return (new Date(String(a.event_at || a.createdAt)).getTime() - new Date(String(b.event_at || b.createdAt)).getTime()) * direction;
      return String(av ?? "").localeCompare(String(bv ?? "")) * direction;
    });
    return next;
  }, [items, sortDirection, sortKey]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "createdAt" ? "desc" : "asc");
  };

  return (
    <div className="space-y-6 text-slate-100">
      <header className="relative overflow-hidden rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.16),transparent_35%),radial-gradient(circle_at_top_right,rgba(139,92,246,0.14),transparent_34%),linear-gradient(180deg,rgba(13,18,32,0.95),rgba(8,12,22,0.97))] p-6 shadow-[0_36px_90px_-50px_rgba(34,211,238,0.35)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="text-[11px] uppercase tracking-[0.35em] text-cyan-300/80">Admin Ledger Overview</div>
            <h2 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">Income Ledger Overview</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300/80">
              Executive ledger tracking across referral, level, signal, and manual admin wallet adjustments with fast filtering, export, and user-level review.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[340px]">
            <Input type="date" value={filters.fromDate} onChange={(e) => setFilters((prev) => ({ ...prev, fromDate: e.target.value, page: 1 }))} />
            <Input type="date" value={filters.toDate} onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value, page: 1 }))} />
            <Button variant="secondary" onClick={() => void refresh()}>Refresh</Button>
            <Button variant="secondary" onClick={() => void handleExport()}>Export CSV</Button>
          </div>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className={panelCls}>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{card.label}</div>
            <div className="mt-3 text-3xl font-semibold text-white">{card.value}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InsightCard label="Top Earning Income Type" value={incomeTypeLabel[topType] ?? "—"} />
        <InsightCard label="Highest Beneficiary Count" value={compact.format(highestBeneficiaryCount)} />
        <InsightCard label="Latest Income Entry" value={latestEntry ? formatDate(latestEntry.createdAt) : "—"} />
        <InsightCard label="Average Income Per User" value={formatAmount(avgIncomePerUser)} />
      </section>

      <section className={panelCls}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="grid flex-1 gap-3 lg:grid-cols-4">
            <Input value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} placeholder="Search name, email, user ID, referral code" />
            <select value={filters.incomeType} onChange={(e) => setFilters((prev) => ({ ...prev, incomeType: e.target.value, page: 1 }))} className="h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white">
            {typeOptions.map((type) => <option key={type || "all"} value={type}>{type ? incomeTypeLabel[type] : "All ledger types"}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value, page: 1 }))} className="h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white">
            {statusOptions.map((status) => <option key={status || "all"} value={status}>{status ? status : "All status"}</option>)}
            </select>
            <Input value={filters.level} onChange={(e) => setFilters((prev) => ({ ...prev, level: e.target.value, page: 1 }))} placeholder="Filter by level" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={String(filters.limit)} onChange={(e) => setFilters((prev) => ({ ...prev, limit: Number(e.target.value), page: 1 }))} className="h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white">
            {limitOptions.map((limit) => <option key={limit} value={limit}>{limit} / page</option>)}
            </select>
            <Button onClick={applySearch}>Search</Button>
            <Button variant="secondary" onClick={reset}>Reset</Button>
            <Button variant="secondary" onClick={() => void handleExport()}>Save Filter</Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {incomeGroups.map((tab) => (
            <button
              key={tab.key || "all"}
              type="button"
              onClick={() => {
                setFilters((prev) => ({ ...prev, group: tab.key, page: 1 }));
                if (tab.key === "recent") setSortKey("createdAt");
                if (tab.key === "top") setSortKey("amount");
              }}
              className={`rounded-full border px-4 py-2 text-xs font-medium transition ${
                activeTab === tab.key
                  ? "border-cyan-400/30 bg-cyan-500/10 text-cyan-200"
                  : "border-white/10 bg-white/5 text-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      <section className={panelCls}>
        <div className={tableWrapCls}>
          <table className="min-w-[1300px] w-full text-sm">
            <thead>
              <tr>
                {[
                  ["Timestamp", "createdAt"],
                  ["Transaction ID", "txn_id"],
                  ["Income Type", "incomeType"],
                  ["Primary User", "userName"],
                  ["Source User", "sourceUser"],
                  ["Reference", "reference"],
                  ["Amount", "amount"],
                  ["Status", "status"],
                  ["Action", null],
                ].map(([header, key]) => (
                  <th key={header} className={headCellCls}>
                    {key ? (
                      <button type="button" className="inline-flex items-center gap-1" onClick={() => handleSort(key as SortKey)}>
                        {header}
                        <span className="text-[10px] text-slate-500">{sortKey === key ? (sortDirection === "asc" ? "↑" : "↓") : "⇅"}</span>
                      </button>
                    ) : (
                      header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="px-4 py-10"><TableSkeleton rows={4} /></td></tr>
              )}
              {!loading && sortedItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12">
                    <EmptyState
                      title="No income records found"
                      description="Try widening the date range, clearing filters, or switching to All Ledger."
                    />
                  </td>
                </tr>
              )}
              {!loading && sortedItems.map((row) => (
                <tr key={`${row.incomeType}-${row.id}`} className="border-t border-white/5 transition hover:bg-white/5 hover:shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]">
                  <td className={bodyCellCls}>
                    <div className="font-medium text-white">{formatDate(row.event_at || row.createdAt)}</div>
                    <div className="text-xs text-slate-400">{row.createdAt ? `Created ${formatDate(row.createdAt)}` : "-"}</div>
                  </td>
                  <td className={bodyCellCls}>
                    <div className="font-medium text-white">{row.txn_id}</div>
                    {row.order_id ? <div className="text-xs text-cyan-300">{row.order_id}</div> : null}
                  </td>
                  <td className={bodyCellCls}><span className={`${typeBadgeClass(row.incomeType)}`}>{incomeTypeLabel[row.incomeType] ?? row.incomeType}</span></td>
                  <td className={bodyCellCls}>
                    <div className="font-medium text-white">{row.userName}</div>
                    <div className="text-xs text-slate-400">{row.userEmail}</div>
                  </td>
                  <td className={bodyCellCls}>{row.sourceUser || "-"}</td>
                  <td className={bodyCellCls}>
                    <div className="font-medium text-white">{row.reference || "-"}</div>
                    {row.remark ? <div className="text-xs text-slate-400">{row.remark}</div> : null}
                  </td>
                  <td className={bodyCellCls}>
                    <div className={`font-semibold ${amountClass(row)}`}>{formatSignedAmount(row)}</div>
                    {row.asset ? <div className="text-xs text-slate-400">{row.asset}</div> : null}
                  </td>
                  <td className={bodyCellCls}><span className={`rounded-full border px-3 py-1 text-xs ${badgeClass(row.status)}`}>{row.status}</span></td>
                  <td className={bodyCellCls}>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <button className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200" onClick={() => setSelectedRow(row)}>View</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300/80">
          <div>
            Showing <span className="text-white">{items.length}</span> of <span className="text-white">{pagination.total}</span> records
          </div>
          <div>
            Page <span className="text-white">{pagination.page}</span> of <span className="text-white">{Math.max(pagination.totalPages, 1)}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={pagination.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}>Previous</Button>
            <Button variant="secondary" disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages} onClick={() => setFilters((prev) => ({ ...prev, page: Math.min(Math.max(pagination.totalPages, 1), prev.page + 1) }))}>Next</Button>
          </div>
        </div>
      </section>

      {selectedRow ? (
        <DetailsModal row={selectedRow} onClose={() => setSelectedRow(null)} />
      ) : null}
    </div>
  );
}

function InsightCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={`${panelCls} border-white/15 bg-[linear-gradient(180deg,rgba(19,24,40,0.9),rgba(10,14,24,0.94))]`}>
      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-4 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

function DetailsModal({ row, onClose }: { row: AdminIncomeLedgerRow; onClose: () => void }) {
  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(String(row.reference ?? ""));
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-md">
      <div className="w-full max-w-4xl rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,18,32,0.98),rgba(8,12,22,0.98))] p-6 shadow-[0_40px_120px_-55px_rgba(34,211,238,0.35)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-cyan-300/80">Ledger Details</div>
            <h3 className="mt-2 text-2xl font-semibold text-white">{row.userName}</h3>
            <p className="mt-1 text-sm text-slate-300/80">{row.userEmail}</p>
          </div>
          <button className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <DetailItem label="Txn ID" value={row.txn_id} />
          <DetailItem label="Order ID" value={row.order_id || "-"} />
          <DetailItem label="Income Type" value={incomeTypeLabel[row.incomeType] ?? row.incomeType} />
          <DetailItem label="Amount" value={formatSignedAmount(row)} />
          <DetailItem label="Asset" value={row.asset || "-"} />
          <DetailItem label="Status" value={row.status} />
          <DetailItem label="Primary User ID" value={String(row.primary_user_id)} />
          <DetailItem label="Source User ID" value={String(row.source_user_id ?? "-")} />
          <DetailItem label="Level" value={row.level || "-"} />
          <DetailItem label="Reference Type" value={String(row.reference_type ?? "-")} />
          <DetailItem label="Reference ID" value={String(row.reference_id ?? "-")} />
          <DetailItem label="Remark" value={row.remark || "-"} />
          <DetailItem label="Event At" value={formatDate(row.event_at || row.createdAt)} />
          <DetailItem label="Created At" value={formatDate(row.createdAt)} />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={copyRef}>Copy Reference</Button>
          <Button variant="secondary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-2xl bg-white/5" />
      ))}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto max-w-lg rounded-[22px] border border-white/10 bg-white/5 px-6 py-8 text-center">
      <div className="text-lg font-semibold text-white">{title}</div>
      <p className="mt-2 text-sm leading-6 text-slate-300/80">{description}</p>
    </div>
  );
}
