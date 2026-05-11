import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchAdminAuditLogs,
  fetchAdminDashboardActivity,
  fetchAdminDashboardOverview,
  fetchAdminServices,
  fetchAdminTreasury,
  fetchAdminWebsocketStatus,
  type AdminDashboardActivity,
  type AdminAuditLog,
  type AdminDashboardQueueItem,
} from "../api/admin.api";

type LiveState = "connecting" | "live" | "fallback";

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const pageShell = "space-y-6 text-slate-100";
const panelCls =
  "relative overflow-hidden rounded-[30px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(20,184,166,0.1),_rgba(2,6,23,0.94)_55%)] backdrop-blur-2xl shadow-[0_40px_120px_-65px_rgba(16,185,129,0.35)]";
const sectionPad = "p-5 md:p-6";
const eyebrowCls = "text-[11px] uppercase tracking-[0.28em] text-emerald-200/70";
const mutedCls = "text-sm text-slate-400";

const chartPalette = {
  emerald: "#34d399",
  cyan: "#22d3ee",
  blue: "#60a5fa",
  amber: "#fbbf24",
  rose: "#fb7185",
  violet: "#a78bfa",
};

const safeNumber = (value?: number | string | null) => {
  if (value === undefined || value === null) return 0;
  const numeric = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : 0;
};

const formatMoney = (value?: number | string | null, compactMode = true) =>
  compactMode ? usdCompact.format(safeNumber(value)) : usd.format(safeNumber(value));

const formatCount = (value?: number | string | null, compactMode = false) =>
  compactMode ? compact.format(safeNumber(value)) : integer.format(safeNumber(value));

const formatRelativeTime = (value?: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const buildAdminDashboardWsUrl = () => {
  if (typeof window === "undefined") return null;
  const token = window.localStorage.getItem("adminAccessToken");
  const url = new URL(window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/admin/dashboard";
  url.search = "";
  if (token) {
    url.searchParams.set("token", token);
  }
  return url.toString();
};

function useAdminDashboardLiveFeed() {
  const queryClient = useQueryClient();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const [liveState, setLiveState] = useState<LiveState>("connecting");
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  useEffect(() => {
    const url = buildAdminDashboardWsUrl();
    if (!url) {
      setLiveState("fallback");
      return;
    }

    let closedByUser = false;

    const connect = () => {
      try {
        setLiveState("connecting");
        const socket = new WebSocket(url);
        socketRef.current = socket;

        socket.onopen = () => {
          setLiveState("live");
        };

        socket.onmessage = () => {
          setLastEventAt(new Date().toISOString());
          queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
          queryClient.invalidateQueries({ queryKey: ["admin", "services"] });
        };

        socket.onerror = () => {
          setLiveState("fallback");
        };

        socket.onclose = () => {
          socketRef.current = null;
          if (closedByUser) return;
          setLiveState("fallback");
          reconnectRef.current = window.setTimeout(connect, 6000);
        };
      } catch {
        setLiveState("fallback");
      }
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
      }
      socketRef.current?.close();
    };
  }, [queryClient]);

  return { liveState, lastEventAt };
}

function inferSupportOpenCount(activity: AdminDashboardActivity[]) {
  return activity.filter((item) => /support|ticket|chat|complaint/i.test(item.type)).length;
}

function sumQueueAmounts(items: AdminDashboardQueueItem[]) {
  return items.reduce((sum, item) => sum + safeNumber(item.amount), 0);
}

export default function AdminDashboardPage() {
  const queryClient = useQueryClient();
  const { liveState, lastEventAt } = useAdminDashboardLiveFeed();
  const [rangeDays, setRangeDays] = useState(30);
  const [activityPage, setActivityPage] = useState(1);
  const [loginPage, setLoginPage] = useState(1);

  const overviewQuery = useQuery({
    queryKey: ["admin", "dashboard", "overview", rangeDays],
    queryFn: () => fetchAdminDashboardOverview({ rangeDays }),
    refetchInterval: liveState === "live" ? false : 30_000,
    staleTime: 15_000,
  });

  const activityQuery = useQuery({
    queryKey: ["admin", "dashboard", "activity"],
    queryFn: () => fetchAdminDashboardActivity({ limit: 40 }),
    refetchInterval: liveState === "live" ? false : 20_000,
    staleTime: 10_000,
  });

  const servicesQuery = useQuery({
    queryKey: ["admin", "services"],
    queryFn: fetchAdminServices,
    refetchInterval: liveState === "live" ? false : 20_000,
    staleTime: 10_000,
  });

  const treasuryQuery = useQuery({
    queryKey: ["admin", "treasury"],
    queryFn: fetchAdminTreasury,
    refetchInterval: liveState === "live" ? false : 20_000,
    staleTime: 10_000,
  });

  const websocketStatusQuery = useQuery({
    queryKey: ["admin", "websocket-status"],
    queryFn: fetchAdminWebsocketStatus,
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const auditLogsQuery = useQuery({
    queryKey: ["admin", "audit", "logins"],
    queryFn: () => fetchAdminAuditLogs(120),
    refetchInterval: liveState === "live" ? false : 30_000,
    staleTime: 15_000,
  });

  const overview = overviewQuery.data;
  const activityItems = activityQuery.data?.items ?? overview?.recentActivity ?? [];
  const services = overview?.services?.length ? overview.services : servicesQuery.data?.services ?? [];
  const syncedAt = overview?.syncedAt ?? servicesQuery.data?.syncedAt ?? undefined;

  const usersChart = useMemo(
    () =>
      (overview?.charts?.dailyUsers ?? []).map((point) => ({
        date: point.date,
        total: safeNumber(point.total),
        active: safeNumber(point.active),
        newUsers: safeNumber(point.new),
      })),
    [overview]
  );

  const moneyFlowChart = useMemo(
    () =>
      (overview?.charts?.fundingFlows ?? []).map((point) => ({
        date: point.date,
        deposits: safeNumber(point.cryptoIn) + safeNumber(point.fiatIn),
        withdrawals: safeNumber(point.cryptoOut),
        cryptoIn: safeNumber(point.cryptoIn),
        fiatIn: safeNumber(point.fiatIn),
        net: safeNumber(point.cryptoIn) + safeNumber(point.fiatIn) - safeNumber(point.cryptoOut),
      })),
    [overview]
  );

  const supportOpenCount = useMemo(() => inferSupportOpenCount(activityItems), [activityItems]);

  const activityChart = useMemo(() => {
    const grouped = new Map<string, { date: string; deposits: number; withdrawals: number; staking: number; kyc: number }>();
    for (const item of activityItems) {
      const rawDate = item.occurredAt ?? item.timestamp;
      if (!rawDate) continue;
      const dateKey = new Date(rawDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const bucket = grouped.get(dateKey) ?? { date: dateKey, deposits: 0, withdrawals: 0, staking: 0, kyc: 0 };
      if (/deposit/i.test(item.type)) bucket.deposits += 1;
      else if (/withdraw/i.test(item.type)) bucket.withdrawals += 1;
      else if (/staking/i.test(item.type)) bucket.staking += 1;
      else if (/kyc/i.test(item.type)) bucket.kyc += 1;
      grouped.set(dateKey, bucket);
    }
    return Array.from(grouped.values()).slice(-14);
  }, [activityItems]);

  const operationsChart = useMemo(
    () =>
      moneyFlowChart.map((point) => ({
        date: point.date,
        cryptoIn: point.cryptoIn,
        fiatIn: point.fiatIn,
        cryptoOut: point.withdrawals,
        net: point.net,
      })),
    [moneyFlowChart]
  );

  const latestUsersPoint = usersChart[usersChart.length - 1];
  const depositTotal = moneyFlowChart.reduce((sum, point) => sum + point.deposits, 0);
  const withdrawalTotal = moneyFlowChart.reduce((sum, point) => sum + point.withdrawals, 0);
  const netFlow = depositTotal - withdrawalTotal;
  const kycPending = safeNumber(overview?.summary.users?.kycPending ?? overview?.queues?.kyc?.length);
  const kycApproved = safeNumber(overview?.summary.users?.verified);
  const totalUsers = safeNumber(overview?.summary.users?.total);
  const activeUsers = latestUsersPoint?.active ?? safeNumber(overview?.summary.users?.active24h);
  const newUsers = latestUsersPoint?.newUsers ?? safeNumber(overview?.summary.users?.new24h);
  const pendingFiatCount = safeNumber(overview?.summary.funding?.fiat?.pending);
  const pendingFiatAmount = safeNumber(overview?.summary.funding?.fiat?.pendingAmount);
  const fiatQueue = overview?.queues?.fiatDeposits ?? [];
  const withdrawalQueue = overview?.queues?.withdrawals ?? [];
  const treasuryWallets = treasuryQuery.data?.custodial?.wallets ?? [];
  const liveUsdtByNetwork = treasuryWallets.reduce<Record<string, string>>((acc, wallet) => {
    acc[String(wallet.network || "").toLowerCase()] = wallet.usdtBalance || "0";
    return acc;
  }, {});
  const totalAdminUsdt = treasuryQuery.data?.custodial?.totalTreasuryBalance
    ? Object.values(treasuryQuery.data.custodial.totalTreasuryBalance).reduce((sum, value) => sum + Number(value || 0), 0)
    : treasuryWallets.reduce((sum, wallet) => sum + Number(wallet.usdtBalance || 0), 0);

  const summaryCards = [
    { label: "Total Users", value: formatCount(totalUsers), meta: `${formatCount(activeUsers)} active in 24h`, accent: chartPalette.emerald },
    { label: "New Users", value: formatCount(newUsers), meta: `${rangeDays}-day chart range`, accent: chartPalette.cyan },
    { label: "KYC Pending", value: formatCount(kycPending), meta: `${formatCount(kycApproved)} verified users`, accent: chartPalette.amber },
    { label: "Total Admin USDT", value: formatMoney(totalAdminUsdt, false), meta: "Combined live admin treasury balance", accent: chartPalette.blue },
    { label: "Admin ERC-20 USDT", value: formatMoney(liveUsdtByNetwork.ethereum || "0", false), meta: "Ethereum admin treasury wallet", accent: chartPalette.cyan },
    { label: "Admin BEP-20 USDT", value: formatMoney(liveUsdtByNetwork.bsc || "0", false), meta: "BSC admin treasury wallet", accent: chartPalette.amber },
    { label: "Admin TRC-20 USDT", value: formatMoney(liveUsdtByNetwork.tron || "0", false), meta: "TRON admin treasury wallet", accent: chartPalette.violet },
  ];

  const securityRows = [
    { label: "Pending KYC requests", value: formatCount(overview?.queues?.kyc?.length ?? 0) },
    { label: "Pending fiat approvals", value: formatCount(pendingFiatCount) },        
  ];

  const liveLabel =
    liveState === "live" ? "Socket live" : liveState === "connecting" ? "Connecting feed" : "Polling fallback";

  const loginRows = useMemo(() => {
    return (auditLogsQuery.data ?? [])
      .filter((log) => /login|sign in|signin|auth/i.test(log.action))
      .map((log) => mapLoginAuditRow(log));
  }, [auditLogsQuery.data]);

  const loginPageSize = 8;
  const loginTotalPages = Math.max(1, Math.ceil(loginRows.length / loginPageSize));
  const normalizedLoginPage = Math.min(loginPage, loginTotalPages);
  const paginatedLoginRows = loginRows.slice(
    (normalizedLoginPage - 1) * loginPageSize,
    normalizedLoginPage * loginPageSize
  );

  const activityPageSize = 8;
  const activityTotalPages = Math.max(1, Math.ceil(activityItems.length / activityPageSize));
  const normalizedActivityPage = Math.min(activityPage, activityTotalPages);
  const paginatedActivityItems = activityItems.slice(
    (normalizedActivityPage - 1) * activityPageSize,
    normalizedActivityPage * activityPageSize
  );

  return (
    <div className={pageShell}>
      <section className={`${panelCls} ${sectionPad}`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.2),_transparent_30%),radial-gradient(circle_at_bottom_left,_rgba(56,189,248,0.16),_transparent_28%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            {/* <div className={eyebrowCls}>Build Web Apps: frontend-skill</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white md:text-4xl">
              Admin Mission Control
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Live money flow, user growth, KYC pressure, signal income, and operations health for this exchange.
              The dashboard auto-refreshes by socket when available and falls back to polling when the realtime feed is unavailable.
            </p> */}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <span
                  className={`h-3 w-3 rounded-full ${
                    liveState === "live"
                      ? "animate-pulse bg-emerald-400"
                      : liveState === "connecting"
                      ? "animate-pulse bg-amber-400"
                      : "bg-slate-500"
                  }`}
                />
                <div>
                  <div className="text-sm font-medium text-white">{liveLabel}</div>
                  <div className="text-xs text-slate-400">
                    {lastEventAt ? `Last event ${formatRelativeTime(lastEventAt)}` : "Waiting for event stream"}
                  </div>
                </div>
              </div>
            </div>

            <label className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">Range</div>
              <select
                value={rangeDays}
                onChange={(event) => setRangeDays(Number(event.target.value))}
                className="mt-1 bg-transparent text-sm text-white focus:outline-none"
              >
                {[7, 14, 30, 60, 90].map((value) => (
                  <option key={value} value={value} className="bg-slate-900">
                    Last {value} days
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
                queryClient.invalidateQueries({ queryKey: ["admin", "services"] });
              }}
              className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100 transition hover:border-emerald-300/40 hover:bg-emerald-400/15"
            >
              Refresh dashboard
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card, index) => (
          <div
            key={card.label}
            className={`${panelCls} ${sectionPad} transition duration-500 hover:-translate-y-1`}
            style={{ animationDelay: `${index * 80}ms` }}
          >
            <div className="absolute inset-x-0 top-0 h-px opacity-90" style={{ backgroundColor: card.accent }} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{card.label}</div>
                <div className="mt-3 text-3xl font-semibold text-white">{card.value}</div>
                <div className="mt-2 text-sm text-slate-400">{card.meta}</div>
              </div>
              <span
                className="mt-1 h-10 w-10 rounded-full opacity-90 blur-[1px]"
                style={{ background: `radial-gradient(circle, ${card.accent} 0%, transparent 70%)` }}
              />
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className={`${panelCls} ${sectionPad}`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className={eyebrowCls}>Money Flow</div>
              <h2 className="mt-1 text-xl font-semibold text-white">Deposits vs withdrawals</h2>
            </div>
            <div className={mutedCls}>Auto-updates on feed events</div>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={moneyFlowChart}>
                <defs>
                  <linearGradient id="depositFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartPalette.emerald} stopOpacity={0.6} />
                    <stop offset="100%" stopColor={chartPalette.emerald} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="withdrawFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartPalette.rose} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={chartPalette.rose} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#ffffff12" strokeDasharray="4 4" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(value) => formatMoney(value)} />
                <Tooltip
                  contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18 }}
                  formatter={(value: number) => usd.format(value)}
                />
                <Legend />
                <Area type="monotone" dataKey="cryptoIn" name="Crypto in" stroke={chartPalette.emerald} fill="url(#depositFill)" strokeWidth={2.5} />
                <Area type="monotone" dataKey="fiatIn" name="Fiat in" stroke={chartPalette.blue} fillOpacity={0.12} fill={chartPalette.blue} strokeWidth={2.2} />
                <Area type="monotone" dataKey="cryptoOut" name="Crypto out" stroke={chartPalette.rose} fill="url(#withdrawFill)" strokeWidth={2.5} />
                <Line type="monotone" dataKey="net" stroke={chartPalette.cyan} dot={false} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`${panelCls} ${sectionPad}`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className={eyebrowCls}>User Growth</div>
              <h2 className="mt-1 text-xl font-semibold text-white">Acquisition and activity</h2>
            </div>
            <Link to="/admin/users" className="text-sm text-emerald-200 transition hover:text-white">
              Open users
            </Link>
          </div>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={usersChart}>
                <CartesianGrid stroke="#ffffff12" strokeDasharray="4 4" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18 }}
                />
                <Legend />
                <Line type="monotone" dataKey="total" stroke={chartPalette.blue} strokeWidth={3} dot={false} />
                <Line type="monotone" dataKey="active" stroke={chartPalette.emerald} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="newUsers" stroke={chartPalette.amber} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className={`${panelCls} ${sectionPad}`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className={eyebrowCls}>Signals</div>
              <h3 className="mt-1 text-lg font-semibold text-white">Signal usage and income</h3>
            </div>
            <Link to="/admin/signal-history" className="text-sm text-emerald-200 transition hover:text-white">
              View logs
            </Link>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activityChart}>
                <CartesianGrid stroke="#ffffff12" strokeDasharray="4 4" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18 }}
                />
                <Legend />
                <Bar dataKey="deposits" fill={chartPalette.emerald} radius={[8, 8, 0, 0]} />
                <Bar dataKey="withdrawals" fill={chartPalette.rose} radius={[8, 8, 0, 0]} />
                <Bar dataKey="staking" fill={chartPalette.violet} radius={[8, 8, 0, 0]} />
                <Bar dataKey="kyc" fill={chartPalette.amber} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`${panelCls} ${sectionPad}`}>
          <div className="mb-4">
            <div className={eyebrowCls}>Operations</div>
            <h3 className="mt-1 text-lg font-semibold text-white">Funding lanes and net flow</h3>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={operationsChart}>
                <CartesianGrid stroke="#ffffff12" strokeDasharray="4 4" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(value) => formatMoney(value)} />
                <Tooltip
                  contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18 }}
                  formatter={(value: number) => usd.format(value)}
                />
                <Area type="monotone" dataKey="cryptoIn" stroke={chartPalette.emerald} fillOpacity={0.15} fill={chartPalette.emerald} />
                <Area type="monotone" dataKey="fiatIn" stroke={chartPalette.blue} fillOpacity={0.12} fill={chartPalette.blue} />
                <Line type="monotone" dataKey="cryptoOut" stroke={chartPalette.rose} strokeWidth={2.2} dot={false} />
                <Line type="monotone" dataKey="net" stroke={chartPalette.amber} strokeWidth={2.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`${panelCls} ${sectionPad}`}>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className={eyebrowCls}>Compliance</div>
              <h3 className="mt-1 text-lg font-semibold text-white">KYC and security posture</h3>
            </div>
            <Link to="/admin/kyc" className="text-sm text-emerald-200 transition hover:text-white">
              Review KYC
            </Link>
          </div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  { name: "Pending", value: kycPending, fill: chartPalette.amber },
                  { name: "Approved", value: kycApproved, fill: chartPalette.emerald },
                  { name: "Support", value: supportOpenCount, fill: chartPalette.rose },
                ]}
              >
                <CartesianGrid stroke="#ffffff12" strokeDasharray="4 4" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "#020617", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18 }}
                />
                <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                  {[
                    { fill: chartPalette.amber },
                    { fill: chartPalette.emerald },
                    { fill: chartPalette.rose },
                  ].map((entry, index) => (
                    <Cell key={index} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 grid gap-2">
            {securityRows.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              >
                <span className="text-slate-400">{item.label}</span>
                <span className="text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      
      <section className={`${panelCls} ${sectionPad}`}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className={eyebrowCls}>Recent Activity</div>
            <h3 className="mt-1 text-xl font-semibold text-white">Platform event stream</h3>
          </div>
          <div className="text-sm text-slate-400">{syncedAt ? `Snapshot ${formatRelativeTime(syncedAt)}` : "Waiting for snapshot"}</div>
        </div>

        <div className="overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.03]">
          {activityItems.length === 0 && <div className={`${mutedCls} px-5 py-8`}>No recent activity in the current range.</div>}
          {paginatedActivityItems.map((item, index) => (
            <ActivityListItem
              key={`${item.id ?? item.type}-${index}`}
              item={item}
              isLast={index === paginatedActivityItems.length - 1}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
          <span>
            Page {normalizedActivityPage} / {activityTotalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActivityPage((page) => Math.max(1, page - 1))}
              disabled={normalizedActivityPage <= 1}
              className="rounded-full border border-white/10 px-3 py-1.5 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setActivityPage((page) => Math.min(activityTotalPages, page + 1))}
              disabled={normalizedActivityPage >= activityTotalPages}
              className="rounded-full border border-white/10 px-3 py-1.5 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <section className={`${panelCls} ${sectionPad}`}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className={eyebrowCls}>Recent Logins</div>
            <h3 className="mt-1 text-xl font-semibold text-white">Recent login users details</h3>
          </div>
          <div className="text-sm text-slate-400">
            {loginRows.length ? `${formatCount(loginRows.length)} stored login rows` : "Waiting for login audit logs"}
          </div>
        </div>

        <div className="overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.03]">
          <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr_140px] gap-3 border-b border-white/10 px-5 py-3 text-[11px] uppercase tracking-[0.22em] text-slate-500">
            <span>User</span>
            <span>IP Address</span>
            <span>Location / Device</span>
            <span>Status</span>
            <span className="text-right">Time</span>
          </div>

          {paginatedLoginRows.length === 0 && (
            <div className="px-5 py-8 text-sm text-slate-400">
              {auditLogsQuery.isLoading ? "Loading login details..." : "No login audit records found."}
            </div>
          )}

          {paginatedLoginRows.map((row, index) => (
            <div
              key={`${row.id}-${index}`}
              className="grid grid-cols-[1.3fr_1fr_1fr_1fr_140px] gap-3 border-b border-white/10 px-5 py-4 text-sm last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-white">{row.user}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{row.action}</div>
              </div>
              <div className="text-slate-300">{row.ipAddress}</div>
              <div className="min-w-0">
                <div className="truncate text-slate-300">{row.location}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{row.device}</div>
              </div>
              <div>
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${
                    row.status === "success"
                      ? "bg-emerald-500/15 text-emerald-200"
                      : "bg-amber-500/15 text-amber-200"
                  }`}
                >
                  {row.status}
                </span>
              </div>
              <div className="text-right text-slate-400">{formatRelativeTime(row.createdAt)}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-slate-400">
          <span>
            Page {normalizedLoginPage} / {loginTotalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setLoginPage((current) => Math.max(1, current - 1))}
              disabled={normalizedLoginPage === 1}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setLoginPage((current) => Math.min(loginTotalPages, current + 1))}
              disabled={normalizedLoginPage === loginTotalPages}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function QueueItemCard({
  title,
  amount,
  subtitle,
  status,
}: {
  title: string;
  amount: string;
  subtitle: string;
  status: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 transition hover:border-white/20 hover:bg-white/[0.07]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{title}</div>
          <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold text-white">{amount}</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-emerald-200">{status}</div>
        </div>
      </div>
    </div>
  );
}

function ActivityListItem({
  item,
  isLast,
}: {
  item: AdminDashboardActivity;
  isLast: boolean;
}) {
  const title = item.summary ?? item.type;
  const subtext = item.subtitle ?? item.user?.email ?? "System event";
  const amount = safeNumber(item.amount);
  const transactionId = getActivityTransactionId(item);
  const accent = /kyc/i.test(item.type)
    ? chartPalette.amber
    : /withdraw/i.test(item.type)
    ? chartPalette.rose
    : /deposit|fund/i.test(item.type)
    ? chartPalette.cyan
    : /signal/i.test(item.type)
    ? chartPalette.emerald
    : chartPalette.violet;

  return (
    <div
      className={`grid gap-4 px-5 py-4 transition duration-300 hover:bg-white/[0.04] md:grid-cols-[120px_14px_minmax(0,1fr)_auto] md:items-start ${
        !isLast ? "border-b border-white/10" : ""
      }`}
    >
      <div className="text-xs text-slate-500 md:pt-1">
        <div>{formatRelativeTime(item.occurredAt ?? item.timestamp)}</div>
      </div>

      <div className="relative hidden h-full md:block">
        <span
          className="absolute left-1/2 top-1 h-3 w-3 -translate-x-1/2 rounded-full animate-pulse"
          style={{ backgroundColor: accent }}
        />
        {!isLast && <span className="absolute left-1/2 top-5 bottom-[-1rem] w-px -translate-x-1/2 bg-white/10" />}
      </div>

      <div className="min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{title}</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-500">{item.type}</div>
          </div>
          <span
            className="h-3 w-3 shrink-0 rounded-full md:hidden"
            style={{ backgroundColor: accent }}
          />
        </div>

        <div className="mt-3 text-sm text-slate-300">{subtext}</div>
        {item.description && <div className="mt-2 text-xs leading-5 text-slate-400">{item.description}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {amount > 0 && <span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white">{usd.format(amount)}</span>}
        {transactionId && (
          <span className="max-w-[220px] truncate rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">
            Txn: {transactionId}
          </span>
        )}
        {item.metadata?.status && (
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-300">
            {String(item.metadata.status)}
          </span>
        )}
      </div>
    </div>
  );
}

function getActivityTransactionId(item: AdminDashboardActivity) {
  const metadata = item.metadata ?? {};
  const candidates = [
    metadata.txn_id,
    metadata.txnId,
    metadata.txHash,
    metadata.transactionId,
    metadata.referenceId,
  ];

  const match = candidates.find((value) => typeof value === "string" && value.trim() !== "");
  return typeof match === "string" ? match : null;
}

function mapLoginAuditRow(log: AdminAuditLog) {
  const metadata = (log.metadata ?? {}) as Record<string, unknown>;
  const ipAddress =
    readText(metadata, ["ip", "ipAddress", "ip_address", "loginIp", "lastLoginIp"]) ?? "--";
  const device =
    readText(metadata, ["device", "browser", "userAgent", "user_agent"]) ?? "Unknown device";
  const location =
    readText(metadata, ["location", "city", "country", "geo"]) ?? "Unknown location";
  const statusRaw = readText(metadata, ["status", "result", "state"]) ?? "success";

  return {
    id: log.id,
    user: log.actor || "Unknown user",
    action: log.action,
    ipAddress,
    device,
    location,
    status: /fail|deny|reject|error/i.test(statusRaw) ? "failed" : "success",
    createdAt: log.createdAt,
  };
}

function readText(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
