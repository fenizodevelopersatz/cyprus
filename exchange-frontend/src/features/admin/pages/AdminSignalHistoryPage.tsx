import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import {
  fetchAdminSignalHistoryByToken,
  fetchAdminSignalHistoryDayWise,
  type AdminSignalHistoryDayWiseRow,
  type AdminSignalHistoryTokenDetail,
} from "../api/admin.api";

const cardCls = "rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl";
const tableWrapCls = "overflow-x-auto rounded-2xl border border-white/10";
const headCellCls = "px-4 py-3 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400";
const bodyCellCls = "px-4 py-3 align-middle text-slate-200";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Request failed";
  }
  if (error instanceof Error) return error.message;
  return "Request failed";
}

const findNumeric = (entry: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    if (key in entry) {
      const numeric = Number(entry[key]);
      if (Number.isFinite(numeric)) return numeric;
    }
  }
  return 0;
};

const findText = (entry: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
};

const formatDateTime = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export default function AdminSignalHistoryPage() {
  const [selectedToken, setSelectedToken] = useState("");
  const [lookupToken, setLookupToken] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const historyQuery = useQuery({
    queryKey: ["admin", "signal-history", "day-wise"],
    queryFn: fetchAdminSignalHistoryDayWise,
  });

  const detailQuery = useQuery({
    queryKey: ["admin", "signal-history", "token", lookupToken],
    queryFn: () => fetchAdminSignalHistoryByToken(lookupToken),
    enabled: lookupToken.length === 10,
  });

  const details = detailQuery.data;

  const usageRows = useMemo(() => buildUserUsage(details), [details]);
  const profitReport = useMemo(() => buildProfitReport(details), [details]);

  const openToken = (token: string) => {
    if (!token || token.length !== 10) return;
    setFeedback(null);
    setSelectedToken(token);
    setLookupToken(token);
  };

  return (
    <div className="space-y-6 text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-300/80">Signals</div>
          <h2 className="text-2xl font-semibold text-white">Signals History</h2>
          <p className="text-sm text-slate-300/80">
            Inspect batch logs, user signal usage, and profit performance for each generated signal token.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-sm text-slate-300">
            <span className="mb-2 block">Batch token lookup</span>
            <Input
              value={selectedToken}
              onChange={(event) => setSelectedToken(event.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="Enter 10-digit token"
              className="min-w-[220px] bg-white/5 text-white"
            />
          </label>
          <Button onClick={() => openToken(selectedToken)} disabled={selectedToken.length !== 10}>
            View
          </Button>
        </div>
      </header>

      {(feedback || historyQuery.error || detailQuery.error) && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {feedback ?? getErrorMessage(historyQuery.error ?? detailQuery.error)}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Signal logs" value={String(details?.signals.length ?? 0)} helper="Signals in selected batch" />
        <MetricCard label="User signal usage" value={String(details?.userSignalLogs.length ?? 0)} helper="Usage logs in selected batch" />
        <MetricCard label="Profit generated" value={usd.format(profitReport.totalProfit)} helper="Sum of user profit amounts" />
        <MetricCard label="Usage success rate" value={`${profitReport.successRate}%`} helper="Successful logs in selected batch" />
      </section>

      <section className={cardCls}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Signal Logs</h3>
            <p className="text-sm text-slate-300/80">
              Day-wise signal batch history. Click any token to inspect its detailed logs.
            </p>
          </div>
          <Button variant="ghost" onClick={() => historyQuery.refetch()} disabled={historyQuery.isFetching}>
            {historyQuery.isFetching ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        <div className={tableWrapCls}>
          <table className="min-w-full text-sm">
            <thead className="bg-white/5">
              <tr>
                <th className={headCellCls}>Date</th>
                <th className={headCellCls}>09:00</th>
                <th className={headCellCls}>12:00</th>
                <th className={headCellCls}>15:00</th>
                <th className={headCellCls}>18:00</th>
                <th className={headCellCls}>Created</th>
              </tr>
            </thead>
            <tbody>
              {historyQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Loading signal history...
                  </td>
                </tr>
              )}
              {!historyQuery.isLoading && (historyQuery.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No signal batch history found.
                  </td>
                </tr>
              )}
              {(historyQuery.data ?? []).map((row) => (
                <SignalHistoryRow key={row.date} row={row} onOpen={openToken} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <section className={cardCls}>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-white">User Signal Usage</h3>
            <p className="text-sm text-slate-300/80">
              Per-user usage counts and earnings for the selected token.
            </p>
          </div>
          <div className={tableWrapCls}>
            <table className="min-w-full text-sm">
              <thead className="bg-white/5">
                <tr>
                  <th className={headCellCls}>User</th>
                  <th className={headCellCls}>Usages</th>
                  <th className={headCellCls}>Invested</th>
                  <th className={headCellCls}>Profit</th>
                  <th className={headCellCls}>Status</th>
                </tr>
              </thead>
              <tbody>
                {!details && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      Select a batch token to view user usage.
                    </td>
                  </tr>
                )}
                {details && usageRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      No user signal logs found for this token.
                    </td>
                  </tr>
                )}
                {usageRows.map((row) => (
                  <tr key={row.userKey} className="border-t border-white/5">
                    <td className={bodyCellCls}>{row.userLabel}</td>
                    <td className={bodyCellCls}>{row.usages}</td>
                    <td className={bodyCellCls}>{usd.format(row.totalInvestment)}</td>
                    <td className={bodyCellCls}>{usd.format(row.totalProfit)}</td>
                    <td className={bodyCellCls}>{row.statusLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={cardCls}>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-white">Profit Report</h3>
            <p className="text-sm text-slate-300/80">
              Batch-level performance snapshot for the currently selected signal token.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MetricCard label="Total investment" value={usd.format(profitReport.totalInvestment)} helper="Sum of invested amounts" />
            <MetricCard label="Total profit" value={usd.format(profitReport.totalProfit)} helper="Sum of profit amounts" />
            <MetricCard label="Total earned" value={usd.format(profitReport.totalEarned)} helper="Sum of total earned values" />
            <MetricCard label="Avg profit/log" value={usd.format(profitReport.averageProfit)} helper="Average across usage logs" />
          </div>
          {details && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-slate-300">
              <div className="font-medium text-white">Selected batch</div>
              <div className="mt-1">{details.batch.batchToken}</div>
              <div className="mt-2 text-xs text-slate-400">
                {details.batch.slotDate} | {details.batch.slotName ?? "Slot"} {details.batch.slotTime} | {details.batch.status}
              </div>
            </div>
          )}
        </section>
      </section>

      {details && (
        <section className={cardCls}>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-white">Batch Detail</h3>
            <p className="text-sm text-slate-300/80">
              Raw batch records for debugging and audit review.
            </p>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <JsonPanel title="Signals" data={details.signals} />
            <JsonPanel title="User Signal Logs" data={details.userSignalLogs} />
          </div>
        </section>
      )}
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className={cardCls}>
      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</div>
      <div className="mt-3 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-2 text-xs text-slate-400">{helper}</div>
    </div>
  );
}

function SignalHistoryRow({ row, onOpen }: { row: AdminSignalHistoryDayWiseRow; onOpen: (token: string) => void }) {
  return (
    <tr className="border-t border-white/5">
      <td className={bodyCellCls}>{row.date}</td>
      {(["9", "12", "3", "6"] as const).map((column) => (
        <td key={`${row.date}-${column}`} className={bodyCellCls}>
          {row[column] ? (
            <button
              type="button"
              onClick={() => onOpen(row[column] as string)}
              className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-100 transition hover:bg-cyan-400/20"
            >
              {row[column]}
            </button>
          ) : (
            <span className="text-slate-500">-</span>
          )}
        </td>
      ))}
      <td className={bodyCellCls}>{row.createdAt ? formatDateTime(row.createdAt) : "-"}</td>
    </tr>
  );
}

function JsonPanel({ title, data }: { title: string; data: Array<Record<string, unknown>> }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <div className="mb-3 text-sm font-medium text-white">{title}</div>
      <pre className="max-h-[420px] overflow-auto rounded-xl bg-slate-950/70 p-3 text-xs text-slate-200">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function buildUserUsage(details?: AdminSignalHistoryTokenDetail | null) {
  if (!details) return [];

  const grouped = new Map<
    string,
    { userKey: string; userLabel: string; usages: number; totalInvestment: number; totalProfit: number; statuses: Set<string> }
  >();

  for (const item of details.userSignalLogs) {
    const userId = findText(item, ["userId", "user_id"]);
    const userEmail = findText(item, ["email", "userEmail", "user_email"]);
    const key = userId || userEmail || `row-${grouped.size + 1}`;
    const existing = grouped.get(key) ?? {
      userKey: key,
      userLabel: userEmail || userId || "Unknown user",
      usages: 0,
      totalInvestment: 0,
      totalProfit: 0,
      statuses: new Set<string>(),
    };
    existing.usages += 1;
    existing.totalInvestment += findNumeric(item, ["investment_amount", "investmentAmount"]);
    existing.totalProfit += findNumeric(item, ["profit_amount", "profitAmount", "total_earned", "totalEarned"]);
    existing.statuses.add(findText(item, ["status"]) || "SUCCESS");
    grouped.set(key, existing);
  }

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      statusLabel: Array.from(row.statuses).join(", "),
    }))
    .sort((a, b) => b.totalProfit - a.totalProfit);
}

function buildProfitReport(details?: AdminSignalHistoryTokenDetail | null) {
  const logs = details?.userSignalLogs ?? [];
  const totalInvestment = logs.reduce(
    (sum, item) => sum + findNumeric(item, ["investment_amount", "investmentAmount"]),
    0
  );
  const totalProfit = logs.reduce(
    (sum, item) => sum + findNumeric(item, ["profit_amount", "profitAmount"]),
    0
  );
  const totalEarned = logs.reduce(
    (sum, item) => sum + findNumeric(item, ["total_earned", "totalEarned", "profit_amount", "profitAmount"]),
    0
  );
  const successCount = logs.filter((item) => {
    const status = findText(item, ["status"]).toUpperCase();
    return !status || status === "SUCCESS";
  }).length;
  return {
    totalInvestment,
    totalProfit,
    totalEarned,
    averageProfit: logs.length ? totalProfit / logs.length : 0,
    successRate: logs.length ? Math.round((successCount / logs.length) * 100) : 0,
  };
}
