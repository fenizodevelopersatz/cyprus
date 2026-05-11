import { useEffect, useState } from "react";
import { useAuth } from "../../auth/state/auth.store";
import Dialog from "../../../ui/Dialog";
import { DepositTab } from "../components/DepositTab";
import { FundingTabs } from "../components/FundingTabs";
import { WithdrawTab } from "../components/WithdrawTab";
import { useFundingData } from "../hooks/useFundingData";
import { getLevelImageSrc, getLevelLabel } from "../../../utils/levelImages";
import { getUserProfile } from "../../settings/api/account.api";
import { loadWithdrawAddressBook } from "../../settings/utils/withdrawAddressBook";

type DefaultWithdrawAddresses = Partial<Record<"tron" | "bsc" | "ethereum", string>>;

export default function FundingPage() {
  const funding = useFundingData();
  const user = useAuth((state) => state.user);
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");
  const [copied, setCopied] = useState(false);
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAddressTouched, setWithdrawAddressTouched] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawDetails, setWithdrawDetails] = useState("");
  const [withdrawMessage, setWithdrawMessage] = useState<string | null>(null);
  const [levelPreviewOpen, setLevelPreviewOpen] = useState(false);
  const [defaultWithdrawAddresses, setDefaultWithdrawAddresses] = useState<DefaultWithdrawAddresses>({});
  const withdrawAmountNumber = Number(withdrawAmount || 0);
  const userLevelImage = getLevelImageSrc(user?.currentLevelCode, user?.currentLevelRank);
  const userLevelLabel = getLevelLabel(user?.currentLevelCode, user?.currentLevelRank);

  useEffect(() => {
    let active = true;

    const loadProfileDefaults = async () => {
      try {
        const addressBook = loadWithdrawAddressBook();
        if (active) {
          setDefaultWithdrawAddresses(addressBook.current);
        }

        const profile = await getUserProfile();
        if (!active) return;
        const normalizedNetwork = profile.default_withdraw_wallet_network as keyof DefaultWithdrawAddresses;
        const normalizedAddress = profile.default_withdraw_wallet_address?.trim() || "";

        if (normalizedAddress && (normalizedNetwork === "tron" || normalizedNetwork === "bsc" || normalizedNetwork === "ethereum")) {
          setDefaultWithdrawAddresses((current) => ({
            ...current,
            [normalizedNetwork]: current[normalizedNetwork] || normalizedAddress,
          }));
          if (!withdrawAddressTouched && funding.selectedNetwork === normalizedNetwork) {
            setWithdrawAddress(addressBook.current[normalizedNetwork] || normalizedAddress);
          }
        }
        if (profile.default_withdraw_wallet_network && funding.summary?.depositAddresses?.length) {
          const matchedNetwork = funding.summary.depositAddresses.find(
            (item) => item.network === profile.default_withdraw_wallet_network
          );
          if (matchedNetwork) {
            funding.setSelectedNetwork(matchedNetwork.network);
          }
        }
      } catch {
        // Keep the funding flow usable even if profile defaults fail to load.
      }
    };

    void loadProfileDefaults();
    return () => {
      active = false;
    };
  }, [funding.selectedNetwork, funding.summary?.depositAddresses, funding.setSelectedNetwork, withdrawAddressTouched]);

  useEffect(() => {
    if (withdrawAddressTouched) return;
    const defaultAddress = defaultWithdrawAddresses[funding.selectedNetwork as keyof DefaultWithdrawAddresses] || "";
    setWithdrawAddress(defaultAddress);
  }, [defaultWithdrawAddresses, funding.selectedNetwork, withdrawAddressTouched]);

  useEffect(() => {
    if (activeTab !== "deposit" || !funding.summary) return;

    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void funding.refreshDeposits().catch(() => undefined);
      }
    }, 20000);

    return () => window.clearInterval(timer);
  }, [activeTab, funding.refreshDeposits, funding.summary]);

  const liveWithdrawalPolicy = funding.summary?.withdrawalPolicy
    ? {
        ...funding.summary.withdrawalPolicy,
        preview: {
          requestedAmount: Number.isFinite(withdrawAmountNumber) ? withdrawAmountNumber : 0,
          adminFeeAmount: Number.isFinite(withdrawAmountNumber)
            ? (withdrawAmountNumber * (funding.summary.withdrawalPolicy.policy.adminFeePercent || 0)) / 100
            : 0,
          earlyPenaltyAmount:
            Number.isFinite(withdrawAmountNumber) && funding.summary.withdrawalPolicy.user.lockActive
              ? (withdrawAmountNumber * (funding.summary.withdrawalPolicy.policy.earlyPenaltyPercent || 0)) / 100
              : 0,
          netAmount: 0,
        },
      }
    : undefined;

  if (liveWithdrawalPolicy) {
    liveWithdrawalPolicy.preview.netAmount = Math.max(
      0,
      liveWithdrawalPolicy.preview.requestedAmount -
        liveWithdrawalPolicy.preview.adminFeeAmount -
        liveWithdrawalPolicy.preview.earlyPenaltyAmount
    );
  }

  const handleNetworkSelect = (network: string) => {
    const currentScrollY = window.scrollY;
    const defaultAddress = defaultWithdrawAddresses[network as keyof DefaultWithdrawAddresses] || "";

    setWithdrawAddressTouched(false);
    setWithdrawAddress(defaultAddress);
    funding.setSelectedNetwork(network);

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: currentScrollY, behavior: "auto" });
    });
  };

  async function handleCopy() {
    if (!funding.selectedAddress?.address) return;
    await navigator.clipboard.writeText(funding.selectedAddress.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const handleTabChange = (tab: "deposit" | "withdraw") => {
    setActiveTab(tab);
    if (tab === "withdraw" && funding.summary?.withdrawalPolicy?.user.kycVerified === false) {
      // setWithdrawMessage("KYC pending. Complete KYC verification before submitting a withdrawal request.");
      return;
    }
    if (tab === "withdraw" && funding.summary?.withdrawalPolicy?.user.activeUser === false) {
      setWithdrawMessage("Your account is not active yet. Withdrawal is available only for active users.");
      return;
    }
    setWithdrawMessage(null);
  };

  async function handleWithdrawalSubmit(event: React.FormEvent) {
    event.preventDefault();
    setWithdrawMessage(null);
    const amount = Number(withdrawAmount);
    if (!funding.selectedAddress) return setWithdrawMessage("Select a network first.");
    if (!withdrawAddress.trim()) return setWithdrawMessage("Destination address is required.");
    if (!Number.isFinite(amount) || amount <= 0) return setWithdrawMessage("Enter a valid amount.");
    if (liveWithdrawalPolicy && !liveWithdrawalPolicy.user.activeUser) return setWithdrawMessage("Withdrawal is allowed only for active users.");
    if (liveWithdrawalPolicy && !liveWithdrawalPolicy.user.kycVerified) return setWithdrawMessage("Complete KYC verification before submitting a withdrawal request.");

    try {
      await funding.submitWithdrawal({
        address: withdrawAddress.trim(),
        amount,
        asset: "USDT",
        chain:
          funding.selectedAddress.network === "ethereum"
            ? "ERC20"
            : funding.selectedAddress.network === "bsc"
            ? "BEP20"
            : "TRC20",
        details: withdrawDetails.trim() || undefined,
      });
      setWithdrawAddress(defaultWithdrawAddresses[funding.selectedNetwork as keyof DefaultWithdrawAddresses] || "");
      setWithdrawAddressTouched(false);
      setWithdrawAmount("");
      setWithdrawDetails("");
      setWithdrawMessage("Withdrawal request submitted.");
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Withdrawal failed.";
      if (rawMessage.includes("WITHDRAWAL_REQUIRES_ACTIVE_USER")) return setWithdrawMessage("Withdrawal is allowed only for active users.");
      if (rawMessage.includes("WITHDRAWAL_REQUIRES_KYC")) return setWithdrawMessage("Complete KYC verification before submitting a withdrawal request.");
      setWithdrawMessage(rawMessage);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 text-[13px] text-slate-100 sm:text-sm">
      <header className="exchange-card exchange-card-strong overflow-hidden p-0">
        <div className="relative flex items-center justify-between px-5 py-6">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.08),transparent)]" />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setLevelPreviewOpen(true)}
              className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-[var(--border-soft)] bg-[linear-gradient(180deg,#2a2f36_0%,#1b2026_100%)] shadow-[0_0_20px_rgba(255,255,255,0.04)] transition hover:scale-[1.03] active:scale-[0.98]"
              aria-label={`Open ${userLevelLabel} preview`}
            >
              <img src={userLevelImage} alt={userLevelLabel} className="h-full w-full object-cover" />
            </button>
            <div>
              <div className="page-title text-[clamp(1.25rem,1.08rem+0.45vw,1.75rem)] uppercase tracking-[0.08em]">Wallet</div>            
            </div>
          </div>
          {/* <button type="button" className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[linear-gradient(180deg,#2a2f36_0%,#1b2026_100%)] text-[var(--accent-yellow)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z"/></svg>
          </button> */}
        </div>
      </header>

      <section className="exchange-card exchange-card-strong p-4 sm:p-5">
        <div className="rounded-[22px] border border-[var(--border-soft)] bg-[linear-gradient(180deg,rgba(255,255,255,0.03)_0%,rgba(255,255,255,0.015)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_30px_rgba(255,255,255,0.02)]">
          <FundingTabs activeTab={activeTab} onChange={handleTabChange} />
        </div>
      </section>

      {funding.error && (
        <div className="rounded-[18px] border border-[rgba(246,70,93,0.25)] bg-[rgba(246,70,93,0.12)] px-4 py-3 text-[12px] text-[var(--danger)]">
          {funding.error}
        </div>
      )}

      {funding.loading || !funding.summary ? (
        <div className="exchange-card px-6 py-16 text-center text-[12px] text-[var(--text-muted)]">Loading funding data...</div>
      ) : activeTab === "deposit" ? (
        <DepositTab
          total={funding.summary.mainWalletBalance}
          breakdown={funding.summary.balance.breakdown}
          adminAdjustmentBalance={funding.summary.adminAdjustmentBalance}
          addresses={funding.summary.depositAddresses}
          selectedNetwork={funding.selectedNetwork}
          onSelectNetwork={handleNetworkSelect}
          selectedAddress={funding.selectedAddress}
          copied={copied}
          onCopy={handleCopy}
          onRefresh={() => void funding.refreshDeposits()}
          refreshing={funding.refreshingDeposits}
          items={funding.depositHistory}
          pagination={funding.depositPagination}
          filterNetwork={funding.depositFilterNetwork}
          onFilterNetwork={(network) => void funding.changeDepositFilter(network)}
          onPageChange={(page) => void funding.changeDepositPage(page)}
          updatedAt={funding.summary.updatedAt}
        />
      ) : (
        <WithdrawTab
          availableBalance={funding.summary.mainWalletBalance}
          withdrawalPolicy={liveWithdrawalPolicy}
          networks={funding.summary.depositAddresses.map((item) => ({ network: item.network, label: item.label }))}
          selectedNetwork={funding.selectedNetwork}
          onSelectNetwork={handleNetworkSelect}
          withdrawAddress={withdrawAddress}
          withdrawAmount={withdrawAmount}
          withdrawDetails={withdrawDetails}
          onWithdrawAddressChange={(value) => {
            setWithdrawAddressTouched(true);
            setWithdrawAddress(value);
          }}
          onWithdrawAmountChange={setWithdrawAmount}
          onWithdrawDetailsChange={setWithdrawDetails}
          onSubmit={handleWithdrawalSubmit}
          submitting={funding.submittingWithdrawal}
          message={withdrawMessage}
          history={funding.withdrawHistory}
          pagination={funding.withdrawPagination}
          onPageChange={(page) => void funding.changeWithdrawPage(page)}
        />
      )}

      <Dialog
        open={levelPreviewOpen}
        onClose={() => setLevelPreviewOpen(false)}
        title="Level Preview"
        panelClassName="max-w-sm"
      >
        <div className="flex flex-col items-center text-center">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border border-[var(--border-soft)] bg-[linear-gradient(180deg,#2a2f36_0%,#1b2026_100%)] shadow-[0_0_24px_rgba(255,255,255,0.06)]">
            <img src={userLevelImage} alt={userLevelLabel} className="h-full w-full object-cover" />
          </div>
          <div className="mt-4 text-lg font-semibold text-white">{userLevelLabel}</div>
          <div className="mt-2 text-sm text-[var(--text-secondary)]">
            Your wallet page now uses the same tap-to-preview level behavior as the dashboard.
          </div>
        </div>
      </Dialog>
    </div>
  );
}
