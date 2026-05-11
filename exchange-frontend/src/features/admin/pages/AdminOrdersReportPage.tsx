import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Input from "../../../ui/Input";
import Button from "../../../ui/Button";
import {
  fetchAdminLiveOrders,
  fetchAdminRecentOrders,
  fetchAdminRecentTrades,
  type AdminOrder,
  type AdminTrade,
} from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-5";
const STATUS_OPTIONS = ["", "NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "EXPIRED", "REJECTED"];
const LIMIT_OPTIONS = [25, 50, 100, 250, 500];

const badgeCls = (status: string) => {
  const normalized = status?.toLowerCase();
  if (normalized === "new" || normalized === "partially_filled") return "bg-amber-500/15 text-amber-100 border border-amber-400/30";
  if (normalized === "filled") return "bg-emerald-500/15 text-emerald-100 border border-emerald-400/30";
  if (normalized === "canceled" || normalized === "rejected" || normalized === "expired") return "bg-rose-500/15 text-rose-100 border border-rose-400/30";
  return "bg-slate-500/15 text-slate-200 border border-white/10";
};

const formatNumber = (value: number | undefined, fractionDigits = 4) => {
  if (value === undefined || value === null) return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: fractionDigits });
};

const userLabel = (order: { user?: { email?: string | null; displayName?: string | null; country?: string | null }; userId?: string | number }) => {
  if (!order.user) return `User #${order.userId}`;
  return order.user.displayName ?? order.user.email ?? `User #${order.userId}`;
};

export default function AdminOrdersReportPage() {
  const [filters, setFilters] = useState({ search: "", symbol: "", status: "", userId: "", limit: 50 });

  const normalizedFilters = useMemo(() => {
    const symbol = filters.symbol.trim();
    const search = filters.search.trim();
    const userId = filters.userId.trim();
    return {
      limit: filters.limit || undefined,
      search: search || undefined,
      symbol: symbol || undefined,
      status: filters.status || undefined,
      userId: userId || undefined,
    };
  }, [filters]);

  const tradeFilters = useMemo(() => {
    const { status, ...rest } = normalizedFilters;
    return rest;
  }, [normalizedFilters]);

  const liveQuery = useQuery<AdminOrder[]>({
    queryKey: ["admin", "orders", "live", normalizedFilters],
    queryFn: () => fetchAdminLiveOrders(normalizedFilters),
  });
  const recentQuery = useQuery<AdminOrder[]>({
    queryKey: ["admin", "orders", "recent", normalizedFilters],
    queryFn: () => fetchAdminRecentOrders(normalizedFilters),
  });
  const tradesQuery = useQuery<AdminTrade[]>({
    queryKey: ["admin", "orders", "trades", tradeFilters],
    queryFn: () => fetchAdminRecentTrades(tradeFilters),
  });

  const onFilterChange = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <section className={panelCls}>
        <div className="mb-4">
          <h2 className="text-xl font-semibold text-white">Orders report</h2>
          <p className="text-sm text-slate-300/80">Monitor open interest, recent fills, and per-user activity in real time.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-5">
          <Input
            placeholder="Search email, name..."
            value={filters.search}
            onChange={(e) => onFilterChange("search", e.target.value)}
            className="lg:col-span-2"
          />
          <Input placeholder="Symbol (e.g. BTCUSDT)" value={filters.symbol} onChange={(e) => onFilterChange("symbol", e.target.value.toUpperCase())} />
          <Input placeholder="User ID" value={filters.userId} onChange={(e) => onFilterChange("userId", e.target.value)} />
          <select
            value={filters.status}
            onChange={(e) => onFilterChange("status", e.target.value)}
            className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt || "all"} value={opt}>
                {opt ? opt : "All statuses"}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-300">
          <label className="flex items-center gap-2">
            Limit:
            <select
              value={filters.limit}
              onChange={(e) => onFilterChange("limit", Number(e.target.value))}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white"
            >
              {LIMIT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="secondary" onClick={() => { liveQuery.refetch(); recentQuery.refetch(); tradesQuery.refetch(); }}>
            Refresh feeds
          </Button>
          {(liveQuery.isFetching || recentQuery.isFetching || tradesQuery.isFetching) && (
            <span className="text-xs text-emerald-200">Fetching latest data...</span>
          )}
        </div>
        {(liveQuery.error || recentQuery.error || tradesQuery.error) && (
          <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-100">
            Unable to load one or more feeds. Verify your admin session and try again.
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <OrdersPanel title="Live open orders" data={liveQuery.data ?? []} loading={liveQuery.isFetching && !(liveQuery.data && liveQuery.data.length)}>
          <OrdersTable orders={liveQuery.data ?? []} emptyLabel="No active orders match your filters." />
        </OrdersPanel>
        <OrdersPanel title="Recent order history" data={recentQuery.data ?? []} loading={recentQuery.isFetching && !(recentQuery.data && recentQuery.data.length)}>
          <OrdersTable orders={recentQuery.data ?? []} emptyLabel="No recent orders returned." />
        </OrdersPanel>
      </div>

      <section className={panelCls}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Latest trades</h3>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Trade feed (fills widget)</p>
          </div>
          <span className="text-xs text-slate-400">{(tradesQuery.data ?? []).length} items</span>
        </div>
        {tradesQuery.isFetching && !(tradesQuery.data && tradesQuery.data.length) ? (
          <div className="text-sm text-slate-300/80">Loading trades...</div>
        ) : (
          <TradesTable trades={tradesQuery.data ?? []} emptyLabel="No trades returned for this filter." />
        )}
      </section>
    </div>
  );
}

type OrdersPanelProps = {
  title: string;
  data: AdminOrder[];
  loading: boolean;
  children: ReactNode;
};

function OrdersPanel({ title, data, loading, children }: OrdersPanelProps) {
  return (
    <section className={panelCls}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <span className="text-xs text-slate-400">{data.length} items</span>
      </div>
      {loading ? <div className="text-sm text-slate-300/80">Loading data...</div> : children}
    </section>
  );
}

function OrdersTable({ orders, emptyLabel }: { orders: AdminOrder[]; emptyLabel: string }) {
  if (!orders.length) {
    return <div className="text-sm text-slate-400">{emptyLabel}</div>;
  }

  return (
    <div className="overflow-auto rounded-2xl border border-white/5">
      <table className="min-w-full divide-y divide-white/5 text-sm">
        <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
          <tr>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2">Side/type</th>
            <th className="px-3 py-2">Qty / Filled</th>
            <th className="px-3 py-2">Price</th>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-slate-200">
          {orders.map((order) => (
            <tr key={`${order.id}-${order.updatedAt ?? order.createdAt}`}>
              <td className="px-3 py-2 font-semibold text-white">{order.symbol}</td>
              <td className="px-3 py-2 text-xs text-slate-300">
                <div className="font-semibold text-white">{order.side}</div>
                <div className="text-slate-400">{order.type}</div>
              </td>
              <td className="px-3 py-2 text-xs">
                {formatNumber(order.qty)} /{" "}
                <span className="text-slate-400">{formatNumber(order.filled)}</span>
              </td>
              <td className="px-3 py-2 text-xs">{formatNumber(order.price, 6)}</td>
              <td className="px-3 py-2 text-xs">
                <div className="font-medium text-white">{userLabel(order)}</div>
                <div className="text-slate-400 text-[11px]">{order.user?.email}</div>
              </td>
              <td className="px-3 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${badgeCls(order.status)}`}>{order.status}</span>
              </td>
              <td className="px-3 py-2 text-xs">
                <div>{new Date(order.createdAt).toLocaleString()}</div>
                {order.updatedAt && <div className="text-slate-400 text-[11px]">upd {new Date(order.updatedAt).toLocaleTimeString()}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradesTable({ trades, emptyLabel }: { trades: AdminTrade[]; emptyLabel: string }) {
  if (!trades.length) {
    return <div className="text-sm text-slate-400">{emptyLabel}</div>;
  }

  return (
    <div className="overflow-auto rounded-2xl border border-white/5">
      <table className="min-w-full divide-y divide-white/5 text-sm">
        <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
          <tr>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2">Side</th>
            <th className="px-3 py-2">Qty</th>
            <th className="px-3 py-2">Price</th>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">Time</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-slate-200">
          {trades.map((trade) => (
            <tr key={trade.id}>
              <td className="px-3 py-2 font-semibold text-white">{trade.symbol}</td>
              <td className="px-3 py-2 text-xs">{trade.side}</td>
              <td className="px-3 py-2 text-xs">{formatNumber(trade.qty)}</td>
              <td className="px-3 py-2 text-xs">{formatNumber(trade.price, 6)}</td>
              <td className="px-3 py-2 text-xs">
                <div className="font-medium text-white">{userLabel(trade)}</div>
                <div className="text-[11px] text-slate-400">{trade.user?.email}</div>
              </td>
              <td className="px-3 py-2 text-xs">{new Date(trade.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

