import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminUserWalletDeposits, type AdminDepositRecord } from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";
const headerCellCls = "px-3 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-slate-400";
const bodyCellCls = "px-3 py-3 align-top";

function getUserLabel(item: AdminDepositRecord) {
  return item.userEmail?.trim() || `User #${item.userId}`;
}

export default function UserWalletDepositsPage() {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    network: "",
    status: "",
    userId: "",
    txHash: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "user-wallet-deposits", filters],
    queryFn: () =>
      fetchAdminUserWalletDeposits({
        page: filters.page,
        limit: filters.limit,
        network: filters.network || undefined,
        status: filters.status || undefined,
        userId: filters.userId || undefined,
        txHash: filters.txHash || undefined,
      }),
    refetchInterval: 15000,
  });

  const items: AdminDepositRecord[] = data?.items ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 };
  const summary = data?.summary ?? { totalUsdt: "0", totalErc: "0", totalBep: "0", totalTrc: "0" };

  const copyValue = async (value: string) => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue((current) => (current === value ? null : current)), 1500);
  };

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold text-white">User Wallet Deposit</h2>
        <p className="text-sm text-slate-300/80">External user deposits into platform deposit addresses only.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <div className={panelCls}>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Total USDT</div>
          <div className="mt-3 text-3xl font-semibold text-white">{formatAmount(summary.totalUsdt, 2)}</div>
          <div className="mt-1 text-xs text-slate-400">All credited user balances across ERC + BEP + TRC.</div>
        </div>
        <div className={panelCls}>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Total ERC</div>
          <div className="mt-3 text-3xl font-semibold text-white">{formatAmount(summary.totalErc, 2)}</div>
          <div className="mt-1 text-xs text-slate-400">Credited USDT on Ethereum.</div>
        </div>
        <div className={panelCls}>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Total BEP</div>
          <div className="mt-3 text-3xl font-semibold text-white">{formatAmount(summary.totalBep, 2)}</div>
          <div className="mt-1 text-xs text-slate-400">Credited USDT on BSC.</div>
        </div>
        <div className={panelCls}>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Total TRC</div>
          <div className="mt-3 text-3xl font-semibold text-white">{formatAmount(summary.totalTrc, 2)}</div>
          <div className="mt-1 text-xs text-slate-400">Credited USDT on TRON.</div>
        </div>
      </section>

      <section className={panelCls}>
        <div className="grid gap-3 md:grid-cols-5">
          <select className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" value={filters.network} onChange={(event) => setFilters((prev) => ({ ...prev, network: event.target.value, page: 1 }))}>
            <option value="">All networks</option>
            <option value="ethereum">ERC</option>
            <option value="bsc">BEP</option>
            <option value="tron">TRC</option>
          </select>
          <input className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" placeholder="Status" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value, page: 1 }))} />
          <input className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" placeholder="User ID" value={filters.userId} onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value, page: 1 }))} />
          <input className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" placeholder="Search tx hash" value={filters.txHash} onChange={(event) => setFilters((prev) => ({ ...prev, txHash: event.target.value, page: 1 }))} />
          <select className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" value={String(filters.limit)} onChange={(event) => setFilters((prev) => ({ ...prev, limit: Number(event.target.value), page: 1 }))}>
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
        </div>
      </section>

      <section className={panelCls}>
        <div className="overflow-x-auto overflow-y-hidden">
          <div className="min-w-[1320px]">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10">
                <tr>
                  <th className={headerCellCls}>ID</th>
                  <th className={headerCellCls}>Txn ID</th>
                  <th className={headerCellCls}>User</th>
                  <th className={headerCellCls}>Network</th>
                  <th className={headerCellCls}>To Address</th>
                  <th className={headerCellCls}>From Address</th>
                  <th className={headerCellCls}>Tx Hash</th>
                  <th className={headerCellCls}>Amount</th>
                  <th className={headerCellCls}>Status</th>
                  <th className={headerCellCls}>Conf.</th>
                  <th className={headerCellCls}>Created</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-slate-300/80">
                      Loading deposits...
                    </td>
                  </tr>
                )}
                {!isLoading && items.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-slate-300/80">
                      No deposit history found.
                    </td>
                  </tr>
                )}
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-white/5 last:border-b-0">
                    <td className={bodyCellCls}>{item.id}</td>
                    <td className={`${bodyCellCls} break-all text-xs text-cyan-300`}>{item.txn_id || "--"}</td>
                    <td className={bodyCellCls} title={item.userEmail || undefined}>
                      <div className="font-medium text-white">{getUserLabel(item)}</div>
                    </td>
                    <td className={bodyCellCls}>{item.network}</td>
                    <td className={bodyCellCls}>
                      <AddressCell
                        value={item.depositAddress}
                        href={getAddressExplorerUrl(item.networkKey || item.network, item.depositAddress)}
                        copiedValue={copiedValue}
                        onCopy={copyValue}
                      />
                    </td>
                    <td className={bodyCellCls}>
                      <AddressCell
                        value={item.fromAddress || "--"}
                        href={item.fromAddress ? getAddressExplorerUrl(item.networkKey || item.network, item.fromAddress) : undefined}
                        copiedValue={copiedValue}
                        onCopy={copyValue}
                      />
                    </td>
                    <td className={bodyCellCls}>
                      <a href={item.explorerUrl || "#"} target="_blank" rel="noreferrer" className="break-all text-xs text-cyan-300">
                        {item.txHash}
                      </a>
                    </td>
                    <td className={bodyCellCls}>
                      <div className="flex items-center gap-2">
                        <span>{formatAmount(item.amount, 2)}</span>
                        <button
                          type="button"
                          onClick={() => void copyValue(String(item.amount || ""))}
                          className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white hover:bg-white/10"
                        >
                          {copiedValue === String(item.amount || "") ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </td>
                    <td className={`${bodyCellCls} capitalize`}>{item.status}</td>
                    <td className={bodyCellCls}>{item.confirmationCount}</td>
                    <td className={`${bodyCellCls} text-xs text-slate-400`}>{new Date(item.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <span>Page {pagination.page} of {Math.max(pagination.totalPages, 1)}</span>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg border border-white/10 px-3 py-2" disabled={pagination.page <= 1} onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}>Prev</button>
            <button type="button" className="rounded-lg border border-white/10 px-3 py-2" disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages} onClick={() => setFilters((prev) => ({ ...prev, page: Math.min(Math.max(pagination.totalPages, 1), prev.page + 1) }))}>Next</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AddressCell({
  value,
  href,
  copiedValue,
  onCopy,
}: {
  value: string;
  href?: string;
  copiedValue: string | null;
  onCopy: (value: string) => void | Promise<void>;
}) {
  if (!value || value === "--") {
    return <span className="break-all text-xs text-slate-300">--</span>;
  }

  return (
    <div className="flex items-start gap-2">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="min-w-0 flex-1 break-all text-xs text-cyan-300">
          {value}
        </a>
      ) : (
        <span className="min-w-0 flex-1 break-all text-xs text-slate-300">{value}</span>
      )}
      <button
        type="button"
        onClick={() => void onCopy(value)}
        className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white hover:bg-white/10"
      >
        {copiedValue === value ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function formatAmount(value: string | number | undefined, digits = 2) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(amount)
    : "0.00";
}

function getAddressExplorerUrl(network: string | undefined, address: string) {
  const normalized = String(network || "").trim().toLowerCase();
  const trimmedAddress = String(address || "").trim();
  if (!trimmedAddress) return "#";
  if (normalized === "ethereum" || normalized === "erc20" || normalized === "eth") return `https://etherscan.io/address/${trimmedAddress}`;
  if (normalized === "bsc" || normalized === "bep20") return `https://bscscan.com/address/${trimmedAddress}`;
  if (normalized === "tron" || normalized === "trc20") return `https://tronscan.org/#/address/${trimmedAddress}`;
  return "#";
}
