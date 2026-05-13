import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePortfolioData } from "../hooks/usePortfolioData";

const numberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const qtyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

export default function PortfolioPage() {
  const {
    loading,
    error,
    equity,
    unrealizedPnl,
    positions,
    allocation,
    equityTimeline,
    activity,
    sipLiabilities,
    wsStatus,
    updatedAt,
    refresh,
  } = usePortfolioData();

  const activePositions = useMemo(
    () => positions.filter((position) => Number(position.qty) !== 0),
    [positions]
  );
  const allocationEntries = useMemo(
    () => allocation.slice().sort((a, b) => b.value - a.value),
    [allocation]
  );
  const recentActivity = useMemo(() => activity.slice(0, 8), [activity]);
  const sipCommitmentTotal = useMemo(
    () => sipLiabilities.reduce((sum, entry) => sum + (Number.isFinite(entry.amountFiat) ? entry.amountFiat : 0), 0),
    [sipLiabilities]
  );
  const sipCommitmentLabel = useMemo(() => {
    if (!sipLiabilities.length) return "No SIP commitments";
    return sipLiabilities.map((entry) => `${entry.currency} (${entry.asset})`).join(", ");
  }, [sipLiabilities]);
  const summaryColsClass = sipLiabilities.length ? "md:grid-cols-4" : "md:grid-cols-3";

  const statusMeta = useMemo(() => {
    switch (wsStatus) {
      case "open":
        return { label: "Live", tone: "bg-emerald-400" as const };
      case "connecting":
        return { label: "Syncing", tone: "bg-amber-400" as const };
      case "error":
        return { label: "Error", tone: "bg-rose-500" as const };
      default:
        return { label: "Idle", tone: "bg-slate-500" as const };
    }
  }, [wsStatus]);

  const exposedSymbolsLabel = activePositions.length
    ? activePositions.map((position) => position.symbol).join(", ")
    : "No open positions";

  const formattedUpdatedAt = useMemo(
    () =>
      updatedAt
        ? new Date(updatedAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : null,
    [updatedAt]
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold mb-1">Portfolio</h1>
            <p className="text-sm text-slate-300/90">
              Track holdings, exposure, and live performance across the Primerica portfolio service.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300/80">
            <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 uppercase tracking-[0.22em]">
              <span className={`h-2 w-2 rounded-full ${statusMeta.tone}`} />
              <span>{statusMeta.label}</span>
            </span>
            {formattedUpdatedAt ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                Updated {formattedUpdatedAt}
              </span>
            ) : null}
            <button
              type="button"
              onClick={refresh}
              className="rounded-full border border-white/10 bg-white/10 px-3 py-1 uppercase tracking-[0.22em] text-white transition hover:border-indigo-400/40 hover:bg-white/20"
            >
              Refresh
            </button>
          </div>
        </div>
        {error ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <span>{error}</span>
            <button
              type="button"
              onClick={refresh}
              className="rounded-lg border border-rose-500/40 bg-rose-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-50 transition hover:border-rose-400/60 hover:bg-rose-400/20"
            >
              Retry
            </button>
          </div>
        ) : null}
      </header>

      <section className={`grid ${summaryColsClass} gap-4`}>
        <SummaryCard
          label="Equity Value"
          value={`$${numberFormatter.format(equity)}`}
          sublabel="USDT balances plus marked positions"
        />
        <SummaryCard
          label="Unrealized PnL"
          value={`${unrealizedPnl >= 0 ? "+" : ""}${numberFormatter.format(unrealizedPnl)} USDT`}
          sublabel="Based on backend mark prices"
          positive={unrealizedPnl >= 0}
        />
        <SummaryCard
          label="Exposed Symbols"
          value={activePositions.length > 0 ? activePositions.length.toString() : "0"}
          sublabel={exposedSymbolsLabel}
        />
        {sipLiabilities.length > 0 && (
          <SummaryCard
            label="SIP Commitments"
            value={`$${numberFormatter.format(sipCommitmentTotal)}`}
            sublabel={sipCommitmentLabel}
          />
        )}
      </section>

      {sipLiabilities.length > 0 && (
        <section className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-lg text-slate-100 shadow-[0_20px_70px_-45px_rgba(99,102,241,0.35)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">SIP commitments</div>
              <div className="text-xs text-slate-300/80">
                Funds earmarked for upcoming SIP executions
              </div>
            </div>
            <div className="text-xs text-slate-300/80">
              Tracking {sipLiabilities.length} currency{sipLiabilities.length === 1 ? "" : " pairs"}
            </div>
          </div>
          <div className="space-y-2 text-sm">
            {sipLiabilities.map((entry) => (
              <div key={`${entry.currency}-${entry.asset}`} className="flex flex-wrap items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <div>
                  <div className="text-xs text-slate-400">{entry.currency}</div>
                  <div className="font-semibold text-white">
                    ${numberFormatter.format(entry.amountFiat)}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-300/80">
                  <div>{qtyFormatter.format(entry.amountAsset)} {entry.asset}</div>
                  <div>Earmarked in spot wallet</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid lg:grid-cols-[2fr_1fr] gap-4">
        <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-lg text-slate-100 shadow-[0_20px_70px_-45px_rgba(14,165,233,0.35)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">Equity Timeline</div>
              <div className="text-xs text-slate-300/80">
                Aggregated value of balances plus current holdings
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-300/80">Current Equity</div>
              <div className="text-lg font-semibold">
                ${numberFormatter.format(equity)}
              </div>
            </div>
          </div>
          {equityTimeline.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-slate-300/80">
              {loading ? "Loading equity history..." : "No history available yet."}
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityTimeline}>
                  <defs>
                    <linearGradient id="portfolioEquity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" minTickGap={24} />
                  <YAxis tickFormatter={(value) => numberFormatter.format(value as number)} />
                  <Tooltip
                    formatter={(value: number) => `$${numberFormatter.format(value as number)}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#portfolioEquity)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-lg text-slate-100 shadow-[0_20px_70px_-45px_rgba(59,130,246,0.35)]">
          <div className="text-sm font-semibold mb-3">Allocation</div>
          <div className="space-y-3 text-sm">
            {allocationEntries.length === 0 ? (
              <div className="text-sm text-slate-300/80">
                {loading
                  ? "Loading allocation..."
                  : "Nothing allocated yet. Trade on the exchange to build exposure."}
              </div>
            ) : (
              allocationEntries.map((entry) => {
                const pctValue = Number.isFinite(entry.pct) ? entry.pct : 0;
                return (
                  <div key={entry.symbol}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{entry.symbol}</span>
                      <span className="text-xs text-slate-300/70">
                        {numberFormatter.format(entry.value)} USDT
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-800 mt-1">
                      <div
                        className="h-2 rounded-full bg-indigo-500"
                        style={{ width: `${Math.min(100, Math.max(0, pctValue))}%` }}
                      />
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {pctValue.toFixed(1)}% of portfolio
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-lg text-slate-100 shadow-[0_20px_70px_-45px_rgba(37,99,235,0.35)]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Holdings Detail</div>
          <div className="text-xs text-slate-300/80">
            {loading
              ? "Loading holdings from the portfolio service..."
              : "Marks refresh as the backend streams new data."}
          </div>
        </div>
        {activePositions.length === 0 ? (
          <div className="text-sm text-slate-300/80">
            {loading
              ? "Preparing holdings..."
              : "Your spot wallet is empty. Head to the exchange to buy assets."}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[110px_1fr_1fr_1fr_1fr] text-[11px] uppercase text-slate-300/70 mb-2">
              <span>Symbol</span>
              <span>Quantity</span>
              <span>Avg Price</span>
              <span>Mark Price</span>
              <span>Unrealized PnL</span>
            </div>
            <div className="space-y-2 text-sm">
              {activePositions.map((position) => {
                const resolvedMark = Number.isFinite(position.markPrice) ? position.markPrice : 0;
                const resolvedAvg = Number.isFinite(position.avgPrice) ? position.avgPrice : 0;
                const rawPnl =
                  position.unrealizedPnl ??
                  (resolvedMark - resolvedAvg) * position.qty;
                const pnl = Number.isFinite(rawPnl) ? rawPnl : 0;
                const pnlClass = pnl >= 0 ? "text-emerald-500" : "text-rose-500";
                return (
                  <div
                    key={position.symbol}
                    className="grid grid-cols-[110px_1fr_1fr_1fr_1fr] items-center rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <span className="font-semibold">{position.symbol}</span>
                    <span>{qtyFormatter.format(position.qty)}</span>
                    <span>{numberFormatter.format(resolvedAvg)}</span>
                    <span>{numberFormatter.format(resolvedMark)}</span>
                    <span className={pnlClass}>
                      {numberFormatter.format(pnl)} USDT
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/6 p-4 backdrop-blur-lg text-slate-100 shadow-[0_20px_70px_-45px_rgba(56,189,248,0.3)]">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Recent Activity</div>
          <div className="text-xs text-slate-300/80">
            Latest orders, fills, and transfers from the portfolio backend.
          </div>
        </div>
        {recentActivity.length === 0 ? (
          <div className="text-sm text-slate-300/80">
            {loading
              ? "Streaming activity..."
              : "No activity yet. Submit an order to populate your log."}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            {recentActivity.map((entry) => {
              const priceDisplay =
                entry.price !== undefined && Number.isFinite(entry.price)
                  ? numberFormatter.format(entry.price)
                  : null;
              const isSip = entry.type?.toLowerCase().startsWith("sip");
              const sipLabel =
                entry.status?.toUpperCase() === "EXECUTED" ? "SIP executed" : "SIP scheduled";
              return (
                <div
                  key={entry.id}
                  className="flex justify-between items-center rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                >
                  <div>
                    <div className="text-xs text-slate-400">
                      {new Date(entry.createdAt).toLocaleString()}
                    </div>
                    <div className="font-medium">
                      {isSip ? sipLabel : `${entry.symbol} ${entry.type}`}
                    </div>
                    <div className="text-xs text-slate-400">
                      {qtyFormatter.format(entry.qty)} {entry.symbol}
                      {priceDisplay ? ` @ ${priceDisplay}` : ""}
                    </div>
                  </div>
                  <div className="text-right">
                    {isSip ? (
                      <>
                        <div className="text-xs text-indigo-300">{entry.symbol}</div>
                        <div className="text-xs text-slate-400">{entry.status}</div>
                      </>
                    ) : (
                      <>
                        <div
                          className={`text-xs ${
                            entry.side === "BUY" ? "text-emerald-500" : "text-rose-500"
                          }`}
                        >
                          {entry.side}
                        </div>
                        <div className="text-xs text-slate-400">{entry.status}</div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

type SummaryCardProps = {
  label: string;
  value: string;
  sublabel: string;
  positive?: boolean;
};

function SummaryCard({
  label,
  value,
  sublabel,
  positive = true,
}: SummaryCardProps) {
  const tone =
    value.startsWith("-") || !positive
      ? "text-rose-400"
      : positive
      ? "text-emerald-400"
      : "text-white";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-lg text-slate-100 shadow-[0_20px_70px_-45px_rgba(79,70,229,0.35)]">
      <div className="text-[11px] uppercase tracking-[0.18em] text-indigo-200/80 mb-1">
        {label}
      </div>
      <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="text-xs text-slate-300 mt-1">{sublabel}</div>
    </div>
  );
}
