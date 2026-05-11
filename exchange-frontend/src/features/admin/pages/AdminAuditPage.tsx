import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminAuditLogs } from "../api/admin.api";
import Button from "../../../ui/Button";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";

export default function AdminAuditPage() {
  const [limit, setLimit] = useState(25);
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["admin", "audit", limit],
    queryFn: () => fetchAdminAuditLogs(limit),
    refetchInterval: 45_000,
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-white">Audit log</h2>
          <p className="text-sm text-slate-300/80">Track every admin action for compliance.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <input
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-24 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
            min={5}
            max={200}
          />
          <Button size="sm" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </header>

      <section className={panelCls}>
        {isFetching && <div className="text-sm text-slate-300/80">Fetching logs...</div>}
        <div className="space-y-3 text-sm max-h-[520px] overflow-auto">
          {data?.map((log) => (
            <div key={log.id} className="rounded-2xl border border-white/10 px-4 py-3">
              <div className="text-xs text-slate-400">{new Date(log.createdAt).toLocaleString()}</div>
              <div className="text-white font-semibold">{log.actor}</div>
              <div className="text-slate-200">
                {log.action} {log.target ? `-> ${log.target}` : ""}
              </div>
              {log.metadata && (
                <pre className="mt-2 rounded-2xl bg-black/30 p-2 text-[11px] text-emerald-200">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              )}
            </div>
          ))}
          {!data?.length && <div className="text-sm text-slate-300/80">No audit entries returned.</div>}
        </div>
      </section>
    </div>
  );
}
