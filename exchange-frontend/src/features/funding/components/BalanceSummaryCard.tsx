import { formatMoney } from "../../../utils/money";
import { FundingNetworkIcon } from "./FundingNetworkIcon";

type Props = {
  total: string;
  breakdown: Record<string, string>;
  adminAdjustmentBalance: string;
};

const networkMeta = [
  { key: "ethereum", label: "ETH" },
  { key: "bsc", label: "BSC" },
  { key: "tron", label: "TRON" },
];

const formatFundingUsd = (value: string | number | null | undefined) => `$${formatMoney(value)}`;

export function BalanceSummaryCard({ total, breakdown, adminAdjustmentBalance }: Props) {
  return (
    <section className="space-y-4 lg:space-y-3">
      <div className="exchange-card p-5 sm:border-0 sm:bg-transparent sm:p-1 sm:shadow-none lg:max-w-[760px]">
        <div className="flex items-center gap-3">
          <FundingNetworkIcon network="wallet" />
          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] sm:text-[13px] sm:tracking-[0.16em] lg:text-[12px]">Wallet Balance</div>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <div className="text-[clamp(1.45rem,1.25rem+0.45vw,2.1rem)] font-black leading-none text-white sm:text-[clamp(1.75rem,1.55rem+0.55vw,2.45rem)] lg:text-[clamp(1.6rem,1.35rem+0.35vw,2.05rem)]">
            {Number(total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
          </div>
          <div className="pb-0.5 text-[0.82rem] font-extrabold uppercase text-[var(--accent-yellow)] sm:text-[clamp(0.84rem,0.78rem+0.22vw,1rem)] lg:text-[0.85rem]">USDT</div>
        </div>
        <div className="mt-2 text-[0.72rem] text-[var(--text-muted)] sm:text-[0.78rem] lg:text-[0.76rem]">
          {`~ $${Number(total || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`}
        </div>
        <div className="mt-5 hidden h-px bg-[rgba(255,255,255,0.05)] sm:block" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:max-w-[1020px]">
        {networkMeta.map((item) => (
          <div key={item.key} className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-3.5 lg:px-4 lg:py-3">
            <div className="flex items-center gap-3 sm:block sm:space-y-2">
              <FundingNetworkIcon network={item.key as "ethereum" | "bsc" | "tron"} size="sm" />
              <div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] sm:text-[10px] sm:tracking-[0.12em]">{item.label}</div>
                <span className="text-[0.82rem] font-semibold text-white sm:text-[1.25rem] sm:font-bold lg:text-[1.05rem]">{formatFundingUsd(breakdown[item.key] ?? "0")}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* <div className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-3.5 lg:max-w-[1020px]">
        <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)] sm:text-[10px] sm:tracking-[0.12em]">
          Admin Manual Adjustment
        </div>
        <div className="mt-2 text-[0.9rem] font-semibold text-white sm:text-[1.05rem]">
          {formatFundingUsd(adminAdjustmentBalance || "0")}
        </div>        
      </div> */}
    </section>
  );
}
