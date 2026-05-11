import Button from "../../../ui/Button";
import type { FundingAddress } from "../api/funding.api";
import { FundingNetworkIcon } from "./FundingNetworkIcon";

type Props = {
  address?: FundingAddress;
  copied: boolean;
  onCopy: () => void;
  onRefresh: () => void;
  refreshing: boolean;
};

export function DepositAddressCard({ address, copied, onCopy, onRefresh, refreshing }: Props) {
  const refreshLabel = refreshing ? "Reconciling..." : "Refresh Deposits";

  return (
    <section className="exchange-card exchange-card-strong p-5 sm:p-6">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div className="flex h-[220px] w-full max-w-[220px] items-center justify-center rounded-[22px] bg-[#f6f3ee] p-4 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)] sm:h-[240px] sm:max-w-[240px] sm:rounded-[26px]">
          <div className="flex h-full w-full items-center justify-center rounded-[18px] bg-[#223036] p-3 sm:rounded-[20px]">
            {address?.qrCode ? (
              <div className="relative h-full w-full">
                <img src={address.qrCode} alt="Deposit QR" className="h-full w-full rounded-[10px] object-contain bg-white p-2" />
                {address?.network ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/80 bg-white/95 shadow-[0_10px_25px_rgba(0,0,0,0.2)] sm:h-14 sm:w-14">
                      <FundingNetworkIcon network={address.network} size="sm" />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="text-xs uppercase tracking-[0.2em] text-slate-400">No QR</span>
            )}
          </div>
        </div>

        <div className="mt-8 text-sm font-semibold uppercase tracking-[0.16em] text-[#d7c9a1] sm:text-[0.95rem] sm:text-[var(--text-muted)]">Your USDT Deposit Address</div>

        <div className="mt-4 flex w-full items-center gap-3 rounded-[18px] bg-[#0d1014] p-3 sm:rounded-[18px]">
          <div className="min-w-0 flex-1 truncate text-left font-mono text-[0.95rem] text-white">{address?.address || "-"}</div>
          <button type="button" onClick={onCopy} disabled={!address?.address} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-[var(--accent-yellow)] text-[#111] transition hover:bg-[var(--accent-yellow-hover)] sm:bg-[rgba(252,213,53,0.14)] sm:text-[var(--accent-yellow)] sm:hover:bg-[rgba(252,213,53,0.2)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M8 7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V7Zm-4 4a2 2 0 0 1 2-2v8a4 4 0 0 0 4 4h6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-10Z"/></svg>
          </button>
        </div>

        <div className="mt-3 flex w-full sm:hidden">
          <Button size="sm" variant="secondary" onClick={onRefresh} disabled={refreshing || !address} className="w-full">
            <span className="inline-flex items-center gap-2">
              <svg viewBox="0 0 24 24" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              <span>{refreshLabel}</span>
            </span>
          </Button>
        </div>

        <div className="mt-4 hidden w-full flex-wrap gap-2 sm:flex">
          <Button size="sm" onClick={onCopy} disabled={!address?.address} className="flex-1 min-w-[140px]">
            {copied ? "Copied!" : "Copy Address"}
          </Button>
          <Button size="sm" variant="secondary" onClick={onRefresh} disabled={refreshing || !address} className="flex-1 min-w-[140px]">
            <span className="inline-flex items-center gap-2">
              <svg viewBox="0 0 24 24" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
              <span>{refreshLabel}</span>
            </span>
          </Button>
        </div>

        <div className="mt-6 w-full rounded-[18px] border border-[var(--border-soft)] bg-[rgba(252,213,53,0.06)] px-4 py-4 text-left text-sm leading-7 text-[var(--text-secondary)]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-yellow)] text-[#111]">!</span>
            <div>
              Ensure you select the <span className="font-semibold text-[var(--accent-yellow)]">{address?.label ?? "selected"}</span> network on your withdrawal platform. Deposits on other networks will be permanently lost.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
