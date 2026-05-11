import { useEffect, useState } from "react";
import api from "../../../app/axios";
import { ADMIN_ENDPOINTS } from "../../../app/apiRoutes";
import Button from "../../../ui/Button";

type TestResult = {
  run: {
    id: number;
    mode: string;
    config: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  users: Array<{
    id: number;
    testUserNo: number;
    email: string;
    phone: string;
    fullName: string;
    sponsorId: number | null;
    depth: number;
    status: string;
    wallet: string;
    individualBalance: string;
    downlineTotalBalance: string;
    eligibleTeamBalance: string;
    minimumEligibleTeamBalance: string;
    directTotalBalance: string;
    directTotalMembers: number;
    directEligibleMembers: number;
    teamTotalMembers: number;
    teamEligibleMembers: number;
    achievedLevel: string | null;
    nextLevelPossible: string | null;
    promotionRewardApplicable: boolean;
    bonusEligible: boolean;
    simulatedPromotionReward: string;
    simulatedBonusAmount: string;
    depositHistory: Array<{
      id: number;
      amount: string;
      txRef: string;
      createdAt: string;
    }>;
    bonusPayoutHistory: Array<{
      id: number;
      levelCode: string;
      eligibleBalance: string;
      eligibleMembers: number;
      qualifiedDirectMembers: number;
      actualEligibleBalance: string;
      minimumEligibleBalance: string;
      payoutEligibleBalance: string;
      bonusBase: string;
      payoutAmount: string;
      status: string;
      createdAt: string;
    }>;
  }>;
};

const formatAmount = (value: string | number | null | undefined) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
};

const initialForm = {
  totalUsers: 100,
  maxTreeDepth: 3,
  maxDirectChildren: 4,
  activeRatio: 70,
  minDeposit: 1,
  maxDeposit: 600,
  minimumEligibleBalance: 300,
  minimumGuaranteedEligibleUsers: 10,
  mode: "basic",
};

export default function AdminMlmTestToolPage() {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState<TestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normaliseResult = (payload: any): TestResult | null => {
    const raw = payload?.data ?? payload ?? null;
    if (!raw || !raw.run) return null;
    return {
      run: raw.run,
      users: Array.isArray(raw.users) ? raw.users : [],
    };
  };

  const loadLatest = async () => {
    try {
      const { data } = await api.get(ADMIN_ENDPOINTS.devMlmTest.results());
      setResult(normaliseResult(data));
    } catch {
      setResult(null);
    }
  };

  useEffect(() => {
    void loadLatest();
  }, []);

  const runAction = async (request: Promise<any>) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await request;
      setResult(normaliseResult(data));
    } catch (err: any) {
      setError(err?.response?.data?.message ?? err?.message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  };

  const treeRows = result?.users ?? [];
  const currentRunId = result?.run?.id ?? null;
  const currentRunMode = result?.run?.mode ?? null;
  const sortedTreeRows = treeRows.slice().sort((a, b) => a.depth - b.depth || a.testUserNo - b.testUserNo);
  const eligibleUsers = treeRows.filter((user) => Number(user.individualBalance) >= form.minimumEligibleBalance && user.status === "active").length;
  const totalSeededBalance = treeRows.reduce((sum, user) => sum + Number(user.individualBalance || 0), 0);

  return (
    <div className="space-y-6 text-slate-100">
      <header>
        <div className="text-[11px] uppercase tracking-[0.26em] text-emerald-300/80">Dev Only</div>
        <h2 className="text-2xl font-semibold text-white">MLM Testing Tool</h2>
        <p className="text-sm text-slate-300/80">
          Separate test-only generator for referral tree, deposits, level eligibility, and reward simulation.
        </p>
      </header>

      {error && <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>}

      <section className="grid gap-4 rounded-3xl border border-white/10 bg-white/5 p-5 md:grid-cols-4">
        {[
          ["totalUsers", "Total Users"],
          ["maxTreeDepth", "Max Depth"],
          ["maxDirectChildren", "Max Direct Children"],
          ["activeRatio", "Active Ratio %"],
          ["minDeposit", "Min Deposit"],
          ["maxDeposit", "Max Deposit"],
          ["minimumEligibleBalance", "Minimum Eligible Balance"],
          ["minimumGuaranteedEligibleUsers", "Min Users Above Eligible"],
        ].map(([key, label]) => (
          <label key={key} className="text-sm text-slate-300">
            <span className="mb-2 block">{label}</span>
            <input
              type="number"
              value={(form as any)[key]}
              onChange={(event) => setForm((current) => ({ ...current, [key]: Number(event.target.value) }))}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-white"
            />
          </label>
        ))}
        <label className="text-sm text-slate-300">
          <span className="mb-2 block">Mode</span>
          <select
            value={form.mode}
            onChange={(event) => setForm((current) => ({ ...current, mode: event.target.value }))}
            className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-white"
          >
            <option value="basic">Basic: Lv1-Lv3</option>
            <option value="full">Full: Lv1-Lv12</option>
          </select>
        </label>
      </section>

      <section className="flex flex-wrap gap-3">
        <Button onClick={() => void runAction(api.post(ADMIN_ENDPOINTS.devMlmTest.generateUsers, form))} disabled={loading}>
          {loading ? "Running..." : "Generate"}
        </Button>
        <Button variant="secondary" onClick={() => currentRunId && void runAction(api.post(ADMIN_ENDPOINTS.devMlmTest.generateDeposits, { runId: currentRunId, minDeposit: form.minDeposit, maxDeposit: form.maxDeposit, multipleDeposits: true }))} disabled={loading || !currentRunId}>
          Generate Deposits
        </Button>
        <Button variant="secondary" onClick={() => currentRunId && void runAction(api.post(ADMIN_ENDPOINTS.devMlmTest.rebuildTree, { runId: currentRunId, maxTreeDepth: form.maxTreeDepth, maxDirectChildren: form.maxDirectChildren }))} disabled={loading || !currentRunId}>
          Rebuild Tree
        </Button>
        <Button variant="secondary" onClick={() => currentRunId && void runAction(api.post(ADMIN_ENDPOINTS.devMlmTest.recalculateLevels, { runId: currentRunId, minimumEligibleBalance: form.minimumEligibleBalance, mode: form.mode }))} disabled={loading || !currentRunId}>
          Rerun Calculation
        </Button>
        <Button variant="danger" onClick={() => void runAction(api.post(ADMIN_ENDPOINTS.devMlmTest.reset))} disabled={loading}>
          Reset Test Data
        </Button>
      </section>

      {result ? (
        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-cyan-400/20 bg-cyan-500/10 p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/80">Seeded Users</div>
            <div className="mt-2 text-3xl font-semibold text-white">{treeRows.length}</div>
            <div className="mt-1 text-sm text-slate-300">Run #{currentRunId} using real users flow</div>
          </div>
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-emerald-200/80">Users Above ${form.minimumEligibleBalance}</div>
            <div className="mt-2 text-3xl font-semibold text-white">{eligibleUsers}</div>
            <div className="mt-1 text-sm text-slate-300">Eligible by seeded deposit balance and active status</div>
          </div>
          <div className="rounded-3xl border border-amber-400/20 bg-amber-500/10 p-5">
            <div className="text-[11px] uppercase tracking-[0.22em] text-amber-200/80">Total Seeded Balance</div>
            <div className="mt-2 text-3xl font-semibold text-white">${formatAmount(totalSeededBalance)}</div>
            <div className="mt-1 text-sm text-slate-300">Generated with the 1 to 600 USDT deposit range</div>
          </div>
        </section>
      ) : null}

      {!result && !loading && (
        <section className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-300">
          No MLM test run is loaded yet. Click `Generate` to create random users, deposits, tree data, and level results.
        </section>
      )}

      {result && (
        <>
          <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Child Tree Graph</div>
                <div className="text-xs text-slate-400">Run #{currentRunId} | {currentRunMode}</div>
              </div>
            </div>
            <div className="space-y-2">
              {sortedTreeRows.map((user) => (
                <div key={user.id} className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm">
                  <div style={{ paddingLeft: `${user.depth * 28}px` }} className="flex flex-wrap items-center gap-3">
                    <span className="font-medium text-white">{user.fullName}</span>
                    <span className="text-slate-300">{user.fullName}</span>
                    <span className="text-slate-500">{user.sponsorId ? `Sponsor U${user.sponsorId}` : "Root"}</span>
                    <span className={user.status === "active" ? "text-emerald-300" : "text-rose-300"}>{user.status}</span>
                    <span className="text-cyan-300">Self ${formatAmount(user.individualBalance)}</span>
                    <span className="text-sky-300">Eligible Team ${formatAmount(user.eligibleTeamBalance)}</span>
                    <span className="text-slate-400">Min Base ${formatAmount(user.minimumEligibleTeamBalance)}</span>
                    <span className="text-slate-400">Level {user.achievedLevel ?? "--"}</span>
                    <span className="text-slate-400">Direct {user.directEligibleMembers}</span>
                    <span className="text-slate-400">Team {user.teamEligibleMembers}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 text-sm font-semibold text-white">Unilevel Result Table</div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-white/5 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">
                  <tr>
                    <th className="px-3 py-2">User</th>
                    <th className="px-3 py-2">Sponsor</th>
                    <th className="px-3 py-2">Individual Balance</th>
                    <th className="px-3 py-2">Eligible Team Balance</th>
                    <th className="px-3 py-2">Minimum Team Base</th>
                    <th className="px-3 py-2">Direct Eligible</th>
                    <th className="px-3 py-2">Team Eligible</th>
                    <th className="px-3 py-2">Current Level</th>
                    <th className="px-3 py-2">Promotion Reward</th>
                    <th className="px-3 py-2">10 Day Bonus</th>
                  </tr>
                </thead>
                <tbody>
                  {treeRows.map((user) => (
                    <tr key={user.id} className="border-t border-white/5 text-slate-200">
                      <td className="px-3 py-2">{user.fullName}</td>
                      <td className="px-3 py-2">{user.sponsorId ? `U${user.sponsorId}` : "Root"}</td>
                      <td className="px-3 py-2">${formatAmount(user.individualBalance)}</td>
                      <td className="px-3 py-2">${formatAmount(user.eligibleTeamBalance)}</td>
                      <td className="px-3 py-2">${formatAmount(user.minimumEligibleTeamBalance)}</td>
                      <td className="px-3 py-2">{user.directEligibleMembers}</td>
                      <td className="px-3 py-2">{user.teamEligibleMembers}</td>
                      <td className="px-3 py-2">{user.achievedLevel ?? "--"}</td>
                      <td className="px-3 py-2">{user.promotionRewardApplicable ? `$${formatAmount(user.simulatedPromotionReward)}` : "--"}</td>
                      <td className="px-3 py-2">{user.bonusEligible ? `$${formatAmount(user.simulatedBonusAmount)}` : "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 text-sm font-semibold text-white">Deposit History By User</div>
            <div className="space-y-3">
              {treeRows.map((user) => (
                <div key={`deposits-${user.id}`} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium text-white">{user.fullName}</span>
                    <span className="text-slate-300">{user.fullName}</span>
                    <span className="text-cyan-300">Self ${formatAmount(user.individualBalance)}</span>
                    <span className="text-sky-300">Eligible Team ${formatAmount(user.eligibleTeamBalance)}</span>
                    <span className="text-slate-400">Minimum Base ${formatAmount(user.minimumEligibleTeamBalance)}</span>
                    <span className="text-slate-400">Level {user.achievedLevel ?? "--"}</span>
                  </div>
                  {user.depositHistory.length ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-white/5 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400">
                          <tr>
                            <th className="px-3 py-2">Deposit ID</th>
                            <th className="px-3 py-2">Amount</th>
                            <th className="px-3 py-2">Tx Ref</th>
                            <th className="px-3 py-2">Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {user.depositHistory.map((deposit) => (
                            <tr key={deposit.id} className="border-t border-white/5 text-slate-200">
                              <td className="px-3 py-2">{deposit.id}</td>
                              <td className="px-3 py-2">{formatAmount(deposit.amount)}</td>
                              <td className="px-3 py-2">{deposit.txRef ?? (deposit as any).txHash ?? "--"}</td>
                              <td className="px-3 py-2">{new Date(deposit.createdAt).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400">No deposits generated for this user.</div>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 text-sm font-semibold text-white">10-Day Bonus Recheck Snapshot</div>
            <div className="space-y-3">
              {treeRows
                .filter((user) => user.bonusPayoutHistory?.length)
                .map((user) => {
                  const payout = user.bonusPayoutHistory[0];
                  return (
                    <div key={`bonus-${user.id}`} className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-200">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-medium text-white">{user.fullName}</span>
                        <span>Level {payout.levelCode}</span>
                        <span>Base {payout.bonusBase}</span>
                        <span>Eligible Members {payout.eligibleMembers}</span>
                        <span>Qualified Directs {payout.qualifiedDirectMembers}</span>
                        <span>Actual ${formatAmount(payout.actualEligibleBalance)}</span>
                        <span>Minimum ${formatAmount(payout.minimumEligibleBalance)}</span>
                        <span>Payout Base ${formatAmount(payout.payoutEligibleBalance)}</span>
                        <span className="text-emerald-300">Bonus ${formatAmount(payout.payoutAmount)}</span>
                      </div>
                    </div>
                  );
                })}
              {!treeRows.some((user) => user.bonusPayoutHistory?.length) ? (
                <div className="text-sm text-slate-400">No 10-day bonus payout history has been created yet for this run.</div>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
