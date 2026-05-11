import { useEffect, useMemo, useState } from "react";

type Metric = {
  id: string;
  label: string;
  value: number;
  unit: string;
  delta: number;
};

type StreamEvent = {
  id: string;
  ts: number;
  message: string;
  severity: "info" | "warning" | "success";
};

const INITIAL_METRICS: Metric[] = [
  { id: "latency", label: "WS Latency", value: 24, unit: "ms", delta: 0 },
  { id: "orders", label: "Orders/min", value: 68, unit: "", delta: 0 },
  { id: "fills", label: "Fills/min", value: 31, unit: "", delta: 0 },
  { id: "connections", label: "Active sockets", value: 124, unit: "", delta: 0 },
];

const messages = [
  { severity: "info", text: "Subscribed to ticker feed BTCUSDT." },
  { severity: "warning", text: "Depth snapshot delay > 1200ms. Monitoring…" },
  { severity: "success", text: "Trade batch ACK received (24 fills)." },
  { severity: "info", text: "Heartbeat acknowledged from syd-03 node." },
  { severity: "warning", text: "Retrying order stream after timeout." },
] as const;

export default function RealtimeHub() {
  const [metrics, setMetrics] = useState<Metric[]>(INITIAL_METRICS);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    const uptimeTimer = window.setInterval(() => setUptime((prev) => prev + 1), 1000);
    return () => window.clearInterval(uptimeTimer);
  }, []);

  useEffect(() => {
    const metricTimer = window.setInterval(() => {
      setMetrics((prev) =>
        prev.map((metric) => {
          const variance = metric.id === "latency" ? 6 : metric.id === "connections" ? 4 : 12;
          const change = (Math.random() - 0.5) * variance;
          const nextValue = Math.max(metric.id === "latency" ? 12 : 0, metric.value + change);
          return {
            ...metric,
            value: Math.round(nextValue * 100) / 100,
            delta: Math.round(change * 100) / 100,
          };
        })
      );
    }, 1500);

    const eventTimer = window.setInterval(() => {
      setEvents((prev) => {
        const pick = messages[Math.floor(Math.random() * messages.length)];
        const entry: StreamEvent = {
          id: Math.random().toString(36).slice(2),
          ts: Date.now(),
          message: pick.text,
          severity: pick.severity,
        };
        return [entry, ...prev].slice(0, 12);
      });
    }, 2200);

    return () => {
      window.clearInterval(metricTimer);
      window.clearInterval(eventTimer);
    };
  }, []);

  const formattedUptime = useMemo(() => {
    const minutes = Math.floor(uptime / 60);
    const seconds = uptime % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }, [uptime]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Realtime Control Hub</h1>
          <p className="text-sm text-slate-300/85">
            Placeholder widgets simulating websocket health, latency, and stream events. Swap the demo data with your production feeds.
          </p>
        </div>
        <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-sm">
          Uptime {formattedUptime}
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <div
            key={metric.id}
            className="rounded-3xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.35)]"
          >
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">
              {metric.label}
            </div>
            <div className="mt-2 text-2xl font-semibold text-white">
              {metric.value.toFixed(2)}
              {metric.unit && <span className="ml-1 text-base text-slate-300/80">{metric.unit}</span>}
            </div>
            <div
              className={`text-xs ${
                metric.delta >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {metric.delta >= 0 ? "+" : ""}
              {metric.delta.toFixed(2)}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">
                Stream log
              </div>
              <h2 className="text-lg font-semibold text-white">Latest transport events</h2>
            </div>
            <span className="text-xs text-indigo-200">
              {events.length} events tracked
            </span>
          </div>
          <div className="max-h-72 overflow-auto space-y-2 text-sm">
            {events.map((event) => (
              <div
                key={event.id}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-slate-200"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs ${
                      event.severity === "info"
                        ? "text-indigo-200"
                        : event.severity === "warning"
                        ? "text-amber-300"
                        : "text-emerald-300"
                    }`}
                  >
                    {event.severity.toUpperCase()}
                  </span>
                  <span className="text-xs text-slate-400">
                    {new Date(event.ts).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-1 text-sm">{event.message}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.3)] space-y-4">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">
              Preview
            </div>
            <h2 className="text-lg font-semibold text-white">Integration notes</h2>
            <p className="mt-1 text-sm text-slate-300/80">
              Swap these arrays with websockets, SSE, or gRPC streams. The UI is tuned for sub-second updates.
            </p>
          </div>
          <ul className="space-y-2 text-sm text-slate-300/90">
            <li>• Replace metric updates with your latency and volume metrics.</li>
            <li>• Pipe live log entries from Kafka or Redis streams.</li>
            <li>• Attach CTA buttons for clearing buffers or replaying events.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
