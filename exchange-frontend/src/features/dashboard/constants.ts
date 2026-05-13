export const DEFAULT_PROMOTIONS = [
  {
    id: "vaults",
    title: "Primerica Vaults APY Boost",
    subtitle: "Earn up to 12.5% on stable pairs with auto-compounded rewards.",
    cta: "Explore vaults",
    to: "/app/staking",
    accent: "from-indigo-500 via-sky-400 to-emerald-400",
  },
  {
    id: "p2p",
    title: "P2P Escrow Upgrade",
    subtitle: "Now supporting instant releases for verified merchants in 40+ regions.",
    cta: "Open desk",
    to: "/app/funding",
    accent: "from-purple-500 via-fuchsia-500 to-rose-500",
  },
  {
    id: "launchpad",
    title: "Launchpad Round 08",
    subtitle: "Whitelist closes in 3 hours. Secure allocation before public sale.",
    cta: "Join launchpad",
    to: "/app/funding",
    accent: "from-amber-500 via-orange-500 to-rose-500",
  },
  {
    id: "signals",
    title: "Signal Room Priority Access",
    subtitle: "Unlock faster entries, cleaner setups, and priority delivery for active traders.",
    cta: "View signal access",
    to: "/app/settings",
    accent: "from-emerald-500 via-teal-400 to-cyan-400",
  },
] as const;

export const DEFAULT_NEWS = [
  {
    id: "default-news-1",
    title: "CME Bitcoin futures open interest hits all-time high",
    summary: "Institutional desks rotate into longer-dated BTC exposure as funding flips neutral.",
    source: "Primerica Research",
    publishedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    tag: "Derivatives",
  },
  {
    id: "default-news-2",
    title: "Layer-2 TVL surges 14% after ETH gas repricing",
    summary: "Sequencer revenues spike on OP Stack networks with new staking incentives.",
    source: "Onchain Daily",
    publishedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    tag: "Layer-2",
  },
  {
    id: "default-news-3",
    title: "USDT market share crosses 70% on major spot venues",
    summary: "Stablecoin dominance drives deeper liquidity for USD-denominated pairs.",
    source: "Market Pulse",
    publishedAt: new Date(Date.now() - 32 * 60 * 1000).toISOString(),
    tag: "Stablecoins",
  },
] as const;
