const env = (import.meta.env.VITE_API_URL as string | undefined)?.trim() ?? "";
const REMOTE_FALLBACK_API_BASE = env && env !== "undefined" && env !== "null" ? env : "http://localhost:4000";

const resolveDefaultApiBase = () => {
  if (typeof window !== "undefined" && window.location?.origin) {
    if (/localhost:5173|127\.0\.0\.1:5173/i.test(window.location.origin)) {
      return REMOTE_FALLBACK_API_BASE;
    }
    return window.location.origin;
  }
  return REMOTE_FALLBACK_API_BASE;
};

const normaliseBase = (raw?: string) => {
  if (!raw || raw.trim() === "") return resolveDefaultApiBase();
  return raw.replace(/\/+$/, "");
};

export const API_BASE_URL = normaliseBase(import.meta.env.VITE_API_URL as string | undefined);
export const WS_BASE_URL = (() => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return API_BASE_URL;
})();
export const ADMIN_DASHBOARD_WS_PATH = "/ws/admin/dashboard";
export const WALLET_WS_PATH = "/ws/wallet";

const toAbsolute = (path: string) => {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${safePath}`;
};

export const API_ROUTES = {
  auth: {
    register: "/auth/register",
    login: "/auth/login",
    adminLogin: "/auth/admin/login",
    google: "/auth/google",
    me: "/users/me",
    forgotPasswordRequest: "/auth/forgot-password/request",
    forgotPasswordReset: "/auth/forgot-password/reset",
  },
  account: {
    delete: "/user/account",
  },
  content: {
    systemStatus: "/content/system-status",
  },
  dashboard: {
    summary: "/api/dashboard/summary",
    telegramAccessRequest: "/api/dashboard/telegram-access/request",
    positions: "/api/dashboard/positions",
    orders: "/api/dashboard/orders",
    tickers: "/api/dashboard/tickers",
    topMovers: "/api/dashboard/top-movers",
    marketPulse: "/api/dashboard/market-pulse",
    promos: "/api/dashboard/promotions",
    news: "/api/dashboard/news",
  },
  exchange: {
    markets: "/api/exchange/markets",
    ticker: "/api/exchange/ticker",
    orderbook: "/api/exchange/orderbook",
    trades: "/api/exchange/trades",
    wallets: "/api/exchange/wallets",
    openOrders: "/api/exchange/orders/open",
    orders: "/api/exchange/orders",
    cancel: "/api/exchange/orders/cancel",
    snapshot: "/api/exchange/snapshot",
  },
  kyc: {
    status: "/api/kyc/status",
    documents: "/api/kyc/documents",
    history: "/api/kyc/history",
  },
  referrals: {
    dashboard: "/api/referrals/dashboard",
    history: "/api/referrals/history",
    promo: "/api/referrals/promo",
    export: "/api/referrals/export",
  },
  portfolio: {
    snapshot: "/api/portfolio/snapshot",
    activity: "/api/portfolio/activity",
    equityHistory: "/api/portfolio/equity-history",
  },
  staking: {
    overview: "/api/staking/overview",
    pools: "/api/staking/pools",
    positions: "/api/staking/positions",
    earnings: "/api/staking/earnings",
  },
  orders: {
    list: "/api/orders",
    recent: "/api/orders/recent",
    snapshot: "/api/orders/snapshot",
  },
  wallet: {
    balances: "/api/wallet/balances",
    depositAddress: "/api/wallet/deposit-address",
    depositAddresses: "/api/wallet/deposit-addresses",
    history: "/api/wallet/history",
    withdrawals: "/api/wallet/withdrawals",
  },
  user: {
    ordersAuditSummary: "/api/user/orders-audit/summary",
    ordersAudit: "/api/user/orders-audit",
  },
  funding: {
    depositHistory: "/api/funding/deposit-history",
    depositSummary: "/api/funding/deposit-summary",
    depositAddresses: "/api/funding/deposit-addresses",
  },
  sip: {
    catalog: "/api/sip/catalog",
    preview: "/api/sip/preview",
    subscriptions: "/api/sip/subscriptions",
    orders: "/api/sip/orders",
    ordersRecent: "/api/sip/orders/recent",
    history: "/api/sip/history",
  },
} as const;

//*********** won write  */
export const ORDERS_ENDPOINTS = {
  list: (params?: { status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`/api/orders${q}`);
  },
  recent: (limit?: number) => {
    const q = limit ? `?limit=${limit}` : "";
    return toAbsolute(`/api/orders/recent${q}`);
  },
  snapshot: (p?: { openLimit?: number; historyLimit?: number; tradeLimit?: number }) => {
    const qs = new URLSearchParams();
    if (p?.openLimit) qs.set("openLimit", String(p.openLimit));
    if (p?.historyLimit) qs.set("historyLimit", String(p.historyLimit));
    if (p?.tradeLimit) qs.set("tradeLimit", String(p.tradeLimit));
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`/api/orders/snapshot${q}`);
  },
  cancel: toAbsolute(`/api/exchange/orders/cancel`),
} as const;

// keep your existing helpers (API_BASE_URL, toAbsolute, etc.)
export const FUTURES_ENDPOINTS = {
  contracts: () => toAbsolute(`/futures/contracts`),
  mark: (symbol: string) => toAbsolute(`/futures/mark/${encodeURIComponent(symbol)}`),
  funding: (symbol: string) => toAbsolute(`/futures/funding/${encodeURIComponent(symbol)}`),
  history: (symbol: string, limit?: number) => {
    const q = limit ? `?limit=${limit}` : "";
    return toAbsolute(`/futures/history/${encodeURIComponent(symbol)}${q}`);
  },
  account: () => toAbsolute(`/futures/account`),

  // positions & trades (auth)
  positions: () => toAbsolute(`/futures/positions`),
  trades: (params?: { limit?: number; cursor?: string | number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.cursor !== undefined && params?.cursor !== null) qs.set("cursor", String(params.cursor));
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`/futures/trades${q}`);
  },

  // mutations
  openPosition: () => toAbsolute(`/futures/position/open`),
  updateTriggers: () => toAbsolute(`/futures/position/update-triggers`),
  closePosition: () => toAbsolute(`/futures/position/close`),
} as const;


export const AUTH_ENDPOINTS = {
  register: toAbsolute(API_ROUTES.auth.register),
  login: toAbsolute(API_ROUTES.auth.login),
  adminLogin: toAbsolute(API_ROUTES.auth.adminLogin),
  google: toAbsolute(API_ROUTES.auth.google),
  forgotPasswordRequest: toAbsolute(API_ROUTES.auth.forgotPasswordRequest),
  forgotPasswordReset: toAbsolute(API_ROUTES.auth.forgotPasswordReset),
} as const;

export const ACCOUNT_ENDPOINTS = {
  profile: toAbsolute("/user/profile"),
  password: toAbsolute("/user/password"),
  twoFactorSetup: toAbsolute("/user/two-factor/setup"),
  twoFactorEnable: toAbsolute("/user/two-factor/enable"),
  twoFactorDisable: toAbsolute("/user/two-factor/disable"),
  delete: toAbsolute(API_ROUTES.account.delete),
} as const;

export const CONTENT_ENDPOINTS = {
  systemStatus: toAbsolute(API_ROUTES.content.systemStatus),
  branding: toAbsolute("/content/branding"),
} as const;

export const DASHBOARD_ENDPOINTS = {
  summary: toAbsolute(API_ROUTES.dashboard.summary),
  telegramAccessRequest: toAbsolute(API_ROUTES.dashboard.telegramAccessRequest),
  positions: toAbsolute(API_ROUTES.dashboard.positions),
  orders: toAbsolute(API_ROUTES.dashboard.orders),
  tickers: toAbsolute(API_ROUTES.dashboard.tickers),
  topMovers: toAbsolute(API_ROUTES.dashboard.topMovers),
  marketPulse: toAbsolute(API_ROUTES.dashboard.marketPulse),
  promos: toAbsolute(API_ROUTES.dashboard.promos),
  news: toAbsolute(API_ROUTES.dashboard.news),
  legacyHistory: (symbol: string) => toAbsolute(`/markets/${symbol}/history`),
};

export const EXCHANGE_ENDPOINTS = {
  markets: toAbsolute(API_ROUTES.exchange.markets),
  ticker: (symbol: string) => toAbsolute(`${API_ROUTES.exchange.ticker}/${symbol}`),
  orderbook: (symbol: string, depth?: number) => {
    const params = depth ? `?depth=${depth}` : "";
    return toAbsolute(`${API_ROUTES.exchange.orderbook}/${symbol}${params}`);
  },
  trades: (symbol: string, limit?: number) => {
    const params = limit ? `?limit=${limit}` : "";
    return toAbsolute(`${API_ROUTES.exchange.trades}/${symbol}${params}`);
  },
  wallets: toAbsolute(API_ROUTES.exchange.wallets),
  openOrders: toAbsolute(API_ROUTES.exchange.openOrders),
  orders: toAbsolute(API_ROUTES.exchange.orders),
  cancel: toAbsolute(API_ROUTES.exchange.cancel),
  snapshot: (symbol: string) => toAbsolute(`${API_ROUTES.exchange.snapshot}?symbol=${encodeURIComponent(symbol)}`),
};

export const SIGNAL_ENDPOINTS = {
  walletSummary: toAbsolute("/api/user/wallet-summary"),
  validate: toAbsolute("/api/user/signals/validate"),
  apply: toAbsolute("/api/user/signals/apply"),
  history: toAbsolute("/api/user/signals/history"),
} as const;

export const KYC_ENDPOINTS = {
  status: toAbsolute(API_ROUTES.kyc.status),
  documents: toAbsolute(API_ROUTES.kyc.documents),
  history: toAbsolute(API_ROUTES.kyc.history),
};

export const REFERRAL_ENDPOINTS = {
  dashboard: toAbsolute(API_ROUTES.referrals.dashboard),
  history: toAbsolute(API_ROUTES.referrals.history),
  promo: toAbsolute(API_ROUTES.referrals.promo),
  export: toAbsolute(API_ROUTES.referrals.export),
};

export const PORTFOLIO_ENDPOINTS = {
  snapshot: toAbsolute(API_ROUTES.portfolio.snapshot),
  activity: (limit?: number) =>
    toAbsolute(`${API_ROUTES.portfolio.activity}${limit ? `?limit=${limit}` : ""}`),
  equityHistory: (params?: Record<string, string | number | boolean>) => {
    const query =
      params && Object.keys(params).length
        ? `?${new URLSearchParams(
            Object.entries(params).reduce<Record<string, string>>((acc, [key, value]) => {
              if (value === undefined || value === null) return acc;
              acc[key] = String(value);
              return acc;
            }, {})
          ).toString()}`
        : "";
    return toAbsolute(`${API_ROUTES.portfolio.equityHistory}${query}`);
  },
};

export const PORTFOLIO_WS_PATH = "/ws/portfolio";
export const STAKING_ENDPOINTS = {
  overview: toAbsolute(API_ROUTES.staking.overview),
  pools: toAbsolute(API_ROUTES.staking.pools),
  positions: (params?: { status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`${API_ROUTES.staking.positions}${query}`);
  },
  earnings: (params?: { rangeDays?: number }) => {
    const qs = new URLSearchParams();
    if (params?.rangeDays) qs.set("rangeDays", String(params.rangeDays));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`${API_ROUTES.staking.earnings}${query}`);
  },
  position: (id: string | number) =>
    toAbsolute(`${API_ROUTES.staking.positions}/${encodeURIComponent(String(id))}`),
  unstake: (id: string | number) =>
    toAbsolute(`${API_ROUTES.staking.positions}/${encodeURIComponent(String(id))}/unstake`),
};

export const WALLET_ENDPOINTS = {
  balances: toAbsolute(API_ROUTES.wallet.balances),
  depositAddress: (chain: string) =>
    toAbsolute(`${API_ROUTES.wallet.depositAddress}?chain=${encodeURIComponent(chain)}`),
  depositAddresses: toAbsolute(API_ROUTES.wallet.depositAddresses),
  history: (limit?: number) =>
    toAbsolute(`${API_ROUTES.wallet.history}${limit ? `?limit=${limit}` : ""}`),
  refreshHistory: toAbsolute("/api/wallet/history/refresh"),
  withdrawals: toAbsolute(API_ROUTES.wallet.withdrawals),
  fiatDeposits: (params?: { status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`/wallet/fiat/deposits${q}`);
  },
  fiatDepositCreate: toAbsolute("/wallet/fiat/deposits"),
  fiatCheckout: toAbsolute("/wallet/fiat/checkout"),
  fiatCheckoutSession: (sessionId: string) =>
    toAbsolute(`/wallet/fiat/checkout/${encodeURIComponent(sessionId)}`),
  transfer: toAbsolute("/wallet/transfer"),
};

export const FUNDING_ENDPOINTS = {
  summary: toAbsolute(`/api/funding/summary`),
  refreshDeposits: toAbsolute(`/api/funding/refresh-deposits`),
  depositHistory: (params?: { network?: string; status?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.network) qs.set("network", params.network);
    if (params?.status) qs.set("status", params.status);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`${API_ROUTES.funding.depositHistory}${q}`);
  },
  withdrawHistory: (params?: { page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`/api/funding/withdraw-history${q}`);
  },
};

export const SIP_ENDPOINTS = {
  catalog: () => toAbsolute(API_ROUTES.sip.catalog),
  preview: () => toAbsolute(API_ROUTES.sip.preview),
  subscriptions: (id?: string | number) => {
    if (id !== undefined && id !== null) {
      return toAbsolute(`${API_ROUTES.sip.subscriptions}/${encodeURIComponent(String(id))}`);
    }
    return toAbsolute(API_ROUTES.sip.subscriptions);
  },
  subscriptionPause: (id: string | number) =>
    toAbsolute(`${API_ROUTES.sip.subscriptions}/${encodeURIComponent(String(id))}/pause`),
  subscriptionResume: (id: string | number) =>
    toAbsolute(`${API_ROUTES.sip.subscriptions}/${encodeURIComponent(String(id))}/resume`),
  subscriptionCancel: (id: string | number) =>
    toAbsolute(`${API_ROUTES.sip.subscriptions}/${encodeURIComponent(String(id))}/cancel`),
  orders: (params?: { limit?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.status) qs.set("status", params.status);
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`${API_ROUTES.sip.orders}${q}`);
  },
  recentOrders: (limit?: number) => {
    const q = limit ? `?limit=${limit}` : "";
    return toAbsolute(`${API_ROUTES.sip.ordersRecent}${q}`);
  },
  history: (params?: { limit?: number; status?: string; subscriptionId?: string | number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.status) qs.set("status", params.status);
    if (params?.subscriptionId !== undefined && params?.subscriptionId !== null) {
      qs.set("subscriptionId", String(params.subscriptionId));
    }
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`${API_ROUTES.sip.history}${q}`);
  },
} as const;

export const ADMIN_ENDPOINTS = {
  session: toAbsolute("/admin/session"),
  dashboard: {
    overview: (params?: { rangeDays?: number; asset?: string; force?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.rangeDays) qs.set("rangeDays", String(params.rangeDays));
      if (params?.asset) qs.set("asset", params.asset);
      if (params?.force) qs.set("force", "1");
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/dashboard/overview${q}`);
    },
    activity: (params?: { limit?: number; cursor?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.cursor) qs.set("cursor", params.cursor);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/dashboard/activity${q}`);
    },
  },
  services: toAbsolute("/admin/services"),
  websocketStatus: toAbsolute("/admin/websocket-status"),
  users: {
    list: (params?: { search?: string; limit?: number; page?: number; status?: string; telegramOnly?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.search) qs.set("search", params.search);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.page) qs.set("page", String(params.page));
      if (params?.status) qs.set("status", params.status);
      if (params?.telegramOnly) qs.set("telegramOnly", "true");
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/users${q}`);
    },
    balances: (userId: string) => toAbsolute(`/admin/wallet/users/${encodeURIComponent(userId)}/balances`),
    overview: (userId: string) => toAbsolute(`/admin/wallet/users/${encodeURIComponent(userId)}/overview`),
    depositAddresses: (userId: string) => toAbsolute(`/admin/wallet/users/${encodeURIComponent(userId)}/deposit-addresses`),
    adjustments: (userId: string) => toAbsolute(`/admin/wallet/users/${encodeURIComponent(userId)}/adjust`),
    updateStatus: (userId: string | number) => toAbsolute(`/admin/users/${encodeURIComponent(String(userId))}/status`),
    approveTelegramAccess: (userId: string | number) => toAbsolute(`/admin/users/${encodeURIComponent(String(userId))}/telegram-access/approve`),
    rejectTelegramAccess: (userId: string | number) => toAbsolute(`/admin/users/${encodeURIComponent(String(userId))}/telegram-access/reject`),
  },
  internal: {
    cronJobs: toAbsolute("/admin/internal/cron-jobs"),
    runCronJob: (jobKey: string) => toAbsolute(`/admin/internal/cron-jobs/${encodeURIComponent(jobKey)}/run`),
  },
  wallet: {
    userWalletDeposits: (params?: { page?: number; limit?: number; network?: string; status?: string; userId?: string | number; txHash?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.network) qs.set("network", params.network);
      if (params?.status) qs.set("status", params.status);
      if (params?.userId !== undefined && params?.userId !== null) qs.set("userId", String(params.userId));
      if (params?.txHash) qs.set("txHash", params.txHash);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/wallet/user-wallet/deposits${q}`);
    },
    userWalletWithdrawals: (params?: { status?: string; userId?: string; limit?: number; page?: number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.userId) qs.set("userId", params.userId);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.page) qs.set("page", String(params.page));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/wallet/user-wallet/withdrawals${q}`);
    },
    adminWalletDeposits: (params?: { page?: number; limit?: number; network?: string; status?: string; userId?: string | number }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.network) qs.set("network", params.network);
      if (params?.status) qs.set("status", params.status);
      if (params?.userId !== undefined && params?.userId !== null) qs.set("userId", String(params.userId));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/wallet/admin-wallet/deposits${q}`);
    },
    adminWalletWithdrawQueue: (params?: {
      userId?: string;
      limit?: number;
      page?: number;
      network?: string;
      fromDate?: string;
      toDate?: string;
      eligibleOnly?: boolean;
    }) => {
      const qs = new URLSearchParams();
      if (params?.userId) qs.set("userId", params.userId);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.page) qs.set("page", String(params.page));
      if (params?.network) qs.set("network", String(params.network));
      if (params?.fromDate) qs.set("fromDate", String(params.fromDate));
      if (params?.toDate) qs.set("toDate", String(params.toDate));
      if (params?.eligibleOnly !== undefined) qs.set("eligibleOnly", String(params.eligibleOnly));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/wallet/admin-wallet/withdraw-queue${q}`);
    },
    adminWalletWithdrawQueueLiveBalances: toAbsolute(`/admin/wallet/admin-wallet/withdraw-queue/live-balances`),
    withdrawals: (params?: { status?: string; userId?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.userId) qs.set("userId", params.userId);
      if (params?.limit) qs.set("limit", String(params.limit));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/wallet/withdrawals${q}`);
    },
    approveWithdrawal: (id: string) => toAbsolute(`/admin/wallet/withdrawals/${encodeURIComponent(id)}/approve`),
    rejectWithdrawal: (id: string) => toAbsolute(`/admin/wallet/withdrawals/${encodeURIComponent(id)}/reject`),
    deposits: (params?: { page?: number; limit?: number; network?: string; status?: string; userId?: string | number; txHash?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.network) qs.set("network", params.network);
      if (params?.status) qs.set("status", params.status);
      if (params?.userId !== undefined && params?.userId !== null) qs.set("userId", String(params.userId));
      if (params?.txHash) qs.set("txHash", params.txHash);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/wallet/deposits${q}`);
    },
    treasury: toAbsolute(`/admin/wallet/treasury`),
    treasurySweep: toAbsolute(`/admin/wallet/treasury/sweep`),
    sweeps: (params?: { page?: number; limit?: number; network?: string; status?: string; userId?: string | number }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.network) qs.set("network", params.network);
      if (params?.status) qs.set("status", params.status);
      if (params?.userId !== undefined && params?.userId !== null) qs.set("userId", String(params.userId));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/wallet/admin-wallet/sweeps${q}`);
    },
    gasFunding: (params?: { page?: number; limit?: number; network?: string; status?: string; userId?: string | number }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.network) qs.set("network", params.network);
      if (params?.status) qs.set("status", params.status);
      if (params?.userId !== undefined && params?.userId !== null) qs.set("userId", String(params.userId));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/wallet/admin-wallet/gas-funding${q}`);
    },
    runEligibleSweeps: toAbsolute(`/admin/wallet/admin-wallet/sweeps/run-eligible`),
    runPendingGasFunding: toAbsolute(`/admin/wallet/admin-wallet/gas-funding/run-pending`),
    runSweep: (id: string | number) => toAbsolute(`/admin/wallet/admin-wallet/sweeps/${encodeURIComponent(String(id))}/run`),
    retrySweep: (id: string | number) => toAbsolute(`/admin/wallet/admin-wallet/sweeps/${encodeURIComponent(String(id))}/retry`),
    sendGasFunding: (id: string | number) => toAbsolute(`/admin/wallet/admin-wallet/gas-funding/${encodeURIComponent(String(id))}/send`),
    retryGasFunding: (id: string | number) => toAbsolute(`/admin/wallet/admin-wallet/gas-funding/${encodeURIComponent(String(id))}/retry`),
    adjustBalance: (userId: string) => toAbsolute(`/admin/wallet/users/${encodeURIComponent(userId)}/adjust`),
    fiatDeposits: (params?: { status?: string; method?: string; userId?: string | number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.method) qs.set("method", params.method);
      if (params?.userId !== undefined && params?.userId !== null) qs.set("userId", String(params.userId));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/wallet/fiat/deposits${q}`);
    },
    approveFiatDeposit: (id: string | number) =>
      toAbsolute(`/admin/wallet/fiat/deposits/${encodeURIComponent(String(id))}/approve`),
    rejectFiatDeposit: (id: string | number) =>
      toAbsolute(`/admin/wallet/fiat/deposits/${encodeURIComponent(String(id))}/reject`),
    transfer: (userId: string | number) =>
      toAbsolute(`/admin/wallet/users/${encodeURIComponent(String(userId))}/transfer`),
  },
  orders: {
    live: (params?: { limit?: number; search?: string; symbol?: string; status?: string; userId?: string | number }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.search) qs.set("search", params.search);
      if (params?.symbol) qs.set("symbol", params.symbol);
      if (params?.status) qs.set("status", params.status);
      if (params?.userId) qs.set("userId", String(params.userId));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/orders/live${q}`);
    },
    recent: (params?: { limit?: number; search?: string; symbol?: string; status?: string; userId?: string | number }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.search) qs.set("search", params.search);
      if (params?.symbol) qs.set("symbol", params.symbol);
      if (params?.status) qs.set("status", params.status);
      if (params?.userId) qs.set("userId", String(params.userId));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/orders/recent${q}`);
    },
    trades: (params?: { limit?: number; search?: string; symbol?: string; userId?: string | number }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.search) qs.set("search", params.search);
      if (params?.symbol) qs.set("symbol", params.symbol);
      if (params?.userId) qs.set("userId", String(params.userId));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/orders/trades${q}`);
    },
  },
  markets: toAbsolute("/admin/markets"),
  audit: (params?: { limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString() ? `?${qs.toString()}` : "";
    return toAbsolute(`/admin/audit${q}`);
  },
  settings: {
    get: toAbsolute("/admin/settings"),
    update: toAbsolute("/admin/settings"),
    upload: toAbsolute("/admin/settings/upload"),
    password: toAbsolute("/admin/settings/password"),
  },
  commission: {
    history: (params?: { page?: number; limit?: number; search?: string; incomeType?: string; level?: string; status?: string; fromDate?: string; toDate?: string; group?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.search) qs.set("search", params.search);
      if (params?.incomeType) qs.set("incomeType", params.incomeType);
      if (params?.level) qs.set("level", params.level);
      if (params?.status) qs.set("status", params.status);
      if (params?.fromDate) qs.set("fromDate", params.fromDate);
      if (params?.toDate) qs.set("toDate", params.toDate);
      if (params?.group) qs.set("group", params.group);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/commission/history${q}`);
    },
    incomeSummary: toAbsolute("/admin/income-ledger/summary"),
    incomeLedger: (params?: { page?: number; limit?: number; search?: string; incomeType?: string; level?: string; status?: string; fromDate?: string; toDate?: string; group?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.search) qs.set("search", params.search);
      if (params?.incomeType) qs.set("incomeType", params.incomeType);
      if (params?.level) qs.set("level", params.level);
      if (params?.status) qs.set("status", params.status);
      if (params?.fromDate) qs.set("fromDate", params.fromDate);
      if (params?.toDate) qs.set("toDate", params.toDate);
      if (params?.group) qs.set("group", params.group);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/income-ledger${q}`);
    },
    incomeLedgerUserSummary: (params?: { page?: number; limit?: number; search?: string; incomeType?: string; level?: string; status?: string; fromDate?: string; toDate?: string; group?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set("page", String(params.page));
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.search) qs.set("search", params.search);
      if (params?.incomeType) qs.set("incomeType", params.incomeType);
      if (params?.level) qs.set("level", params.level);
      if (params?.status) qs.set("status", params.status);
      if (params?.fromDate) qs.set("fromDate", params.fromDate);
      if (params?.toDate) qs.set("toDate", params.toDate);
      if (params?.group) qs.set("group", params.group);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/income-ledger/user-summary${q}`);
    },
    incomeLedgerExport: (params?: { search?: string; incomeType?: string; level?: string; status?: string; fromDate?: string; toDate?: string; group?: string }) => {
      const qs = new URLSearchParams();
      if (params?.search) qs.set("search", params.search);
      if (params?.incomeType) qs.set("incomeType", params.incomeType);
      if (params?.level) qs.set("level", params.level);
      if (params?.status) qs.set("status", params.status);
      if (params?.fromDate) qs.set("fromDate", params.fromDate);
      if (params?.toDate) qs.set("toDate", params.toDate);
      if (params?.group) qs.set("group", params.group);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/income-ledger/export${q}`);
    },
  },
  signalPackages: {
    get: toAbsolute("/admin/package-settings"),
    updateSettings: toAbsolute("/admin/package-settings/settings"),
    create: toAbsolute("/admin/package-settings/packages"),
    update: (id: string | number) => toAbsolute(`/admin/package-settings/packages/${encodeURIComponent(String(id))}`),
  },
  controlSettings: {
    get: toAbsolute("/admin/control-settings"),
    update: toAbsolute("/admin/control-settings"),
    generateTradeSlotToken: (slotId: string | number) =>
      toAbsolute(`/api/admin/control-system/trade-slots/${encodeURIComponent(String(slotId))}/generate-token`),
    signalHistoryDayWise: toAbsolute("/api/admin/control-system/signal-history/day-wise"),
    signalHistoryToken: (batchToken: string) =>
      toAbsolute(`/api/admin/control-system/signal-history/token/${encodeURIComponent(batchToken)}`),
  },
  levelManagement: {
    get: toAbsolute("/api/admin/level-management-settings"),
    update: toAbsolute("/api/admin/level-management-settings"),
  },
  devMlmTest: {
    generateUsers: toAbsolute("/api/dev/mlm-test/generate-users"),
    generateDeposits: toAbsolute("/api/dev/mlm-test/generate-deposits"),
    rebuildTree: toAbsolute("/api/dev/mlm-test/rebuild-tree"),
    recalculateLevels: toAbsolute("/api/dev/mlm-test/recalculate-levels"),
    results: (runId?: string | number) =>
      toAbsolute(`/api/dev/mlm-test/results${runId !== undefined && runId !== null ? `?runId=${encodeURIComponent(String(runId))}` : ""}`),
    reset: toAbsolute("/api/dev/mlm-test/reset"),
  },
  assets: {
    list: (params?: { status?: string; asset?: string; includeDisabled?: boolean }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.asset) qs.set("asset", params.asset);
      if (params?.includeDisabled !== undefined) qs.set("includeDisabled", String(params.includeDisabled));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/assets${q}`);
    },
    create: toAbsolute("/admin/assets"),
    update: (id: string | number) => toAbsolute(`/admin/assets/${encodeURIComponent(String(id))}`),
  },
  futures: {
    contracts: toAbsolute("/admin/futures/contracts"),
    updateContract: (symbol: string) => toAbsolute(`/admin/futures/contracts/${encodeURIComponent(symbol)}`),
    mark: (symbol: string) => toAbsolute(`/admin/futures/mark/${encodeURIComponent(symbol)}`),
    funding: (symbol: string) => toAbsolute(`/admin/futures/funding/${encodeURIComponent(symbol)}`),
    history: (symbol: string, limit?: number) => {
      const q = limit ? `?limit=${limit}` : "";
      return toAbsolute(`/admin/futures/history/${encodeURIComponent(symbol)}${q}`);
    },
    userAccount: (userId: string) => toAbsolute(`/admin/futures/users/${encodeURIComponent(userId)}/account`),
    userPositions: (userId: string, status?: string) => {
      const q = status ? `?status=${encodeURIComponent(status)}` : "";
      return toAbsolute(`/admin/futures/users/${encodeURIComponent(userId)}/positions${q}`);
    },
    userTrades: (userId: string) => toAbsolute(`/admin/futures/users/${encodeURIComponent(userId)}/trades`),
    openPosition: (userId: string) => toAbsolute(`/admin/futures/users/${encodeURIComponent(userId)}/open`),
    updateTriggers: (userId: string) => toAbsolute(`/admin/futures/users/${encodeURIComponent(userId)}/update-triggers`),
    closePosition: (userId: string) => toAbsolute(`/admin/futures/users/${encodeURIComponent(userId)}/close`),
  },
  kyc: {
    summary: toAbsolute(`/admin/kyc/summary`),
    requests: (params?: { page?: number; pageSize?: number; status?: string; search?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set("page", String(params.page));
      if (params?.pageSize) qs.set("pageSize", String(params.pageSize));
      if (params?.status) qs.set("status", params.status);
      if (params?.search) qs.set("search", params.search);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/kyc/requests${q}`);
    },
    request: (id: string | number) => toAbsolute(`/admin/kyc/requests/${encodeURIComponent(String(id))}`),
    approve: (id: string | number) => toAbsolute(`/admin/kyc/requests/${encodeURIComponent(String(id))}/approve`),
    decline: (id: string | number) => toAbsolute(`/admin/kyc/requests/${encodeURIComponent(String(id))}/decline`),
  },
  staking: {
    overview: toAbsolute("/admin/staking/overview"),
    packages: (params?: { status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/staking/packages${q}`);
    },
    package: (id: string | number) =>
      toAbsolute(`/admin/staking/packages/${encodeURIComponent(String(id))}`),
    positions: (params?: { status?: string; userId?: string | number; packageId?: string | number }) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.userId !== undefined && params?.userId !== null) {
        qs.set("userId", String(params.userId));
      }
      if (params?.packageId !== undefined && params?.packageId !== null) {
        qs.set("packageId", String(params.packageId));
      }
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/staking/positions${q}`);
    },
    earnings: (params?: { rangeDays?: number; asset?: string; userId?: string | number; status?: string }) => {
      const qs = new URLSearchParams();
      if (params?.rangeDays) qs.set("rangeDays", String(params.rangeDays));
      if (params?.asset) qs.set("asset", params.asset);
      if (params?.userId !== undefined && params?.userId !== null) qs.set("userId", String(params.userId));
      if (params?.status) qs.set("status", params.status);
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/staking/earnings${q}`);
    },
    positionPayout: (positionId: string | number) =>
      toAbsolute(`/admin/staking/positions/${encodeURIComponent(String(positionId))}/payout`),
    runPayouts: toAbsolute("/admin/staking/payouts/run"),
  },
  sip: {
    plans: {
      list: () => toAbsolute("/admin/sip/plans"),
      create: () => toAbsolute("/admin/sip/plans"),
      update: (id: string | number) =>
        toAbsolute(`/admin/sip/plans/${encodeURIComponent(String(id))}`),
    },
    subscriptions: (params?: { planId?: string | number; status?: string; userId?: string | number; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.planId !== undefined && params?.planId !== null) {
        qs.set("planId", String(params.planId));
      }
      if (params?.status) qs.set("status", params.status);
      if (params?.userId !== undefined && params?.userId !== null) {
        qs.set("userId", String(params.userId));
      }
      if (params?.limit) qs.set("limit", String(params.limit));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/sip/subscriptions${q}`);
    },
    orders: (params?: { planId?: string | number; subscriptionId?: string | number; status?: string; limit?: number }) => {
      const qs = new URLSearchParams();
      if (params?.planId !== undefined && params?.planId !== null) {
        qs.set("planId", String(params.planId));
      }
      if (params?.subscriptionId !== undefined && params?.subscriptionId !== null) {
        qs.set("subscriptionId", String(params.subscriptionId));
      }
      if (params?.status) qs.set("status", params.status);
      if (params?.limit) qs.set("limit", String(params.limit));
      const q = qs.toString() ? `?${qs.toString()}` : "";
      return toAbsolute(`/admin/sip/orders${q}`);
    },
  },
};
