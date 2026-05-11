import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminDeposits, type AdminDepositRecord } from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";

export default function AdminDepositsPage() {
  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    network: "",
    status: "",
    userId: "",
    txHash: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "deposits", filters],
    queryFn: () =>
      fetchAdminDeposits({
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

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold text-white">Admin Deposits</h2>
        <p className="text-sm text-slate-300/80">User deposit records across ERC, BEP, and TRC networks.</p>
      </header>

      <section className={panelCls}>
        <div className="grid gap-3 md:grid-cols-5">
          <select
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            value={filters.network}
            onChange={(event) => setFilters((prev) => ({ ...prev, network: event.target.value, page: 1 }))}
          >
            <option value="">All networks</option>
            <option value="ethereum">ERC</option>
            <option value="bsc">BEP</option>
            <option value="tron">TRC</option>
          </select>
          <input
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            placeholder="Status"
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value, page: 1 }))}
          />
          <input
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            placeholder="User ID"
            value={filters.userId}
            onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value, page: 1 }))}
          />
          <input
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            placeholder="Search tx hash"
            value={filters.txHash}
            onChange={(event) => setFilters((prev) => ({ ...prev, txHash: event.target.value, page: 1 }))}
          />
          <select
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            value={String(filters.limit)}
            onChange={(event) => setFilters((prev) => ({ ...prev, limit: Number(event.target.value), page: 1 }))}
          >
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
        </div>
      </section>

      <section className={panelCls}>
        <div className="overflow-x-auto overflow-y-hidden">
          <div className="min-w-[1320px]">
            <div className="grid grid-cols-[70px_80px_80px_1fr_1fr_1fr_110px_120px_90px_140px] gap-2 border-b border-white/10 pb-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
              <span>ID</span>
              <span>User</span>
              <span>Network</span>
              <span>Deposit Address</span>
              <span>From</span>
              <span>Tx Hash</span>
              <span>Amount</span>
              <span>Status</span>
              <span>Conf.</span>
              <span>Created</span>
            </div>
            <div className="space-y-2 pt-3 text-sm">
              {isLoading && <div className="text-slate-300/80">Loading deposits...</div>}
              {!isLoading &&
                items.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[70px_80px_80px_1fr_1fr_1fr_110px_120px_90px_140px] gap-2 rounded-2xl border border-white/10 px-3 py-3"
                  >
                    <span>{item.id}</span>
                    <span>{item.userId}</span>
                    <span>{item.network}</span>
                    <span className="break-all text-xs text-slate-300">{item.depositAddress}</span>
                    <span className="break-all text-xs text-slate-300">{item.fromAddress || "--"}</span>
                    <a href={item.explorerUrl || "#"} target="_blank" rel="noreferrer" className="break-all text-xs text-cyan-300">
                      {item.txHash}
                    </a>
                    <span>{item.amount}</span>
                    <span className="capitalize">{item.status}</span>
                    <span>{item.confirmationCount}</span>
                    <span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              {!isLoading && items.length === 0 && <div className="text-slate-300/80">No deposits found.</div>}
            </div>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <span>
            Page {pagination.page} of {Math.max(pagination.totalPages, 1)}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2"
              disabled={pagination.page <= 1}
              onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2"
              disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages}
              onClick={() =>
                setFilters((prev) => ({
                  ...prev,
                  page: Math.min(Math.max(pagination.totalPages, 1), prev.page + 1),
                }))
              }
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
