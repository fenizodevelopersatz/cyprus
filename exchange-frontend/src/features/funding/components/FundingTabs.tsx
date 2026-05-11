type Props = {
  activeTab: "deposit" | "withdraw";
  onChange: (tab: "deposit" | "withdraw") => void;
};

export function FundingTabs({ activeTab, onChange }: Props) {
  return (
    <div className="grid grid-cols-2 rounded-[18px] border border-[rgba(255,255,255,0.05)] bg-[linear-gradient(180deg,#1f242b_0%,#181c22_100%)] p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {(["deposit", "withdraw"] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`rounded-[14px] px-4 py-3 text-base font-semibold capitalize transition ${
            activeTab === tab
              ? "bg-[linear-gradient(180deg,#303640_0%,#21262d_100%)] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_0_0_1px_rgba(252,213,53,0.2),0_0_22px_rgba(252,213,53,0.12),0_10px_26px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.06)]"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
