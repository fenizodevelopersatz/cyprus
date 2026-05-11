import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import { usePaperEngine } from "../../../hooks/usePaperEngine";
import type { SwapExecution } from "../../../utils/paperEngine";

const slippagePresets = [0.1, 0.3, 0.5, 1, 3];

const routingOptions = [
  {
    id: "auto",
    label: "CryptoSignal Smart Route",
    description: "Splits flow between CryptoSignal liquidity and trusted market makers.",
    hops: ["CryptoSignal Pool", "Prime MM desk"],
    impactPct: 0.12,
    feeBps: 4,
  },
  {
    id: "dex",
    label: "External DEX",
    description: "Bridges through supported on-chain venues for long-tail pairs.",
    hops: ["Serum", "Camelot"],
    impactPct: 0.22,
    feeBps: 8,
  },
  {
    id: "mm",
    label: "OTC block desk",
    description: "Best for large tickets needing discreet execution.",
    hops: ["OTC desk"],
    impactPct: 0.05,
    feeBps: 2,
  },
];

const tokenMeta: Record<
  string,
  {
    name: string;
    description: string;
  }
> = {
  BTC: {
    name: "Bitcoin",
    description: "Digital collateral layer for the CryptoSignal ecosystem.",
  },
  ETH: {
    name: "Ethereum",
    description: "Programmable settlement asset for on-chain activity.",
  },
  SOL: {
    name: "Solana",
    description: "High throughput execution layer with ultra-low latency.",
  },
  USDT: {
    name: "Tether USD",
    description: "Dollar-pegged stablecoin used as the primary quote asset.",
  },
};

const usdFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatTokenAmount(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 1) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(2)}%`;
}

export default function SwapPage() {
  const engine = usePaperEngine();
  const tokens = useMemo(() => {
    const discovered = new Set(engine.assets ?? []);
    if (!discovered.has("USDT")) discovered.add("USDT");
    return Array.from(discovered).map((symbol) => ({
      symbol,
      name: tokenMeta[symbol]?.name ?? symbol,
      description: tokenMeta[symbol]?.description ?? "Supported swap asset.",
    }));
  }, [engine.assets]);

  const [fromToken, setFromToken] = useState(() => {
    const preferred = tokens.find((token) => token.symbol === "USDT");
    return preferred?.symbol ?? tokens[0]?.symbol ?? "USDT";
  });
  const [toToken, setToToken] = useState(() => {
    const fallback = tokens.find((token) => token.symbol !== "USDT");
    return fallback?.symbol ?? tokens[0]?.symbol ?? "BTC";
  });
  const [amountIn, setAmountIn] = useState("1000");
  const [slippage, setSlippage] = useState(0.5);
  const [routing, setRouting] = useState(routingOptions[0].id);
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentExecutionId, setRecentExecutionId] = useState<string | null>(null);

  useEffect(() => {
    if (!tokens.some((token) => token.symbol === fromToken)) {
      const fallback = tokens[0]?.symbol ?? "USDT";
      setFromToken(fallback);
    }
  }, [tokens, fromToken]);

  useEffect(() => {
    if (fromToken === toToken) {
      const next = tokens.find((token) => token.symbol !== fromToken);
      if (next) {
        setToToken(next.symbol);
      }
    } else if (!tokens.some((token) => token.symbol === toToken)) {
      const fallback = tokens.find((token) => token.symbol !== fromToken);
      if (fallback) {
        setToToken(fallback.symbol);
      }
    }
  }, [tokens, fromToken, toToken]);

  const fromBalance = engine.balances[fromToken] ?? 0;
  const toBalance = engine.balances[toToken] ?? 0;
  const amountNumber = parseFloat(amountIn) || 0;
  const selectedRoute = routingOptions.find((route) => route.id === routing) ?? routingOptions[0];

  const quote =
    amountNumber > 0 && fromToken !== toToken
      ? engine.quoteSwap({
          fromToken,
          toToken,
          amountIn: amountNumber,
          slippagePct: slippage,
          impactPct: selectedRoute.impactPct,
        })
      : null;

  const routeImpact = selectedRoute.impactPct;
  const worstCaseImpact =
    quote && quote.midAmountOut > 0
      ? ((quote.midAmountOut - quote.amountOut) / quote.midAmountOut) * 100
      : 0;

  const estimatedFeeUsd =
    quote && selectedRoute.feeBps
      ? (quote.usdtValue * selectedRoute.feeBps) / 10000
      : 0;

  const insufficientBalance = amountNumber > fromBalance && amountNumber !== 0;
  const lastExecution = engine.swapHistory[0];
  const showExecutionBanner = lastExecution && lastExecution.id === recentExecutionId;

  const walletBreakdown = tokens
    .map((token) => {
      const qty = engine.balances[token.symbol] ?? 0;
      const price = engine.getTokenPrice(token.symbol) ?? (token.symbol === "USDT" ? 1 : 0);
      return {
        ...token,
        qty,
        usdValue: qty * price,
      };
    })
    .filter((entry) => entry.qty > 0);

  const handleFlip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setShowPreview(false);
    setError(null);
  };

  const handleMax = () => {
    if (fromBalance <= 0) return;
    const formatted = fromBalance.toFixed(6).replace(/\.?0+$/, "");
    setAmountIn(formatted);
  };

  const handlePreview = () => {
    setError(null);
    if (!quote) {
      setError("Enter an amount and choose two different assets to preview.");
      return;
    }
    if (insufficientBalance) {
      setError("Insufficient balance for the selected amount.");
      return;
    }
    setShowPreview(true);
  };

  const handleSwap = () => {
    setError(null);
    if (!quote) {
      setError("Enter an amount and choose two different assets to swap.");
      return;
    }
    if (insufficientBalance) {
      setError("Insufficient balance for the selected amount.");
      return;
    }
    const execution = engine.swapTokens({
      fromToken,
      toToken,
      amountIn: amountNumber,
      slippagePct: slippage,
      impactPct: selectedRoute.impactPct,
      routing: selectedRoute.label,
    });
    if (!execution) {
      setError("Swap could not be simulated. Adjust parameters and try again.");
      return;
    }
    setAmountIn("");
    setShowPreview(false);
    setRecentExecutionId(execution.id);
  };

  const history = engine.swapHistory.slice(0, 6);

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Instant Swap</h1>
          <p className="text-sm text-slate-300/85">
            Route assets across CryptoSignal rails with live quotes, slippage controls, and execution history.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm">
            View swap history
          </Button>
          <Button size="sm" onClick={() => setShowPreview(false)}>
            New swap
          </Button>
        </div>
      </header>

      {showExecutionBanner && lastExecution ? (
        <ExecutionBanner execution={lastExecution} />
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">
                Swap details
              </div>
              <div className="text-xs text-slate-300/70">
                Slippage tolerance {formatPercent(slippage)}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-300/70">
                  <span>From</span>
                  <button className="text-indigo-300 hover:underline" onClick={handleMax}>
                    Max balance
                  </button>
                </div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <TokenSelect
                    value={fromToken}
                    onChange={(event) => {
                      setFromToken(event.target.value);
                      setShowPreview(false);
                    }}
                    tokens={tokens}
                  />
                  <div className="w-full md:w-44">
                    <Input
                      value={amountIn}
                      onChange={(event) => setAmountIn(event.target.value)}
                      type="number"
                      step="any"
                      inputMode="decimal"
                      className="border-white/20 bg-slate-950/40 text-right text-lg text-white"
                      placeholder="0.00"
                    />
                    <div className="mt-1 text-xs text-slate-400">
                      Balance: {formatTokenAmount(fromBalance)} {fromToken}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center">
                <Button variant="ghost" size="sm" onClick={handleFlip} className="rounded-full border border-white/10 bg-white/10 text-xs">
                  Swap
                </Button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-300/70">
                  <span>To</span>
                  <span className="text-slate-300/80">
                    Wallet balance: {formatTokenAmount(toBalance)} {toToken}
                  </span>
                </div>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <TokenSelect
                    value={toToken}
                    onChange={(event) => {
                      setToToken(event.target.value);
                      setShowPreview(false);
                    }}
                    tokens={tokens.filter((token) => token.symbol !== fromToken)}
                  />
                  <div className="w-full md:w-44 text-right">
                    <div className="text-lg font-semibold text-white">
                      {quote ? formatTokenAmount(quote.amountOut) : "--"}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      Mid: {quote ? formatTokenAmount(quote.midAmountOut) : "--"} {toToken}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 space-y-2">
              <div className="flex justify-between">
                <span>Route</span>
                <span>{selectedRoute.label}</span>
              </div>
              <div className="flex justify-between">
                <span>Estimated price impact</span>
                <span className={routeImpact > 0.6 ? "text-amber-300" : "text-emerald-300"}>
                  {formatPercent(routeImpact)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Estimated fee</span>
                <span>${usdFormatter.format(estimatedFeeUsd)}</span>
              </div>
              <div className="flex justify-between">
                <span>Worst case impact</span>
                <span>{formatPercent(worstCaseImpact)}</span>
              </div>
              <div className="flex justify-between">
                <span>Notional</span>
                <span>${usdFormatter.format(quote?.usdtValue ?? 0)}</span>
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            ) : null}

            <div className="flex flex-col gap-3 md:flex-row">
              <Button
                className="flex-1"
                size="lg"
                variant={showPreview ? "primary" : "secondary"}
                onClick={handlePreview}
              >
                Preview quote
              </Button>
              <Button className="flex-1" size="lg" onClick={handleSwap} disabled={!quote || insufficientBalance}>
                Execute swap
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(37,99,235,0.35)] space-y-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Routing options</div>
            <div className="space-y-3 text-sm text-slate-200">
              {routingOptions.map((route) => (
                <button
                  key={route.id}
                  onClick={() => {
                    setRouting(route.id);
                    setShowPreview(false);
                  }}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    routing === route.id
                      ? "border-indigo-400/60 bg-indigo-500/20 text-white shadow-[0_15px_45px_-30px_rgba(79,70,229,0.65)]"
                      : "border-white/10 bg-white/5 text-slate-300/80 hover:border-indigo-400/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-white">{route.label}</div>
                    <div className="text-xs text-indigo-200/80">{route.description}</div>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-300/75">
                    <span>{route.hops.join(" -> ")}</span>
                    <span>
                      Impact {formatPercent(route.impactPct)} | Fee {route.feeBps} bps
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.3)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">
                Slippage tolerance
              </div>
              <div className="text-xs text-slate-300/75">
                Execution reverts if price moves beyond the threshold.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {slippagePresets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => {
                    setSlippage(preset);
                    setShowPreview(false);
                  }}
                  className={`rounded-full px-3 py-1 text-sm ${
                    slippage === preset
                      ? "bg-indigo-500/20 text-white border border-indigo-400/50"
                      : "bg-white/5 text-slate-300/80 border border-white/10"
                  }`}
                >
                  {preset}%
                </button>
              ))}
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-slate-300/80">
                <Input
                  value={slippage}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setSlippage(Number.isNaN(next) ? 0 : next);
                    setShowPreview(false);
                  }}
                  className="h-7 w-16 border-none bg-transparent text-center"
                  type="number"
                  step="any"
                />
                <span>%</span>
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div
            className={`rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.3)] ${
              showPreview ? "ring-2 ring-indigo-400/60" : ""
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-white">Quote summary</div>
              <div className="text-xs text-slate-300/75">
                Real-time pricing updates every engine tick.
              </div>
            </div>
            {quote ? (
              <div className="space-y-3 text-sm text-slate-200">
                <SummaryRow label="You pay" value={`${formatTokenAmount(quote.amountIn)} ${fromToken}`} />
                <SummaryRow label="You receive" value={`${formatTokenAmount(quote.amountOut)} ${toToken}`} />
                <SummaryRow
                  label="Execution price"
                  value={
                    quote.effectivePrice === 0
                      ? "--"
                      : `${formatTokenAmount(quote.effectivePrice)} ${toToken}/${fromToken}`
                  }
                />
                <SummaryRow label="Notional (USDT)" value={`$${usdFormatter.format(quote.usdtValue)}`} />
                <SummaryRow label="Route" value={selectedRoute.label} />
                <SummaryRow label="Estimated fee" value={`$${usdFormatter.format(estimatedFeeUsd)}`} />
                <SummaryRow label="Slippage tolerance" value={formatPercent(slippage)} />
                <SummaryRow label="Route impact" value={formatPercent(routeImpact)} />
                <SummaryRow label="Worst case impact" value={formatPercent(worstCaseImpact)} />
              </div>
            ) : (
              <div className="text-sm text-slate-300/80">
                Enter an amount to preview the execution path and settlement breakdown.
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Wallet balances</div>
              <div className="text-xs text-slate-300/80">Values marked to mid price</div>
            </div>
            {walletBreakdown.length === 0 ? (
              <div className="text-sm text-slate-300/75">
                Balances are empty. Swap from USDT to seed your wallet.
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                {walletBreakdown.map((entry) => (
                  <div
                    key={entry.symbol}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <div>
                      <div className="font-semibold text-white">{entry.symbol}</div>
                      <div className="text-xs text-slate-300/80">{entry.description}</div>
                    </div>
                    <div className="text-right">
                      <div>{formatTokenAmount(entry.qty)} {entry.symbol}</div>
                      <div className="text-xs text-slate-300/70">${usdFormatter.format(entry.usdValue)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(37,99,235,0.35)] space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-white">Recent swaps</div>
              <div className="text-xs text-slate-300/80">Latest {history.length} records</div>
            </div>
            {history.length === 0 ? (
              <div className="text-sm text-slate-300/75">No simulated swaps yet.</div>
            ) : (
              <div className="space-y-2 text-sm">
                {history.map((entry) => (
                  <HistoryRow key={entry.id} execution={entry} />
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}

type TokenSelectProps = {
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  tokens: { symbol: string; name: string; description: string }[];
};

function TokenSelect({ value, onChange, tokens }: TokenSelectProps) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2">
      <select
        value={value}
        onChange={onChange}
        className="bg-transparent text-sm font-semibold text-white focus:outline-none"
      >
        {tokens.map((token) => (
          <option key={token.symbol} value={token.symbol} className="text-black">
            {token.symbol}
          </option>
        ))}
      </select>
      <div className="hidden md:block text-xs text-slate-300/75">{tokens.find((token) => token.symbol === value)?.name}</div>
    </div>
  );
}

type SummaryRowProps = {
  label: string;
  value: string;
};

function SummaryRow({ label, value }: SummaryRowProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-300/75">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

type ExecutionBannerProps = {
  execution: SwapExecution;
};

function ExecutionBanner({ execution }: ExecutionBannerProps) {
  return (
    <div className="rounded-3xl border border-emerald-400/40 bg-emerald-500/15 px-4 py-3 text-sm text-emerald-100 shadow-[0_20px_70px_-45px_rgba(16,185,129,0.35)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          Swap executed: {formatTokenAmount(execution.amountIn)} {execution.fromToken}
          {" -> "}
          {formatTokenAmount(execution.amountOut)} {execution.toToken}
        </span>
        <span className="text-xs text-emerald-200/80">
          Route {execution.routing}, slippage {formatPercent(execution.slippagePct)}.
        </span>
        <span className="text-xs text-emerald-200/80">
          Timestamp {new Date(execution.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

type HistoryRowProps = {
  execution: SwapExecution;
};

function HistoryRow({ execution }: HistoryRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <div>
        <div className="text-xs text-slate-400">
          {new Date(execution.timestamp).toLocaleString()}
        </div>
        <div className="font-semibold text-white">
          {formatTokenAmount(execution.amountIn)} {execution.fromToken}
          {" -> "}
          {formatTokenAmount(execution.amountOut)} {execution.toToken}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs text-slate-300/80">{execution.routing}</div>
        <div className="text-xs text-slate-300/70">
          Notional ${usdFormatter.format(execution.usdtValue)}
        </div>
      </div>
    </div>
  );
}
