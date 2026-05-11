import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import {
  adminClosePosition,
  adminOpenPosition,
  adminUpdateTriggers,
  fetchAdminFuturesAccount,
  fetchAdminFuturesContracts,
  fetchAdminFuturesPositions,
  fetchAdminFuturesTrades,
} from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";

export default function AdminFuturesOpsPage() {
  const [userId, setUserId] = useState("");
  const [symbol, setSymbol] = useState("");
  const [form, setForm] = useState({
    size: 0,
    leverage: 5,
    side: "LONG",
    stopLoss: "",
    takeProfit: "",
  });
  const queryClient = useQueryClient();

  const contractsQuery = useQuery({
    queryKey: ["admin", "futures", "contracts"],
    queryFn: fetchAdminFuturesContracts,
  });

  const accountQuery = useQuery({
    queryKey: ["admin", "futures", "account", userId],
    queryFn: () => fetchAdminFuturesAccount(userId),
    enabled: Boolean(userId),
  });

  const positionsQuery = useQuery({
    queryKey: ["admin", "futures", "positions", userId],
    queryFn: () => fetchAdminFuturesPositions(userId),
    enabled: Boolean(userId),
  });

  const tradesQuery = useQuery({
    queryKey: ["admin", "futures", "trades", userId],
    queryFn: () => fetchAdminFuturesTrades(userId),
    enabled: Boolean(userId),
  });

  const openMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !symbol) throw new Error("User and symbol required");
      return adminOpenPosition(userId, {
        symbol,
        side: form.side,
        size: Number(form.size),
        leverage: Number(form.leverage),
        stopLoss: form.stopLoss ? Number(form.stopLoss) : undefined,
        takeProfit: form.takeProfit ? Number(form.takeProfit) : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "futures", "positions", userId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "futures", "account", userId] });
    },
  });

  const updateTriggersMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !symbol) throw new Error("User and symbol required");
      return adminUpdateTriggers(userId, {
        symbol,
        stopLoss: form.stopLoss ? Number(form.stopLoss) : undefined,
        takeProfit: form.takeProfit ? Number(form.takeProfit) : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "futures", "positions", userId] });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (payload: { symbol: string }) => {
      if (!userId) throw new Error("User required");
      return adminClosePosition(userId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "futures", "positions", userId] });
      queryClient.invalidateQueries({ queryKey: ["admin", "futures", "account", userId] });
    },
  });

  const handleOpen = (evt: FormEvent) => {
    evt.preventDefault();
    openMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
        <section className={panelCls}>
          <h2 className="text-lg font-semibold text-white mb-3">User Lookup</h2>
          <div className="space-y-3">
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="User ID"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
            />
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
            >
              <option value="">Select contract</option>
              {contractsQuery.data?.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.symbol} ({c.baseAsset})
                </option>
              ))}
            </select>
            {accountQuery.data && (
              <div className="rounded-2xl border border-white/10 px-3 py-2 text-sm text-slate-200">
                <div>Equity: {accountQuery.data.equity}</div>
                <div>Margin used: {accountQuery.data.marginUsed}</div>
                <div>Unrealized PnL: {accountQuery.data.unrealizedPnl}</div>
              </div>
            )}
          </div>
        </section>

        <section className={panelCls}>
          <h2 className="text-lg font-semibold text-white mb-3">Open / manage position</h2>
          <form className="space-y-3" onSubmit={handleOpen}>
            <div className="flex gap-2">
              <select
                value={form.side}
                onChange={(e) => setForm((prev) => ({ ...prev, side: e.target.value }))}
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              >
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
              <input
                type="number"
                step="0.01"
                value={form.size}
                onChange={(e) => setForm((prev) => ({ ...prev, size: Number(e.target.value) }))}
                placeholder="Size"
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={form.leverage}
                onChange={(e) => setForm((prev) => ({ ...prev, leverage: Number(e.target.value) }))}
                placeholder="Leverage"
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <input
                value={form.stopLoss}
                onChange={(e) => setForm((prev) => ({ ...prev, stopLoss: e.target.value }))}
                placeholder="Stop loss"
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              />
              <input
                value={form.takeProfit}
                onChange={(e) => setForm((prev) => ({ ...prev, takeProfit: e.target.value }))}
                placeholder="Take profit"
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              />
            </div>
            {(openMutation.isError || updateTriggersMutation.isError) && (
              <div className="text-sm text-rose-400">
                {(openMutation.error as Error)?.message || (updateTriggersMutation.error as Error)?.message}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={openMutation.isPending}>
                {openMutation.isPending ? "Opening..." : "Open position"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => updateTriggersMutation.mutate()}
                disabled={updateTriggersMutation.isPending}
              >
                {updateTriggersMutation.isPending ? "Updating..." : "Update SL/TP"}
              </Button>
            </div>
          </form>
        </section>
      </div>

      <section className={panelCls}>
        <h3 className="text-lg font-semibold text-white mb-3">Open positions</h3>
        {positionsQuery.isFetching && <div className="text-sm text-slate-300/80">Loading...</div>}
        <div className="space-y-2">
          {positionsQuery.data?.map((pos) => (
            <div key={pos.id ?? `${pos.symbol}-${pos.side}`} className="rounded-2xl border border-white/10 px-4 py-3 flex items-center justify-between text-sm">
              <div>
                <div className="font-semibold text-white">{pos.symbol}</div>
                <div className="text-xs text-slate-400">
                  {pos.side} - size {pos.size} @ {pos.entryPrice}
                </div>
              </div>
              <Button size="xs" variant="danger" onClick={() => closeMutation.mutate({ symbol: pos.symbol })}>
                Force close
              </Button>
            </div>
          ))}
          {!positionsQuery.isFetching && !positionsQuery.data?.length && (
            <div className="text-sm text-slate-300/80">No positions for this user.</div>
          )}
        </div>
      </section>

      <section className={panelCls}>
        <h3 className="text-lg font-semibold text-white mb-3">Recent trades</h3>
        <div className="space-y-2 text-sm max-h-64 overflow-auto">
          {tradesQuery.data?.map((trade) => (
            <div key={trade.id} className="rounded-2xl border border-white/10 px-4 py-2 flex items-center justify-between">
              <span>
                {trade.symbol} - {trade.side}
              </span>
              <span>
                {trade.price} / {trade.qty}
              </span>
              <span className="text-xs text-slate-400">{new Date(trade.timestamp).toLocaleString()}</span>
            </div>
          ))}
          {!tradesQuery.data?.length && <div className="text-sm text-slate-300/80">No trades found.</div>}
        </div>
      </section>
    </div>
  );
}
