import { useEffect, useMemo, useState } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import Dialog from "../../../ui/Dialog";
import { useP2PEngine } from "../../../hooks/useP2PEngine";
import type { P2PListing, P2POrder } from "../../../utils/p2pEngine";

const numberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const messageTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

export default function P2PPage() {
  const engine = useP2PEngine();
  const [tab, setTab] = useState<"BUY" | "SELL">("BUY");
  const [listingId, setListingId] = useState<string | null>(null);
  const [fiatInput, setFiatInput] = useState("500");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showTradeConfirm, setShowTradeConfirm] = useState(false);

  const listings = useMemo(
    () => engine.listings.filter((item) => item.type === tab),
    [engine.listings, tab]
  );

  useEffect(() => {
    setListingId((prev) => {
      if (prev && listings.some((item) => item.id === prev)) return prev;
      return listings[0]?.id ?? null;
    });
  }, [listings]);

  useEffect(() => {
    setActiveOrderId((prev) => {
      if (prev && engine.orders.some((order) => order.id === prev)) return prev;
      return engine.orders[0]?.id ?? null;
    });
  }, [engine.orders]);

  const selectedListing = useMemo(
    () => listings.find((item) => item.id === listingId),
    [listings, listingId]
  );

  const activeOrder = useMemo(
    () => engine.orders.find((order) => order.id === activeOrderId) ?? null,
    [engine.orders, activeOrderId]
  );

  const activeMessages = useMemo(() => {
    if (!activeOrder) return [];
    return engine.messages[activeOrder.id] ?? [];
  }, [engine.messages, activeOrder]);

  const fiatAmount = parseFloat(fiatInput) || 0;
  const cryptoAmount = selectedListing ? fiatAmount / selectedListing.price : 0;

  const kycVerified = engine.user.kycVerified;

  const statusTone = (order: P2POrder) => {
    switch (order.status) {
      case "ESCROW_LOCKED":
      case "WAITING_PAYMENT":
        return "bg-amber-500/10 text-amber-200 border border-amber-500/40";
      case "PAID":
        return "bg-sky-500/10 text-sky-200 border border-sky-500/40";
      case "RELEASED":
        return "bg-emerald-500/10 text-emerald-200 border border-emerald-500/40";
      case "CANCELLED":
      default:
        return "bg-rose-500/10 text-rose-200 border border-rose-500/40";
    }
  };

  const handleCreateOrder = () => {
    if (!selectedListing) return;
    setError(null);
    try {
      engine.createOrder(selectedListing.id, fiatAmount);
      setActiveOrderId(engine.orders[0]?.id ?? null);
      setChatDraft("");
      setShowTradeConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open order.");
    }
  };

  const attemptTrade = () => {
    if (!selectedListing) return;
    if (!kycVerified) {
      setError("Please verify your account before trading P2P.");
      return;
    }
    if (fiatAmount <= 0) {
      setError("Enter a trade amount above zero.");
      return;
    }
    setShowTradeConfirm(true);
  };

  const sendChat = () => {
    if (!activeOrder || !chatDraft.trim()) return;
    engine.sendMessage(activeOrder.id, "YOU", chatDraft.trim());
    setChatDraft("");
  };

  const acknowledgeEscrow = () => {
    if (!activeOrder) return;
    engine.acknowledgePaymentWindow(activeOrder.id);
  };

  const markAsPaid = () => {
    if (!activeOrder) return;
    engine.markAsPaid(activeOrder.id);
  };

  const cancelOrder = () => {
    if (!activeOrder) return;
    engine.cancelOrder(activeOrder.id);
  };

  if (!kycVerified) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 text-slate-100">
        <header>
          <h1 className="text-2xl font-semibold text-white">Peer-to-Peer Desk</h1>
          <p className="mt-1 text-sm text-slate-300/80">
            Securely swap assets with verified CryptoSignal traders. Complete KYC to unlock the desk.
          </p>
        </header>

        <section className="rounded-3xl border border-indigo-500/40 bg-indigo-500/10 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.3)]">
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-amber-400/60 bg-amber-500/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-amber-100">
              KYC required
            </div>
            <p className="text-sm text-slate-100/85">
              Only verified identities can access the P2P marketplace, escrow guarantees, and in-trade messaging.
            </p>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-indigo-100/90">
            <li>- Submit government ID and proof of address.</li>
            <li>- Allow up to 2 minutes for automated verification.</li>
            <li>- P2P trades unlock instantly once approved.</li>
          </ul>
          <Button
            className="mt-5"
            size="lg"
            onClick={() => engine.verifyUser()}
          >
            Complete KYC and Unlock P2P
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Peer-to-Peer Desk</h1>
          <p className="text-sm text-slate-300/80">
            Curated marketplace for verified CryptoSignal traders. Escrow backed, chat enabled, compliance ready.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="rounded-full border border-emerald-500/50 bg-emerald-500/15 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
            KYC VERIFIED
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs text-slate-200">
            Last updated {new Date(engine.user.lastUpdated).toLocaleString()}
          </div>
        </div>
      </header>

      <section className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <aside className="space-y-4 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.3)]">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Marketplace</div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300/75">
              {listings.length} offers
            </div>
          </div>

          <div className="flex gap-2">
            {(["BUY", "SELL"] as const).map((value) => (
              <button
                key={value}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm transition ${
                  tab === value
                    ? value === "BUY"
                      ? "border-emerald-500/60 bg-emerald-500/20 text-white"
                      : "border-indigo-500/60 bg-indigo-500/20 text-white"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-indigo-400/40 hover:text-white"
                }`}
                onClick={() => setTab(value)}
              >
                {value === "BUY" ? "Buy crypto" : "Sell crypto"}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {listings.map((item) => (
              <ListingCard
                key={item.id}
                item={item}
                active={item.id === listingId}
                onSelect={() => setListingId(item.id)}
              />
            ))}
          </div>
        </aside>

        <div className="space-y-6">
          <div className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(56,189,248,0.35)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-slate-300/65">
                  Trade ticket
                </div>
                <div className="text-lg font-semibold text-white">
                  {selectedListing ? `${selectedListing.asset} / ${selectedListing.fiatCurrency}` : "Select an offer"}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300/80">
                Escrow protected
              </div>
            </div>

            {selectedListing ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs text-slate-300/70">Trade size ({selectedListing.fiatCurrency})</label>
                  <Input
                    value={fiatInput}
                    onChange={(event) => setFiatInput(event.target.value)}
                    inputMode="decimal"
                    placeholder={`${selectedListing.minAmount}`}
                  />
                  <div className="text-xs text-slate-300/70">
                    Limits {currencyFormatter.format(selectedListing.minAmount)} to {currencyFormatter.format(selectedListing.maxAmount)}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-slate-300/70">You will receive ({selectedListing.asset})</label>
                  <div className="h-10 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
                    {numberFormatter.format(cryptoAmount)} {selectedListing.asset}
                  </div>
                  <div className="text-xs text-slate-300/70">
                    Best price {currencyFormatter.format(selectedListing.price)} per {selectedListing.asset}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-slate-300/75">
                Choose a listing from the left to prepare a trade ticket.
              </div>
            )}

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/75">
                <div className="text-slate-200">Payment methods</div>
                <div>{selectedListing?.paymentMethods.join(", ") ?? "N/A"}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/75">
                <div className="text-slate-200">Counterparty</div>
                <div>
                  {selectedListing
                    ? `${selectedListing.trader.name} - ${selectedListing.trader.tier}`
                    : "N/A"}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/75">
                <div className="text-slate-200">Completion</div>
                <div>
                  {selectedListing ? `${selectedListing.completionRate}% success - ${selectedListing.trader.trades} trades` : "N/A"}
                </div>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
                {error}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <Button size="lg" onClick={attemptTrade} disabled={!selectedListing}>
                Initiate Escrow
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => setFiatInput(selectedListing ? `${selectedListing.minAmount}` : "0")}
              >
                Reset to minimum
              </Button>
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300/70">
              <div className="font-semibold text-slate-200">Reminder</div>
              <p>
                P2P trades are monitored for AML compliance. Keep all communication in chat and upload your payment slip when requested.
              </p>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/6 p-6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.35)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Active trades</div>
                <div className="text-xs text-slate-300/75">
                  Escrow-backed chats stay open until settlement.
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300/70">
                {engine.orders.length} open
              </div>
            </div>

            {engine.orders.length === 0 ? (
              <div className="mt-6 text-sm text-slate-300/70">
                You do not have any active escrow positions. Initiate a trade above to start a secure P2P order.
              </div>
            ) : (
              <div className="mt-4 grid gap-4 lg:grid-cols-[260px_1fr]">
                <div className="space-y-3">
                  {engine.orders.map((order) => (
                    <button
                      key={order.id}
                      onClick={() => setActiveOrderId(order.id)}
                      className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                        order.id === activeOrderId
                          ? "border-indigo-500/60 bg-indigo-500/20 text-white"
                          : "border-white/10 bg-white/5 text-slate-200 hover:border-indigo-400/40 hover:text-white"
                      }`}
                    >
                      <div className="flex items-center justify-between text-sm font-semibold">
                        <span>{order.asset}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${statusTone(order)}`}>
                          {order.status.replace("_", " ")}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-300/75">
                        {currencyFormatter.format(order.fiatAmount)} - counterpart {order.counterpart.name}
                      </div>
                    </button>
                  ))}
                </div>

                {activeOrder ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                      <div className="flex flex-wrap items-center gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-300/70">
                            Escrow
                          </div>
                          <div className="text-lg font-semibold text-white">
                            {numberFormatter.format(activeOrder.cryptoAmount)} {activeOrder.asset}
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300/75">
                          {currencyFormatter.format(activeOrder.fiatAmount)} @ {currencyFormatter.format(activeOrder.price)}
                        </div>
                        <div className={`rounded-xl px-3 py-1 text-xs ${statusTone(activeOrder)}`}>
                          {activeOrder.status.replace("_", " ")}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-300/70 md:grid-cols-2">
                        <div>Counterparty: {activeOrder.counterpart.name} ({activeOrder.counterpart.tier})</div>
                        <div>Release average: {activeOrder.counterpart.avgReleaseMinutes} minutes</div>
                        <div>Payment window: 15 minutes</div>
                        <div>Trade started: {new Date(activeOrder.createdAt).toLocaleTimeString()}</div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-white">Secure chat</span>
                        <span className="text-xs text-slate-300/70">
                          Escrow {activeOrder.escrow.released ? "released" : "funded"}
                        </span>
                      </div>
                      <div className="mt-3 h-48 overflow-auto rounded-xl border border-white/5 bg-slate-950/40 p-3 space-y-3 text-xs">
                        {activeMessages.map((message) => (
                          <div
                            key={message.id}
                            className={`flex flex-col ${
                              message.author === "YOU" ? "items-end text-emerald-100" : "items-start text-slate-200"
                            }`}
                          >
                            <div
                              className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                                message.author === "YOU"
                                  ? "bg-emerald-500/15 border border-emerald-500/30"
                                  : message.author === "SYSTEM"
                                    ? "bg-indigo-500/10 border border-indigo-500/30 text-indigo-100"
                                    : "bg-white/10 border border-white/10"
                              }`}
                            >
                              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-300/60">
                                {message.author}
                              </div>
                              <div className="mt-1 text-sm leading-snug">{message.body}</div>
                            </div>
                            <span className="mt-1 text-[10px] text-slate-400">
                              {messageTimeFormatter.format(message.timestamp)}
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Input
                          value={chatDraft}
                          onChange={(event) => setChatDraft(event.target.value)}
                          placeholder="Send an in-escrow message"
                        />
                        <Button onClick={sendChat} disabled={!chatDraft.trim()}>
                          Send
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <Button size="md" onClick={acknowledgeEscrow}>
                        Acknowledge escrow
                      </Button>
                      <Button size="md" onClick={markAsPaid}>
                        Mark as paid
                      </Button>
                      <Button variant="ghost" size="md" onClick={cancelOrder}>
                        Cancel trade
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-slate-300/70">
                    Select an order to manage escrow, chat, and payment actions.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <Dialog
        open={showTradeConfirm && !!selectedListing}
        onClose={() => setShowTradeConfirm(false)}
        title="Confirm P2P escrow initiation"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowTradeConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateOrder}>Lock escrow</Button>
          </>
        }
      >
        {selectedListing ? (
          <div className="space-y-3 text-sm text-slate-200">
            <p>
              You are about to open a {tab.toLowerCase()} order with {selectedListing.trader.name}. As a verified user you are eligible for
              escrow protection, CryptoSignal chat monitoring, and dispute resolution.
            </p>
            <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300/80">
              <div>Trade size: {currencyFormatter.format(fiatAmount)} {selectedListing.fiatCurrency}</div>
              <div>Escrow amount: {numberFormatter.format(cryptoAmount)} {selectedListing.asset}</div>
              <div>Payment methods: {selectedListing.paymentMethods.join(", ")}</div>
            </div>
            <p className="text-xs text-slate-300/70">
              P2P desk access is restricted to KYC verified users. Never take conversations off-platform.
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

type ListingCardProps = {
  item: P2PListing;
  active: boolean;
  onSelect: () => void;
};

function ListingCard({ item, active, onSelect }: ListingCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
        active
          ? "border-indigo-500/60 bg-indigo-500/20 text-white shadow-[0_25px_60px_-40px_rgba(79,70,229,0.7)]"
          : "border-white/10 bg-white/5 text-slate-200 hover:border-indigo-400/40 hover:text-white"
      }`}
    >
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>{item.asset}</span>
        <span>{currencyFormatter.format(item.price)}</span>
      </div>
      <div className="mt-1 text-xs text-slate-300/75">
        Limits {currencyFormatter.format(item.minAmount)} to {currencyFormatter.format(item.maxAmount)}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-300/75">
        <span>{item.paymentMethods.join(", ")}</span>
        <span>{item.completionRate}% success</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-300/70">
        <span>{item.trader.name}</span>
        <span>{item.trader.trades} trades</span>
      </div>
    </button>
  );
}
