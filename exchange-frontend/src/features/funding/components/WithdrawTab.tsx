import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import { formatMoney } from "../../../utils/money";
import type { Pagination, WithdrawHistoryItem } from "../api/funding.api";
import { FundingNetworkIcon } from "./FundingNetworkIcon";

type Props = {
  availableBalance: string;
  withdrawWalletBalance: string;
  withdrawWalletBreakdown: {
    directDepositTotal: string;
    tradeProfitTotal: string;
    tenDaySalaryTotal: string;
    activeWithdrawalTotal: string;
  };
  withdrawalPolicy?: {
    policy: {
      withdrawalEnabled: boolean;
      withdrawalNote: string;
      adminFeePercent: number;
      lockPeriodDays: number;
      earlyPenaltyPercent: number;
      rewardReductionEnabled: boolean;
      rewardReductionType: string;
      minimumWithdrawalAmount: number;
      maximumWithdrawalAmount: number;
    };
    user: {
      createdAt: string | null;
      kycVerified: boolean;
      status: string;
      activeUser: boolean;
      canRequestWithdrawal: boolean;
      eligibilityWarnings: string[];
      accountAgeDays: number;
      lockActive: boolean;
      daysRemaining: number;
    };
    preview: {
      requestedAmount: number;
      adminFeeAmount: number;
      earlyPenaltyAmount: number;
      netAmount: number;
    };
  };
  networks: Array<{ network: string; label: string }>;
  selectedNetwork: string;
  onSelectNetwork: (network: string) => void;
  withdrawAddress: string;
  withdrawAmount: string;
  withdrawDetails: string;
  onWithdrawAddressChange: (value: string) => void;
  onWithdrawAmountChange: (value: string) => void;
  onWithdrawDetailsChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  submitting: boolean;
  message?: { tone: "success" | "error"; text: string } | null;
  history: WithdrawHistoryItem[];
  pagination: Pagination;
  onPageChange: (page: number) => void;
};

const formatFundingUsd = (value: string | number | null | undefined) => `$${formatMoney(value)}`;

export function WithdrawTab(props: Props) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const policy = props.withdrawalPolicy;
  const policyRules = policy?.policy;
  const policyUser = policy?.user;
  const preview = policy?.preview;
  const maxWithdrawableAmount = Math.max(0, Number(props.withdrawWalletBalance || 0));
  const eligibilityWarnings = Array.isArray(policyUser?.eligibilityWarnings) ? policyUser.eligibilityWarnings : [];
  const kycPending = policyUser?.kycVerified === false;
  const showSubmitButton = policyUser?.kycVerified === true;
  const mobileNetworkOrder: Record<string, number> = {
    tron: 0,
    bsc: 1,
    ethereum: 2,
  };
  const orderedNetworks = [...props.networks].sort(
    (a, b) => (mobileNetworkOrder[a.network] ?? 99) - (mobileNetworkOrder[b.network] ?? 99)
  );
  const needsKycNavigation =
    props.message?.text === "Complete KYC verification before submitting a withdrawal request.";

  const copyValue = async (value: string, key: string) => {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-2">
        <div className="exchange-card p-5 sm:border-0 sm:bg-transparent sm:p-1 sm:shadow-none">
          <div className="flex items-center gap-3">
            <FundingNetworkIcon network="wallet" />
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] sm:text-[13px] sm:tracking-[0.16em] lg:text-[12px]">Wallet Balance</div>
            </div>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <div className="text-[clamp(1.45rem,1.25rem+0.45vw,2.1rem)] font-black leading-none text-white lg:text-[clamp(1.6rem,1.35rem+0.35vw,2.05rem)]">
              {Number(props.availableBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
            </div>
            <div className="pb-0.5 text-[0.82rem] font-extrabold uppercase text-[var(--accent-yellow)] lg:text-[0.85rem]">USDT</div>
          </div>
          <div className="mt-2 text-[0.72rem] text-[var(--text-muted)] sm:text-[0.78rem] lg:text-[0.76rem]">
            {`~ $${Number(props.availableBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`}
          </div>
        </div>

        <div className="exchange-card p-5">
          <div className="flex items-center gap-3">
            <FundingNetworkIcon network="wallet" />
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--text-muted)] sm:text-[13px] sm:tracking-[0.16em] lg:text-[12px]">Withdraw Wallet Balance</div>
            </div>
          </div>
          <div className="mt-3 flex items-end gap-2">
            <div className="text-[clamp(1.45rem,1.25rem+0.45vw,2.1rem)] font-black leading-none text-white lg:text-[clamp(1.6rem,1.35rem+0.35vw,2.05rem)]">
              {Number(props.withdrawWalletBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}
            </div>
            <div className="pb-0.5 text-[0.82rem] font-extrabold uppercase text-[var(--accent-yellow)] lg:text-[0.85rem]">USDT</div>
          </div>
          <div className="mt-2 text-[0.72rem] text-[var(--text-muted)] sm:text-[0.78rem] lg:text-[0.76rem]">
            {`~ $${Number(props.withdrawWalletBalance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`}
          </div>
          {/* <div className="mt-4 rounded-[18px] border border-[var(--border-soft)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[11px] text-[var(--text-secondary)]">
            <div>Direct deposit: {formatFundingUsd(props.withdrawWalletBreakdown.directDepositTotal)}</div>
            <div>Trade profit: {formatFundingUsd(props.withdrawWalletBreakdown.tradeProfitTotal)}</div>
            <div>10-day salary: {formatFundingUsd(props.withdrawWalletBreakdown.tenDaySalaryTotal)}</div>
            <div>Less withdrawals: {formatFundingUsd(props.withdrawWalletBreakdown.activeWithdrawalTotal)}</div>
          </div> */}
        </div>
      </section>



      <section className="exchange-card p-5">
        <div className="section-title text-[1rem]">Withdraw USDT</div>
        <form className="mt-4 space-y-4" onSubmit={props.onSubmit}>
          <div>
            <div className="mb-3">
              <div className="section-title text-[0.94rem] sm:text-[1.2rem]">Select Network</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)] sm:text-[11px] sm:tracking-[0.12em]">Choose the chain for your USDT wallet</div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {orderedNetworks.map((item) => (
              <button
                key={item.network}
                type="button"
                onClick={() => props.onSelectNetwork(item.network)}
                className={`inline-flex w-full min-w-0 items-center gap-1.5 rounded-[18px] border px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.04em] transition sm:gap-2.5 sm:rounded-[22px] sm:px-4 sm:py-3 sm:text-[11px] sm:tracking-[0.08em] ${
                  props.selectedNetwork === item.network
                    ? "border-[var(--border-soft)] bg-[var(--accent-yellow)] text-[#111] shadow-[0_6px_14px_rgba(252,213,53,0.14)] sm:bg-[rgba(252,213,53,0.12)] sm:text-[var(--accent-yellow)] sm:shadow-none"
                    : "border-[var(--border-soft)] bg-[var(--bg-card)] text-[var(--text-muted)]"
                }`}
              >
                <FundingNetworkIcon network={item.network as "ethereum" | "bsc" | "tron"} size="xs" />
                <span className="block min-w-0">
                  <span className="block truncate text-[10px] font-bold tracking-[0.04em] sm:text-[11px] sm:tracking-[0.08em] sm:font-semibold">{item.label}</span>
                </span>
              </button>
            ))}
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Input value={props.withdrawAddress} onChange={(e) => props.onWithdrawAddressChange(e.target.value)} placeholder="Destination address" className="h-12" />
            <div className="space-y-2">
              <Input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={props.withdrawAmount}
                onChange={(e) => props.onWithdrawAmountChange(e.target.value)}
                placeholder="Amount"
                className="h-12"
              />
              <div className="text-xs text-[var(--text-muted)]">
                Maximum eligible amount: {maxWithdrawableAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} USDT
              </div>
            </div>
          </div>
          <textarea
            value={props.withdrawDetails}
            onChange={(e) => props.onWithdrawDetailsChange(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Write withdrawal details for admin review"
            className="min-h-28 w-full rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[var(--bg-input)] px-4 py-3 text-sm text-white placeholder:text-[var(--text-muted)] focus:border-[var(--accent-yellow)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(252,213,53,0.10)]"
          />
          {showSubmitButton ? (
            <Button
              type="submit"
              disabled={props.submitting || policyRules?.withdrawalEnabled === false || policyUser?.canRequestWithdrawal === false}
            >
              {props.submitting ? "Submitting..." : "Submit Withdrawal"}
            </Button>
          ) : null}
          {props.message &&
            (needsKycNavigation ? (
              <Link
                to="/app/kyc"
                className="inline-flex rounded-[14px] border border-[rgba(246,70,93,0.28)] bg-[rgba(246,70,93,0.10)] px-4 py-3 text-sm font-medium text-[var(--danger)] transition hover:border-[rgba(246,70,93,0.45)] hover:bg-[rgba(246,70,93,0.14)]"
              >
                {props.message.text}
              </Link>
            ) : (
              <div
                className={`text-sm ${
                  props.message.tone === "success"
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                }`}
              >
                {props.message.text}
              </div>
            ))}
        </form>
        
        {policyRules && (
        <section className="rounded-[24px] border border-[var(--border-soft)] bg-[rgba(252,213,53,0.06)] p-5">
          <div className="section-title text-[1rem]">Withdrawal Rules</div>
          <div className="mt-3 space-y-1.5 text-[12px] leading-5 text-[var(--text-secondary)]">
            {!policyRules.withdrawalEnabled && <div>Withdrawals are temporarily disabled by admin.</div>}
            {kycPending && (
              <Link to="/app/kyc" className="block font-medium text-[var(--danger)] underline-offset-2 hover:underline">
                KYC Pending: complete verification before sending a withdrawal request.
              </Link>
            )}
            {eligibilityWarnings.map((warning) => <div key={warning} className="text-[var(--danger)]">{warning}</div>)}
            {policyRules.lockPeriodDays > 0 && <div>Lock Period: {policyRules.lockPeriodDays} day(s)</div>}
            {policyUser?.lockActive && <div>Remaining lock time: {policyUser.daysRemaining} day(s).</div>}
            {policyRules.adminFeePercent > 0 && <div>Admin fee: {policyRules.adminFeePercent}%</div>}
            {policyRules.earlyPenaltyPercent > 0 && <div>Early withdrawal penalty: {policyRules.earlyPenaltyPercent}%</div>}
            {/* {policyRules.rewardReductionEnabled && <div>Reward reduction: {policyRules.rewardReductionType || "Enabled"}</div>} */}
            {policyRules.withdrawalNote && <div>{policyRules.withdrawalNote}</div>}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <PolicyMetric label="Requested" value={formatFundingUsd(preview?.requestedAmount ?? 0)} />
            <PolicyMetric label="Admin Fee" value={formatFundingUsd(preview?.adminFeeAmount ?? 0)} />
            <PolicyMetric label="Penalty" value={formatFundingUsd(preview?.earlyPenaltyAmount ?? 0)} />
            <PolicyMetric label="You Receive" value={formatFundingUsd(preview?.netAmount ?? 0)} />
          </div>
        </section>
      )}
      </section>

      <section className="space-y-4">
        <div className="section-title">Recent Activity</div>
        <div className="space-y-3">
          {props.history.map((item) => (
            <div key={item.id} className="rounded-[20px] border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-white sm:text-[1.75rem]">
                    {formatFundingUsd(Number(item.meta?.netAmount || item.amount || 0))}
                  </div>
                  {item.txn_id ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--accent-yellow)]">
                      <span className="break-all">Txn ID: {item.txn_id}</span>
                      <CopyAction
                        value={item.txn_id}
                        copyKey={`withdraw-${item.id}-txn-id`}
                        copiedKey={copiedKey}
                        onCopy={copyValue}
                      />
                    </div>
                  ) : null}
                </div>
                <div className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] ${getWithdrawStatusBadgeCls(item.status)}`}>
                  {item.status}
                </div>
              </div>
              <div className="mt-3 space-y-3">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Destination address</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {item.explorerUrl ? (
                      <a
                        href={item.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-[var(--accent-yellow)] transition hover:text-[var(--accent-yellow-hover)]"
                        title={item.address}
                      >
                        {shortHash(item.address)}
                      </a>
                    ) : (
                      <span className="break-all text-sm text-[var(--text-secondary)]">{item.address}</span>
                    )}
                    <CopyAction
                      value={item.address}
                      copyKey={`withdraw-${item.id}-address`}
                      copiedKey={copiedKey}
                      onCopy={copyValue}
                    />
                  </div>
                </div>
                {item.txHash ? (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Transaction hash</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {item.txExplorerUrl ? (
                        <a
                          href={item.txExplorerUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[11px] text-[var(--accent-yellow)] transition hover:text-[var(--accent-yellow-hover)]"
                          title={item.txHash}
                        >
                          {shortHash(item.txHash)}
                        </a>
                      ) : (
                        <span className="break-all text-sm text-[var(--text-secondary)]">{item.txHash}</span>
                      )}
                      <CopyAction
                        value={item.txHash}
                        copyKey={`withdraw-${item.id}-tx-hash`}
                        copiedKey={copiedKey}
                        onCopy={copyValue}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">{new Date(item.createdAt).toLocaleString()}</div>
            </div>
          ))}
          {!props.history.length && <div className="text-sm text-[var(--text-muted)]">No withdraw history found.</div>}
        </div>
        <div className="flex flex-col gap-3 text-xs text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
          <span>Page {props.pagination.page} of {Math.max(props.pagination.totalPages, 1)}</span>
          <div className="flex gap-2 self-end sm:self-auto">
            <button type="button" onClick={() => props.onPageChange(Math.max(1, props.pagination.page - 1))} className="rounded-[10px] border border-[var(--border-soft)] px-3 py-2">Prev</button>
            <button type="button" onClick={() => props.onPageChange(Math.min(Math.max(props.pagination.totalPages, 1), props.pagination.page + 1))} className="rounded-[10px] border border-[var(--border-soft)] px-3 py-2">Next</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function PolicyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[var(--border-soft)] bg-[var(--bg-card)] p-4">
      <div className="micro-label">{label}</div>
      <div className="mt-2 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function CopyAction({
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
      className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] transition ${
        copied
          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
          : "border-[var(--border-soft)] text-[var(--text-muted)] hover:text-white"
      }`}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function getWithdrawStatusBadgeCls(status: string) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "approved" || normalized === "completed" || normalized === "confirmed") {
    return "bg-[rgba(34,197,94,0.16)] text-[#86efac] border border-[rgba(34,197,94,0.28)]";
  }
  if (normalized === "rejected" || normalized === "failed" || normalized === "cancelled") {
    return "bg-[rgba(246,70,93,0.14)] text-[#fca5a5] border border-[rgba(246,70,93,0.24)]";
  }
  return "bg-[rgba(255,255,255,0.08)] text-[var(--text-secondary)] border border-transparent";
}

function shortHash(value: string) {
  return value.length > 22 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
