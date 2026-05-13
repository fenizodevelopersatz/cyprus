import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import {
  cancelSipSubscription,
  createSipSubscription,
  fetchSipCatalog,
  fetchSipOrders,
  fetchSipHistory,
  fetchSipSubscriptions,
  pauseSipSubscription,
  previewSipSubscription,
  resumeSipSubscription,
  type SipCatalog,
  type SipCoin,
  type SipContributionType,
  type SipFrequency,
  type SipOrder,
  type SipPreviewRequest,
  type SipPlan,
  type SipPreviewResponse,
  type SipCreateSubscriptionRequest,
  type SipSubscription,
} from "../api/sip.api";

const formatCurrency = (value?: string | number | null, currency = "USD") => {
  if (value === null || value === undefined || value === "") return "--";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(numeric);
};

const formatQuantity = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") return "--";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 8,
  }).format(numeric);
};

const formatTokenAmount = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") return "--";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(numeric);
};

const formatDateTime = (iso?: string | null) => {
  if (!iso) return "--";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "--";
  return new Date(ts).toLocaleString();
};

const toDateTimeLocalValue = (date: Date) => {
  const pad = (num: number) => String(num).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};
const getErrorMessage = (error: unknown) => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybeAxios = error as { response?: { data?: unknown; statusText?: string } };
    const data = maybeAxios.response?.data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      if ("message" in data && typeof (data as any).message === "string") return (data as any).message;
      if ("error" in data && typeof (data as any).error === "string") return (data as any).error;
    }
    if (maybeAxios.response?.statusText) return maybeAxios.response.statusText;
  }
  return "Something went wrong";
};

const buildStartAtDefault = () => {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  return toDateTimeLocalValue(start);
};

type SubscriptionAction = "pause" | "resume" | "cancel" | null;

export default function SipPage() {
  const [catalog, setCatalog] = useState<SipCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedAsset, setSelectedAsset] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [contributionType, setContributionType] = useState<SipContributionType>("QUANTITY");
  const [frequency, setFrequency] = useState<SipFrequency>("DAILY");
  const [amountAsset, setAmountAsset] = useState("0.001");
  const [startAtLocal, setStartAtLocal] = useState(buildStartAtDefault);
  const [autoPauseOnFail, setAutoPauseOnFail] = useState(true);
  const [walletSource, setWalletSource] = useState("spot:available");
  const [preview, setPreview] = useState<SipPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptions, setSubscriptions] = useState<SipSubscription[]>([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [subscriptionsError, setSubscriptionsError] = useState<string | null>(null);
  const [subscriptionTab, setSubscriptionTab] = useState<"ACTIVE" | "PAUSED" | "CANCELLED" | "ALL">("ACTIVE");
  const [orders, setOrders] = useState<SipOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [orderTab, setOrderTab] = useState<"recent" | "history">("recent");
  const [subscriptionActionId, setSubscriptionActionId] = useState<number | null>(null);
  const [subscriptionActionError, setSubscriptionActionError] = useState<string | null>(null);

  const coins = catalog?.coins ?? [];
  const plans = catalog?.plans ?? [];
  const supportedFiats = catalog?.settings?.supportedFiats ?? ["USD"];
  const selectedCoin: SipCoin | null = useMemo(() => {
    if (!selectedAsset) return null;
    return coins.find((coin) => coin.asset === selectedAsset) ?? null;
  }, [coins, selectedAsset]);

  const selectedPlan: SipPlan | null = useMemo(() => {
    if (!plans.length) return null;
    if (selectedPlanId) {
      const match = plans.find((plan) => plan.id === selectedPlanId);
      if (match && selectedAsset && match.asset !== selectedAsset) return null;
      return match ?? null;
    }
    if (!selectedAsset) return null;
    return plans.find((plan) => plan.asset === selectedAsset) ?? null;
  }, [plans, selectedPlanId, selectedAsset]);

  const supportedFrequencies = selectedPlan?.allowedFrequencies ?? catalog?.settings?.scheduleOptions ?? [];
  const allowQuantityInput = selectedPlan ? selectedPlan.allowQuantityInput : true;
  const contributionCurrency = selectedPlan?.quoteCurrency ?? supportedFiats[0] ?? "USD";
  const contributionAsset = selectedAsset || selectedPlan?.asset || selectedCoin?.asset || "BTC";
  const resolvedLimits = {
    minAsset: preview?.limits?.minAsset ?? selectedPlan?.minAssetQuantity ?? catalog?.settings?.minAssetQuantity ?? null,
    maxAsset: preview?.limits?.maxAsset ?? selectedPlan?.maxAssetQuantity ?? catalog?.settings?.maxAssetQuantity ?? null,
  };
  const walletCheck = preview?.walletCheck ?? null;
  const walletCheckInsufficient = walletCheck ? walletCheck.sufficient === false : false;
  const filteredSubscriptions = subscriptions.filter((sub) => {
    if (subscriptionTab === "ALL") return true;
    return sub.status?.toUpperCase() === subscriptionTab;
  });
  const tabCounts = subscriptions.reduce<Record<"ACTIVE" | "PAUSED" | "CANCELLED", number>>(
    (acc, sub) => {
      const status = sub.status?.toUpperCase();
      if (status === "ACTIVE" || status === "PAUSED" || status === "CANCELLED") {
        acc[status] += 1;
      }
      return acc;
    },
    { ACTIVE: 0, PAUSED: 0, CANCELLED: 0 }
  );

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const response = await fetchSipCatalog();
      setCatalog(response);
      const fallbackAsset = response.coins?.[0]?.asset ?? response.plans?.[0]?.asset ?? "";
      setSelectedAsset((prev) => (prev ? prev : fallbackAsset));
      setFrequency(response.settings.defaultFrequency);
    } catch (error) {
      setCatalogError(getErrorMessage(error));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  const loadSubscriptions = useCallback(async () => {
    setSubscriptionsLoading(true);
    setSubscriptionsError(null);
    try {
      const payload = await fetchSipSubscriptions();
      setSubscriptions(payload);
    } catch (error) {
      setSubscriptionsError(getErrorMessage(error));
    } finally {
      setSubscriptionsLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const payload =
        orderTab === "history"
          ? await fetchSipHistory({ limit: 100, status: "EXECUTED" })
          : await fetchSipOrders({ limit: 10, recent: true });
      setOrders(payload);
    } catch (error) {
      setOrdersError(getErrorMessage(error));
    } finally {
      setOrdersLoading(false);
    }
  }, [orderTab]);

  useEffect(() => {
    void loadCatalog();
    void loadSubscriptions();
    void loadOrders();
  }, [loadCatalog, loadSubscriptions, loadOrders]);

  useEffect(() => {
    if (!catalog || !selectedAsset) return;
    if (!plans.length) {
      if (selectedPlanId !== null) setSelectedPlanId(null);
      return;
    }
    const current = plans.find((plan) => plan.id === selectedPlanId);
    if (current && current.asset === selectedAsset) return;
    const fallback = plans.find((plan) => plan.asset === selectedAsset) ?? null;
    setSelectedPlanId(fallback?.id ?? null);
  }, [catalog, plans, selectedAsset, selectedPlanId]);

  useEffect(() => {
    if (!catalog) return;
    const availableFrequencies = supportedFrequencies.length
      ? supportedFrequencies
      : catalog.settings.scheduleOptions ?? [];
    setFrequency((current) => {
      if (availableFrequencies.includes(current)) return current;
      if (availableFrequencies.includes(catalog.settings.defaultFrequency)) {
        return catalog.settings.defaultFrequency;
      }
      return availableFrequencies[0] ?? current;
    });
    setContributionType("QUANTITY");
    if (allowQuantityInput) {
      const baseQty = selectedPlan?.minAssetQuantity ?? catalog.settings.minAssetQuantity ?? "0.0001";
      setAmountAsset(String(baseQty));
    }
    setPreview(null);
    setFormError(null);
  }, [catalog, selectedPlan, allowQuantityInput, supportedFrequencies, supportedFiats]);

  const requireAssetSelection = () => {
    if (selectedAsset) return true;
    setFormError("Select a coin first.");
    return false;
  };

  const buildPreviewPayload = () => {
    if (!requireAssetSelection()) return null;
    if (!allowQuantityInput) {
      setFormError("Quantity-based SIPs are not available for this coin template yet.");
      return null;
    }
    if (!amountAsset || Number(amountAsset) <= 0) {
      setFormError("Enter a quantity greater than zero.");
      return null;
    }
    return {
      asset: selectedAsset,
      contributionType,
      frequency,
      amountAsset,
      quoteCurrency: contributionCurrency,
      walletSource,
    } as const;
  };
  const handlePreview = async () => {
    const basePayload = buildPreviewPayload();
    if (!basePayload) return;
    setPreviewLoading(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const payload: SipPreviewRequest = { ...basePayload };
      if (selectedPlan) payload.planId = selectedPlan.id;
      const result = await previewSipSubscription(payload);
      setPreview(result);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSubscribe = async () => {
    const basePayload = buildPreviewPayload();
    if (!basePayload) return;
    const startDate = new Date(startAtLocal);
    if (Number.isNaN(startDate.getTime())) {
      setFormError("Choose a valid start time.");
      return;
    }
    setSubscriptionLoading(true);
    setFormError(null);
    setFormSuccess(null);
    try {
      const payload: SipCreateSubscriptionRequest = {
        ...basePayload,
        startAt: startDate.toISOString(),
        autoPauseOnFail,
        walletSource,
      };
      if (selectedPlan) payload.planId = selectedPlan.id;
      await createSipSubscription(payload);
      setFormSuccess("SIP subscription scheduled successfully.");
      await Promise.all([loadSubscriptions(), loadOrders()]);
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setSubscriptionLoading(false);
    }
  };

  const handleSubscriptionAction = async (sub: SipSubscription, action: SubscriptionAction) => {
    if (!action) return;
    setSubscriptionActionId(sub.id);
    setSubscriptionActionError(null);
    try {
      if (action === "pause") {
        await pauseSipSubscription(sub.id);
      } else if (action === "resume") {
        await resumeSipSubscription(sub.id);
      } else if (action === "cancel") {
        await cancelSipSubscription(sub.id);
      }
      await loadSubscriptions();
    } catch (error) {
      setSubscriptionActionError(getErrorMessage(error));
    } finally {
      setSubscriptionActionId(null);
    }
  };

  const hero = catalog?.hero;
  const scheduleCopy = catalog?.settings?.scheduleOptions ?? [];
  if (catalogLoading && !catalog) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-100">
        <div className="rounded-3xl border border-indigo-500/40 bg-indigo-500/10 px-6 py-5 text-sm shadow-lg shadow-indigo-500/30">
          Loading SIP catalog...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 text-slate-100">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/70 to-indigo-900/60 p-6 shadow-[0_35px_120px_-70px_rgba(79,70,229,0.7)]">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex-1">
            <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-300/80">Primerica SIP</p>
            <h1 className="text-3xl font-semibold text-white">{hero?.title ?? "SIP for Cryptos"}</h1>
            <p className="mt-1 text-sm text-slate-300/80">
              {hero?.subtitle ??
                "Pick a coin, enter a target quantity, preview allocations, and automate recurring accumulation."}
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs text-slate-300 min-w-[220px]">
            <div className="text-[11px] uppercase tracking-[0.25em] text-slate-400">Supported fiats</div>
            <div className="mt-1 text-lg font-semibold text-white">{supportedFiats.join(" / ")}</div>
            <div className="mt-3 text-[11px] uppercase tracking-[0.2em] text-slate-400">Schedules</div>
            <div className="mt-1 text-sm text-white">
              {scheduleCopy.length ? scheduleCopy.join(" - ") : "Configure via admin settings"}
            </div>
            {!catalog?.enabled && (
              <div className="mt-3 rounded-xl border border-amber-300/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                SIP catalog disabled via admin settings.
              </div>
            )}
          </div>
        </div>
        {hero?.sections?.length ? (
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {hero.sections.map((section) => (
              <div
                key={section.title}
                className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200"
              >
                <div className="text-xs uppercase tracking-[0.16em] text-slate-400">{section.title}</div>
                <p className="mt-2 text-slate-200/90">{section.body}</p>
              </div>
            ))}
          </div>
        ) : null}
      </header>
      {catalogError && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {catalogError}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Plans catalog</div>
              <p className="text-sm text-slate-300/80">Templates created by admins for popular coins.</p>
            </div>
            <Button size="sm" variant="ghost" onClick={loadCatalog} disabled={catalogLoading}>
              {catalogLoading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
          <div className="mt-4 space-y-3 max-h-[500px] overflow-y-auto pr-1">
            {plans.length ? (
              plans.map((plan) => {
                const isActive = selectedPlan?.id === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => {
                      setSelectedPlanId(plan.id);
                      setSelectedAsset(plan.asset);
                    }}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                      isActive
                        ? "border-emerald-400/70 bg-emerald-500/10 text-white shadow-[0_20px_80px_-50px_rgba(16,185,129,0.8)]"
                        : "border-white/10 bg-white/5 text-slate-200 hover:border-emerald-400/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-lg font-semibold text-white">{plan.nickname}</div>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">
                        {plan.asset}/{plan.quoteCurrency}
                      </span>
                      <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] text-indigo-100">
                        {plan.allowedFrequencies.join(" - ")}
                      </span>
                      <span className="ml-auto text-xs uppercase tracking-[0.2em] text-slate-400">{plan.status}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-300/80">{plan.description}</div>
                    <div className="mt-2 grid gap-2 text-xs text-slate-300/70 sm:grid-cols-2">
                      <span>
                        Amounts: {plan.allowAmountInput ? `${formatCurrency(plan.minFiatAmount, plan.quoteCurrency)} min` : "Disabled"}
                      </span>
                      <span>
                        Quantity: {plan.allowQuantityInput ? `${plan.minAssetQuantity ?? "0"} ${plan.asset}` : "Disabled"}
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300/80">
                No SIP templates yet. Users can still configure SIPs from the coin picker below.
              </div>
            )}
          </div>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Plan composer</div>
              <p className="text-sm text-slate-300/80">
                Choose a coin, enter the asset quantity, preview, and start the SIP.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-3 text-sm text-slate-200">
            <div>
              <label className="text-xs text-slate-400">Coin</label>
              <select
                value={selectedAsset}
                onChange={(event) => setSelectedAsset(event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
              >
                {!coins.length && <option value="">No coins configured</option>}
                {coins.map((coin) => (
                  <option key={coin.asset} value={coin.asset} className="bg-slate-900 text-white">
                    {coin.asset} ({coin.symbol})
                  </option>
                ))}
              </select>
              {selectedCoin ? (
                <div className="mt-2 text-xs text-slate-400">
                  USD {formatCurrency(selectedCoin.lastPriceUsd, "USD")}
                </div>
              ) : !coins.length ? (
                <div className="mt-2 text-xs text-amber-200">Admins must configure allowed coins first.</div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
              Fiat-based SIPs are temporarily disabled. Configure recurring purchases using asset quantities only.
            </div>
            <div>
              <label className="text-xs text-slate-400">Quantity ({contributionAsset})</label>
              <Input value={amountAsset} onChange={(event) => setAmountAsset(event.target.value)} />
              {(resolvedLimits.minAsset || resolvedLimits.maxAsset) && (
                <div className="mt-1 text-xs text-slate-400">
                  Min {resolvedLimits.minAsset ? `${formatQuantity(resolvedLimits.minAsset)} ${contributionAsset}` : "--"} / Max{" "}
                  {resolvedLimits.maxAsset ? `${formatQuantity(resolvedLimits.maxAsset)} ${contributionAsset}` : "unlimited"}
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-400">Schedule</label>
              <select
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
              >
                {(supportedFrequencies.length ? supportedFrequencies : [frequency]).map((option) => (
                  <option key={option} value={option} className="bg-slate-900 text-white">
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">Start at</label>
              <input
                type="datetime-local"
                value={startAtLocal}
                onChange={(event) => setStartAtLocal(event.target.value)}
                className="mt-1 w-full rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-indigo-400 focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300/80">
              <input
                type="checkbox"
                checked={autoPauseOnFail}
                onChange={(event) => setAutoPauseOnFail(event.target.checked)}
                className="h-4 w-4 rounded border border-white/30 bg-transparent"
              />
              Auto pause after consecutive failures
            </label>
            <div>
              <label className="text-xs text-slate-400">Wallet source</label>
              <Input value={walletSource} onChange={(event) => setWalletSource(event.target.value)} />
              {walletCheck ? (
                <div
                  className={`mt-2 rounded-2xl border px-3 py-2 text-xs ${
                    walletCheckInsufficient ? "border-rose-500/40 bg-rose-500/10 text-rose-100" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  }`}
                >
                  {walletCheckInsufficient ? (
                    <span>
                      You need {walletCheck.required ? formatTokenAmount(walletCheck.required) : "--"} {walletCheck.asset} in {walletSource}.
                      Available {walletCheck.available ? formatTokenAmount(walletCheck.available) : "--"} {walletCheck.asset}.
                    </span>
                  ) : (
                    <span>
                      Ready: {walletCheck.available ? formatTokenAmount(walletCheck.available) : "--"} {walletCheck.asset} available in {walletSource}.
                      Required {walletCheck.required ? formatTokenAmount(walletCheck.required) : "--"} {walletCheck.asset}.
                    </span>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-xs text-slate-400">Preview to check wallet balances before scheduling.</div>
              )}
            </div>
            {formError && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                {formError}
              </div>
            )}
            {formSuccess && (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                {formSuccess}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={handlePreview} disabled={previewLoading || !selectedAsset}>
                {previewLoading ? "Previewing..." : "Preview allocation"}
              </Button>
              <Button
                size="sm"
                onClick={handleSubscribe}
                disabled={!catalog?.enabled || subscriptionLoading || !selectedAsset || walletCheckInsufficient}
              >
                {subscriptionLoading ? "Scheduling..." : "Start SIP"}
              </Button>
            </div>
            {walletCheckInsufficient && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                Low balance: add funds or edit the quantity before scheduling.
              </div>
            )}
            {preview && (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-300/80 space-y-1">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Preview</div>
                <div className="mt-1 text-white">
                  {formatQuantity(preview.amountAsset)} {preview.asset} every {preview.frequency.toLowerCase()}
                </div>
                {preview.amountFiat && (
                  <div className="text-xs text-slate-400">~ {formatCurrency(preview.amountFiat, preview.quoteCurrency)} per run</div>
                )}
                {preview.reserveAsset && preview.reserveAssetAmount && (
                  <div className="text-xs text-indigo-200">
                    Reserved: {formatTokenAmount(preview.reserveAssetAmount)} {preview.reserveAsset} will be locked now.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Active subscriptions</div>
            <p className="text-sm text-slate-300/80">Pause, resume, or cancel automated runs.</p>
          </div>
          <div className="flex flex-wrap gap-1 text-xs text-slate-300/80">
            {(["ACTIVE", "PAUSED", "CANCELLED", "ALL"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSubscriptionTab(tab)}
                className={`rounded-full border px-3 py-1 uppercase tracking-[0.16em] ${
                  subscriptionTab === tab ? "border-emerald-400/70 bg-emerald-500/15 text-white" : "border-white/10"
                }`}
              >
                {tab === "ALL" ? "All" : tab.toLowerCase()}
                {tab !== "ALL" ? ` (${tabCounts[tab]})` : ""}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={loadSubscriptions} disabled={subscriptionsLoading}>
            {subscriptionsLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        {subscriptionActionError && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {subscriptionActionError}
          </div>
        )}
        {subscriptionsError && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {subscriptionsError}
          </div>
        )}
        {!filteredSubscriptions.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300/80">
            {subscriptions.length === 0
              ? "You have not scheduled any SIPs yet. Use the composer above to get started."
              : `No ${subscriptionTab.toLowerCase()} subscriptions right now.`}
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredSubscriptions.map((sub) => {
              const isMutating = subscriptionActionId === sub.id;
              const canPause = sub.status === "ACTIVE";
              const canResume = sub.status === "PAUSED";
              const canCancel = sub.status === "ACTIVE" || sub.status === "PAUSED";
              const reserveHealthy = (sub.reserveStatus ?? "HEALTHY").toUpperCase() === "HEALTHY";
              return (
                <div key={sub.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-400">#{sub.id}</div>
                      <div className="text-lg font-semibold text-white">{sub.plan?.nickname ?? `${sub.asset} SIP`}</div>
                      <div className="text-xs text-slate-400">{sub.contributionType} - {sub.frequency}</div>
                    </div>
                    <div className="ml-auto rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-200">
                      {sub.status}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-300/80 sm:grid-cols-2 lg:grid-cols-5">
                    <span>Amount: {formatCurrency(sub.amountFiat, sub.quoteCurrency)}</span>
                    <span>Quantity: {formatQuantity(sub.amountAsset)} {sub.asset}</span>
                    <span>Next run: {formatDateTime(sub.nextRunAt)}</span>
                    <span>Auto pause: {sub.autoPauseOnFail ? "Yes" : "No"}</span>
                    <span>
                      Reserve:{" "}
                      {sub.reserveBalance
                        ? `${formatTokenAmount(sub.reserveBalance)} ${sub.reserveAsset ?? sub.quoteCurrency}`
                        : "—"}{" "}
                      {sub.reserveStatus ? `(${sub.reserveStatus})` : ""}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span>Wallet: {sub.walletSource ?? "spot:available"}</span>
                    <span>Start: {formatDateTime(sub.startAt)}</span>
                    <div className="ml-auto flex gap-2">
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleSubscriptionAction(sub, "pause")}
                        disabled={!canPause || isMutating || !reserveHealthy}
                      >
                        Pause
                      </Button>
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => handleSubscriptionAction(sub, "resume")}
                        disabled={!canResume || isMutating || !reserveHealthy}
                      >
                        Resume
                      </Button>
                      <Button
                        size="xs"
                        variant="danger"
                        onClick={() => handleSubscriptionAction(sub, "cancel")}
                        disabled={!canCancel || isMutating || !reserveHealthy}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                  {!reserveHealthy && (
                    <div className="mt-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                      Reserve status {sub.reserveStatus ?? "unknown"}. Actions are disabled until funds are healthy again.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {orderTab === "history" ? "SIP history" : "Recent executions"}
            </div>
            <p className="text-sm text-slate-300/80">
              {orderTab === "history"
                ? "Review executed runs to track recurring investment totals."
                : "Monitor fills, failures, and conversion rates."}
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            {(["recent", "history"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setOrderTab(tab)}
                className={`rounded-full border px-3 py-1 uppercase tracking-[0.16em] ${
                  orderTab === tab ? "border-indigo-400/70 bg-indigo-500/20 text-white" : "border-white/10 text-slate-400"
                }`}
              >
                {tab === "recent" ? "Recent" : "History"}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={loadOrders} disabled={ordersLoading}>
            {ordersLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        {orderTab === "history" && (
          <div className="rounded-2xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-100">
            Showing executed SIP runs (limit 100) for earnings tracking.
          </div>
        )}
        {ordersError && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {ordersError}
          </div>
        )}
        {!orders.length ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300/80">
            {orderTab === "history"
              ? "No SIP history records match the current filters yet."
              : "No SIP runs yet. Once schedules begin, fills and failures will appear here."}
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Order #{order.id}</div>
                  <div className="rounded-full bg-white/10 px-2 py-0.5 text-xs">Sub #{order.subscriptionId}</div>
                  <div className="ml-auto rounded-full bg-indigo-500/15 px-3 py-0.5 text-xs text-indigo-100">
                    {order.status}
                  </div>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-slate-300/80 sm:grid-cols-2 lg:grid-cols-4">
                  <span>Amount: {formatCurrency(order.amountFiat, order.quoteCurrency)}</span>
                  <span>Quantity: {formatQuantity(order.amountAsset)} {order.asset}</span>
                  <span>Executed: {formatDateTime(order.executedAt ?? order.nextRunAt)}</span>
                  <span>Fill price: {order.priceExecutedFiat ? formatCurrency(order.priceExecutedFiat, order.quoteCurrency) : "--"}</span>
                </div>
                {order.failureReason && (
                  <div className="mt-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                    Failure: {order.failureReason}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
