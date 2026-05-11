import { useEffect, useState } from "react";

type SignalPoint = { time: number; value: number; channel: string };

const channels = ["order", "trade", "liquidity", "system"];

export default function SignalPlayground() {
  const [signals, setSignals] = useState<SignalPoint[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setConnected(true);
    const timer = window.setInterval(() => {
      setSignals((prev) => {
        const next: SignalPoint = {
          time: Date.now(),
          value: Math.random() * 100,
          channel: channels[Math.floor(Math.random() * channels.length)],
        };
        return [next, ...prev].slice(0, 50);
      });
    }, 900);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Signal Playground</h1>
          <p className="text-sm text-slate-300/80">
            A sandbox to preview how real-time analytics will look once you connect live feeds. Currently powered by mock data that mutates every second.
          </p>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-xs ${
            connected ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"
          }`}
        >
          {connected ? "connected" : "disconnected"}
        </div>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(147,197,253,0.35)] space-y-3">
        <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">
          Streaming metrics
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {channels.map((ch) => {
            const latest = signals.find((item) => item.channel === ch);
            const values = signals
              .filter((item) => item.channel === ch)
              .slice(0, 10)
              .map((item) => item.value);
            const avg =
              values.reduce((total, value) => total + value, 0) /
              (values.length || 1);

            return (
              <div
                key={ch}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">
                    {ch.toUpperCase()}
                  </span>
                  <span className="text-xs text-slate-400">
                    {latest
                      ? new Date(latest.time).toLocaleTimeString()
                      : "--"}
                  </span>
                </div>
                <div className="mt-1 text-2xl font-semibold text-white">
                  {latest ? latest.value.toFixed(2) : "--"}
                </div>
                <div className="text-xs text-slate-300/80">
                  10 sample avg: {avg.toFixed(2)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(59,130,246,0.35)]">
        <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70 mb-3">
          Raw stream firehose (latest 15)
        </div>
        <div className="grid grid-cols-[130px_1fr_1fr] text-xs uppercase tracking-[0.12em] text-slate-300/60 mb-2">
          <span>Timestamp</span>
          <span>Channel</span>
          <span>Value</span>
        </div>
        <div className="max-h-64 overflow-auto space-y-1 text-sm">
          {signals.slice(0, 15).map((item) => (
            <div
              key={item.time + item.channel}
              className="grid grid-cols-[130px_1fr_1fr] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-slate-200"
            >
              <span className="text-xs text-slate-400">
                {new Date(item.time).toLocaleTimeString()}
              </span>
              <span>{item.channel}</span>
              <span>{item.value.toFixed(3)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
