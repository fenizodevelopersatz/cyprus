import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import { API_BASE_URL } from "../../../app/apiRoutes";
import {
  fetchAdminManualCronJobs,
  fetchAdminUsers,
  runAdminManualCronJob,
  type AdminManualCronJob,
  type AdminManualCronRunResponse,
  type AdminUser,
} from "../api/admin.api";

const cardCls = "rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_20px_60px_-35px_rgba(0,0,0,0.55)]";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 py-3 text-sm last:border-b-0">
      <div className="text-slate-400">{label}</div>
      <div className="max-w-[65%] break-words text-right text-white">{value || "—"}</div>
    </div>
  );
}

export default function AdminUserLookupPage() {
  const [searchInput, setSearchInput] = useState("");
  const [email, setEmail] = useState("");
  const [cronResponses, setCronResponses] = useState<Record<string, AdminManualCronRunResponse | null>>({});
  const [networkSelections, setNetworkSelections] = useState<Record<string, "all" | "ethereum" | "bsc" | "tron">>({
    deposit_monitor: "all",
    user_wallet_live_balance_scan: "all",
  });

  const query = useQuery({
    queryKey: ["admin", "hidden-user-lookup", email],
    queryFn: () => fetchAdminUsers({ search: email, page: 1, limit: 25 }),
    enabled: Boolean(email.trim()),
  });

  const cronJobsQuery = useQuery({
    queryKey: ["admin", "manual-cron-jobs"],
    queryFn: fetchAdminManualCronJobs,
  });

  const runCronMutation = useMutation({
    mutationFn: async (job: AdminManualCronJob) => {
      const selectedNetwork = networkSelections[job.key] ?? "all";
      const payload =
        "network" in (job.samplePayload || {})
          ? selectedNetwork === "all"
            ? {}
            : { network: selectedNetwork }
          : job.samplePayload;
      const response = await runAdminManualCronJob(job.key, payload);
      return { jobKey: job.key, response };
    },
    onSuccess: ({ jobKey, response }) => {
      setCronResponses((prev) => ({ ...prev, [jobKey]: response }));
    },
  });

  const matchedUser = (query.data?.items ?? []).find(
    (item) => String(item.email || "").trim().toLowerCase() === email.trim().toLowerCase()
  );
  const runningJobKey = runCronMutation.variables?.key ?? null;
  const cronJobs = cronJobsQuery.data ?? [];
  const flowLabel = "The flow under test is: /admin/internal/user-lookup -> click a manual cron button -> backend cron-like job runs and the response payload is shown on the page.";
  const baseOrigin = useMemo(() => API_BASE_URL.replace(/\/+$/, ""), []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setEmail(searchInput.trim());
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs uppercase tracking-[0.32em] text-slate-400">Admin Internal</div>
        <h1 className="mt-2 text-3xl font-semibold text-white">User Lookup</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Admin-only lookup for stored user profile details. This page intentionally does not expose password hashes or any credential secrets.
        </p>
        <p className="mt-2 max-w-3xl text-xs text-slate-500">{flowLabel}</p>
      </div>

      <section className={cardCls}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-slate-400">Developer Cron Testing</div>
            <h2 className="mt-1 text-xl font-semibold text-white">Manual Cron Jobs</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Trigger cron-like backend jobs on demand for internal developer testing. Each button uses the sample payload shown in the card.
            </p>
          </div>
          <div className="rounded-full border border-amber-400/20 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-amber-200">
            Admin Testing Only
          </div>
        </div>

        {cronJobsQuery.isLoading ? <div className="mt-4 text-sm text-slate-300">Loading manual cron jobs...</div> : null}
        {cronJobsQuery.isError ? <div className="mt-4 text-sm text-rose-200">Failed to load manual cron jobs.</div> : null}

        {cronJobs.length ? (
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {cronJobs.map((job) => {
              const response = cronResponses[job.key];
              const fullUrl = `${baseOrigin}${job.path}`;
              const isRunning = runCronMutation.isPending && runningJobKey === job.key;
              const selectedNetwork = networkSelections[job.key] ?? "all";
              const supportsNetworkSelection = "network" in (job.samplePayload || {});
              const visiblePayload =
                supportsNetworkSelection
                  ? selectedNetwork === "all"
                    ? {}
                    : { network: selectedNetwork }
                  : job.samplePayload;

              return (
                <article key={job.key} className="rounded-2xl border border-white/10 bg-[#0f1724]/80 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{job.label}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{job.key}</div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => runCronMutation.mutate(job)}
                      disabled={runCronMutation.isPending}
                    >
                      {isRunning ? "Running..." : "Run Now"}
                    </Button>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-300">{job.description}</p>

                  <div className="mt-4 space-y-3 text-xs">
                    {supportsNetworkSelection ? (
                      <div>
                        <div className="mb-1 uppercase tracking-[0.18em] text-slate-500">Network</div>
                        <select
                          value={selectedNetwork}
                          onChange={(event) =>
                            setNetworkSelections((current) => ({
                              ...current,
                              [job.key]: event.target.value as "all" | "ethereum" | "bsc" | "tron",
                            }))
                          }
                          className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-slate-200 outline-none"
                        >
                          <option value="all">All networks</option>
                          <option value="ethereum">Ethereum</option>
                          <option value="bsc">BSC</option>
                          <option value="tron">TRON</option>
                        </select>
                      </div>
                    ) : null}

                    <div>
                      <div className="mb-1 uppercase tracking-[0.18em] text-slate-500">URL</div>
                      <div className="break-all rounded-xl border border-white/10 bg-black/20 px-3 py-2 font-mono text-slate-200">
                        {fullUrl}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 uppercase tracking-[0.18em] text-slate-500">Payload</div>
                      <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-slate-200">
                        {JSON.stringify(visiblePayload, null, 2)}
                      </pre>
                    </div>

                    {response ? (
                      <div>
                        <div className="mb-1 uppercase tracking-[0.18em] text-slate-500">Last Response</div>
                        <pre className="overflow-x-auto rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-emerald-100">
                          {JSON.stringify(response, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {runCronMutation.isError ? (
          <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {runCronMutation.error instanceof Error ? runCronMutation.error.message : "Failed to run manual cron job."}
          </div>
        ) : null}
      </section>

      <form onSubmit={handleSubmit} className={`${cardCls} flex flex-col gap-3 sm:flex-row sm:items-end`}>
        <div className="flex-1">
          <label className="mb-2 block text-xs uppercase tracking-[0.2em] text-slate-400">Email</label>
          <Input
            type="email"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="user@example.com"
            className="!border-white/10"
          />
        </div>
        <Button type="submit" className="sm:min-w-[160px]">
          Find User
        </Button>
      </form>

      {query.isFetching ? (
        <div className={`${cardCls} text-sm text-slate-300`}>Loading user details...</div>
      ) : null}

      {email && !query.isFetching && !matchedUser ? (
        <div className={`${cardCls} text-sm text-amber-200`}>No user matched `{email}`.</div>
      ) : null}

      {matchedUser ? <UserDetailCard user={matchedUser} /> : null}
    </div>
  );
}

function UserDetailCard({ user }: { user: AdminUser }) {
  return (
    <section className={cardCls}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.24em] text-slate-400">User Record</div>
          <div className="mt-1 text-xl font-semibold text-white">{user.displayName || user.name || user.email}</div>
        </div>
        <div className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-200">
          Admin Only
        </div>
      </div>

      <DetailRow label="User ID" value={String(user.id)} />
      <DetailRow label="Email" value={String(user.email || "")} />
      <DetailRow label="Display Name" value={String(user.displayName || user.name || "")} />
      <DetailRow label="Country" value={String(user.country || "")} />
      <DetailRow label="Status" value={String(user.status || "")} />
      <DetailRow label="Tier" value={String(user.tier || "")} />
      <DetailRow label="Roles" value={Array.isArray(user.roles) && user.roles.length ? user.roles.join(", ") : ""} />
      <DetailRow label="Has Password" value={user.hasPassword ? "Yes" : "No"} />
      <DetailRow label="Password Changed" value={String(user.passwordChangedAt || "")} />
      <DetailRow label="Google Linked" value={user.googleAuthConfigured ? "Yes" : "No"} />
      <DetailRow label="Two-Factor Enabled" value={user.twoFactorEnabled ? "Yes" : "No"} />
      <DetailRow label="KYC Verified" value={user.kycVerified ? "Yes" : "No"} />
      <DetailRow label="KYC Level" value={user.kycLevel !== null && user.kycLevel !== undefined ? String(user.kycLevel) : ""} />
      <DetailRow label="Current Level" value={String(user.currentLevelCode || "")} />
      <DetailRow label="Current Level Rank" value={user.currentLevelRank !== null && user.currentLevelRank !== undefined ? String(user.currentLevelRank) : ""} />
      <DetailRow label="Created At" value={String(user.createdAt || "")} />
      <DetailRow label="Last Active At" value={String(user.lastActiveAt || "")} />
    </section>
  );
}
