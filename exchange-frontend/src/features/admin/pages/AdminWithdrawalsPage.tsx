import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import {
  adminApproveFiatDeposit,
  adminApproveWithdrawal,
  adminRejectFiatDeposit,
  adminRejectWithdrawal,
  adminTransferBetweenWallets,
  fetchAdminFiatDeposits,
  fetchAdminWithdrawals,
  type AdminFiatDeposit,
  type AdminWithdrawal,
} from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";

const formatFiatMethodLabel = (method: string) => {
  const normalized = method.toLowerCase();
  if (normalized === "stripe" || normalized === "stripe_checkout") return "Card (Stripe)";
  if (normalized === "bank") return "Bank transfer";
  return method;
};

export default function AdminWithdrawalsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "withdrawals", "pending"],
    queryFn: () => fetchAdminWithdrawals({ status: "pending" }),
    refetchInterval: 10_000,
  });

  const withdrawals: AdminWithdrawal[] = Array.isArray(data) ? data : data?.items ?? [];
  const [modal, setModal] = useState<null | { type: "approve" | "reject"; item: AdminWithdrawal }>(null);
  const [modalInput, setModalInput] = useState("");
  const [fiatFilters, setFiatFilters] = useState({ status: "pending_review", method: "ALL", userId: "" });
  const {
    data: fiatData,
    isLoading: fiatLoading,
    refetch: refetchFiat,
  } = useQuery({
    queryKey: ["admin", "fiatDeposits", fiatFilters],
    queryFn: () =>
      fetchAdminFiatDeposits({
        status: fiatFilters.status === "ALL" ? undefined : fiatFilters.status,
        method: fiatFilters.method === "ALL" ? undefined : fiatFilters.method,
        userId:
          fiatFilters.userId && !Number.isNaN(Number(fiatFilters.userId))
            ? Number(fiatFilters.userId)
            : undefined,
      }),
    refetchInterval: 15_000,
  });
  const fiatDeposits: AdminFiatDeposit[] = fiatData ?? [];
  const [fiatModal, setFiatModal] = useState<null | { type: "approve" | "reject"; item: AdminFiatDeposit }>(null);
  const [fiatModalNotes, setFiatModalNotes] = useState("");
  const [transferForm, setTransferForm] = useState({
    userId: "",
    from: "spot" as "spot" | "futures",
    to: "futures" as "spot" | "futures",
    asset: "USDT",
    amount: "",
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, txHash }: { id: string | number; txHash?: string }) =>
      adminApproveWithdrawal(String(id), txHash ? { txHash } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "withdrawals", "pending"] });
      setModal(null);
      setModalInput("");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string | number; reason?: string }) =>
      adminRejectWithdrawal(String(id), reason ? { reason } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "withdrawals", "pending"] });
      setModal(null);
      setModalInput("");
    },
  });

  const submitModal = () => {
    if (!modal) return;
    if (modal.type === "approve") {
      approveMutation.mutate({ id: modal.item.id, txHash: modalInput });
    } else {
      rejectMutation.mutate({ id: modal.item.id, reason: modalInput });
    }
  };

  const fiatApproveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string | number; notes?: string }) =>
      adminApproveFiatDeposit(id, notes ? { notes } : undefined),
    onSuccess: () => {
      setFiatModal(null);
      setFiatModalNotes("");
      refetchFiat();
    },
  });

  const fiatRejectMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string | number; notes?: string }) =>
      adminRejectFiatDeposit(id, notes ? { notes } : undefined),
    onSuccess: () => {
      setFiatModal(null);
      setFiatModalNotes("");
      refetchFiat();
    },
  });

  const submitFiatModal = () => {
    if (!fiatModal) return;
    if (fiatModal.type === "approve") {
      fiatApproveMutation.mutate({ id: fiatModal.item.id, notes: fiatModalNotes.trim() || undefined });
    } else {
      fiatRejectMutation.mutate({ id: fiatModal.item.id, notes: fiatModalNotes.trim() || undefined });
    }
  };

  const transferMutation = useMutation({
    mutationFn: async ({
      userId,
      from,
      to,
      asset,
      amount,
    }: {
      userId: string;
      from: "spot" | "futures";
      to: "spot" | "futures";
      asset: string;
      amount: number;
    }) => adminTransferBetweenWallets(userId, { from, to, asset, amount }),
    onSuccess: () => {
      setTransferForm((prev) => ({ ...prev, amount: "" }));
    },
  });

  const stripeSpotlight = useMemo(
    () =>
      fiatDeposits
        .filter(
          (deposit) =>
            (deposit.method === "stripe" || deposit.method === "stripe_checkout") &&
            deposit.status === "requires_payment"
        )
        .slice(0, 4),
    [fiatDeposits]
  );

  const handleTransferSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!transferForm.userId.trim()) return;
    const amountValue = Number(transferForm.amount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) return;
    transferMutation.mutate({
      userId: transferForm.userId.trim(),
      from: transferForm.from,
      to: transferForm.to,
      asset: transferForm.asset,
      amount: amountValue,
    });
  };

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-2xl font-semibold text-white">Withdrawal Queue</h2>
        <p className="text-sm text-slate-300/80">Approve or reject pending requests.</p>
      </header>

      <section className={panelCls}>
        <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] text-xs uppercase tracking-[0.2em] text-slate-400 mb-3">
          <span>User / Address</span>
          <span>Asset</span>
          <span>Amount</span>
          <span>Status</span>
          <span>Actions</span>
        </div>
        {isLoading && <div className="text-sm text-slate-300/80">Loading withdrawals...</div>}
        {!isLoading && withdrawals.length === 0 && (
          <div className="text-sm text-slate-300/80">No pending withdrawals.</div>
        )}
        <div className="space-y-2">
          {withdrawals.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr] items-center rounded-2xl border border-white/10 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium text-white">User #{item.userId}</div>
                <div className="text-xs text-slate-400 break-all">{item.address}</div>
              </div>
              <div>{item.asset}</div>
              <div>
                <div>{getDisplayAmount(item)}</div>
                {hasMetaValue(item.meta, "requestedAmount") ? (
                  <div className="text-xs text-slate-400">Gross: {String(item.meta?.requestedAmount)}</div>
                ) : null}
              </div>
              <div className="text-xs uppercase tracking-[0.3em] text-amber-300">{item.status}</div>
              <div className="flex gap-2">
                <Button size="xs" onClick={() => setModal({ type: "approve", item })}>
                  Approve
                </Button>
                <Button size="xs" variant="danger" onClick={() => setModal({ type: "reject", item })}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={panelCls}>
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Fiat Deposits</h3>
            <p className="text-xs text-slate-300/80">Approve card intents or uploaded bank receipts.</p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2 text-xs text-slate-300/80">
            <label>
              Status
              <select
                className="ml-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-white"
                value={fiatFilters.status}
                onChange={(event) => setFiatFilters((prev) => ({ ...prev, status: event.target.value }))}
              >
                <option value="pending_review">Pending review</option>
                <option value="requires_payment">Requires payment</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="ALL">All</option>
              </select>
            </label>
            <label>
              Method
              <select
                className="ml-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-white"
                value={fiatFilters.method}
                onChange={(event) => setFiatFilters((prev) => ({ ...prev, method: event.target.value }))}
              >
                <option value="ALL">All</option>
                <option value="stripe">Stripe</option>
                 <option value="stripe_checkout">Stripe Checkout</option>
                <option value="bank">Bank</option>
              </select>
            </label>
            <label>
              User
              <input
                className="ml-2 w-24 rounded-xl border border-white/10 bg-white/5 px-2 py-1 text-white"
                value={fiatFilters.userId}
                onChange={(event) => setFiatFilters((prev) => ({ ...prev, userId: event.target.value }))}
                placeholder="ID"
              />
            </label>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] text-xs uppercase tracking-[0.2em] text-slate-400">
            <span>User</span>
            <span>Method</span>
            <span>Wallet</span>
            <span>Amount</span>
            <span>Status</span>
          </div>
          {fiatLoading && <div className="text-sm text-slate-300/80">Loading fiat deposits...</div>}
          {!fiatLoading && fiatDeposits.length === 0 && (
            <div className="text-sm text-slate-300/80">No deposits match these filters.</div>
          )}
          {fiatDeposits.map((deposit) => (
            <div
              key={deposit.id}
              className="grid grid-cols-[1.2fr_1fr_1fr_1fr_1fr] items-center rounded-2xl border border-white/10 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium text-white">
                  User #{deposit.userId} {deposit.user?.email ? `- ${deposit.user.email}` : ""}
                </div>
                {deposit.proofUrl && (
                  <a href={deposit.proofUrl} target="_blank" rel="noreferrer" className="text-xs text-indigo-300 underline">
                    View proof
                  </a>
                )}
              </div>
              <div>
                {formatFiatMethodLabel(deposit.method)}
                {deposit.referenceCode ? (
                  <span className="block text-[11px] text-slate-400">Ref {deposit.referenceCode}</span>
                ) : null}
              </div>
              <div className="text-xs text-slate-400">{deposit.wallet.toUpperCase()}</div>
              <div>
                {deposit.amount} {deposit.currency}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="uppercase tracking-[0.3em] text-amber-200">{deposit.status}</span>
                <div className="flex gap-1">
                  <Button size="xs" onClick={() => setFiatModal({ type: "approve", item: deposit })}>
                    Approve
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setFiatModal({ type: "reject", item: deposit })}>
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {stripeSpotlight.length > 0 && (
        <section className={panelCls}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Stripe Spotlight</div>
              <h3 className="text-lg font-semibold text-white">Requires payment</h3>
            </div>
            <Button size="xs" variant="ghost" onClick={() => refetchFiat()}>
              Refresh
            </Button>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            {stripeSpotlight.map((deposit) => (
              <div key={deposit.id} className="rounded-2xl border border-white/10 px-3 py-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>User #{deposit.userId}</span>
                  <span>{new Date(deposit.createdAt).toLocaleTimeString()}</span>
                </div>
                <div className="text-white font-semibold">
                  {deposit.amount} {deposit.currency} - {deposit.wallet.toUpperCase()}
                </div>
                <div className="text-xs text-slate-400">
                  Reference {deposit.referenceCode ?? "n/a"} - Chase customer to complete card payment.
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={panelCls}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">Custodial Transfer</h3>
            <p className="text-xs text-slate-300/80">Move funds between spot and futures wallets on behalf of a user.</p>
          </div>
        </div>
        <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={handleTransferSubmit}>
          <label className="text-xs text-slate-300/80">
            User ID
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={transferForm.userId}
              onChange={(event) => setTransferForm((prev) => ({ ...prev, userId: event.target.value }))}
              required
            />
          </label>
          <label className="text-xs text-slate-300/80">
            Amount ({transferForm.asset})
            <input
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={transferForm.amount}
              onChange={(event) => setTransferForm((prev) => ({ ...prev, amount: event.target.value }))}
              required
            />
          </label>
          <label className="text-xs text-slate-300/80">
            From
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={transferForm.from}
              onChange={(event) =>
                setTransferForm((prev) => ({ ...prev, from: event.target.value as "spot" | "futures" }))
              }
            >
              <option value="spot">Spot</option>
              <option value="futures">Futures</option>
            </select>
          </label>
          <label className="text-xs text-slate-300/80">
            To
            <select
              className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              value={transferForm.to}
              onChange={(event) =>
                setTransferForm((prev) => ({ ...prev, to: event.target.value as "spot" | "futures" }))
              }
            >
              <option value="spot">Spot</option>
              <option value="futures">Futures</option>
            </select>
          </label>
          <div className="md:col-span-2 flex gap-2">
            <Button type="submit" disabled={transferMutation.isPending || !transferForm.userId.trim()}>
              {transferMutation.isPending ? "Transferring..." : "Execute transfer"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setTransferForm({ userId: "", from: "spot", to: "futures", asset: "USDT", amount: "" })
              }
            >
              Reset
            </Button>
          </div>
        </form>
      </section>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 space-y-4">
            <h3 className="text-xl font-semibold text-white">
              {modal.type === "approve" ? "Approve withdrawal" : "Reject withdrawal"}
            </h3>
            <p className="text-sm text-slate-300/80">
              User #{modal.item.userId} - {getDisplayAmount(modal.item)} {modal.item.asset}
            </p>
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
              placeholder={modal.type === "approve" ? "Tx hash (optional)" : "Reason (optional)"}
              value={modalInput}
              onChange={(e) => setModalInput(e.target.value)}
            />
            {(approveMutation.isError || rejectMutation.isError) && (
              <div className="text-sm text-rose-400">
                {(approveMutation.error as Error)?.message || (rejectMutation.error as Error)?.message}
              </div>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" onClick={submitModal} disabled={approveMutation.isPending || rejectMutation.isPending}>
                {approveMutation.isPending || rejectMutation.isPending ? "Submitting..." : "Confirm"}
              </Button>
              <Button className="flex-1" variant="secondary" onClick={() => setModal(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {fiatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 space-y-4">
            <h3 className="text-xl font-semibold text-white">
              {fiatModal.type === "approve" ? "Approve fiat deposit" : "Reject fiat deposit"}
            </h3>
            <p className="text-sm text-slate-300/80">
              User #{fiatModal.item.userId} - {fiatModal.item.amount} {fiatModal.item.currency} via{" "}
              {formatFiatMethodLabel(fiatModal.item.method)}
            </p>
            <input
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm"
              placeholder="Notes (optional)"
              value={fiatModalNotes}
              onChange={(e) => setFiatModalNotes(e.target.value)}
            />
            {(fiatApproveMutation.isError || fiatRejectMutation.isError) && (
              <div className="text-sm text-rose-400">
                {(fiatApproveMutation.error as Error)?.message || (fiatRejectMutation.error as Error)?.message}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={submitFiatModal}
                disabled={fiatApproveMutation.isPending || fiatRejectMutation.isPending}
              >
                {fiatApproveMutation.isPending || fiatRejectMutation.isPending ? "Submitting..." : "Confirm"}
              </Button>
              <Button className="flex-1" variant="secondary" onClick={() => setFiatModal(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function hasMetaValue(meta: Record<string, unknown> | undefined, key: string) {
  return meta && meta[key] !== null && meta[key] !== undefined && meta[key] !== "";
}

function getDisplayAmount(item: AdminWithdrawal) {
  const netAmount = Number(item.meta?.netAmount);
  if (Number.isFinite(netAmount) && netAmount > 0) return netAmount;
  return Number(item.amount || 0);
}
