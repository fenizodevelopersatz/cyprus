import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { CONTENT_ENDPOINTS } from "./apiRoutes";
import { useLiveWalletBalance } from "./liveWalletBalance";
import { deleteAccount } from "../features/settings/api/account.api";
import { useAuth } from "../features/auth/state/auth.store";
import UserAccountDropdown from "./UserAccountDropdown";

type NavLinkItem = {
  to?: string;
  label: string;
  icon: string;
  action?: "deleteAccount" | "logout";
};

type NavSection = {
  title: string;
  toneClass: string;
  items: NavLinkItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    toneClass: "from-indigo-400 to-sky-500",
    items: [
      { to: "/app", label: "Dashboard", icon: "/icons/dashboard.png" },
    ],
  },
  {
    title: "Trading Desk",
    toneClass: "from-emerald-400 to-emerald-600",
    items: [
      { to: "/app/markets", label: "Markets", icon: "/icons/market.png" },
      { to: "/app/exchange", label: "Exchange", icon: "/icons/exchange.png" },
      // { to: "/app/swap", label: "Swap", icon: "/icons/swap.png" },
      // { to: "/app/futures", label: "Futures", icon: "/icons/future_trade.png" },
      // { to: "/app/p2p", label: "P2P Desk", icon: "/icons/p2p.png" },
      { to: "/app/orders", label: "Orders Audit", icon: "/icons/orders.png" },
    ],
  },
  {
    title: "Wealth & Yield",
    toneClass: "from-amber-400 to-rose-500",
    items: [
      // { to: "/app/portfolio", label: "Portfolio", icon: "/icons/portfolio.png" },
      { to: "/app/funding", label: "Wallet", icon: "/icons/funding.png" },
      // { to: "/app/staking", label: "Staking", icon: "/icons/staking.png" },
      // { to: "/app/sip", label: "SIP Plans", icon: "/icons/referral.png" },
     // { to: "/app/paper", label: "Demo / Paper Trading", icon: "https://via.placeholder.com/32/8b5cf6/ffffff?text=PT" },
    ],
  },
  // {
  //   title: "Intelligence",
  //   toneClass: "from-purple-400 to-indigo-500",
  //   items: [
  //     { to: "/app/realtime", label: "Realtime Hub", icon: "/icons/hub_1.png" },
  //     { to: "/app/signal-lab", label: "Signal Lab", icon: "/icons/hub_1.png" },
  //   ],
  // },
  {
    title: "Growth & Compliance",
    toneClass: "from-blue-400 to-slate-500",
    items: [
      { to: "/app/referrals", label: "Referrals", icon: "/icons/referral.png" },
      { to: "/app/kyc", label: "KYC Center", icon: "/icons/kyc.png" },
      { to: "/app/settings", label: "Settings", icon: "/icons/settings.png" },
    ],
  },
  {
    title: "Logout zone",
    toneClass: "from-rose-500 to-rose-700",
    items: [
      // { label: "Delete my account", icon: "/icons/support.png", action: "deleteAccount" },
      { label: "Logout", icon: "/icons/admin-logout.png", action: "logout" },
    ],
  },
];

const linkCls = ({ isActive }: { isActive: boolean }) =>
  `group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
    isActive
      ? "border-[var(--border-yellow)] bg-[rgba(252,213,53,0.08)] text-[var(--accent-yellow)] shadow-[inset_3px_0_0_0_var(--accent-yellow)]"
      : "border-transparent text-[var(--text-secondary)] hover:border-[var(--border-yellow)] hover:bg-[rgba(252,213,53,0.06)] hover:text-white"
  }`;

function SidebarItemIcon({ item, danger = false }: { item: NavLinkItem; danger?: boolean }) {
  if (item.action === "logout") {
    return (
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-xl border ${
          danger ? "border-[rgba(246,70,93,0.28)] bg-[rgba(246,70,93,0.12)] text-[var(--danger)]" : "border-[var(--border-soft)] bg-white/5 text-slate-100"
        } transition-transform duration-300 group-hover:-translate-x-0.5 group-hover:scale-105`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 ${danger ? "group-hover:translate-x-0.5" : ""} transition-transform duration-300`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14 8l4 4-4 4" />
          <path d="M18 12H9" />
          <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
        </svg>
      </span>
    );
  }

  return (
    <img
      src={item.icon}
      alt=""
      className="h-6 w-6 rounded-xl border border-white/10 object-cover"
    />
  );
}

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [siteName, setSiteName] = useState("Primerica Exchange");
  const [siteLogoUrl, setSiteLogoUrl] = useState("/icons/logo.png");
  const [sidebarLogoUrl, setSidebarLogoUrl] = useState("/icons/logo.png");
  const { totalUsdt } = useLiveWalletBalance();
  const logout = useAuth((state) => state.logout);
  const navigate = useNavigate();
  const location = useLocation();

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  const closeSidebar = () => setSidebarOpen(false);

  const openDeleteModal = () => {
    if (deletePending) return;
    setDeleteError(null);
    setDeleteModalOpen(true);
  };

  const closeDeleteModal = () => {
    if (deletePending) return;
    setDeleteError(null);
    setDeleteModalOpen(false);
  };

  const getDeleteErrorMessage = (error: unknown) => {
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const err = error as { response?: { data?: any }; message?: string };
      const data = err.response?.data;
      if (data) {
        if (typeof data === "string") return data;
        if (typeof data === "object") {
          if ("error" in data && typeof data.error === "string") return data.error;
          if ("message" in data && typeof data.message === "string") return data.message;
        }
      }
      if (err.message) return err.message;
    }
    return "Unable to delete account. Please try again.";
  };

  const handleDeleteAccount = async () => {
    setDeletePending(true);
    setDeleteError(null);
    try {
      const res = await deleteAccount();
      if (res?.deleted) {
        logout();
        setDeleteModalOpen(false);
        navigate("/login", { replace: true });
        return;
      }
      setDeleteError("Unable to delete account. Please try again.");
    } catch (error) {
      setDeleteError(getDeleteErrorMessage(error));
    } finally {
      setDeletePending(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const applySiteBranding = (settings?: { siteName?: string; siteLogoUrl?: string; siteFaviconUrl?: string }) => {
    setSiteName(settings?.siteName?.trim() || "Primerica Exchange");
    const nextLogo = settings?.siteLogoUrl?.trim() || "/icons/logo.png";
    const logoWithVersion = nextLogo.startsWith("/icons/")
      ? nextLogo
      : `${nextLogo}${nextLogo.includes("?") ? "&" : "?"}v=${Date.now()}`;
    setSiteLogoUrl(logoWithVersion);
    setSidebarLogoUrl(logoWithVersion);

    const faviconHref = settings?.siteFaviconUrl?.trim();
    if (faviconHref) {
      const cacheBustedHref = `${faviconHref}${faviconHref.includes("?") ? "&" : "?"}v=${Date.now()}`;
      const rels = ["icon", "shortcut icon"];
      rels.forEach((rel) => {
        let favicon = document.querySelector(`link[rel='${rel}']`) as HTMLLinkElement | null;
        if (!favicon) {
          favicon = document.createElement("link");
          favicon.rel = rel;
          document.head.appendChild(favicon);
        }
        favicon.href = cacheBustedHref;
      });
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadSiteSettings = async () => {
      try {
        const response = await fetch(CONTENT_ENDPOINTS.branding, { credentials: "include" });
        if (!response.ok) throw new Error("Unable to load site branding");
        const payload = await response.json();
        const settings = payload?.data ?? payload;
        if (cancelled) return;
        applySiteBranding(settings);
      } catch {
        if (!cancelled) {
          applySiteBranding();
        }
      }
    };

    void loadSiteSettings();

    const handleBrandingRefresh = (event: Event) => {
      const customEvent = event as CustomEvent<{ siteName?: string; siteLogoUrl?: string; siteFaviconUrl?: string }>;
      applySiteBranding(customEvent.detail);
    };
    window.addEventListener("site-settings-updated", handleBrandingRefresh as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener("site-settings-updated", handleBrandingRefresh as EventListener);
    };
  }, []);

  const renderNav = (handleNavigate?: () => void) => (
      <div className="flex h-full flex-col gap-5">
      <div className="flex items-start justify-between gap-3">        
        {handleNavigate ? (
          <button
            type="button"
            onClick={handleNavigate}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-soft)] bg-[var(--bg-card)] text-white transition hover:border-[var(--border-yellow)] hover:bg-[var(--bg-card-soft)] lg:hidden"
            aria-label="Close navigation"
          >
            &times;
          </button>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col gap-5 text-sm">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="flex flex-col gap-2">
            <div className="flex items-center text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
              <span>{section.title}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {section.items.map((item) =>
                item.action === "deleteAccount" ? (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      if (handleNavigate) handleNavigate();
                      openDeleteModal();
                    }}
                    className={`${linkCls({ isActive: false })} border border-[rgba(246,70,93,0.25)] text-[var(--danger)] hover:border-[rgba(246,70,93,0.4)] hover:bg-[rgba(246,70,93,0.12)]`}
                  >
                    <SidebarItemIcon item={item} danger />
                    <span>{item.label}</span>
                  </button>
                ) : item.action === "logout" ? (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      if (handleNavigate) handleNavigate();
                      handleLogout();
                    }}
                    className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-[rgba(246,70,93,0.25)] bg-[rgba(246,70,93,0.12)] px-3 py-2 text-sm font-semibold text-[#ffd4db] transition duration-300 hover:-translate-y-0.5 hover:border-[rgba(246,70,93,0.4)] hover:bg-[rgba(246,70,93,0.16)]"
                  >
                    <span
                      className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,rgba(251,113,133,0.18)_35%,transparent_70%)] translate-x-[-120%] transition-transform duration-700 group-hover:translate-x-[120%]"
                      aria-hidden="true"
                    />
                    <SidebarItemIcon item={item} danger />
                    <span>{item.label}</span>
                    <span className="ml-auto h-2 w-2 rounded-full bg-rose-300 shadow-[0_0_12px_rgba(253,164,175,0.95)] animate-pulse" aria-hidden="true" />
                  </button>
                ) : (
                  <NavLink
                    key={item.to}
                    to={item.to!}
                    end={item.to === "/app"}
                    onClick={handleNavigate}
                    className={linkCls}
                  >
                    <SidebarItemIcon item={item} />
                    <span>{item.label}</span>
                  </NavLink>
                )
              )}
            </div>
          </div>
        ))}
      </nav>

      <div className="rounded-[14px] border border-[var(--border-yellow)] bg-[rgba(252,213,53,0.08)] p-4 text-xs text-[var(--text-secondary)]">
        <div className="text-sm font-semibold text-white">{siteName}</div>
        <p className="mt-1 text-[var(--text-muted)]">Trade Exchange 2.1</p>
      </div>
    </div>
  );

  const mobileNavItems = [
    { to: "/app", label: "Home", icon: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /> },
    { to: "/app/markets", label: "Markets", icon: <><path d="M5 19V9" /><path d="M12 19V5" /><path d="M19 19v-8" /></> },
    { to: "/app/exchange", label: "Trade", icon: <><path d="m7 7 4-4" /><path d="M3 11h8V3" /><path d="m17 17-4 4" /><path d="M13 21h8v-8" /></> },
    { to: "/app/orders-audit", label: "Audit", icon: <><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="M4 6h.01" /><path d="M4 12h.01" /><path d="M4 18h.01" /></> },
    { to: "/app/funding", label: "Wallet", icon: <><path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M16 12h.01" /></> },
    { to: "/app/referrals", label: "Referral", icon: <><path d="M12 4v8" /><path d="M8 8h8" /><path d="M5 19a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3" /><path d="M9 16v-2" /><path d="M15 16v-2" /></> },
    { to: "/app/settings", label: "Profile", icon: <><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M5 20a7 7 0 0 1 14 0" /></> },
  ];

  return (
    <>
      <div className="app-shell relative min-h-screen">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-[rgba(252,213,53,0.08)] blur-3xl" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[rgba(255,184,0,0.05)] blur-3xl" />
      </div>

      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5">
        <header className="shell-panel mb-4 px-3 py-3 sm:mb-5 sm:px-5 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
            <div className="min-w-0 flex-1">
                <img
                  src={siteLogoUrl}
                  alt={`${siteName} logo`}
                  className="h-11 w-full max-w-[110px] rounded-2xl border border-[var(--border-soft)] bg-[var(--bg-card)] object-contain p-1.5 sm:h-14 sm:max-w-[170px] lg:h-16 lg:max-w-[220px]"
                  onError={() => {
                    setSiteLogoUrl("/icons/logo.png");
                  }}
                />
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <UserAccountDropdown totalUsdt={totalUsdt} onNavigate={closeSidebar} onLogout={handleLogout} />
            </div>
          </div>
        </header>

        <div className="relative flex flex-1 flex-col gap-6 lg:flex-row">
          {sidebarOpen ? (
            <div className="fixed inset-0 z-40 flex lg:hidden">
              <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={closeSidebar} />
              <aside className="relative z-50 m-3 flex max-h-[calc(100vh-24px)] w-[min(88vw,320px)] flex-col overflow-y-auto rounded-[18px] border border-[var(--border-soft)] bg-[#101318] p-4 shadow-[0_18px_45px_rgba(0,0,0,0.45)] sm:m-4 sm:max-h-[calc(100vh-32px)] sm:p-5">
                {renderNav(closeSidebar)}
              </aside>
            </div>
          ) : null}

          <aside className="hidden w-full max-w-[260px] flex-col rounded-[18px] border border-[rgba(255,255,255,0.05)] bg-[#101318] p-5 shadow-[0_18px_45px_rgba(0,0,0,0.42)] lg:flex lg:self-start">
            {renderNav()}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-6">
            <main className="shell-panel flex-1 overflow-x-hidden p-3 pb-20 sm:p-4 sm:pb-24 lg:p-5 lg:pb-5">
              <Outlet />
            </main>

            <footer className="shell-panel hidden px-4 py-4 text-xs text-[var(--text-secondary)] sm:px-6 lg:block">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>&copy; {new Date().getFullYear()} {siteName}. All rights reserved.</div>
                {/* <div className="flex flex-wrap gap-4">
                  <a href="#" className="hover:text-white">Status</a>
                  <a href="#" className="hover:text-white">Privacy</a>
                  <a href="#" className="hover:text-white">Terms</a>
                </div> */}
              </div>
            </footer>
          </div>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-[120] border-t border-[var(--border-soft)] bg-[rgba(17,20,26,0.98)] px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-12px_30px_rgba(0,0,0,0.34)] backdrop-blur-xl pointer-events-auto lg:hidden">
        <div className="grid grid-cols-7 gap-1">
          {mobileNavItems.map((item) => {
            const isActive = location.pathname === item.to;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center justify-center gap-1 rounded-[14px] px-1.5 py-2 text-[9px] font-semibold transition ${
                  isActive
                    ? "bg-[rgba(252,213,53,0.12)] text-[var(--accent-yellow)]"
                    : "text-[var(--text-muted)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white"
                }`}
                aria-current={isActive ? "page" : undefined}
              >
                <svg viewBox="0 0 24 24" className={`h-4.5 w-4.5 ${isActive ? "stroke-[var(--accent-yellow)]" : "stroke-current"}`} fill="none" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
                  {item.icon}
                </svg>
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>

      <Dialog
        open={deleteModalOpen}
        onClose={deletePending ? () => {} : closeDeleteModal}
        title="Delete account"
        footer={
          <>
            <Button variant="ghost" onClick={closeDeleteModal} disabled={deletePending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteAccount} disabled={deletePending}>
              {deletePending ? "Deleting..." : "Yes, delete my account"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-secondary)]">
          This will permanently remove your Primerica account, including balances, orders, trades, and KYC data. This action cannot be undone.
        </p>
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          After deletion you will be signed out immediately and must create a new account to return.
        </p>
        {deleteError && (
          <div className="mt-3 rounded-2xl border border-[rgba(246,70,93,0.25)] bg-[rgba(246,70,93,0.12)] px-3 py-2 text-xs text-[var(--danger)]">{deleteError}</div>
        )}
      </Dialog>
    </>
  );
}
