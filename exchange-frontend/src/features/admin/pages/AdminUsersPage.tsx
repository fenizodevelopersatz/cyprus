import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Dialog from "../../../ui/Dialog";
import {
  adminAdjustBalance,
  fetchAdminBalances,
  fetchAdminIncomeLedger,
  type AdminIncomeLedgerRow,
  fetchAdminUserWalletDeposits,
  fetchAdminUserOverview,
  fetchAdminUserWalletWithdrawals,
  fetchAdminUsers,
  patchAdminUserStatus,
  type AdminDepositRecord,
  type AdminUser,
  type AdminWithdrawal,
  type AdminBalances,
} from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";
const transactionPageSize = 10;
const balanceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const generateWalletOrderId = (action: "deposit" | "withdraw") => {
  const alphabet = "abcdef0123456789";
  const randomPart = Array.from({ length: 24 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${action === "deposit" ? "deposit" : "withdraw"}:${randomPart}`;
};

const statusOptions = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
  { label: "Deleted", value: "deleted" },
];

type AdminUsersResponse = Awaited<ReturnType<typeof fetchAdminUsers>>;

const normalizeBalances = (value: unknown): AdminBalances[] => {
  if (Array.isArray(value)) return value as AdminBalances[];
  if (value && typeof value === "object") {
    const record = value as {
      balances?: unknown;
      items?: unknown;
      data?: unknown;
      rows?: unknown;
    };

    if (Array.isArray(record.balances)) return record.balances as AdminBalances[];
    if (Array.isArray(record.items)) return record.items as AdminBalances[];
    if (Array.isArray(record.data)) return record.data as AdminBalances[];
    if (Array.isArray(record.rows)) return record.rows as AdminBalances[];
  }
  return [];
};

const networkCardTone: Record<string, string> = {
  ethereum: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200/80",
  bsc: "border-amber-400/20 bg-amber-500/10 text-amber-200/80",
  tron: "border-violet-400/20 bg-violet-500/10 text-violet-200/80",
};

const networkCardLabel: Record<string, string> = {
  ethereum: "ERC-20",
  bsc: "BEP-20",
  tron: "TRC-20",
};

const getUserAvatarLabel = (user: AdminUser) => {
  const seed = String(user.displayName || user.name || user.email || "U").trim();
  return seed.slice(0, 1).toUpperCase();
};

const hasAdminRole = (user: AdminUser) =>
  Array.isArray(user.roles) && user.roles.some((role) => String(role || "").trim().toLowerCase() === "admin");

export default function AdminUsersPage() {
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState({ search: "", status: "all", page: 1, pageSize: 25 });
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [walletModalUser, setWalletModalUser] = useState<AdminUser | null>(null);
  const [walletActionTab, setWalletActionTab] = useState<"deposit" | "withdraw">("deposit");
  const [walletForm, setWalletForm] = useState({
    asset: "USDT",
    amount: "",
    orderId: "",
    memo: "",
  });
  const [transactionPage, setTransactionPage] = useState(1);
  const queryClient = useQueryClient();
  const userQuery = useQuery<AdminUsersResponse>({
    queryKey: ["admin", "users", filters],
    queryFn: () =>
      fetchAdminUsers({
        search: filters.search || undefined,
        status: filters.status === "all" ? undefined : filters.status,
        page: filters.page,
        limit: filters.pageSize,
      }),
  });

  const items = (userQuery.data?.items ?? []).filter((user) => !hasAdminRole(user));
  const meta = userQuery.data?.meta;

  const overviewQuery = useQuery({
    queryKey: ["admin", "user", selectedUser?.id, "overview"],
    queryFn: () => fetchAdminUserOverview(String(selectedUser?.id)),
    enabled: Boolean(selectedUser),
  });
  const balancesQuery = useQuery({
    queryKey: ["admin", "user", selectedUser?.id, "balances"],
    queryFn: () => fetchAdminBalances(String(selectedUser?.id)),
    enabled: Boolean(selectedUser),
  });
  const balanceItems = normalizeBalances(balancesQuery.data);

  const depositsQuery = useQuery({
    queryKey: ["admin", "user", selectedUser?.id, "deposits", transactionPage],
    queryFn: () => fetchAdminUserWalletDeposits({ userId: String(selectedUser?.id), limit: 100, page: 1 }),
    enabled: Boolean(selectedUser),
  });

  const withdrawalsQuery = useQuery({
    queryKey: ["admin", "user", selectedUser?.id, "withdrawals"],
    queryFn: () => fetchAdminUserWalletWithdrawals({ userId: String(selectedUser?.id), limit: 100 }),
    enabled: Boolean(selectedUser),
  });
  const incomeLedgerQuery = useQuery({
    queryKey: ["admin", "user", selectedUser?.id, "income-ledger", transactionPage],
    queryFn: () =>
      fetchAdminIncomeLedger({
        page: 1,
        limit: 100,
        search: String(selectedUser?.id || ""),
      }),
    enabled: Boolean(selectedUser),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string | number; next: "active" | "inactive" }) =>
      patchAdminUserStatus(id, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const submitSearch = (evt: FormEvent) => {
    evt.preventDefault();
    setFilters((prev) => ({ ...prev, search: searchInput.trim(), page: 1 }));
  };

  const changeStatusFilter = (value: string) => {
    setFilters((prev) => ({ ...prev, status: value, page: 1 }));
  };

  const changePage = (delta: number) => {
    setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page + delta) }));
  };

  const walletOverview = overviewQuery.data;
  const getAssetTotal = (asset: string) =>
    balanceItems
      .filter((item) => String(item.asset || "").toUpperCase() === asset)
      .reduce((sum, item) => sum + Number(item.total || 0), 0);

  const internalWalletBalance = Number(walletOverview?.internal.mainWalletBalance || 0);
  const internalUsdtBalance = getAssetTotal("USDT") || internalWalletBalance;
  const visibleWalletNetworks = (walletOverview?.live.networks ?? []).filter((item) =>
    Boolean(String(item.address || "").trim())
  );
  const depositItems: AdminDepositRecord[] = depositsQuery.data?.items ?? [];
  const internalDepositsByNetwork = depositItems.reduce<Record<string, number>>((acc, item) => {
    const key = String(item.networkKey || item.network || "").trim().toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + Number(item.amount || 0);
    return acc;
  }, {});
  const internalNetworkCards = visibleWalletNetworks.map((item) => {
    const key = String(item.network || "").toLowerCase();
    return {
      key,
      title: `Internal ${networkCardLabel[key] || String(item.walletNetwork || item.network || "").toUpperCase()}`,
      nativeAsset: item.nativeAsset,
      nativeBalance: 0,
      usdtBalance: internalDepositsByNetwork[key] || 0,
      tone: networkCardTone[key] || "border-white/10 bg-white/5 text-slate-300/80",
    };
  });

  const walletAdjustMutation = useMutation({
    mutationFn: async () => {
      if (!walletModalUser) throw new Error("Select a user first.");
      const amount = Number(walletForm.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount.");
      if (!walletForm.orderId.trim()) throw new Error("Order ID is required.");
      return adminAdjustBalance(String(walletModalUser.id), {
        asset: walletForm.asset.trim().toUpperCase() || "USDT",
        amount,
        operation: walletActionTab === "deposit" ? "credit" : "debit",
        namespace: "spot:available",
        memo: walletForm.memo.trim() || undefined,
        orderId: walletForm.orderId.trim(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "user"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setWalletForm({ asset: "USDT", amount: "", orderId: "", memo: "" });
      setWalletModalUser(null);
    },
  });
  const liveNetworkCards = visibleWalletNetworks.map((item) => {
    const key = String(item.network || "").toLowerCase();
    return {
      key,
      title: `Live ${networkCardLabel[key] || String(item.walletNetwork || item.network || "").toUpperCase()}`,
      nativeAsset: item.nativeAsset,
      nativeBalance: Number(item.nativeBalance || 0),
      usdtBalance: Number(item.tokenBalance || 0),
      tone: networkCardTone[key] || "border-white/10 bg-white/5 text-slate-300/80",
    };
  });
  const formatBalance = (value: number) => balanceFormatter.format(Number.isFinite(value) ? value : 0);
  const walletMutationError =
    walletAdjustMutation.error instanceof Error ? walletAdjustMutation.error.message : null;

  const withdrawalItems: AdminWithdrawal[] = Array.isArray(withdrawalsQuery.data)
    ? withdrawalsQuery.data
    : withdrawalsQuery.data?.items ?? [];
  const incomeLedgerItems: AdminIncomeLedgerRow[] = (incomeLedgerQuery.data?.items ?? []).filter(
    (item) => String(item.userId ?? item.primary_user_id ?? "") === String(selectedUser?.id ?? "")
  );
  const successfulWithdrawalItems = withdrawalItems.filter((item) => {
    const status = String(item.status ?? "").toLowerCase();
    return status === "success" || status === "approved" || status === "completed";
  });
  const incomeTotals = incomeLedgerItems.reduce(
    (acc, row) => {
      const amount = Number(row.amount || 0);
      const type = String(row.incomeType || "").toLowerCase();
      acc.total += amount;
      if (type === "signal_income") acc.signal += amount;
      else if (type === "direct_sponsor_commission") acc.direct += amount;
      else if (type === "joined_commission") acc.sponsor += amount;
      else if (type === "level_promotion_reward") acc.level += amount;
      else if (type === "level_bonus_10day") acc.tenDay += amount;
      return acc;
    },
    { total: 0, signal: 0, direct: 0, sponsor: 0, level: 0, tenDay: 0 }
  );
  const unifiedTransactions = [
    ...incomeLedgerItems.map((row) => ({
      id: `ledger-${row.txn_id}-${row.id}`,
      kind: "income" as const,
      category: row.incomeType,
      title: formatIncomeTypeLabel(row.incomeType),
      amountLabel: `$${Number(row.amount || 0).toFixed(2)}`,
      amountValue: Number(row.amount || 0),
      status: row.status,
      timestamp: row.event_at || row.createdAt || "",
      primaryMetaLabel: "Txn ID",
      primaryMetaValue: row.txn_id || "-",
      secondaryMetaLabel: "Reference",
      secondaryMetaValue: String(row.reference ?? row.reference_id ?? row.order_id ?? "-"),
      secondaryMetaHref: undefined,
      tertiaryMetaLabel: "Source User",
      tertiaryMetaValue: row.sourceUser || "-",
      quaternaryMetaLabel: "Level",
      quaternaryMetaValue: row.level || "-",
      badgeClass: "bg-emerald-500/20 text-emerald-100",
    })),
    ...depositItems.map((item) => ({
      id: `deposit-${item.id}`,
      kind: "deposit" as const,
      category: "deposit",
      title: "Deposit",
      amountLabel: `${item.amount} USDT`,
      amountValue: Number(item.amount || 0),
      status: item.status,
      timestamp: item.createdAt,
      primaryMetaLabel: "Txn ID",
      primaryMetaValue: item.txn_id || "-",
      secondaryMetaLabel: "Tx Hash",
      secondaryMetaValue: item.txHash || "-",
      secondaryMetaHref: item.explorerUrl || undefined,
      tertiaryMetaLabel: "Address",
      tertiaryMetaValue: item.depositAddress || "-",
      quaternaryMetaLabel: "Network",
      quaternaryMetaValue: item.network || item.networkKey || "-",
      badgeClass: "bg-cyan-500/20 text-cyan-100",
    })),
    ...successfulWithdrawalItems.map((item) => ({
      id: `withdrawal-${item.id}`,
      kind: "withdrawal" as const,
      category: "withdrawal",
      title: "Withdraw Success",
      amountLabel: `${item.amount} ${item.asset}`,
      amountValue: Number(item.amount || 0),
      status: item.status,
      timestamp: item.confirmedAt || item.updatedAt || item.createdAt || item.requestedAt || "",
      primaryMetaLabel: "Txn ID",
      primaryMetaValue: item.txn_id || "-",
      secondaryMetaLabel: "Tx Hash",
      secondaryMetaValue: item.txHash || "-",
      secondaryMetaHref: item.txExplorerUrl || item.explorerUrl || undefined,
      tertiaryMetaLabel: "Address",
      tertiaryMetaValue: item.address || item.to || "-",
      quaternaryMetaLabel: "Network",
      quaternaryMetaValue: item.chain || "-",
      badgeClass: "bg-amber-500/20 text-amber-100",
    })),
  ].sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
  const unifiedPagination = {
    page: transactionPage,
    limit: transactionPageSize,
    total: unifiedTransactions.length,
    totalPages: Math.max(1, Math.ceil(unifiedTransactions.length / transactionPageSize)),
  };
  const pagedTransactions = unifiedTransactions.slice(
    (transactionPage - 1) * transactionPageSize,
    transactionPage * transactionPageSize
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Users</div>
          <h2 className="text-2xl font-semibold text-white">Directory & controls</h2>
        </div>
        <form onSubmit={submitSearch} className="ml-auto flex gap-2">
          <input
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm focus:border-emerald-400/60 focus:outline-none"
            placeholder="Search email or ID"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>
      </header>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-center gap-3 pb-4">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => changeStatusFilter(option.value)}
              className={`rounded-full px-4 py-1.5 text-sm ${
                filters.status === option.value
                  ? "bg-emerald-500/20 text-white"
                  : "text-slate-300 hover:text-white hover:bg-white/10"
              }`}
            >
              {option.label}
            </button>
          ))}
          <div className="ml-auto text-xs text-slate-400">
            Page {meta?.page ?? filters.page} / {meta?.totalPages ?? "-"}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="pb-2">ID</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Eligible Level</th>
                <th className="pb-2">Roles</th>
                <th className="pb-2">Registered</th>
                <th className="pb-2">KYC</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.map((user) => (
                <tr
                  key={user.id}
                  className={`cursor-pointer transition hover:bg-white/5 ${
                    selectedUser?.id === user.id ? "bg-emerald-500/5" : ""
                  }`}
                  onClick={() => {
                    setSelectedUser(user);
                    setTransactionPage(1);
                  }}
                >
                  <td className="py-2 text-slate-300">{user.id}</td>
                  <td className="py-2">
                    <div className="flex items-center gap-3">
                      {user.profilePhoto ? (
                        <img
                          src={user.profilePhoto}
                          alt={`${user.displayName ?? user.name ?? user.email} profile`}
                          className="h-9 w-9 rounded-full border border-white/10 object-cover"
                        />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-xs font-semibold text-slate-200">
                          {getUserAvatarLabel(user)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-white font-medium">{user.email}</div>
                        <div className="truncate text-xs text-slate-400">{user.displayName ?? user.name ?? "-"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 text-xs">
                    <div className="flex flex-col gap-1">
                      <span className="text-white">{user.currentEligibleLevelCode ?? "-"}</span>
                      <span className="text-slate-400">
                        Prev: {user.previousAchievedLevelCode ?? "-"}
                        {user.fallbackHappened ? " | Fallback" : ""}
                      </span>
                    </div>
                  </td>
                    <td className="py-2 text-xs text-slate-300">
                      {user.roles?.map((r: string) => (
                        <span key={r} className="mr-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em]">
                          {r}
                        </span>
                      ))}
                    </td>
                  <td className="py-2 text-slate-300 text-xs">
                    {user.createdAt ? new Date(user.createdAt).toLocaleString() : "-"}
                  </td>
                  <td className="py-2 text-xs">
                    <span
                      className={`rounded-full px-3 py-0.5 uppercase tracking-[0.2em] ${
                        user.kycVerified ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-500/20 text-slate-200"
                      }`}
                    >
                      {user.kycVerified ? "Verified" : "Unverified"}
                    </span>
                  </td>
                  <td className="py-2 text-xs">
                    <span
                      className={`rounded-full px-3 py-0.5 uppercase tracking-[0.2em] ${
                        user.status === "active" ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"
                      }`}
                    >
                      {user.status ?? "unknown"}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWalletActionTab("deposit");
                          setWalletForm({ asset: "USDT", amount: "", orderId: "", memo: "" });
                          setWalletModalUser(user);
                        }}
                      >
                        Wallet
                      </Button>
                      <Button
                        size="xs"
                        variant={user.status === "active" ? "danger" : "primary"}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStatusMutation.mutate({
                            id: user.id,
                            next: user.status === "active" ? "inactive" : "active",
                          });
                        }}
                      >
                        {user.status === "active" ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!userQuery.isFetching && items.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-slate-400">
                    No user role records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <span>{meta ? `${items.length} user records on this page` : ""}</span>
          <div className="flex gap-2">
            <Button size="xs" variant="secondary" onClick={() => changePage(-1)} disabled={filters.page === 1 || userQuery.isFetching}>
              Prev
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => changePage(1)}
              disabled={meta ? filters.page >= meta.totalPages : userQuery.isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <div className={panelCls}>
        <div className="text-sm text-slate-300/80">Click any user row to open a wide popup with the full profile, balance summary, and transaction history.</div>
      </div>

      <Dialog
        open={Boolean(walletModalUser)}
        onClose={() => {
          if (walletAdjustMutation.isPending) return;
          setWalletModalUser(null);
          setWalletForm({ asset: "USDT", amount: "", orderId: "", memo: "" });
          walletAdjustMutation.reset();
        }}
        title={walletModalUser ? `Wallet actions for ${walletModalUser.email}` : "Wallet actions"}
        panelClassName="max-w-[760px]"
      >
        {walletModalUser ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300/80">
              Manage this user's virtual wallet balance. Use <strong className="text-white">Deposit by Admin</strong> to credit funds and <strong className="text-white">Withdraw by Admin</strong> to reduce funds. Each action requires an order/reference ID.
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { key: "deposit", label: "Deposit by Admin" },
                { key: "withdraw", label: "Withdraw by Admin" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setWalletActionTab(tab.key as "deposit" | "withdraw");
                    walletAdjustMutation.reset();
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${
                    walletActionTab === tab.key
                      ? "bg-emerald-500/20 text-white"
                      : "bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm text-slate-300">
                <span>Asset</span>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-emerald-400/60 focus:outline-none"
                  value={walletForm.asset}
                  onChange={(event) => setWalletForm((prev) => ({ ...prev, asset: event.target.value }))}
                  placeholder="USDT"
                />
              </label>
              <label className="space-y-2 text-sm text-slate-300">
                <span>Amount</span>
                <input
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-emerald-400/60 focus:outline-none"
                  value={walletForm.amount}
                  onChange={(event) => setWalletForm((prev) => ({ ...prev, amount: event.target.value }))}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </label>
              <label className="space-y-2 text-sm text-slate-300 sm:col-span-2">
                <span>Order ID</span>
                <div className="flex gap-2">
                  <input
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-emerald-400/60 focus:outline-none"
                    value={walletForm.orderId}
                    onChange={(event) => setWalletForm((prev) => ({ ...prev, orderId: event.target.value }))}
                    placeholder="Enter order or reference ID"
                  />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setWalletForm((prev) => ({
                          ...prev,
                          orderId: generateWalletOrderId(walletActionTab),
                        }))
                      }
                    >
                    Generate
                  </Button>
                </div>
                <div className="text-xs text-slate-400">
                  Enter your own order/reference ID manually, or generate a random crypto-style hash ID.
                </div>
              </label>
              <label className="space-y-2 text-sm text-slate-300 sm:col-span-2">
                <span>Note</span>
                <textarea
                  className="min-h-[100px] w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white focus:border-emerald-400/60 focus:outline-none"
                  value={walletForm.memo}
                  onChange={(event) => setWalletForm((prev) => ({ ...prev, memo: event.target.value }))}
                  placeholder={walletActionTab === "deposit" ? "Reason for admin deposit" : "Reason for admin withdrawal"}
                />
              </label>
            </div>

            {walletMutationError ? (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {walletMutationError}
              </div>
            ) : null}

            <div className="flex justify-end gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setWalletModalUser(null);
                  setWalletForm({ asset: "USDT", amount: "", orderId: "", memo: "" });
                  walletAdjustMutation.reset();
                }}
                disabled={walletAdjustMutation.isPending}
              >
                Close
              </Button>
              <Button
                onClick={() => void walletAdjustMutation.mutateAsync()}
                disabled={walletAdjustMutation.isPending}
              >
                {walletAdjustMutation.isPending
                  ? walletActionTab === "deposit"
                    ? "Depositing..."
                    : "Withdrawing..."
                  : walletActionTab === "deposit"
                    ? "Confirm Deposit"
                    : "Confirm Withdraw"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(selectedUser)}
        onClose={() => {
          setSelectedUser(null);
          setTransactionPage(1);
        }}
        title={selectedUser ? selectedUser.email : "User details"}
        panelClassName="max-w-[94vw] xl:max-w-[1500px]"
      >
        {selectedUser ? (
          <div className="max-h-[84vh] space-y-6 overflow-y-auto pr-2">
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-start gap-4">
                  {selectedUser.profilePhoto ? (
                    <img
                      src={selectedUser.profilePhoto}
                      alt={`${selectedUser.displayName ?? selectedUser.name ?? selectedUser.email} profile`}
                      className="h-20 w-20 shrink-0 rounded-3xl border border-white/10 object-cover shadow-[0_18px_40px_rgba(0,0,0,0.28)]"
                    />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl border border-white/10 bg-white/5 text-2xl font-semibold text-slate-200 shadow-[0_18px_40px_rgba(0,0,0,0.22)]">
                      {getUserAvatarLabel(selectedUser)}
                    </div>
                  )}
                  <div className="space-y-3">
                    <div>
                      <div className="text-xl font-semibold text-white">{selectedUser.displayName ?? selectedUser.name ?? "Unnamed user"}</div>
                      <p className="text-sm text-slate-300/80">
                        User #{selectedUser.id} | {selectedUser.email}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.22em]">
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200">
                        {selectedUser.country ?? "Unknown country"}
                      </span>
                      <span className={`rounded-full px-3 py-1 ${selectedUser.kycVerified ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-500/20 text-slate-200"}`}>
                        {selectedUser.kycVerified ? "KYC verified" : "KYC unverified"}
                      </span>
                      <span className={`rounded-full px-3 py-1 ${selectedUser.status === "active" ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"}`}>
                        {selectedUser.status ?? "unknown"}
                      </span>
                      {(selectedUser.roles ?? []).map((role) => (
                        <span key={role} className="rounded-full bg-indigo-500/15 px-3 py-1 text-indigo-100">
                          {role}
                        </span>
                      ))}
                    </div>
                    <div className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                      <div>
                        <div className="uppercase tracking-[0.22em]">Registered</div>
                        <div className="mt-1 text-sm text-slate-200">{selectedUser.createdAt ? new Date(selectedUser.createdAt).toLocaleString() : "-"}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-[0.22em]">Last active</div>
                        <div className="mt-1 text-sm text-slate-200">{selectedUser.lastActiveAt ? new Date(selectedUser.lastActiveAt).toLocaleString() : "-"}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-[0.22em]">Current eligible level</div>
                        <div className="mt-1 text-sm text-slate-200">{selectedUser.currentEligibleLevelCode ?? "-"}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-[0.22em]">Highest achieved level</div>
                        <div className="mt-1 text-sm text-slate-200">{selectedUser.previousAchievedLevelCode ?? "-"}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-[0.22em]">Next 10-day bonus due</div>
                        <div className="mt-1 text-sm text-slate-200">{selectedUser.nextBonusDueAt ? new Date(selectedUser.nextBonusDueAt).toLocaleString() : "-"}</div>
                      </div>
                      <div>
                        <div className="uppercase tracking-[0.22em]">Fallback status</div>
                        <div className="mt-1 text-sm text-slate-200">{selectedUser.fallbackHappened ? "Fallback applied" : "No fallback"}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 xl:min-w-[620px]">
                  <div className={`grid gap-3 sm:grid-cols-2 ${internalNetworkCards.length >= 3 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
                    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-4">
                      <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-200/80">Internal Total USDT</div>
                      <div className="mt-2 text-2xl font-semibold text-white">{formatBalance(internalUsdtBalance)}</div>
                    </div>
                    {internalNetworkCards.map((card) => (
                      <div key={card.key} className={`rounded-2xl border p-4 ${card.tone}`}>
                        <div className="text-[11px] uppercase tracking-[0.24em]">{card.title}</div>
                        <div className="mt-3 space-y-2 text-sm text-slate-100">
                          {/* <div className="flex items-center justify-between gap-3">
                            <span>{card.nativeAsset}</span>
                            <span className="text-lg font-semibold text-white">{formatBalance(card.nativeBalance)}</span>
                          </div> */}
                          <div className="flex items-center justify-between gap-3">
                            <span>USDT</span>
                            <span className="text-lg font-semibold text-white">{formatBalance(card.usdtBalance)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={`grid gap-3 sm:grid-cols-2 ${liveNetworkCards.length >= 3 ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
                    {liveNetworkCards.map((card) => (
                      <div key={card.key} className={`rounded-2xl border p-4 ${card.tone}`}>
                        <div className="text-[11px] uppercase tracking-[0.24em]">{card.title}</div>
                        <div className="mt-3 space-y-2 text-sm text-slate-100">
                          <div className="flex items-center justify-between gap-3">
                            <span>{card.nativeAsset}</span>
                            <span className="text-lg font-semibold text-white">{formatBalance(card.nativeBalance)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>USDT</span>
                            <span className="text-lg font-semibold text-white">{formatBalance(card.usdtBalance)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {overviewQuery.isFetching ? (
                    <div className="text-xs text-slate-400">Loading live wallet balances from RPC...</div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <SummaryMetric label="Deposits" value={String(depositItems.length)} accent="cyan" />
                <SummaryMetric label="Withdraw Success" value={String(successfulWithdrawalItems.length)} accent="amber" />
                <SummaryMetric label="Sponsor Income" value={`$${incomeTotals.sponsor.toFixed(2)}`} accent="emerald" />
                <SummaryMetric label="Direct Income" value={`$${incomeTotals.direct.toFixed(2)}`} accent="violet" />
                <SummaryMetric label="Level Income" value={`$${incomeTotals.level.toFixed(2)}`} accent="sky" />
                <SummaryMetric label="10 Days + Signal" value={`$${(incomeTotals.tenDay + incomeTotals.signal).toFixed(2)}`} accent="pink" />
              </div>

              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <SummaryMetric label="Active Direct" value={String(selectedUser.activeDirectCount ?? 0)} accent="emerald" />
                <SummaryMetric label="Active Team" value={String(selectedUser.activeTeamCount ?? 0)} accent="cyan" />
                <SummaryMetric label="Direct LV1" value={String(selectedUser.directLv1Count ?? 0)} accent="violet" />
                <SummaryMetric
                  label="Qualified Now"
                  value={selectedUser.isCurrentlyQualified ? "Yes" : "No"}
                  accent="amber"
                  description="Yes means the user currently meets the live eligibility rules for level/bonus qualification. No means the user does not currently meet those rules."
                />
                <SummaryMetric label="Last Checked" value={selectedUser.lastCheckedAt ? new Date(selectedUser.lastCheckedAt).toLocaleDateString() : "-"} accent="sky" />
              </div>

              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-[0.3em] text-cyan-200/80">Full transaction details</div>
                  <div className="mt-1 text-sm text-slate-400">Deposits, successful withdrawals, sponsor income, direct income, level income, 10-day income, and signal income in one user timeline.</div>
                </div>
                <div className="text-xs text-slate-400">
                  Combined page {unifiedPagination.page} of {unifiedPagination.totalPages}
                </div>
              </div>

              <div className="space-y-3">
                {(incomeLedgerQuery.isFetching || depositsQuery.isFetching || withdrawalsQuery.isFetching) && (
                  <div className="text-slate-300/80">Loading...</div>
                )}
                {!incomeLedgerQuery.isFetching && !depositsQuery.isFetching && !withdrawalsQuery.isFetching && pagedTransactions.length === 0 && (
                  <div className="text-slate-300/80">No transaction history found.</div>
                )}
                {!incomeLedgerQuery.isFetching && !depositsQuery.isFetching && !withdrawalsQuery.isFetching && pagedTransactions.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] ${item.badgeClass}`}>
                            {item.title}
                          </span>
                          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-300">
                            {item.status}
                          </span>
                        </div>
                        <div className="text-base font-semibold text-white">{item.amountLabel}</div>
                        <div className="grid gap-2 text-xs text-slate-400 lg:grid-cols-2">
                          <div>
                            <div className="uppercase tracking-[0.2em]">{item.primaryMetaLabel}</div>
                            <div className="mt-1 break-all font-mono text-[11px] text-slate-300">{item.primaryMetaValue}</div>
                          </div>
                          <div>
                            <div className="uppercase tracking-[0.2em]">{item.secondaryMetaLabel}</div>
                            <div className="mt-1 break-all font-mono text-[11px] text-slate-300">
                              {item.secondaryMetaHref && item.secondaryMetaValue !== "-" ? (
                                <a
                                  href={item.secondaryMetaHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-cyan-300 underline-offset-2 transition hover:text-cyan-200 hover:underline"
                                >
                                  {item.secondaryMetaValue}
                                </a>
                              ) : (
                                item.secondaryMetaValue
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="uppercase tracking-[0.2em]">{item.tertiaryMetaLabel}</div>
                            <div className="mt-1 break-all text-slate-300">{item.tertiaryMetaValue}</div>
                          </div>
                          <div>
                            <div className="uppercase tracking-[0.2em]">{item.quaternaryMetaLabel}</div>
                            <div className="mt-1 break-all text-slate-300">{item.quaternaryMetaValue}</div>
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-slate-500">
                        {item.timestamp ? new Date(item.timestamp).toLocaleString() : "-"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-slate-400">
                <span>
                  Showing combined page {unifiedPagination.page} of {unifiedPagination.totalPages} - {unifiedPagination.total} total records
                </span>
                <div className="flex gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setTransactionPage((prev) => Math.max(1, prev - 1))}
                    disabled={unifiedPagination.page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => setTransactionPage((prev) => prev + 1)}
                    disabled={unifiedPagination.page >= unifiedPagination.totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function formatIncomeTypeLabel(value?: string) {
  switch (String(value || "").toLowerCase()) {
    case "signal_income":
      return "Signal Income";
    case "direct_sponsor_commission":
      return "Direct Income";
    case "joined_commission":
      return "Sponsor Income";
    case "level_promotion_reward":
      return "Level Income";
    case "level_bonus_10day":
      return "10 Days Once";
    case "admin_adjustment_credit":
      return "admin_deposit";
    case "admin_adjustment_debit":
      return "admin_withdraw";
    default:
      return value || "Income";
  }
}

function SummaryMetric({
  label,
  value,
  accent,
  description,
}: {
  label: string;
  value: string;
  accent: MetricAccent;
  description?: string;
}) {
  const accentMap: Record<MetricAccent, string> = {
    cyan: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200/80",
    amber: "border-amber-400/20 bg-amber-500/10 text-amber-200/80",
    emerald: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200/80",
    violet: "border-violet-400/20 bg-violet-500/10 text-violet-200/80",
    sky: "border-sky-400/20 bg-sky-500/10 text-sky-200/80",
    pink: "border-pink-400/20 bg-pink-500/10 text-pink-200/80",
  };

  return (
    <div className={`rounded-2xl border p-4 ${accentMap[accent]}`} title={description}>
      <div className="flex items-center gap-2">
        <div className="text-[11px] uppercase tracking-[0.24em]">{label}</div>
        {description ? (
          <span
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/15 text-[10px] font-bold text-white/80"
            aria-label={description}
            title={description}
          >
            i
          </span>
        ) : null}
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
    </div>
  );
}

type MetricAccent = "cyan" | "amber" | "emerald" | "violet" | "sky" | "pink";
