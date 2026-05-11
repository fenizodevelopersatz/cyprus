import { useState } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";

const rewardModels = [
  { id: "rebate", label: "Percentage rebate", description: "Share a percentage of trading fees with referrals." },
  { id: "flat", label: "Flat signup bonus", description: "Offer a one-time credit when referrals pass KYC." },
  { id: "hybrid", label: "Hybrid", description: "Combine rebate and milestone payouts." },
];

type Milestone = {
  id: number;
  label: string;
  condition: string;
  reward: string;
};

const defaultMilestones: Milestone[] = [
  { id: 1, label: "First trade", condition: "Referral executes first spot order", reward: "$20 bonus" },
  { id: 2, label: "Volume milestone", condition: "Referral reaches $50k notional volume", reward: "5% rebate for 30 days" },
  { id: 3, label: "Team goal", condition: "10 referrals verified in a week", reward: "$400 team bonus" },
];

export default function CampaignSettingsPage() {
  const [selectedModel, setSelectedModel] = useState("rebate");
  const [autoEmail, setAutoEmail] = useState(true);
  const [milestones, setMilestones] = useState<Milestone[]>(defaultMilestones);

  const onAddMilestone = () => {
    const nextId = milestones.length + 1;
    setMilestones([
      ...milestones,
      {
        id: nextId,
        label: `Milestone ${nextId}`,
        condition: "Describe condition…",
        reward: "Describe reward…",
      },
    ]);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 text-slate-100">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Campaign Settings</h1>
        <p className="text-sm text-slate-300/85">
          Configure how referral rewards are calculated, automate communications, and manage payout milestones.
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] space-y-4">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Reward model</div>
          <p className="text-sm text-slate-300/80">
            Choose how rewards are distributed to your referrers.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {rewardModels.map((model) => (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id)}
              className={`rounded-2xl border px-3 py-3 text-left transition ${
                selectedModel === model.id
                  ? "border-indigo-400/50 bg-indigo-500/15 text-white shadow-[0_12px_45px_-35px_rgba(99,102,241,0.8)]"
                  : "border-white/10 bg-white/5 text-slate-300/80 hover:border-indigo-300/40"
              }`}
            >
              <div className="font-semibold text-white">{model.label}</div>
              <div className="text-xs mt-1">{model.description}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.35)] space-y-4">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Automations</div>
          <p className="text-sm text-slate-300/80">
            Control when CryptoSignal notifies referrals and when payouts happen automatically.
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
          <input
            type="checkbox"
            checked={autoEmail}
            onChange={(event) => setAutoEmail(event.target.checked)}
            className="h-4 w-4 rounded border border-white/25 bg-transparent"
          />
          Auto-send welcome and milestone emails to referrals
        </label>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-slate-300/70">Payout schedule</label>
            <select className="w-full rounded-xl border border-black/15 bg-white/8 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none">
              <option className="text-black">Every Friday</option>
              <option className="text-black">Every Monday</option>
              <option className="text-black">Manual approval</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-300/70">Minimum withdrawal</label>
            <Input defaultValue="50 USDT" className="text-sm" />
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.3)] space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Milestone rewards</div>
            <p className="text-sm text-slate-300/80">
              Offer additional incentives when referrals hit key milestones.
            </p>
          </div>
          <Button size="sm" onClick={onAddMilestone}>
            Add milestone
          </Button>
        </div>
        <div className="space-y-3">
          {milestones.map((milestone) => (
            <div key={milestone.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <span className="font-semibold text-white">{milestone.label}</span>
                <Button variant="ghost" size="sm">
                  Edit
                </Button>
              </div>
              <div className="text-xs text-slate-300/80 mt-2">
                Condition: {milestone.condition}
              </div>
              <div className="text-xs text-emerald-300/90 mt-1">
                Reward: {milestone.reward}
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="flex flex-wrap gap-3 justify-end">
        <Button variant="secondary">Discard changes</Button>
        <Button>Save campaign settings</Button>
      </footer>
    </div>
  );
}
