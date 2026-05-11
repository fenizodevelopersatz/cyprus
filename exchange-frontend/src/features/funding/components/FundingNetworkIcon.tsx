import { useState } from "react";

type FundingNetworkKey = "wallet" | "usdt" | "ethereum" | "bsc" | "tron";

const networkIconMap: Record<FundingNetworkKey, { symbol: string; imageUrl: string; shell: string; ring: string }> = {
  wallet: {
    symbol: "W",
    imageUrl: "",
    shell: "from-[#54606f] via-[#384150] to-[#1b222c]",
    ring: "ring-white/10",
  },
  usdt: {
    symbol: "USDT",
    imageUrl: "https://s2.coinmarketcap.com/static/img/coins/64x64/825.png",
    shell: "from-[#30c48d] via-[#26a17b] to-[#0f6c58]",
    ring: "ring-[#30c48d]/30",
  },
  ethereum: {
    symbol: "ETH",
    imageUrl: "https://s2.coinmarketcap.com/static/img/coins/64x64/1027.png",
    shell: "from-[#7c87ff] via-[#627eea] to-[#3946a3]",
    ring: "ring-[#9da5b7]/30",
  },
  bsc: {
    symbol: "BNB",
    imageUrl: "https://s2.coinmarketcap.com/static/img/coins/64x64/1839.png",
    shell: "from-[#f3ba2f] via-[#f0b90b] to-[#7a5b00]",
    ring: "ring-[#f0b90b]/30",
  },
  tron: {
    symbol: "TRX",
    imageUrl: "https://s2.coinmarketcap.com/static/img/coins/64x64/1958.png",
    shell: "from-[#ff5168] via-[#f6465d] to-[#8b1d2d]",
    ring: "ring-[#f6465d]/30",
  },
};

export function FundingNetworkIcon({ network, size = "md" }: { network: FundingNetworkKey; size?: "xs" | "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const icon = networkIconMap[network];
  const sizeClass = size === "xs" ? "h-5 w-5" : size === "sm" ? "h-6 w-6" : "h-10 w-10";
  const textClass = size === "xs" ? "text-[8px]" : size === "sm" ? "text-[9px]" : "text-[13px]";

  if (!failed && icon.imageUrl) {
    return (
      <img
        src={icon.imageUrl}
        alt={`${icon.symbol} icon`}
        className={`${sizeClass} shrink-0 rounded-full object-cover shadow-[0_10px_24px_rgba(0,0,0,0.28)]`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={`relative shrink-0 ${sizeClass}`} aria-hidden="true">
      <div
        className={`absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br ${icon.shell} font-bold text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)] ring-1 ${icon.ring} ${textClass}`}
      >
        {network === "wallet" ? (
          <svg viewBox="0 0 24 24" className={size === "xs" ? "h-3 w-3" : size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5"} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H18a2 2 0 0 1 2 2v1H6.5A1.5 1.5 0 0 0 5 10.5v5A2.5 2.5 0 0 0 7.5 18H20v.5a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 18V8.5Z" />
            <path d="M20 10H15.5A1.5 1.5 0 0 0 14 11.5v2a1.5 1.5 0 0 0 1.5 1.5H20v-5Z" />
            <circle cx="16.8" cy="12.5" r=".9" fill="currentColor" stroke="none" />
          </svg>
        ) : (
          icon.symbol.slice(0, 1)
        )}
      </div>
    </div>
  );
}
