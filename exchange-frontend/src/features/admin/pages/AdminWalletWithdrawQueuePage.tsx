import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import { FundingNetworkIcon } from "../../funding/components/FundingNetworkIcon";
import {
  adminApproveWithdrawal,
  adminRejectWithdrawal,
  fetchAdminWalletWithdrawQueue,
  fetchAdminWalletWithdrawQueueLiveBalances,
  type AdminWithdrawal,
  type AdminWalletLiveBalances,
} from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";
type BalanceAccent = "emerald" | "cyan" | "amber" | "violet";
type StatusTone = "emerald" | "cyan" | "violet" | "slate";
type WalletLinkInfo = Pick<AdminWalletLiveBalances["wallets"][number], "address" | "label" | "explorerUrl">;

export default function AdminWalletWithdrawQueuePage() {
  const queryClient = useQueryClient();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    userId: "",
    network: "",
    fromDate: "",
    toDate: "",
    page: 1,
    limit: 50,
    eligibleOnly: true,
  });
  const normalizedUserId = filters.userId.trim();
  const normalizedNetwork = filters.network.trim().toLowerCase();
  const sanitizedFilters = useMemo(
    () => ({
      page: filters.page,
      limit: filters.limit,
      userId: /^\d+$/.test(normalizedUserId) ? normalizedUserId : "",
      network: normalizedNetwork,
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      eligibleOnly: filters.eligibleOnly,
    }),
    [filters.eligibleOnly, filters.fromDate, filters.limit, filters.page, filters.toDate, normalizedNetwork, normalizedUserId]
  );
  const hasInvalidUserId = normalizedUserId.length > 0 && !/^\d+$/.test(normalizedUserId);
  const [modal, setModal] = useState<null | { type: "approve" | "reject"; item: AdminWithdrawal }>(null);
  const [modalInput, setModalInput] = useState("");

  const queueQuery = useQuery({
    queryKey: ["admin", "admin-wallet-withdraw-queue", sanitizedFilters],
    queryFn: () =>
      fetchAdminWalletWithdrawQueue({
        page: sanitizedFilters.page,
        userId: sanitizedFilters.userId || undefined,
        network: sanitizedFilters.network || undefined,
        fromDate: sanitizedFilters.fromDate || undefined,
        toDate: sanitizedFilters.toDate || undefined,
        limit: sanitizedFilters.limit,
        eligibleOnly: sanitizedFilters.eligibleOnly,
      }),
    refetchInterval: 10000,
    retry: false,
  });

  const liveBalancesQuery = useQuery({
    queryKey: ["admin", "admin-wallet-withdraw-queue", "live-balances"],
    queryFn: fetchAdminWalletWithdrawQueueLiveBalances,
    refetchInterval: 15000,
  });

  const items = queueQuery.data?.items ?? [];
  const pagination = queueQuery.data?.pagination ?? { page: 1, limit: filters.limit, total: 0, totalPages: 0 };
  const liveBalances = liveBalancesQuery.data;
  const walletByNetwork = useMemo(
    () =>
      (liveBalances?.wallets ?? []).reduce<Record<string, AdminWalletLiveBalances["wallets"][number]>>((acc, wallet) => {
        const normalized = normalizeNetworkKey(wallet.network);
        if (normalized) acc[normalized] = wallet;
        return acc;
      }, {}),
    [liveBalances?.wallets]
  );

  const approveMutation = useMutation({
    mutationFn: async ({ id, txHash }: { id: string | number; txHash?: string }) =>
      adminApproveWithdrawal(String(id), txHash ? { txHash } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "admin-wallet-withdraw-queue"] });
      setModal(null);
      setModalInput("");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string | number; reason?: string }) =>
      adminRejectWithdrawal(String(id), reason ? { reason } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "admin-wallet-withdraw-queue"] });
      setModal(null);
      setModalInput("");
    },
  });

  const submitModal = () => {
    if (!modal) return;
    if (modal.type === "approve") {
      const txHash = modalInput.trim();
      if (!txHash) return;
      if (!isValidTxHashForNetwork(modal.item.chain, txHash)) return;
      approveMutation.mutate({ id: modal.item.id, txHash });
      return;
    }
    const reason = modalInput.trim();
    if (!reason) return;
    rejectMutation.mutate({ id: modal.item.id, reason });
  };

  const liveCards: Array<{ label: string; value: string; accent: BalanceAccent }> = useMemo(
    () => [
      { label: "Total USDT", value: liveBalances?.totalUsdt ?? "0", accent: "emerald" },
      { label: "USDT ERC-20", value: liveBalances?.totalErc20 ?? "0", accent: "cyan" },
      { label: "USDT BEP-20", value: liveBalances?.totalBep20 ?? "0", accent: "amber" },
      { label: "USDT TRC-20", value: liveBalances?.totalTrc20 ?? "0", accent: "violet" },
    ],
    [liveBalances]
  );

  const copyValue = async (value: string, key: string) => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-white">Admin Wallet Withdraw Queue</h2>
          <p className="text-sm text-slate-300/80">Pending withdrawals with live treasury balances, approval send flow, and queue filters.</p>
        </div>
        <div className="text-xs text-slate-400">
          {filters.eligibleOnly ? "Active + KYC verified users only" : "All queue users"}
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {liveCards.map((card) => (
          <BalanceCard
            key={card.label}
            label={card.label}
            value={formatAmount(card.value, 2)}
            accent={card.accent}
            loading={liveBalancesQuery.isLoading}
            wallet={resolveWalletForCard(card.label, walletByNetwork)}
            copiedKey={copiedKey}
            copyKey={`wallet-${normalizeNetworkKeyFromLabel(card.label) || card.label.toLowerCase()}`}
            onCopy={copyValue}
          />
        ))}
      </section>

      <section className={panelCls}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            placeholder="User ID"
            value={filters.userId}
            inputMode="numeric"
            onChange={(event) => setFilters((prev) => ({ ...prev, userId: event.target.value.replace(/[^\d]/g, ""), page: 1 }))}
          />
          <select
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            value={filters.network}
            onChange={(event) => setFilters((prev) => ({ ...prev, network: event.target.value, page: 1 }))}
          >
            <option value="">All networks</option>
            <option value="ethereum">ERC-20</option>
            <option value="bsc">BEP-20</option>
            <option value="tron">TRC-20</option>
          </select>
          <input
            type="date"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            value={filters.fromDate}
            onChange={(event) => setFilters((prev) => ({ ...prev, fromDate: event.target.value, page: 1 }))}
          />
          <input
            type="date"
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            value={filters.toDate}
            onChange={(event) => setFilters((prev) => ({ ...prev, toDate: event.target.value, page: 1 }))}
          />
          <select
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            value={String(filters.limit)}
            onChange={(event) => setFilters((prev) => ({ ...prev, limit: Number(event.target.value), page: 1 }))}
          >
            <option value="25">25 rows</option>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
          </select>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white">
            <input
              type="checkbox"
              checked={filters.eligibleOnly}
              onChange={(event) => setFilters((prev) => ({ ...prev, eligibleOnly: event.target.checked, page: 1 }))}
            />
            Eligible only
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
          <div>
            {hasInvalidUserId
              ? "User ID filter accepts numbers only."
              : filters.eligibleOnly
                ? "Showing only active users with completed KYC."
                : "Showing all queued users."}
          </div>
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              setFilters({
                userId: "",
                network: "",
                fromDate: "",
                toDate: "",
                page: 1,
                limit: 50,
                eligibleOnly: true,
              })
            }
          >
            Clear filters
          </Button>
        </div>
      </section>

      <section className={panelCls}>
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Queue Records</div>
          <div className="text-xs text-slate-400">
            Page {pagination.page} of {Math.max(pagination.totalPages, 1)} - {pagination.total} requests
          </div>
        </div>

        <div className="space-y-3">
          {queueQuery.isLoading && <div className="text-slate-300/80">Loading withdrawal queue...</div>}
          {queueQuery.isError && (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              Unable to load the withdrawal queue with the current filters.
            </div>
          )}

          {!queueQuery.isLoading &&
            items.map((item) => (
              <div key={item.id} className="rounded-2xl border border-white/10 px-4 py-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <DetailBlock label="User">
                      <div className="flex items-center gap-3">
                        {item.profilePhoto ? (
                          <img
                            src={item.profilePhoto}
                            alt={`${item.userName || item.email || `User #${item.userId}`} profile`}
                            className="h-11 w-11 rounded-full border border-white/10 object-cover"
                          />
                        ) : (
                          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-sm font-semibold text-slate-200">
                            {getUserAvatarLabel(item)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-white">{item.userName || item.email || `User #${item.userId}`}</div>
                          <div className="text-xs text-slate-400">{item.email || `User #${item.userId}`}</div>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusPill label={item.userStatus || "unknown"} tone={item.userStatus === "active" ? "emerald" : "slate"} />
                        <StatusPill label={item.kycVerified ? "KYC verified" : "KYC unverified"} tone={item.kycVerified ? "cyan" : "slate"} />
                      </div>
                    </DetailBlock>

                    <DetailBlock label="Destination">
                      {item.to || item.address ? (
                        <div className="mt-2 flex items-start gap-2">
                          <a
                            href={toExternalUrl(item.explorerUrl)}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 break-all font-mono text-[11px] text-cyan-300 hover:text-cyan-200"
                          >
                            {item.to || item.address}
                          </a>
                          <InlineCopyAction
                            value={item.to || item.address || ""}
                            copyKey={`withdraw-${item.id}-destination`}
                            copiedKey={copiedKey}
                            onCopy={copyValue}
                          />
                        </div>
                      ) : (
                        <div className="break-all font-mono text-[11px] text-slate-200">-</div>
                      )}
                      <div className="mt-2 text-xs text-slate-400">{normalizeNetworkLabel(item.chain)}</div>
                    </DetailBlock>

                    <DetailBlock label="Requested">
                      <div className="mt-2 flex items-center gap-2">
                        <div className="text-lg font-semibold text-white">
                          {formatAmount(getDisplayAmount(item), 2)} {item.asset}
                        </div>
                        <InlineCopyAction
                          value={String(getDisplayAmount(item))}
                          copyKey={`withdraw-${item.id}-amount`}
                          copiedKey={copiedKey}
                          onCopy={copyValue}
                        />
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                        <span>Txn ID: {item.txn_id || "-"}</span>
                        {item.txn_id ? (
                          <InlineCopyAction
                            value={item.txn_id}
                            copyKey={`withdraw-${item.id}-txn`}
                            copiedKey={copiedKey}
                            onCopy={copyValue}
                          />
                        ) : null}
                      </div>
                      {hasMetaValue(item.meta, "requestedAmount") ? (
                        <div className="mt-2 text-xs text-slate-300">
                          Gross request: {formatAmount(Number(item.meta?.requestedAmount || item.amount), 2)} {item.asset}
                        </div>
                      ) : null}
                      <div className="mt-1 space-y-1 text-xs text-slate-400">
                        {hasMetaValue(item.meta, "adminFeeAmount") ? (
                          <div>Admin fee: {formatAmount(Number(item.meta?.adminFeeAmount || 0), 2)} {item.asset}</div>
                        ) : null}
                        {hasMetaValue(item.meta, "earlyPenaltyAmount") ? (
                          <div>Penalty: {formatAmount(Number(item.meta?.earlyPenaltyAmount || 0), 2)} {item.asset}</div>
                        ) : null}
                        {item.memo ? <div>Memo: {item.memo}</div> : null}
                        {typeof item.meta?.userDetails === "string" && item.meta.userDetails ? (
                          <div className="rounded-xl border border-cyan-400/10 bg-cyan-500/10 px-3 py-2 whitespace-pre-wrap text-cyan-100">
                            User details: {item.meta.userDetails}
                          </div>
                        ) : null}
                      </div>
                    </DetailBlock>

                    <DetailBlock label="Status">
                      <StatusPill label={item.status} tone="violet" />
                      <div className="mt-2 text-xs text-slate-400">{item.requestedAt ? new Date(item.requestedAt).toLocaleString() : "--"}</div>
                      {resolveAdminNote(item) ? (
                        <div className="mt-2 rounded-xl border border-amber-400/10 bg-amber-500/10 px-3 py-2 text-xs whitespace-pre-wrap text-amber-100">
                          Admin notes: {resolveAdminNote(item)}
                        </div>
                      ) : null}
                    </DetailBlock>
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <Button size="xs" onClick={() => setModal({ type: "approve", item })}>Approve</Button>
                    <Button size="xs" variant="danger" onClick={() => setModal({ type: "reject", item })}>Reject</Button>
                  </div>
                </div>
              </div>
            ))}

          {!queueQuery.isLoading && !queueQuery.isError && items.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-slate-300/80">
              No withdrawal requests match the current filters. Try clearing the date range, switching network, or turning off Eligible only.
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-slate-400">
          <span>Showing queue page {pagination.page} of {Math.max(pagination.totalPages, 1)}</span>
          <div className="flex gap-2">
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
              disabled={pagination.page <= 1}
            >
              Previous
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
              disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </section>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 space-y-4">
            <h3 className="text-xl font-semibold text-white">{modal.type === "approve" ? "Approve and send withdrawal" : "Reject withdrawal"}</h3>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <FundingNetworkIcon network={toFundingIconNetwork(modal.item.chain)} size="sm" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">
                    {modal.item.userName || modal.item.email || `User #${modal.item.userId}`} - {formatAmount(getApprovalSendAmount(modal.item), 4)} {modal.item.asset}
                  </div>
                  <div className="text-xs text-slate-400">
                    {normalizeNetworkLabel(modal.item.chain)} payout amount for this approval
                  </div>
                </div>
              </div>
              {hasMetaValue(modal.item.meta, "requestedAmount") ? (
                <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-slate-400 sm:grid-cols-3">
                  <div>Gross: {formatAmount(Number(modal.item.meta?.requestedAmount || modal.item.amount), 2)} {modal.item.asset}</div>
                  <div>Admin fee: {formatAmount(Number(modal.item.meta?.adminFeeAmount || 0), 2)} {modal.item.asset}</div>
                  <div>Penalty: {formatAmount(Number(modal.item.meta?.earlyPenaltyAmount || 0), 2)} {modal.item.asset}</div>
                </div>
              ) : null}
            </div>
            <p className="text-xs text-slate-400">
              {modal.type === "approve"
                ? "Enter the blockchain transaction hash used for this manual withdrawal approval."
                : "Enter the admin note that explains why this withdrawal is being rejected."}
            </p>
            <textarea
              className="min-h-32 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white"
              placeholder={modal.type === "approve" ? "Transaction hash" : "Admin rejection notes"}
              value={modalInput}
              onChange={(e) => setModalInput(e.target.value)}
              rows={modal.type === "approve" ? 2 : 5}
            />
            {modal.type === "approve" && modalInput.trim() && !isValidTxHashForNetwork(modal.item.chain, modalInput.trim()) ? (
              <div className="text-sm text-rose-400">{getTxHashValidationMessage(modal.item.chain)}</div>
            ) : null}
            {(approveMutation.isError || rejectMutation.isError) && (
              <div className="text-sm text-rose-400">
                {(approveMutation.error as Error)?.message || (rejectMutation.error as Error)?.message}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={submitModal}
                disabled={
                  approveMutation.isPending ||
                  rejectMutation.isPending ||
                  !modalInput.trim() ||
                  (modal.type === "approve" && !isValidTxHashForNetwork(modal.item.chain, modalInput.trim()))
                }
              >
                {approveMutation.isPending || rejectMutation.isPending ? "Submitting..." : "Confirm"}
              </Button>
              <Button className="flex-1" variant="secondary" onClick={() => setModal(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BalanceCard({
  label,
  value,
  accent,
  loading,
  wallet,
  copiedKey,
  copyKey,
  onCopy,
}: {
  label: string;
  value: string;
  accent: BalanceAccent;
  loading: boolean;
  wallet?: WalletLinkInfo | null;
  copiedKey: string | null;
  copyKey: string;
  onCopy: (address: string, key: string) => void | Promise<void>;
}) {
  const accentMap: Record<BalanceAccent, string> = {
    emerald: "border-emerald-400/20 bg-emerald-500/10 text-emerald-200/80",
    cyan: "border-cyan-400/20 bg-cyan-500/10 text-cyan-200/80",
    amber: "border-amber-400/20 bg-amber-500/10 text-amber-200/80",
    violet: "border-violet-400/20 bg-violet-500/10 text-violet-200/80",
  };

  return (
    <div className={`rounded-2xl border p-4 ${accentMap[accent]}`}>
      <div className="text-[11px] uppercase tracking-[0.24em]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{loading ? "Loading..." : value}</div>
      {wallet?.address ? (
        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Live wallet address</div>
          <div className="mt-2 flex items-start gap-2">
            <a
              href={toExternalUrl(wallet.explorerUrl)}
              target="_blank"
              rel="noreferrer"
            className="min-w-0 flex-1 break-all font-mono text-[11px] text-cyan-300 hover:text-cyan-200"
          >
            {wallet.address}
          </a>
            <InlineCopyAction value={wallet.address || ""} copyKey={copyKey} copiedKey={copiedKey} onCopy={onCopy} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function InlineCopyAction({
  value,
  copyKey,
  copiedKey,
  onCopy,
}: {
  value: string;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (value: string, key: string) => void | Promise<void>;
}) {
  if (!value) return null;
  const copied = copiedKey === copyKey;
  return (
    <button
      type="button"
      onClick={() => void onCopy(value, copyKey)}
      className={`shrink-0 text-[11px] font-medium transition ${
        copied ? "text-emerald-200" : "text-slate-300 hover:text-white"
      }`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function StatusPill({ label, tone }: { label: string; tone: StatusTone }) {
  const toneMap: Record<StatusTone, string> = {
    emerald: "bg-emerald-500/20 text-emerald-100",
    cyan: "bg-cyan-500/20 text-cyan-100",
    violet: "bg-violet-500/20 text-violet-100",
    slate: "bg-white/10 text-slate-300",
  };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${toneMap[tone]}`}>{label}</span>;
}

function formatAmount(value: string | number | undefined, digits = 4) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits }).format(amount)
    : "0.00";
}

function normalizeNetworkKey(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "erc20" || normalized === "ethereum" || normalized === "eth") return "erc20";
  if (normalized === "bep20" || normalized === "bsc") return "bep20";
  if (normalized === "trc20" || normalized === "tron") return "trc20";
  return "";
}

function toFundingIconNetwork(value?: string): "ethereum" | "bsc" | "tron" {
  const normalized = normalizeNetworkKey(value);
  if (normalized === "erc20") return "ethereum";
  if (normalized === "bep20") return "bsc";
  return "tron";
}

function getApprovalSendAmount(item: AdminWithdrawal) {
  const netAmount = Number(item.meta?.netAmount);
  if (Number.isFinite(netAmount) && netAmount > 0) return netAmount;
  const payoutAmount = Number(item.meta?.payoutAmount);
  if (Number.isFinite(payoutAmount) && payoutAmount > 0) return payoutAmount;
  return Number(item.amount || 0);
}

function isValidTxHashForNetwork(network: string | undefined, value: string) {
  const trimmed = value.trim();
  const normalized = normalizeNetworkKey(network);
  if (!trimmed) return false;
  if (normalized === "trc20") return /^[a-fA-F0-9]{64}$/.test(trimmed);
  if (normalized === "erc20" || normalized === "bep20") return /^0x[a-fA-F0-9]{64}$/.test(trimmed);
  return false;
}

function getTxHashValidationMessage(network: string | undefined) {
  const normalized = normalizeNetworkKey(network);
  if (normalized === "trc20") return "Enter a valid TRC20 transaction hash.";
  if (normalized === "erc20") return "Enter a valid ERC20 transaction hash.";
  if (normalized === "bep20") return "Enter a valid BEP20 transaction hash.";
  return "Enter a valid transaction hash.";
}

function resolveWalletForCard(
  label: string,
  walletByNetwork: Record<string, WalletLinkInfo>
) {
  const normalizedLabel = label.toLowerCase();
  if (normalizedLabel.includes("erc-20")) return walletByNetwork.erc20 ?? null;
  if (normalizedLabel.includes("bep-20")) return walletByNetwork.bep20 ?? null;
  if (normalizedLabel.includes("trc-20")) return walletByNetwork.trc20 ?? null;
  return null;
}

function toExternalUrl(value?: string | null) {
  return value && /^https?:\/\//i.test(value) ? value : "#";
}

function normalizeNetworkLabel(value?: string) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "ethereum") return "ERC-20";
  if (normalized === "bsc") return "BEP-20";
  if (normalized === "tron") return "TRC-20";
  return value || "--";
}

function normalizeNetworkKeyFromLabel(label: string) {
  const normalizedLabel = label.toLowerCase();
  if (normalizedLabel.includes("erc-20")) return "erc20";
  if (normalizedLabel.includes("bep-20")) return "bep20";
  if (normalizedLabel.includes("trc-20")) return "trc20";
  return "";
}

function hasMetaValue(meta: Record<string, unknown> | undefined, key: string) {
  return meta && meta[key] !== null && meta[key] !== undefined && meta[key] !== "";
}

function getDisplayAmount(item: AdminWithdrawal) {
  const netAmount = Number(item.meta?.netAmount);
  if (Number.isFinite(netAmount) && netAmount > 0) return netAmount;
  return Number(item.amount || 0);
}

function resolveAdminNote(item: AdminWithdrawal) {
  if (typeof item.adminNotes === "string" && item.adminNotes.trim()) return item.adminNotes.trim();
  if (typeof item.meta?.adminNotes === "string" && String(item.meta.adminNotes).trim()) {
    return String(item.meta.adminNotes).trim();
  }
  if (typeof item.meta?.reason === "string" && String(item.meta.reason).trim()) {
    return String(item.meta.reason).trim();
  }
  return "";
}

function getUserAvatarLabel(item: AdminWithdrawal) {
  const source = item.userName || item.email || String(item.userId || "U");
  const parts = source
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
