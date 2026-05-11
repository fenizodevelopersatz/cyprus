import { useState } from "react";
import { Link } from "react-router-dom";
import type { DepositHistoryItem, Pagination } from "../api/funding.api";

type Props = {
  items: DepositHistoryItem[];
  pagination: Pagination;
  network: string;
  onNetworkChange: (network: string) => void;
  onPageChange: (page: number) => void;
};

const amountFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(value: string) {
  const num = Number(value);
  return Number.isFinite(num) ? amountFormatter.format(num) : value;
}

function shortHash(value: string) {
  return value.length > 22 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function networkLabel(network: DepositHistoryItem["network"]) {
  if (network === "ethereum") return "ETH";
  if (network === "bsc") return "BSC";
  return "TRON";
}

export function DepositHistoryTable({ items, pagination, network, onNetworkChange, onPageChange }: Props) {
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const copyHash = async (id: number, hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1200);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="section-title text-[1rem] uppercase tracking-[0.18em] sm:text-[1.35rem] sm:normal-case sm:tracking-normal">
          Recent History
        </div>
        <div className="flex items-center gap-3">
          <select
            value={network}
            onChange={(event) => onNetworkChange(event.target.value)}
            className="rounded-full border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 py-2 text-xs text-white sm:text-sm"
          >
            <option value="">All networks</option>
            <option value="ethereum">Ethereum</option>
            <option value="bsc">BSC</option>
            <option value="tron">TRON</option>
          </select>
          <Link
            to="/app/orders"
            className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--accent-yellow)] transition hover:text-[var(--accent-yellow-hover)] sm:text-sm"
          >
            View All
          </Link>
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const completed =
            String(item.status || "").toLowerCase().includes("complete") ||
            String(item.status || "").toLowerCase().includes("detected") ||
            String(item.status || "").toLowerCase().includes("credit");

          return (
            <article
              key={item.id}
              className={`rounded-[18px] border px-3 py-3 transition sm:rounded-[20px] sm:px-4 ${
                completed
                  ? "border-[rgba(14,203,129,0.09)] bg-[linear-gradient(180deg,#1a1f24_0%,#171b20_100%)] shadow-[0_8px_20px_rgba(14,203,129,0.035)]"
                  : "border-[rgba(252,213,53,0.09)] bg-[linear-gradient(180deg,#1c2025_0%,#171b20_100%)] shadow-[0_8px_20px_rgba(252,213,53,0.03)]"
              }`}
            >
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full sm:h-9 sm:w-9 ${
                    completed
                      ? "bg-[rgba(14,203,129,0.10)] text-[var(--success)]"
                      : "bg-[rgba(252,213,53,0.10)] text-[var(--warning)]"
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14" />
                    <path d="m19 12-7 7-7-7" />
                  </svg>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[0.78rem] font-semibold leading-tight text-white sm:text-[0.95rem]">
                        Deposit {networkLabel(item.network)} {item.token}
                      </div>
                      <div className="mt-0.5 text-[0.74rem] text-[var(--text-muted)] sm:text-[0.8rem]">
                        {new Date(item.createdAt).toLocaleDateString()} • {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={completed ? "text-[0.8rem] font-extrabold text-[var(--success)] sm:text-[0.95rem]" : "text-[0.8rem] font-extrabold text-[var(--warning)] sm:text-[0.95rem]"}>
                        +{formatAmount(item.amount)}
                      </div>
                      <div
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] sm:px-2.5 sm:text-[9px] ${
                          completed
                            ? "bg-[rgba(14,203,129,0.14)] text-[var(--success)]"
                            : "bg-[rgba(252,213,53,0.14)] text-[var(--warning)]"
                        }`}
                      >
                        {completed ? "Completed" : item.status}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[9px] text-[var(--text-secondary)] sm:gap-2 sm:text-[10px]">
                    <a
                      href={item.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[8px] text-[var(--accent-yellow)] hover:text-[var(--accent-yellow-hover)] sm:text-[10px]"
                      title={item.hash}
                    >
                      {shortHash(item.hash)}
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyHash(item.id, item.hash)}
                      className="flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--bg-card-soft)] text-[var(--text-secondary)] transition hover:border-[var(--border-yellow)] hover:text-[var(--accent-yellow)] sm:h-6 sm:w-6"
                      aria-label="Copy hash"
                      title="Copy hash"
                    >
                      {copiedId === item.id ? (
                        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 sm:h-3 sm:w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 13 4 4L19 7" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-2.5 w-2.5 sm:h-3 sm:w-3" fill="currentColor">
                          <path d="M8 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V7Zm-4 4a2 2 0 0 1 2-2v8a4 4 0 0 0 4 4h6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10Z" />
                        </svg>
                      )}
                    </button>
                    {item.txn_id ? <span className="truncate text-[var(--text-muted)]">Txn: {item.txn_id}</span> : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {!items.length && (
        <div className="exchange-card px-4 py-10 text-center text-sm text-[var(--text-muted)]">
          No deposit history found.
        </div>
      )}

      <div className="flex flex-col gap-3 text-xs text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
        <span>Page {pagination.page} of {Math.max(pagination.totalPages, 1)}</span>
        <div className="flex gap-2 self-end sm:self-auto">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
            disabled={pagination.page <= 1}
            className="rounded-[10px] border border-[var(--border-soft)] px-3 py-2 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => onPageChange(Math.min(Math.max(pagination.totalPages, 1), pagination.page + 1))}
            disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages}
            className="rounded-[10px] border border-[var(--border-soft)] px-3 py-2 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
