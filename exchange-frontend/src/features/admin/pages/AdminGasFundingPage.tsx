import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  fetchAdminGasFundingQueue,
  type AdminGasFundingRecord,
} from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";

export default function AdminGasFundingPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    page: 1,
    limit: 100,
    network: searchParams.get("network") || "",
    status: "",
    userId: "",
  });
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "gas-funding-queue", filters],
    queryFn: () =>
      fetchAdminGasFundingQueue({
        page: filters.page,
        limit: filters.limit,
        network: filters.network || undefined,
        status: filters.status || undefined,
        userId: filters.userId || undefined,
      }),
    refetchInterval: 15000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "gas-funding-queue"] });
  };

  const items: AdminGasFundingRecord[] = data?.items ?? [];
  const pagination = data?.pagination ?? { page: 1, limit: 20, total: 0, totalPages: 0 };
  const gasStats = useMemo(() => {
    const totals = {
      ethereum: 0,
      bsc: 0,
      tron: 0,
      total: 0,
    };
    for (const item of items) {
      const amount = Number(item.amountDecimal || 0);
      const safeAmount = Number.isFinite(amount) ? amount : 0;
      const network = String(item.network || "").toLowerCase();
      totals.total += safeAmount;
      if (network === "ethereum") totals.ethereum += safeAmount;
      if (network === "bsc") totals.bsc += safeAmount;
      if (network === "tron") totals.tron += safeAmount;
    }
    return totals;
  }, [items]);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold text-white">Admin Gas History</h2>
        <p className="text-sm text-slate-300/80">Read-only history of native gas top-ups sent from admin wallets before sweep execution. Admin Wallet to User Wallet. </p>
      </header>

      <section className={panelCls}>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">ERC-20 Gas</div>
            <div className="mt-2 text-2xl font-semibold text-white">{gasStats.ethereum.toFixed(6)} ETH</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">BEB-20 Gas</div>
            <div className="mt-2 text-2xl font-semibold text-white">{gasStats.bsc.toFixed(6)} BNB</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">TRC-20 Gas</div>
            <div className="mt-2 text-2xl font-semibold text-white">{gasStats.tron.toFixed(6)} TRX</div>
          </div>          
        </div>
      </section>

      <section className={panelCls}>
        <div className="grid gap-3 md:grid-cols-4">
          <select className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" value={filters.network} onChange={(event) => setFilters((prev) => ({ ...prev, network: event.target.value, page: 1 }))}>
            <option value="">All networks</option>
            <option value="ethereum">Ethereum</option>
            <option value="bsc">BSC</option>
            <option value="tron">TRON</option>
          </select>
          <input className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" placeholder="Status" value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value, page: 1 }))} />
          <input className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" placeholder="User ID" value={filters.userId} onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value, page: 1 }))} />
          <select className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white" value={String(filters.limit)} onChange={(event) => setFilters((prev) => ({ ...prev, limit: Number(event.target.value), page: 1 }))}>
            <option value="20">20 / page</option>
            <option value="50">50 / page</option>
            <option value="100">100 / page</option>
          </select>
        </div>
      </section>

      <section className={panelCls}>
        <div className="grid grid-cols-[70px_80px_90px_1fr_1fr_110px_120px_1fr_1fr] gap-2 border-b border-white/10 pb-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
          <span>ID</span>
          <span>User</span>
          <span>Network</span>
          <span>Admin Wallet</span>
          <span>User Wallet</span>
          <span>Amount</span>
          <span>Status</span>
          <span>Tx Hash</span>
          <span>Updated</span>
        </div>
        <div className="space-y-2 pt-3 text-sm">
          {isLoading && <div className="text-slate-300/80">Loading gas funding queue...</div>}
          {!isLoading && items.map((item) => (
            <div key={item.id} className="grid grid-cols-[70px_80px_90px_1fr_1fr_110px_120px_1fr_1fr] gap-2 rounded-2xl border border-white/10 px-3 py-3">
              <span>{item.id}</span>
              <span>{item.userId}</span>
              <span className="capitalize">{item.network}</span>
              <span className="break-all text-xs text-slate-300">{item.sourceAdminWalletAddress}</span>
              <span className="break-all text-xs text-slate-300">{item.destinationUserWalletAddress}</span>
              <span>{item.amountDecimal} {item.gasAsset}</span>
              <span className="capitalize">{item.status}</span>
              <span className="break-all text-xs text-cyan-300">{item.txHash || item.errorMessage || "--"}</span>
              <span className="text-xs text-slate-400">{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "--"}</span>
            </div>
          ))}
          {!isLoading && items.length === 0 && <div className="text-slate-300/80">No gas funding rows found.</div>}
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
