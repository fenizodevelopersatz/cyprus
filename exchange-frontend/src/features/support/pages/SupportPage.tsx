import { useState } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";

type KnowledgeArticle = {
  id: string;
  title: string;
  description: string;
  category: string;
};

const knowledgeBase: KnowledgeArticle[] = [
  {
    id: "kb1",
    title: "How to troubleshoot failed deposits",
    description: "Steps to identify delays, review transaction hashes, and escalate to support.",
    category: "Funding",
  },
  {
    id: "kb2",
    title: "Understanding order status transitions",
    description: "Explain NEW, PARTIAL, FILLED, and CANCELLED including useful edge cases.",
    category: "Trading",
  },
  {
    id: "kb3",
    title: "Connecting Google authenticator for 2FA",
    description: "Install the authenticator app and secure your recovery codes.",
    category: "Security",
  },
  {
    id: "kb4",
    title: "How referral rebates are calculated",
    description: "Learn about the rebate curve, payout frequency, and campaign boosters.",
    category: "Referrals",
  },
];

const categories = ["All", "Funding", "Trading", "Security", "Referrals"];

export default function SupportPage() {
  const [category, setCategory] = useState("All");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState("email");

  const filteredArticles =
    category === "All"
      ? knowledgeBase
      : knowledgeBase.filter((article) => article.category === category);

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Support & Help Center</h1>
          <p className="text-sm text-slate-300/85">
            Search self-serve guides, open priority tickets, or connect with the CryptoSignal response team.
          </p>
        </div>
        <Button size="sm">View system status</Button>
      </header>

      <section className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)] space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Create support request</div>
            <p className="text-sm text-slate-300/80">Submit a new ticket for trading, funding, or compliance queries.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              onClick={() => setChannel("email")}
              className={`rounded-full px-3 py-1 border ${
                channel === "email"
                  ? "border-indigo-400/50 bg-indigo-500/20 text-white"
                  : "border-white/10 bg-white/5 text-slate-300/80"
              }`}
            >
              Email
            </button>
            <button
              onClick={() => setChannel("chat")}
              className={`rounded-full px-3 py-1 border ${
                channel === "chat"
                  ? "border-indigo-400/50 bg-indigo-500/20 text-white"
                  : "border-white/10 bg-white/5 text-slate-300/80"
              }`}
            >
              Live chat
            </button>
            <button
              onClick={() => setChannel("call")}
              className={`rounded-full px-3 py-1 border ${
                channel === "call"
                  ? "border-indigo-400/50 bg-indigo-500/20 text-white"
                  : "border-white/10 bg-white/5 text-slate-300/80"
              }`}
            >
              Schedule call
            </button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-slate-300/70">Topic</label>
            <select className="w-full rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none">
              <option className="text-black">Funding issue</option>
              <option className="text-black">Order execution</option>
              <option className="text-black">Account access</option>
              <option className="text-black">API & integrations</option>
              <option className="text-black">Other</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-300/70">Urgency</label>
            <select className="w-full rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none">
              <option className="text-black">Standard (24h response)</option>
              <option className="text-black">Priority (4h)</option>
              <option className="text-black">Emergency (30m)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-300/70">Describe the issue</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            className="w-full rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none"
            placeholder="Provide context, asset, time of incident, and any relevant refs."
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-slate-300/70">Attach screenshot or log (optional)</label>
            <Input type="file" className="text-sm" />
          </div>
          <div>
            <label className="text-xs text-slate-300/70">Callback number</label>
            <Input placeholder="+1 555 555 5555" className="text-sm" />
          </div>
        </div>

        <div className="flex gap-3">
          <Button size="sm" disabled={description.trim().length === 0}>
            Submit ticket
          </Button>
          <Button variant="secondary" size="sm">
            Save draft
          </Button>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.35)] space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">Knowledge base</div>
            <p className="text-sm text-slate-300/80">
              Browse curated guides before escalating to the support desk.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {categories.map((item) => (
              <button
                key={item}
                onClick={() => setCategory(item)}
                className={`rounded-full px-3 py-1 border ${
                  category === item
                    ? "border-indigo-400/50 bg-indigo-500/20 text-white"
                    : "border-white/10 bg-white/5 text-slate-300/80"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {filteredArticles.map((article) => (
            <div
              key={article.id}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">{article.title}</span>
                <span className="text-xs text-indigo-200">{article.category}</span>
              </div>
              <p className="text-xs text-slate-300/80 mt-1">{article.description}</p>
              <Button variant="ghost" size="sm" className="mt-2">
                Read article
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.3)] space-y-4 text-sm text-slate-200">
        <div className="text-xs uppercase tracking-[0.16em] text-slate-300/70">
          Contact escalation
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="font-semibold text-white">24/7 Live desk</div>
            <div className="text-xs text-slate-300/80 mt-1">
              Our incident team can be reached any time via encrypted chat for high-priority issues.
            </div>
            <Button size="sm" variant="secondary" className="mt-3">
              Launch live chat
            </Button>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="font-semibold text-white">Institutional hotline</div>
            <div className="text-xs text-slate-300/80 mt-1">
              Direct line for enterprise counterparties needing immediate resolution.
            </div>
            <Button size="sm" variant="ghost" className="mt-3">
              View phone number
            </Button>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
            <div className="font-semibold text-white">Status updates</div>
            <div className="text-xs text-slate-300/80 mt-1">
              Subscribe to downtime alerts, maintenance windows, and incident follow-ups.
            </div>
            <Button size="sm" variant="secondary" className="mt-3">
              Subscribe
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
