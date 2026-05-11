import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMarketsBoard } from "../hooks/useMarketsBoard";

// const primaryTabs = ["Favorites", "Market", "Alpha", "Prediction", "Grow", "Square"];
// const marketTabs = ["Crypto", "Spot", "USD-M", "COIN-M", "Options"];
const changeWindows = ["24h", "1h"] as const;
const COINGECKO_IDS = [
  "bitcoin",
  "ethereum",
  "binancecoin",
  "solana",
  "ripple",
  "dogecoin",
  "cardano",
  "tron",
] as const;

const volumeFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  notation: "compact",
});

const marketCapFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  notation: "compact",
});

const compactNumber = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return "--";
  if (value >= 1000) return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  if (value >= 1) return value.toFixed(4);
  return value.toFixed(6);
};

const formatUsdValue = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return "--";
  return `$${compactNumber(value)}`;
};

const formatPercent = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const formatVolume = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return "--";
  return `$${volumeFormatter.format(value)}`;
};

const formatTableVolume = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return "--";
  return volumeFormatter.format(value);
};

const formatMobileLastPrice = (value?: number) => {
  if (value === undefined || Number.isNaN(value)) return "--";
  if (value >= 1000) return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
};

const formatMarketCap = (value?: number) => {
  if (value === undefined || Number.isNaN(value) || value <= 0) return "--";
  return `$${marketCapFormatter.format(value)}`;
};

const formatUpdatedTime = (value?: string) => {
  if (!value) return "Waiting for feed";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Waiting for feed";
  const diffSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return "Connected";
  const diffMinutes = Math.round(diffSeconds / 60);
  return `${diffMinutes}m ago`;
};

type CoinGeckoMarket = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  market_cap?: number;
  total_volume?: number;
};

type CoinMarketMeta = {
  image?: string;
  marketCap?: number;
  totalVolume?: number;
};

async function fetchCoinMarketMeta(signal?: AbortSignal): Promise<Record<string, CoinMarketMeta>> {
  const params = new URLSearchParams({
    vs_currency: "usd",
    ids: COINGECKO_IDS.join(","),
    order: "market_cap_desc",
    per_page: "100",
    page: "1",
    sparkline: "false",
  });
  const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?${params.toString()}`, { signal });
  if (!response.ok) throw new Error("Failed to load CoinGecko market metadata");
  const data = (await response.json()) as CoinGeckoMarket[];
  return data.reduce<Record<string, CoinMarketMeta>>((acc, coin) => {
    const symbol = String(coin.symbol ?? "").trim().toUpperCase();
    if (symbol) {
      acc[symbol] = {
        image: coin.image,
        marketCap: typeof coin.market_cap === "number" ? coin.market_cap : undefined,
        totalVolume: typeof coin.total_volume === "number" ? coin.total_volume : undefined,
      };
    }
    return acc;
  }, {});
}

const getAssetPalette = (asset: string) => {
  const normalized = asset.trim().toUpperCase();
  const palettes: Record<string, { shell: string; ring: string; icon: string }> = {
    BTC: { shell: "from-[#f7931a] via-[#f0b90b] to-[#8a5a00]", ring: "ring-[#f0b90b]/30", icon: "₿" },
    ETH: { shell: "from-[#7c87ff] via-[#627eea] to-[#3946a3]", ring: "ring-[#9da5b7]/30", icon: "◆" },
    BNB: { shell: "from-[#f3ba2f] via-[#f0b90b] to-[#7a5b00]", ring: "ring-[#f0b90b]/30", icon: "✦" },
    SOL: { shell: "from-[#14f195] via-[#80ecff] to-[#9945ff]", ring: "ring-[#80ecff]/30", icon: "S" },
    XRP: { shell: "from-[#2d3138] via-[#16191f] to-[#08090c]", ring: "ring-white/10", icon: "X" },
    DOGE: { shell: "from-[#d4b15a] via-[#c2a633] to-[#6b5714]", ring: "ring-[#d4b15a]/30", icon: "Ð" },
    ADA: { shell: "from-[#5b8cff] via-[#2f6df6] to-[#17358f]", ring: "ring-[#4f7ef8]/30", icon: "A" },
    ASTER: { shell: "from-[#f3d1a2] via-[#d6b184] to-[#6f5841]", ring: "ring-[#d6b184]/30", icon: "✦" },
  };
  return palettes[normalized] ?? { shell: "from-[#2b3139] via-[#3b4350] to-[#161a20]", ring: "ring-white/10", icon: normalized.slice(0, 1) || "C" };
};

type SortKey = "symbol" | "price" | "change" | "volume" | "marketCap";
type SortDirection = "asc" | "desc";

const sortMarkets = (
  markets: ReturnType<typeof useMarketsBoard>["markets"],
  sortBy: SortKey,
  sortDirection: SortDirection
) => {
  const copy = [...markets];
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortBy === "price") return copy.sort((a, b) => ((a.ticker?.last ?? 0) - (b.ticker?.last ?? 0)) * direction);
  if (sortBy === "change") return copy.sort((a, b) => ((a.ticker?.changePct ?? 0) - (b.ticker?.changePct ?? 0)) * direction);
  if (sortBy === "volume") {
    return copy.sort(
      (a, b) => ((a.ticker?.volumeQuote ?? a.ticker?.volume ?? 0) - (b.ticker?.volumeQuote ?? b.ticker?.volume ?? 0)) * direction
    );
  }
  if (sortBy === "marketCap") {
    return copy.sort((a, b) => {
      const aMarketCap = a.ticker?.marketCap ?? 0;
      const bMarketCap = b.ticker?.marketCap ?? 0;
      return (aMarketCap - bMarketCap) * direction;
    });
  }

  return copy.sort((a, b) => a.base.localeCompare(b.base) * direction);
};

export default function MarketsPage() {
  const navigate = useNavigate();
  const [changeWindow, setChangeWindow] = useState<(typeof changeWindows)[number]>("1h");
  const { loading, error, markets, wsStatus } = useMarketsBoard(changeWindow);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("volume");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedSymbol, setSelectedSymbol] = useState<string>();
  const [coinMeta, setCoinMeta] = useState<Record<string, CoinMarketMeta>>({});
  const [failedCoinImages, setFailedCoinImages] = useState<Record<string, true>>({});

  useEffect(() => {
    const controller = new AbortController();
    void fetchCoinMarketMeta(controller.signal)
      .then((meta) => setCoinMeta(meta))
      .catch(() => {
        if (!controller.signal.aborted) setCoinMeta({});
      });
    return () => controller.abort();
  }, []);

  const filteredMarkets = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    const visible = normalized
      ? markets.filter((market) => {
          const symbol = market.symbol.toLowerCase();
          const base = market.base.toLowerCase();
          const quote = market.quote.toLowerCase();
          return symbol.includes(normalized) || base.includes(normalized) || quote.includes(normalized);
        })
      : markets;

    return sortMarkets(visible, sortBy, sortDirection);
  }, [markets, search, sortBy, sortDirection]);

  const handleSort = (key: SortKey, nextDirection?: SortDirection) => {
    if (nextDirection) {
      setSortBy(key);
      setSortDirection(nextDirection);
      return;
    }

    if (sortBy === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setSortBy(key);
    setSortDirection(key === "symbol" ? "asc" : "desc");
  };

  useEffect(() => {
    if (!selectedSymbol && filteredMarkets.length > 0) {
      setSelectedSymbol(filteredMarkets[0].symbol);
    }
  }, [filteredMarkets, selectedSymbol]);

  const selectedMarket = useMemo(
    () => filteredMarkets.find((market) => market.symbol === selectedSymbol) ?? filteredMarkets[0],
    [filteredMarkets, selectedSymbol]
  );

  useEffect(() => {
    if (selectedMarket && selectedMarket.symbol !== selectedSymbol) {
      setSelectedSymbol(selectedMarket.symbol);
    }
  }, [selectedMarket, selectedSymbol]);

  return (
    <div className="mx-auto max-w-7xl text-slate-100">
      <section className="overflow-hidden rounded-[24px] border border-white/6 bg-[#181a20] shadow-[0_30px_80px_-54px_rgba(0,0,0,0.75)]">
        <div className="border-b border-white/6 px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-4">
            <div className="flex min-w-0 flex-col gap-3">
              <div className="text-[1.05rem] font-semibold text-white sm:text-[1.2rem]">Futures</div>
              <div className="flex min-w-0">
                <label className="flex h-10 w-full min-w-0 items-center gap-2 rounded-2xl border border-white/8 bg-[#20242d] px-3 text-[#848e9c] transition focus-within:border-[#f0b90b] sm:h-11 sm:px-3.5">
                  <SearchIcon className="h-4 w-4" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search coin pair and trend"
                    className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-white outline-none placeholder:text-[#6f7787] sm:text-sm"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* <div className="mt-4 flex gap-4 overflow-x-auto text-[11px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-5 sm:text-[13px]">
            {marketTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={`shrink-0 transition ${tab === "Spot" ? "font-semibold text-white" : "text-[#8b93a6] hover:text-white"}`}
              >
                {tab}
              </button>
            ))}
          </div> */}

          {error ? (
            <div className="mt-4 rounded-[18px] border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
          ) : null}
        </div>

        <div className="px-3 pb-3 pt-2 sm:px-4 sm:pb-4">
          <div className="grid grid-cols-[minmax(0,1.7fr)_minmax(82px,0.8fr)_62px] items-center gap-2.5 px-2 py-1.5 text-[8px] text-[#848e9c] md:hidden">
            <SortHeaderButton label="Name" sortKey="symbol" activeSort={sortBy} direction={sortDirection} onSort={handleSort} align="left" />
            <SortHeaderButton label="Last Price" sortKey="price" activeSort={sortBy} direction={sortDirection} onSort={handleSort} align="right" />
            <div className="flex items-center justify-end gap-1">
              <select
              aria-label="Select change window"
                value={changeWindow}
                onChange={(event) => setChangeWindow(event.target.value as (typeof changeWindows)[number])}
                className="h-4 rounded-md border border-white/10 bg-transparent px-1 text-[7px] text-[#848e9c] outline-none"
              >
                {changeWindows.map((window) => (
                  <option key={window} value={window} className="bg-[#20242d] text-white">
                    {window}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2 md:hidden">
            {filteredMarkets.map((market) => {
              const ticker = market.ticker;
              const isPositive = (ticker?.changePct ?? 0) >= 0;
              const volume = coinMeta[market.base.toUpperCase()]?.totalVolume ?? ticker?.volumeQuote ?? ticker?.volume;
              const mobileLabel = market.base.slice(0, 3).toUpperCase();

              return (
                <button
                  key={market.symbol}
                  type="button"
                  onClick={() => {
                    setSelectedSymbol(market.symbol);
                    navigate(`/app/exchange?symbol=${encodeURIComponent(market.symbol)}`);
                  }}
                  className="grid w-full grid-cols-[minmax(0,1.7fr)_minmax(82px,0.8fr)_62px] items-center gap-2.5 rounded-[16px] border border-white/6 bg-[#1f232b] px-2.5 py-2.5 text-left transition active:scale-[0.99]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <MarketPairIcon base={market.base} quote={market.quote} size="sm" imageUrl={coinMeta[market.base.toUpperCase()]?.image} imageFailed={Boolean(failedCoinImages[market.base.toUpperCase()])} onImageError={() => setFailedCoinImages((prev) => (prev[market.base.toUpperCase()] ? prev : { ...prev, [market.base.toUpperCase()]: true }))} />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold tracking-[0.03em] text-white">{mobileLabel}</div>
                        <div className="mt-0.5 truncate text-[9px] text-[#8b93a6]">{formatTableVolume(volume)} vol</div>
                      </div>
                    </div>
                  </div>
                  <div className="border-l border-white/6 pl-2.5 text-right">
                    <div className="text-[11px] font-semibold text-white">{ticker ? formatMobileLastPrice(ticker.last) : "--"}</div>
                    <div className="mt-0.5 truncate text-[9px] text-[#8b93a6]">{ticker ? formatUsdValue(ticker.last) : "--"}</div>
                  </div>
                  <div className="flex justify-end border-l border-white/6 pl-2.5">
                    <div className={`inline-flex min-w-[56px] items-center justify-center rounded-full px-2 py-1 text-[9px] font-semibold ${isPositive ? "bg-[#2ebd85] text-white" : "bg-[#f6465d] text-white"}`}>
                      {ticker ? formatPercent(ticker.changePct) : "--"}
                    </div>
                  </div>
                </button>
              );
            })}

            {!loading && filteredMarkets.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[#848e9c]">No markets matched your search.</div>
            ) : null}
          </div>

          <div className="hidden overflow-x-auto [scrollbar-width:thin] md:block">
            <div className="min-w-[720px]">
              <div className="hidden grid-cols-[minmax(220px,1.35fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_92px] items-center gap-5 px-4 py-3 text-[12px] text-[#848e9c] md:grid">
                <SortHeaderButton label="Name" sortKey="symbol" activeSort={sortBy} direction={sortDirection} onSort={handleSort} align="left" />
                <SortHeaderButton label="Price" sortKey="price" activeSort={sortBy} direction={sortDirection} onSort={handleSort} align="right" />
                <div className="flex items-center justify-end gap-2">
                  <SortHeaderButton label={`${changeWindow} Change`} sortKey="change" activeSort={sortBy} direction={sortDirection} onSort={handleSort} align="right" />
                  <select
                    aria-label="Select change window"
                    value={changeWindow}
                    onChange={(event) => setChangeWindow(event.target.value as (typeof changeWindows)[number])}
                    className="rounded-lg border border-white/10 bg-[#20242d] px-2 py-1 text-[11px] text-white outline-none"
                  >
                    {changeWindows.map((window) => (
                      <option key={window} value={window} className="bg-[#20242d] text-white">
                        {window}
                      </option>
                    ))}
                  </select>
                </div>
                <SortHeaderButton label="24h Volume" sortKey="volume" activeSort={sortBy} direction={sortDirection} onSort={handleSort} align="right" />
                <SortHeaderButton label="Market Cap" sortKey="marketCap" activeSort={sortBy} direction={sortDirection} onSort={handleSort} align="right" />
                <div className="text-right">Action</div>
              </div>

              <div className="divide-y divide-white/6">
                {filteredMarkets.map((market) => {
                  const ticker = market.ticker;
                  const isPositive = (ticker?.changePct ?? 0) >= 0;
                  const isSelected = selectedMarket?.symbol === market.symbol;
                  const volume = coinMeta[market.base.toUpperCase()]?.totalVolume ?? ticker?.volumeQuote ?? ticker?.volume;
                  const marketCap = ticker?.marketCap ?? coinMeta[market.base.toUpperCase()]?.marketCap;

                  return (
                    <div
                      key={market.symbol}
                      className={`rounded-[18px] transition ${isSelected ? "bg-white/[0.05]" : "hover:bg-white/[0.025]"}`}
                    >
                      <div className="hidden grid-cols-[minmax(220px,1.35fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_minmax(120px,1fr)_92px] items-center gap-5 px-4 py-3 md:grid">
                        <button type="button" onClick={() => setSelectedSymbol(market.symbol)} className="min-w-0 text-left">
                          <div className="flex items-center gap-3">
                            <MarketPairIcon base={market.base} quote={market.quote} imageUrl={coinMeta[market.base.toUpperCase()]?.image} imageFailed={Boolean(failedCoinImages[market.base.toUpperCase()])} onImageError={() => setFailedCoinImages((prev) => (prev[market.base.toUpperCase()] ? prev : { ...prev, [market.base.toUpperCase()]: true }))} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-[1rem] font-semibold text-white">{market.base}</span>
                              </div>
                              <div className="mt-0.5 truncate text-xs text-[#848e9c]">{market.base}</div>
                            </div>
                          </div>
                        </button>

                        <div className="text-right">
                          <div className="text-[1rem] font-semibold text-white">{ticker ? compactNumber(ticker.last) : "--"}</div>
                          <div className="mt-0.5 text-xs text-[#848e9c]">{ticker ? formatUsdValue(ticker.last) : "--"}</div>
                        </div>

                        <div className={`text-right text-[0.98rem] font-semibold ${isPositive ? "text-[#0ecb81]" : "text-[#f6465d]"}`}>
                          {ticker ? formatPercent(ticker.changePct) : "--"}
                        </div>

                        <div className="text-right text-[0.98rem] font-medium text-white">{formatTableVolume(volume)}</div>

                        <div className="text-right text-[0.98rem] font-medium text-white">{formatMarketCap(marketCap)}</div>

                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => navigate(`/app/exchange?symbol=${encodeURIComponent(market.symbol)}`)}
                            className="inline-flex items-center justify-center rounded-xl border border-white/8 bg-[#20242d] px-3 py-2 text-sm font-semibold text-white transition hover:border-[#f0b90b] hover:text-[#f0b90b]"
                          >
                            Trade
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {!loading && filteredMarkets.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-[#848e9c]">No markets matched your search.</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="hidden border-t border-white/6 px-4 py-4 sm:px-6 md:block">
          {selectedMarket ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(260px,0.8fr)]">
              <div className="rounded-[20px] border border-white/6 bg-[#1f232b] p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[#848e9c]">Selected Market</div>
                    <div className="mt-2 flex items-center gap-2">
                      <MarketPairIcon base={selectedMarket.base} quote={selectedMarket.quote} imageUrl={coinMeta[selectedMarket.base.toUpperCase()]?.image} imageFailed={Boolean(failedCoinImages[selectedMarket.base.toUpperCase()])} onImageError={() => setFailedCoinImages((prev) => (prev[selectedMarket.base.toUpperCase()] ? prev : { ...prev, [selectedMarket.base.toUpperCase()]: true }))} />
                      <h2 className="text-[1.4rem] font-semibold text-white">{selectedMarket.base}</h2>
                      
                    </div>
                    <div className="mt-1 text-sm text-[#848e9c]">{selectedMarket.base}</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      aria-label="Open market menu"
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-[#20242d] text-[#9aa4b2] transition hover:text-white"
                    >
                      <BurgerIcon className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/app/exchange?symbol=${encodeURIComponent(selectedMarket.symbol)}`)}
                      className="inline-flex items-center justify-center rounded-xl bg-[#f0b90b] px-4 py-2 text-sm font-semibold text-[#111] transition hover:bg-[#f8c933]"
                    >
                      Trade now
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MarketStat label="Last Price" value={selectedMarket.ticker ? compactNumber(selectedMarket.ticker.last) : "--"} />
                  <MarketStat label="24h High" value={selectedMarket.ticker ? compactNumber(selectedMarket.ticker.high) : "--"} />
                  <MarketStat label="24h Low" value={selectedMarket.ticker ? compactNumber(selectedMarket.ticker.low) : "--"} />
                  <MarketStat label="Updated" value={formatUpdatedTime(selectedMarket.ticker?.updatedAt)} />
                </div>
              </div>

              <div className="rounded-[20px] border border-white/6 bg-[#1f232b] p-4 sm:p-5">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#848e9c]">24h Snapshot</div>
                <div className="mt-4 space-y-3">
                  <DetailRow label="Change" value={selectedMarket.ticker ? formatPercent(selectedMarket.ticker.changePct) : "--"} tone={(selectedMarket.ticker?.changePct ?? 0) >= 0 ? "positive" : "negative"} />
                  <DetailRow label="Volume" value={formatVolume(coinMeta[selectedMarket.base.toUpperCase()]?.totalVolume ?? selectedMarket.ticker?.volumeQuote ?? selectedMarket.ticker?.volume)} tone={(selectedMarket.ticker?.changePct ?? 0) >= 0 ? "positive" : "negative"} />
                  <DetailRow
                    label="Market Cap"
                    value={formatMarketCap(selectedMarket.ticker?.marketCap ?? coinMeta[selectedMarket.base.toUpperCase()]?.marketCap)}
                  />
                  <DetailRow label="Status" value={selectedMarket.status} />
                </div>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-[#848e9c]">{loading ? "Loading market details..." : "Select a market to inspect it."}</div>
          )}
        </div>
      </section>
    </div>
  );
}

function MarketStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-white/6 bg-[#262b33] px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-[#848e9c]">{label}</div>
      <div className="mt-2 break-words text-[0.96rem] font-semibold text-white">{value}</div>
    </div>
  );
}

function CoinLogo({
  symbol,
  imageUrl,
  imageFailed,
  onImageError,
  size = "md",
}: {
  symbol: string;
  imageUrl?: string;
  imageFailed?: boolean;
  onImageError?: () => void;
  size?: "sm" | "md";
}) {
  const basePalette = getAssetPalette(symbol);
  const small = size === "sm";
  const canShowImage = Boolean(imageUrl) && !imageFailed;

  if (canShowImage) {
    return (
      <img
        src={imageUrl}
        alt={`${symbol} logo`}
        className={`shrink-0 rounded-full object-cover shadow-[0_10px_24px_rgba(0,0,0,0.28)] ${small ? "h-6 w-6" : "h-10 w-10"}`}
        onError={onImageError}
        loading="lazy"
      />
    );
  }

  return (
    <div className={`relative shrink-0 ${small ? "h-6 w-6" : "h-10 w-10"}`} aria-hidden="true">
      <div
        className={`absolute inset-0 flex items-center justify-center rounded-full bg-gradient-to-br ${basePalette.shell} font-bold text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)] ring-1 ${basePalette.ring} ${small ? "text-[10px]" : "text-[16px]"}`}
      >
        {basePalette.icon}
      </div>
    </div>
  );
}

function MarketPairIcon({
  base,
  quote,
  size = "md",
  imageUrl,
  imageFailed,
  onImageError,
}: {
  base: string;
  quote: string;
  size?: "sm" | "md";
  imageUrl?: string;
  imageFailed?: boolean;
  onImageError?: () => void;
}) {
  const mappedSymbol = base.toUpperCase();

  return (
    <CoinLogo
      symbol={mappedSymbol}
      imageUrl={imageUrl}
      imageFailed={imageFailed}
      onImageError={onImageError}
      size={size}
    />
  );
}

function DetailRow({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "positive" | "negative" }) {
  const toneClass = tone === "positive" ? "text-[#0ecb81]" : tone === "negative" ? "text-[#f6465d]" : "text-white";
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/6 bg-[#262b33] px-4 py-3">
      <span className="text-sm text-[#848e9c]">{label}</span>
      <span className={`text-sm font-semibold ${toneClass}`}>{value}</span>
    </div>
  );
}

function SortHeaderButton({
  label,
  sortKey,
  activeSort,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeSort: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey, direction?: SortDirection) => void;
  align?: "left" | "right";
}) {
  const active = activeSort === sortKey;
  const alignment = align === "right" ? "justify-end text-right" : "justify-start text-left";

  return (
    <div className={`inline-flex items-center gap-1.5 ${alignment}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`transition ${active ? "text-white" : "text-[#848e9c] hover:text-white"}`}
      >
        {label}
      </button>
      <SortChevron sortKey={sortKey} active={active} direction={direction} onSort={onSort} />
    </div>
  );
}

function SortChevron({
  sortKey,
  active,
  direction,
  onSort,
}: {
  sortKey: SortKey;
  active: boolean;
  direction: SortDirection;
  onSort: (key: SortKey, direction?: SortDirection) => void;
}) {
  return (
    <span className="inline-flex flex-col leading-none">
      <button
        type="button"
        onClick={() => onSort(sortKey, "asc")}
        className={`transition ${active && direction === "asc" ? "text-[#f0b90b]" : "text-[#5f6878] hover:text-white"}`}
        aria-label={`Sort ${sortKey} ascending`}
      >
        <svg viewBox="0 0 12 12" className="h-[9px] w-[9px]" fill="none" aria-hidden="true">
          <path d="M3 7.5 6 4.5 9 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onSort(sortKey, "desc")}
        className={`-mt-[1px] transition ${active && direction === "desc" ? "text-[#f0b90b]" : "text-[#5f6878] hover:text-white"}`}
        aria-label={`Sort ${sortKey} descending`}
      >
        <svg viewBox="0 0 12 12" className="h-[9px] w-[9px]" fill="none" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </span>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

function BurgerIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M4 7h16" strokeLinecap="round" />
      <path d="M4 12h16" strokeLinecap="round" />
      <path d="M4 17h16" strokeLinecap="round" />
    </svg>
  );
}
