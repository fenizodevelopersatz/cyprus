import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ADMIN_DASHBOARD_WS_PATH, API_BASE_URL } from "../../../app/apiRoutes";
import Button from "../../../ui/Button";
import { useAdminAuth } from "../state/AdminAuthProvider";
import { fetchAdminKycSidebarSummary, fetchAdminSettings } from "../api/admin.api";

type NavEntry = {
  label: string;
  to?: string;
  icon?: string;
  action?: "logout";
  children?: Array<{ label: string; to?: string; heading?: boolean }>;
};

const ADMIN_KYC_LAST_READ_KEY = "admin:kyc:last-read-at";

const buildAdminDashboardWsUrl = (token: string) => {
  try {
    const url = new URL(API_BASE_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/?$/, "")}${ADMIN_DASHBOARD_WS_PATH}`;
    url.search = "";
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    return null;
  }
};

const NAV_GROUPS: NavEntry[] = [
  { label: "Dashboard", to: "/admin", icon: "/icons/admin-dashboard.png" },
  { label: "User Management", to: "/admin/users", icon: "/icons/admin-user.png" },
  // { label: "Orders Report", to: "/admin/orders-report", icon: "/icons/admin-order.png"},
  // { label: "Staking Ops", to: "/admin/staking", icon: "/icons/admin-staking.png" },
  // { label: "SIP Ops", to: "/admin/sip", icon: "/icons/admin-staking.png" },

  {
    label: "Commission",
    icon: "/icons/admin-settings.png",
    children: [
      { label: "Commission History", to: "/admin/commission/history" },
      { label: "Commission Rules", to: "/admin/controls/level-management" },
    ],
  },
  // {
  //   label: "Signals",
  //   icon: "/icons/admin-settings.png",
  //   children: [
  //     { label: "Manage Signals", to: "/admin/manage-signals" },
  //     { label: "Signal History", to: "/admin/signal-history" },
  //     // { label: "Signal Packages", to: "/admin/package-settings" },
  //   ],
  // },
  {
    label: "Controls",
    icon: "/icons/admin-settings.png",
    children: [
      { label: "Level Management", to: "/admin/controls/level-management" },
      { label: "Manage Signals", to: "/admin/manage-signals" },
      { label: "Signal History", to: "/admin/signal-history" },
      // { label: "MLM Test Tool", to: "/admin/controls/mlm-test-tool" },
    ],
  },

  {
    label: "Compliance",
    icon: "/icons/admin-Compliance.png",
    children: [{ label: "KYC Queue", to: "/admin/kyc" }],
  },
  {
    label: "Wallet Management",
    icon: "/icons/admin-wallet.png",
    children: [
      { label: "User Wallet", heading: true },
      { label: "Deposit", to: "/admin/wallet-management/user-wallet/deposits" },
      { label: "Withdraw List", to: "/admin/wallet-management/user-wallet/withdrawals" },
      { label: "Admin Wallet", heading: true },
      { label: "User to Admin Hot Wallet", to: "/admin/wallet-management/admin-wallet/deposits" },
      { label: "Admin Gas History", to: "/admin/wallet-management/admin-wallet/gas-funding" },
      { label: "Withdraw Queue", to: "/admin/wallet-management/admin-wallet/withdraw-queue" },
    ],
  },
    {
    label: "Coin",
    icon: "/icons/admin-coin.png",
    children: [      
      { label: "Signal Assets", to: "/admin/assets" },
      { label: "Coin List", to: "/admin/markets" },
      // { label: "Coin Pairs", to: "/admin/markets#pairs" },
    ],
  },
  //   {
  //   label: "Admin & Role",
  //   icon: "/icons/admin-rol.png",
  //   children: [
  //     { label: "Audit Logs", to: "/admin/audit" },
  //     // { label: "Futures Ops", to: "/admin/futures" },
  //   ],
  // },
  { label: "Site Settings", to: "/admin/settings", icon: "/icons/admin-settings.png" },  
  { label: "Logout", icon: "/icons/admin-logout.png", action: "logout" },
];

export default function AdminShell() {
  const { session, logout } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [siteName, setSiteName] = useState("Primerica Exchange");
  const [siteLogoUrl, setSiteLogoUrl] = useState("/icons/logo-white.webp");
  const [kycLastReadAt, setKycLastReadAt] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ADMIN_KYC_LAST_READ_KEY);
  });

  const kycSummaryQuery = useQuery({
    queryKey: ["admin", "kyc", "sidebar-summary"],
    queryFn: fetchAdminKycSidebarSummary,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const pendingKycItems = kycSummaryQuery.data?.items ?? [];
  const unreadKycCount = useMemo(() => {
    const lastReadTs = kycLastReadAt ? new Date(kycLastReadAt).getTime() : 0;
    return pendingKycItems.filter((item) => {
      const createdAt = new Date(item.createdAt).getTime();
      return Number.isFinite(createdAt) && createdAt > lastReadTs;
    }).length;
  }, [kycLastReadAt, pendingKycItems]);
  const hasUnreadKyc = unreadKycCount > 0;

  useEffect(() => {
    const token = window.localStorage.getItem("adminAccessToken");
    if (!token) return;
    const url = buildAdminDashboardWsUrl(token);
    if (!url) return;

    let closedByUser = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const connect = () => {
      try {
        socket = new WebSocket(url);
        socket.onmessage = () => {
          queryClient.invalidateQueries({ queryKey: ["admin", "kyc", "sidebar-summary"] });
        };
        socket.onclose = () => {
          socket = null;
          if (closedByUser) return;
          reconnectTimer = window.setTimeout(connect, 5000);
        };
        socket.onerror = () => {
          socket?.close();
        };
      } catch {
        reconnectTimer = window.setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [queryClient]);

  useEffect(() => {
    if (location.pathname !== "/admin/kyc") return;
    if (!pendingKycItems.length) return;
    const latestPendingCreatedAt = pendingKycItems.reduce<string | null>((latest, item) => {
      if (!item.createdAt) return latest;
      if (!latest) return item.createdAt;
      return new Date(item.createdAt).getTime() > new Date(latest).getTime() ? item.createdAt : latest;
    }, null);
    if (!latestPendingCreatedAt || latestPendingCreatedAt === kycLastReadAt) return;
    setKycLastReadAt(latestPendingCreatedAt);
    window.localStorage.setItem(ADMIN_KYC_LAST_READ_KEY, latestPendingCreatedAt);
  }, [kycLastReadAt, location.pathname, pendingKycItems]);

  const toggleSection = (label: string) =>
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));

  const closeMobileNav = () => setMobileNavOpen(false);
  const toggleSidebar = () => setSidebarCollapsed((prev) => !prev);
  const handleLogout = () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    logout();
    closeMobileNav();
    window.setTimeout(() => {
      navigate("/admin/login", { replace: true });
      setIsLoggingOut(false);
    }, 320);
  };

  const filteredNav = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return NAV_GROUPS;
    return NAV_GROUPS.map((group) => {
      const matchesLabel = group.label.toLowerCase().includes(q);
      if (group.children) {
        const filteredChildren = group.children.filter((child) =>
          child.label.toLowerCase().includes(q)
        );
        if (matchesLabel || filteredChildren.length) {
          return { ...group, children: filteredChildren.length ? filteredChildren : group.children };
        }
        return null;
      }
      return matchesLabel ? group : null;
    }).filter(Boolean) as NavEntry[];
  }, [search]);

  useEffect(() => {
    let cancelled = false;

    const applyBranding = (settings?: { siteName?: string; siteLogoUrl?: string }) => {
      setSiteName(settings?.siteName?.trim() || "Primerica Exchange");
      setSiteLogoUrl(settings?.siteLogoUrl?.trim() || "/icons/logo-white.webp");
    };

    const loadBranding = async () => {
      try {
        const settings = await fetchAdminSettings();
        if (cancelled) return;
        applyBranding(settings);
      } catch {
        if (!cancelled) applyBranding();
      }
    };

    void loadBranding();

    const handleBrandingRefresh = (event: Event) => {
      const customEvent = event as CustomEvent<{ siteName?: string; siteLogoUrl?: string }>;
      applyBranding(customEvent.detail);
    };
    window.addEventListener("site-settings-updated", handleBrandingRefresh as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener("site-settings-updated", handleBrandingRefresh as EventListener);
    };
  }, []);

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 left-0 h-64 w-64 rounded-full bg-emerald-500/20 blur-[140px]" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-cyan-500/30 blur-[160px]" />
      </div>
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="Close admin menu"
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm lg:hidden"
          onClick={closeMobileNav}
        />
      )}
      <div className="mx-auto flex h-full max-w-[1400px] gap-6 px-4 py-8">
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex h-[100dvh] w-[min(88vw,320px)] -translate-x-full flex-col overflow-hidden border-r border-white/10 bg-gradient-to-b from-slate-950/95 to-slate-900/80 p-5 shadow-[0_35px_120px_-60px_rgba(15,118,110,0.65)] backdrop-blur-2xl transition-transform duration-300 lg:sticky lg:top-8 lg:z-auto lg:h-[calc(100vh-4rem)] lg:translate-x-0 lg:rounded-[28px] lg:border ${sidebarCollapsed ? "lg:w-[92px]" : "lg:w-full lg:max-w-[290px]"}`}
          data-mobile-open={mobileNavOpen}
          style={{ transform: mobileNavOpen ? "translateX(0)" : undefined }}
        >
          <div className="flex items-center justify-between gap-3 border-b border-white/5 pb-6">
            <div className="flex items-center gap-3">
              <img
                src={siteLogoUrl}
                alt={`${siteName} logo`}
                className="h-12 w-12 rounded-full border border-white/10 bg-white/5 object-contain p-1"
                onError={(event) => {
                  event.currentTarget.src = "/icons/logo-white.webp";
                }}
              />
              {!sidebarCollapsed && (
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-slate-400">{siteName}</div>
                  <div className="text-lg font-semibold text-white">Admin</div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSidebar}
                className="hidden rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/10 lg:inline-flex"
              >
                {sidebarCollapsed ? "Expand" : "Collapse"}
              </button>
              <button
                type="button"
                onClick={closeMobileNav}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/10 lg:hidden"
              >
                Close
              </button>
            </div>
          </div>
          {!sidebarCollapsed && (
            <div className="mt-4">
              <input
                type="text"
                placeholder="Search menu"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm focus:border-emerald-400/60 focus:outline-none"
              />
            </div>
          )}
          <nav className="mt-6 flex-1 space-y-2 overflow-y-auto pr-1">
            {filteredNav.map((entry) => {
              const hasChildren = Boolean(entry.children && entry.children.length);
              const open = hasChildren ? openSections[entry.label] ?? true : false;
              const compact = sidebarCollapsed;

              if (!hasChildren && entry.action === "logout") {
                return (
                  <button
                    key={entry.label}
                    type="button"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    className={`group relative flex w-full items-center overflow-hidden ${compact ? "justify-center px-3" : "gap-3 px-4"} rounded-2xl border py-3 text-sm font-medium transition duration-300 ${
                      isLoggingOut
                        ? "border-rose-400/40 bg-rose-500/20 text-rose-50"
                        : "border-rose-500/25 bg-gradient-to-r from-rose-500/12 via-orange-500/10 to-transparent text-rose-100 hover:border-rose-400/45 hover:bg-rose-500/16 hover:text-white"
                    }`}
                  >
                    <span className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-rose-400/20 to-transparent opacity-70 transition-transform duration-500 group-hover:translate-x-2" />
                    <span
                      className={`relative flex items-center justify-center rounded-2xl border border-rose-400/20 bg-slate-950/50 text-rose-100 ${
                        compact ? "h-10 w-10" : "h-12 w-12"
                      } ${isLoggingOut ? "animate-pulse" : "transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105"}`}
                    >
                      <LogoutIcon spinning={isLoggingOut} />
                    </span>
                    {!compact && (
                      <span className="relative flex flex-col items-start">
                        <span>{isLoggingOut ? "Signing out..." : entry.label}</span>
                        <span className="text-[11px] uppercase tracking-[0.24em] text-rose-200/70">
                          {isLoggingOut ? "Closing session" : "Secure exit"}
                        </span>
                      </span>
                    )}
                  </button>
                );
              }

              if (!hasChildren && entry.to) {
                return (
                  <NavLink
                    key={entry.label}
                    to={entry.to}
                    end
                    onClick={closeMobileNav}
                    className={({ isActive }) =>
                      `flex items-center ${compact ? "justify-center px-3" : "gap-3 px-4"} rounded-2xl border border-white/10 py-3 text-sm font-medium transition ${
                        isActive ? "bg-emerald-500/20 text-white" : "bg-white/5 text-slate-200 hover:text-white"
                      }`
                    }
                  >
                    <span className="text-lg">
                       <img
                        src={entry.icon}
                        alt=""
                        className={`${compact ? "h-8 w-8" : "h-12 w-12"} rounded-xl border border-white/10 object-cover`}
                      />
                    </span>
                    {!compact && entry.label}
                  </NavLink>
                );
              }

              return (
                <div key={entry.label} className="rounded-2xl bg-white/5 border border-white/10">
                  <button
                    type="button"
                    className={`flex w-full items-center ${compact ? "justify-center px-3" : "justify-between px-4"} py-3 text-sm font-medium text-slate-200`}
                    onClick={() => toggleSection(entry.label)}
                  >
                    <span className={`flex items-center ${compact ? "justify-center" : "gap-3"}`}>
                      <span className="text-lg">
                        <img
                        src={entry.icon}
                        alt=""
                        className={`${compact ? "h-8 w-8" : "h-12 w-12"} rounded-xl border border-white/10 object-cover`}
                      />
                      </span>
                      {!compact && entry.label}
                    </span>
                    {!compact && (
                      <span className="flex items-center gap-2">
                        {entry.label === "Compliance" ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              hasUnreadKyc
                                ? "bg-amber-400/20 text-amber-100"
                                : "bg-white/10 text-slate-300"
                            }`}
                          >
                            {hasUnreadKyc ? unreadKycCount : kycSummaryQuery.data?.pendingCount ?? 0}
                          </span>
                        ) : null}
                        <span className={`transition ${open ? "rotate-0" : "-rotate-90"}`}>{">"}</span>
                      </span>
                    )}
                  </button>
                  {open && entry.children && !compact && (
                    <div className="space-y-1 border-t border-white/5 px-4 py-3 text-sm">
                      {entry.children.map((child) =>
                        child.heading ? (
                          <div
                            key={`${entry.label}-${child.label}-heading`}
                            className="px-3 pt-2 text-[11px] uppercase tracking-[0.22em] text-emerald-200/70"
                          >
                            {child.label}
                          </div>
                        ) : (
                          <NavLink
                            key={`${entry.label}-${child.label}-${child.to ?? "link"}`}
                            to={child.to || "#"}
                            onClick={closeMobileNav}
                            className={({ isActive }) =>
                              `flex items-center gap-2 rounded-xl px-3 py-2 ${
                                isActive
                                  ? "bg-emerald-500/20 text-white"
                                  : "text-slate-300 hover:text-white"
                              }`
                            }
                          >
                            <span className="text-xs text-white/60">*</span>
                            <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                              <span className="truncate">{child.label}</span>
                              {child.to === "/admin/kyc" ? (
                                <span
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    hasUnreadKyc
                                      ? "bg-amber-400/20 text-amber-100"
                                      : "bg-white/10 text-slate-300"
                                  }`}
                                >
                                  {hasUnreadKyc ? unreadKycCount : kycSummaryQuery.data?.pendingCount ?? 0}
                                </span>
                              ) : null}
                            </span>
                          </NavLink>
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <header className="rounded-[28px] border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-900/30 px-7 py-6 shadow-[0_30px_120px_-70px_rgba(15,118,110,0.65)] backdrop-blur-2xl">
            <div className="flex flex-wrap items-start gap-6">
              <div>
                {/* <div className="text-[11px] uppercase tracking-[0.32em] text-emerald-200/70">{siteName}</div> */}
                {/* <h1 className="text-3xl font-semibold text-white">Admin Console</h1>
                <p className="text-sm text-slate-300/80">Operational controls & compliance monitoring.</p> */}
              </div>
              <div className="ml-auto flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  className="inline-flex rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 transition hover:bg-white/10 lg:hidden"
                >
                  Menu
                </button>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="inline-flex rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 transition hover:bg-white/10 lg:inline-flex"
                >
                  {sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"}
                </button>
              </div>
              <div className="flex items-center gap-4 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm shadow-[0_20px_80px_-65px_rgba(236,72,153,0.75)]">
                <div className="text-right">
                  <div className="text-sm font-semibold text-white">{session?.name ?? "Admin"}</div>
                  <div className="text-xs text-slate-300">{session?.email ?? "admin@cryptosignal.com"}</div>
                  <div className="text-[11px] uppercase tracking-[0.3em] text-emerald-300">
                    Roles: {session?.roles?.join(", ") ?? "n/a"}
                  </div>
                </div>
                <Button variant="danger" size="sm" onClick={handleLogout} className="px-4" disabled={isLoggingOut}>
                  {isLoggingOut ? "Signing out..." : "Logout"}
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 min-h-0 overflow-auto rounded-[28px] border border-white/10 bg-gradient-to-br from-slate-950/70 to-slate-900/60 p-6 shadow-[0_45px_140px_-80px_rgba(20,184,166,0.6)] backdrop-blur-2xl">
            <Outlet />
          </main>

          <footer className="rounded-[24px] border border-white/10 bg-white/5 px-6 py-4 text-xs text-slate-400 backdrop-blur-xl">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <span>&copy; {new Date().getFullYear()} CryptoSignal Admin. For authorized personnel only.</span>
              <span>Audit logging enabled - v2.1</span>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}

function LogoutIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${spinning ? "animate-spin" : "transition-transform duration-300 group-hover:translate-x-0.5"}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H4" />
    </svg>
  );
}
