import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import { fetchOrdersAudit, fetchOrdersAuditSummary } from "../api/ordersAudit.api";

const panelCls = "rounded-3xl border border-white/10 bg-white/6 p-4 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.18)] sm:p-5";

const labelMap: Record<string, string> = {
  signal_income: "Signal Income",
  direct_sponsor_commission: "Direct Sponsor Income",
  joined_commission: "Joined Commission",
  level_bonus_10day: "10-Day Level Income",
  level_promotion_reward: "Level Reward",
  admin_adjustment_credit: "admin_deposit",
  admin_adjustment_debit: "admin_withdraw",
};

const selectCls =
  "h-10 rounded-xl border border-white/10 bg-slate-900 text-[11px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20 sm:text-[13px]";

export default function OrdersPage() {
  const [draftSearch, setDraftSearch] = useState("");
  const [filters, setFilters] = useState({ incomeType: "", fromDate: "", toDate: "", page: 1, limit: 50 });
  const [search, setSearch] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ["user", "orders-audit-summary", { incomeType: filters.incomeType, fromDate: filters.fromDate, toDate: filters.toDate, search }],
    queryFn: () =>
      fetchOrdersAuditSummary({
        incomeType: filters.incomeType || undefined,
        search: search || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
      }),
  });

  const listQuery = useQuery({
    queryKey: ["user", "orders-audit", filters, search],
    queryFn: () =>
      fetchOrdersAudit({
        page: filters.page,
        limit: filters.limit,
        incomeType: filters.incomeType || undefined,
        search: search || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
      }),
    placeholderData: (prev) => prev,
  });

  const summary = summaryQuery.data;
  const items = listQuery.data?.items ?? [];
  const pagination = listQuery.data?.pagination ?? { page: 1, limit: 50, total: 0, totalPages: 0 };
  const loading = summaryQuery.isLoading || listQuery.isLoading || listQuery.isFetching;

  const activeTypes = useMemo(() => Object.entries(labelMap), []);

  const copyToClipboard = async (value: string, key: string) => {
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = value;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "absolute";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1800);
    } catch (error) {
      console.error("Failed to copy audit value", error);
    }
  };

  const handleSearch = () => {
    setSearch(draftSearch.trim());
    setFilters((prev) => ({ ...prev, page: 1 }));
  };

  const reset = () => {
    setDraftSearch("");
    setSearch("");
    setFilters({ incomeType: "", fromDate: "", toDate: "", page: 1, limit: 50 });
  };

  return (
    <div className="space-y-4 px-1 text-slate-100 sm:space-y-5 sm:px-0">
      <header className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_34%),radial-gradient(circle_at_top_right,rgba(99,102,241,0.15),transparent_36%),linear-gradient(180deg,rgba(12,16,28,0.98),rgba(7,10,18,0.98))] p-4 shadow-[0_30px_90px_-45px_rgba(34,211,238,0.35)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="text-[9px] uppercase tracking-[0.28em] text-cyan-300/80 sm:text-[10px] sm:tracking-[0.3em]">Orders Audit History</div>
            <h1 className="mt-2 text-[1rem] font-semibold leading-tight text-white sm:text-[1.95rem]">Wallet And Orders Activity</h1>
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-2 lg:max-w-[520px] xl:min-w-[420px]">
            <Input
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              placeholder="Search txn id / order id / signal code"
              className="h-10 text-[11px] sm:text-[13px]"
            />
            <select
              value={filters.incomeType}
              onChange={(e) => setFilters((prev) => ({ ...prev, incomeType: e.target.value, page: 1 }))}
              className={`${selectCls} px-3`}
            >
              <option value="">All activity types</option>
              {activeTypes.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <Input type="date" value={filters.fromDate} onChange={(e) => setFilters((prev) => ({ ...prev, fromDate: e.target.value, page: 1 }))} className="h-10 text-[11px] sm:text-[13px]" />
            <Input type="date" value={filters.toDate} onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value, page: 1 }))} className="h-10 text-[11px] sm:text-[13px]" />
            <select
              value={filters.limit}
              onChange={(e) => setFilters((prev) => ({ ...prev, limit: Number(e.target.value), page: 1 }))}
              className={`${selectCls} px-3`}
            >
              {[20, 50, 100].map((limit) => (
                <option key={limit} value={limit}>
                  {limit} / page
                </option>
              ))}
            </select>
            <Button variant="secondary" size="sm" className="text-[11px] sm:text-[13px]" onClick={handleSearch}>Search</Button>
            <Button
              variant="secondary"
              size="sm"
              className="text-[11px] sm:text-[13px]"
              onClick={() => {
                void summaryQuery.refetch();
                void listQuery.refetch();
              }}
            >
              Refresh
            </Button>
            <Button variant="secondary" size="sm" className="text-[11px] sm:text-[13px]" onClick={reset}>Reset</Button>
          </div>
        </div>
      </header>

      <section className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 xl:grid-cols-5">
        <Metric label="Total Signal Income" value={formatMoney(summary?.totalSignalIncome ?? 0)} />
        <Metric label="Total Direct Income" value={formatMoney(summary?.totalDirectIncome ?? 0)} />
        <Metric label="Total Joined Income" value={formatMoney(summary?.totalJoinedIncome ?? 0)} />
        <Metric label="Total Level Income" value={formatMoney(summary?.totalLevelIncome ?? 0)} />
        <Metric label="Total Combined Income" value={formatMoney(summary?.totalCombinedIncome ?? 0)} />
      </section>

      <section className={`${panelCls} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/90 sm:text-[13px] sm:normal-case sm:tracking-normal">Audit History</div>
          </div>
          <div className="text-[10px] text-slate-400 sm:text-[11px]">{loading ? "Loading..." : `${pagination.total} rows`}</div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/8">
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full text-left">
            <thead className="border-b border-white/10 text-[9px] uppercase tracking-[0.16em] text-slate-400 sm:text-[10px]">
              <tr>
                <th className="px-3 py-3">Timestamp</th>
                <th className="px-3 py-3">Txn ID</th>
                <th className="px-3 py-3">Order / Ref ID</th>
                <th className="px-3 py-3">Activity Type</th>
                <th className="px-3 py-3">Amount</th>
                <th className="px-3 py-3">Package / Level</th>
                <th className="px-3 py-3">Source</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-[11px] text-slate-400 sm:text-[13px]">No rows found.</td>
                </tr>
              )}
              {items.map((row) => (
                <tr key={`${row.incomeType}-${row.id}`} className="border-b border-white/5 transition hover:bg-white/5">
                  <td className="px-3 py-3 text-[11px] text-slate-200 sm:text-[13px]">{formatDate(row.timestamp)}</td>
                  <td className="px-3 py-3">
                    <CopyValue
                      value={row.txn_id}
                      copied={copiedKey === `txn-${row.id}`}
                      tone="cyan"
                      onCopy={() => void copyToClipboard(row.txn_id, `txn-${row.id}`)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <span className="break-all text-[10px] text-slate-200 sm:text-[11px]">
                        {String(row.signal_token ?? row.batch_token ?? row.orderRefId ?? row.order_id ?? "-")}
                      </span>
                      {buildReferenceCaption(row) ? (
                        <span className="break-all text-[9px] text-slate-500 sm:text-[10px]">{buildReferenceCaption(row)}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      <span className={getActivityTypeClassName(row.incomeType)}>
                        {labelMap[row.incomeType] ?? row.incomeType}
                      </span>
                      <span className="text-[9px] text-slate-500 sm:text-[10px]">{buildActivityMeta(row)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">{renderAmountCell(row.amount)}</td>
                  <td className="px-3 py-3 text-[11px] text-slate-300 sm:text-[13px]">{getPackageLevelLabel(row)}</td>
                  <td className="px-3 py-3 text-[11px] text-slate-300 sm:text-[13px]">{renderSourceCell(row)}</td>
                  <td className="px-3 py-3 text-[11px] uppercase text-slate-300">
                    <span className="inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[9px] font-medium tracking-[0.14em] text-emerald-200 sm:px-2.5 sm:text-[10px]">
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 text-[10px] text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:text-[11px]">
          <span>
            Page {pagination.page} of {Math.max(pagination.totalPages, 1)}
          </span>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border border-white/10 px-3 py-2 text-[11px] disabled:opacity-40" disabled={pagination.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}>
              Prev
            </button>
            <button type="button" className="rounded-lg border border-white/10 px-3 py-2 text-[11px] disabled:opacity-40" disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages} onClick={() => setFilters((prev) => ({ ...prev, page: Math.min(Math.max(pagination.totalPages, 1), prev.page + 1) }))}>
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-3.5 backdrop-blur-xl sm:rounded-3xl sm:p-5">
      <div className="text-[8px] uppercase tracking-[0.17em] text-slate-400 sm:text-[9px]">{label}</div>
      <div className="mt-1.5 text-[0.95rem] font-semibold text-white sm:mt-3 sm:text-[1.2rem]">{value}</div>
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0));
}

function isAdminWalletActivity(incomeType: string) {
  return incomeType === "admin_adjustment_credit" || incomeType === "admin_adjustment_debit";
}

function getActivityTypeClassName(incomeType: string) {
  if (incomeType === "admin_adjustment_credit" || incomeType === "admin_adjustment_debit") {
    return "text-[10px] font-semibold uppercase tracking-[0.14em] text-white sm:text-[11px]";
  }
  return "text-[10px] text-white sm:text-[11px]";
}

function buildActivityMeta(row: {
  incomeType: string;
  symbol?: string | null;
  asset?: string | null;
  remark?: string | null;
  sourceUserName?: string | null;
  sourceUserEmail?: string | null;
}) {
  const parts: string[] = [];

  if (row.incomeType === "signal_income") parts.push("Trade");
  if (row.incomeType === "level_promotion_reward") parts.push("Promotion");
  if (row.incomeType === "direct_sponsor_commission" || row.incomeType === "joined_commission") parts.push("Referral");
  if (row.incomeType === "level_bonus_10day") parts.push("Level cycle");
  if (row.incomeType === "admin_adjustment_credit" || row.incomeType === "admin_adjustment_debit") parts.push("Admin wallet");

  if (row.symbol) parts.push(row.symbol);
  if (row.asset && !parts.includes(row.asset)) parts.push(row.asset);
  if (row.remark) parts.push(row.remark);

  return parts.filter(Boolean).join(" | ") || "-";
}

function buildReferenceCaption(row: {
  signal_token?: string | null;
  batch_token?: string | null;
  orderRefId?: string | number | null;
  order_id?: string | null;
  referenceDetails?: string | null;
}) {
  const detail = String(row.referenceDetails || "").trim();
  if (!detail) return "";

  const primaryValue = String(row.signal_token ?? row.batch_token ?? row.orderRefId ?? row.order_id ?? "").trim();
  if (!primaryValue) return detail;

  const cleaned = detail
    .replace(new RegExp(`\\b${escapeRegExp(primaryValue)}\\b`, "ig"), "")
    .replace(/\s+\|\s+/g, " | ")
    .replace(/\|\s*\|/g, "|")
    .replace(/^\s*\|\s*|\s*\|\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned === primaryValue ? "" : cleaned;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderAmountCell(amount: number) {
  const positive = amount >= 0;
  const textClass = "text-white";
  const sign = positive ? "+" : "-";
  const displayValue = `${sign}${formatMoney(Math.abs(amount))}`;

  return (
    <div className="flex flex-col">
      <span className={`text-[11px] font-semibold sm:text-[13px] ${textClass}`}>{displayValue}</span>
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getPackageLevelLabel(row: {
  incomeType: string;
  level?: string | null;
  packageName?: string | null;
  signalCode?: string | null;
  referenceDetails?: string | null;
}) {
  if (row.level) return row.level;
  if (row.packageName) return row.packageName;
  if (row.signalCode) return row.signalCode;
  if (isAdminWalletActivity(row.incomeType)) return "Wallet";

  const ref = (row.referenceDetails || "").trim();
  if (/lv\d+/i.test(ref)) {
    const match = ref.match(/lv\d+/i);
    if (match) return match[0].toUpperCase().replace("LV", "Lv");
  }

  return "-";
}

function renderSourceCell(row: {
  sourceUser?: string | null;
  sourceEmail?: string | null;
  sourceUserEmail?: string | null;
  sourceUserName?: string | null;
  sourceUserLabel?: string | null;
}) {
  const sourceName = row.sourceUserName?.trim();
  const sourceEmail = row.sourceUserEmail?.trim() || row.sourceEmail?.trim() || row.sourceUser?.trim();
  const sourceLabel = row.sourceUserLabel?.trim();

  if (sourceName || sourceEmail) {
    return (
      <span className="min-w-0">
        <span className="block truncate text-[11px] text-slate-100 sm:text-[13px]">{sourceName || sourceEmail}</span>
        {sourceName && sourceEmail ? <span className="block truncate text-[9px] text-slate-400 sm:text-[10px]">{sourceEmail}</span> : null}
      </span>
    );
  }

  if (sourceLabel) return <span className="break-all text-[11px] text-slate-300 sm:text-[13px]">{sourceLabel}</span>;

  return <span className="text-[11px] text-slate-500 sm:text-[13px]">-</span>;
}

function CopyValue({
  value,
  copied,
  onCopy,
  tone,
}: {
  value: string;
  copied: boolean;
  onCopy: () => void;
  tone: "cyan" | "slate";
}) {
  const displayValue = value || "-";
  const textClass = tone === "cyan" ? "text-cyan-300" : "text-slate-300";

  return (
    <div className="flex items-start gap-2">
      <span className={`break-all text-[11px] ${textClass} sm:text-[12px]`}>{displayValue}</span>
      {value && value !== "-" ? (
        <button
          type="button"
          onClick={onCopy}
          className={`mt-0.5 shrink-0 rounded-md border border-white/10 bg-white/5 p-1 transition hover:bg-white/10 ${copied ? "text-emerald-300" : "text-slate-400 hover:text-cyan-200"}`}
          title={copied ? "Copied" : "Copy"}
          aria-label={copied ? "Copied" : "Copy value"}
        >
          {copied ? <CopiedIcon /> : <CopyIcon />}
        </button>
      ) : null}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 9.75A2.25 2.25 0 0 1 11.25 7.5h6A2.25 2.25 0 0 1 19.5 9.75v7.5a2.25 2.25 0 0 1-2.25 2.25h-6A2.25 2.25 0 0 1 9 17.25v-7.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M15 7.5V6.75A2.25 2.25 0 0 0 12.75 4.5h-6A2.25 2.25 0 0 0 4.5 6.75v7.5a2.25 2.25 0 0 0 2.25 2.25H9"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function CopiedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
