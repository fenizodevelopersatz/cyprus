import { BalanceSummaryCard } from "./BalanceSummaryCard";
import { DepositAddressCard } from "./DepositAddressCard";
import { DepositHistoryTable } from "./DepositHistoryTable";
import { FundingNetworkIcon } from "./FundingNetworkIcon";
import type { DepositHistoryItem, FundingAddress, Pagination } from "../api/funding.api";

type Props = {
  total: string;
  breakdown: Record<string, string>;
  adminAdjustmentBalance: string;
  addresses: FundingAddress[];
  selectedNetwork: string;
  onSelectNetwork: (network: string) => void;
  selectedAddress?: FundingAddress;
  copied: boolean;
  onCopy: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  items: DepositHistoryItem[];
  pagination: Pagination;
  filterNetwork: string;
  onFilterNetwork: (network: string) => void;
  onPageChange: (page: number) => void;
  updatedAt?: string | null;
};

export function DepositTab(props: Props) {
  const mobileNetworkOrder: Record<FundingAddress["network"], number> = {
    tron: 0,
    bsc: 1,
    ethereum: 2,
  };
  const orderedAddresses = [...props.addresses].sort(
    (a, b) => (mobileNetworkOrder[a.network] ?? 99) - (mobileNetworkOrder[b.network] ?? 99)
  );

  return (
    <div className="space-y-6">
      <BalanceSummaryCard
        total={props.total}
        breakdown={props.breakdown}
        adminAdjustmentBalance={props.adminAdjustmentBalance}
      />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="section-title text-[0.94rem] sm:text-[1.2rem]">Select Network</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)] sm:text-[11px] sm:tracking-[0.12em]">Choose the chain for your USDT wallet</div>
          </div>          
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {orderedAddresses.map((item) => (
            <button
              key={item.network}
              type="button"
              onClick={() => props.onSelectNetwork(item.network)}
              className={`inline-flex w-full min-w-0 items-center gap-1.5 rounded-[18px] border px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.04em] transition sm:gap-2.5 sm:rounded-[22px] sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.08em] ${
                props.selectedNetwork === item.network
                  ? "border-[var(--border-soft)] bg-[var(--accent-yellow)] text-[#111] shadow-[0_6px_14px_rgba(252,213,53,0.14)] sm:bg-[rgba(252,213,53,0.12)] sm:text-[var(--accent-yellow)] sm:shadow-none"
                  : "border-[var(--border-soft)] bg-[var(--bg-card)] text-[var(--text-muted)]"
              }`}
            >
              <FundingNetworkIcon network={item.network} size="xs" />
              <span className="block min-w-0">
                <span className="block truncate text-[10px] font-bold tracking-[0.04em] sm:text-[11px] sm:tracking-[0.08em] sm:font-semibold">{item.label}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] sm:text-xs sm:tracking-[0.08em]">
          Last updated: {props.updatedAt ? new Date(props.updatedAt).toLocaleString() : "--"}
        </div>
      </section>

      <DepositAddressCard
        address={props.selectedAddress}
        copied={props.copied}
        onCopy={props.onCopy}
        onRefresh={props.onRefresh}
        refreshing={props.refreshing}
      />

      <DepositHistoryTable
        items={props.items}
        pagination={props.pagination}
        network={props.filterNetwork}
        onNetworkChange={props.onFilterNetwork}
        onPageChange={props.onPageChange}
      />
    </div>
  );
}
