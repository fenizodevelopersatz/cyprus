import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import { fetchAdminTreasury, runEligibleSweeps, runPendingGasFunding, triggerAdminTreasurySweep } from "../api/admin.api";
import { formatMoneyWithSymbol } from "../../../utils/money";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";

export default function AdminTreasuryPage() {
  const queryClient = useQueryClient();
  const [network, setNetwork] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "treasury"],
    queryFn: () => fetchAdminTreasury(),
    refetchInterval: 15000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "treasury"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "sweep-queue"] });
    queryClient.invalidateQueries({ queryKey: ["admin", "gas-funding-queue"] });
  };

  const legacySweepMutation = useMutation({
    mutationFn: async () => triggerAdminTreasurySweep(network ? { network } : undefined),
    onSuccess: refresh,
  });

  const queueSweepMutation = useMutation({
    mutationFn: async () => runEligibleSweeps(network ? { network } : undefined),
    onSuccess: refresh,
  });

  const gasFundingMutation = useMutation({
    mutationFn: async () => runPendingGasFunding(network ? { network } : undefined),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold text-white">Treasury Overview</h2>
        <p className="text-sm text-slate-300/80">Admin treasury balances, queued custodial sweeps, and gas-funding operations.</p>
      </header>

      <section className="grid gap-4 md:grid-cols-3">
        {(data?.custodial?.wallets ?? []).map((wallet) => (
          <div key={wallet.network} className={panelCls}>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{wallet.network}</div>
            <div className="mt-2 break-all text-sm text-slate-200">{wallet.address || "--"}</div>
            <div className="mt-4 text-2xl font-semibold text-white">{formatMoneyWithSymbol(wallet.usdtBalance)}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className={panelCls}>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Pending Sweeps</div>
          <div className="mt-3 text-3xl font-semibold text-white">{data?.custodial?.pendingSweeps ?? 0}</div>
          <div className="mt-1 text-xs text-slate-400">Queue rows waiting for gas or sweep execution.</div>
        </div>
        <div className={panelCls}>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Pending Gas Top-ups</div>
          <div className="mt-3 text-3xl font-semibold text-white">{data?.custodial?.pendingGasTopups ?? 0}</div>
          <div className="mt-1 text-xs text-slate-400">Native-asset funding rows not fully confirmed yet.</div>
        </div>
        <div className={panelCls}>
          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Legacy Sweep Runs</div>
          <div className="mt-3 text-3xl font-semibold text-white">{data?.sweepStatus?.sweepCount ?? 0}</div>
          <div className="mt-1 text-xs text-slate-400">Older treasury sweep counter kept for compatibility.</div>
        </div>
      </section>

      <section className={panelCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Operations</div>
            <div className="mt-2 text-xs text-slate-400">
              Last legacy sweep: {data?.sweepStatus?.lastSweepTime ? new Date(data.sweepStatus.lastSweepTime).toLocaleString() : "--"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
              value={network}
              onChange={(event) => setNetwork(event.target.value)}
            >
              <option value="">All networks</option>
              <option value="ethereum">Ethereum</option>
              <option value="bsc">BSC</option>
              <option value="tron">TRON</option>
            </select>
            <Button onClick={() => queueSweepMutation.mutate()} disabled={queueSweepMutation.isPending}>
              {queueSweepMutation.isPending ? "Queueing..." : "Run Eligible Sweeps"}
            </Button>
            <Button variant="secondary" onClick={() => gasFundingMutation.mutate()} disabled={gasFundingMutation.isPending}>
              {gasFundingMutation.isPending ? "Confirming..." : "Run Pending Gas"}
            </Button>
            <Button variant="secondary" onClick={() => legacySweepMutation.mutate()} disabled={legacySweepMutation.isPending}>
              {legacySweepMutation.isPending ? "Sweeping..." : "Legacy Sweep"}
            </Button>
          </div>
        </div>
        {isLoading && <div className="mt-3 text-sm text-slate-300/80">Loading treasury...</div>}
      </section>
    </div>
  );
}
