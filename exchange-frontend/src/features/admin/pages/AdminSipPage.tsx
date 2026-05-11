
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import {
  createAdminSipPlan,
  fetchAdminSettings,
  fetchAdminSipOrders,
  fetchAdminSipPlans,
  fetchAdminSipSubscriptions,
  type AdminSettings,
  type AdminSipOrder,
  type AdminSipPlan,
  type AdminSipPlanPayload,
  type AdminSipSubscription,
  updateAdminSettings,
  updateAdminSipPlan,
} from "../api/admin.api";

const FREQUENCY_OPTIONS = ["HOURLY", "DAILY", "WEEKLY", "MONTHLY"] as const;

type PlanFormState = {
  asset: string;
  quoteCurrency: string;
  nickname: string;
  description: string;
  status: string;
  allowedFrequencies: string[];
  allowAmountInput: boolean;
  allowQuantityInput: boolean;
  minFiatAmount: string;
  maxFiatAmount: string;
  minAssetQuantity: string;
  maxAssetQuantity: string;
};

const emptyPlanForm: PlanFormState = {
  asset: "",
  quoteCurrency: "USD",
  nickname: "",
  description: "",
  status: "ACTIVE",
  allowedFrequencies: ["DAILY", "WEEKLY"],
  allowAmountInput: true,
  allowQuantityInput: true,
  minFiatAmount: "100",
  maxFiatAmount: "",
  minAssetQuantity: "0.0001",
  maxAssetQuantity: "",
};

type HeroSectionForm = { title: string; body: string };

const defaultHeroSections: HeroSectionForm[] = [
  { title: "Steer Through The Volatility", body: "Invest a fixed USD amount into your chosen coin and let automation handle the timing." },
  { title: "Gradually Build Wealth", body: "Remove emotion from trading with disciplined, recurring accumulations." },
];

type SipSettingsForm = {
  enabled: boolean;
  supportedFiats: string;
  scheduleOptions: string;
  defaultFrequency: string;
  minFiatAmount: string;
  maxFiatAmount: string;
  minAssetQuantity: string;
  maxAssetQuantity: string;
  fxHints: string;
  heroTitle: string;
  heroSubtitle: string;
  heroSections: HeroSectionForm[];
  heroCtaLabel: string;
  heroCtaHelper: string;
};

const defaultSettingsForm: SipSettingsForm = {
  enabled: true,
  supportedFiats: "USD",
  scheduleOptions: "HOURLY,DAILY,WEEKLY,MONTHLY",
  defaultFrequency: "DAILY",
  minFiatAmount: "100",
  maxFiatAmount: "100000",
  minAssetQuantity: "0.00001000",
  maxAssetQuantity: "",
  fxHints: "{\n  \"USD\": 1\n}",
  heroTitle: "SIP for Cryptos",
  heroSubtitle: "Automate USD contributions into your favourite coins.",
  heroSections: defaultHeroSections,
  heroCtaLabel: "Start a SIP",
  heroCtaHelper: "Choose a coin, amount or quantity, schedule and confirm.",
};

const formatCurrency = (value?: string | number | null, currency = "USD") => {
  if (value === null || value === undefined || value === "") return "--";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(
    numeric
  );
};

const formatQuantity = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") return "--";
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 8 }).format(numeric);
};

const formatDateTime = (iso?: string | null) => {
  if (!iso) return "--";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "--";
  return new Date(ts).toLocaleString();
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

const normaliseListInput = (raw: string) =>
  raw
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);

const cloneDefaultHeroSections = () => defaultHeroSections.map((section) => ({ ...section }));

const parseHeroSections = (raw: AdminSettings["sipHeroSections"]): HeroSectionForm[] => {
  if (!raw) return cloneDefaultHeroSections();
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((section) => ({
          title: section?.title ?? "",
          body: section?.body ?? "",
        }));
      }
    } catch {
      return cloneDefaultHeroSections();
    }
  }
  if (Array.isArray(raw)) {
    return raw.map((section) => ({
      title: section?.title ?? "",
      body: section?.body ?? "",
    }));
  }
  return cloneDefaultHeroSections();
};

const stringifyFxHints = (value: AdminSettings["sipFxHints"]) => {
  if (!value) return "{}";
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
};

const parseFxHintsInput = (raw: string) => {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
  } catch {
    const pairs = raw.split(",").map((entry) => entry.trim()).filter(Boolean);
    const result: Record<string, number> = {};
    pairs.forEach((pair) => {
      const [key, value] = pair.split(":");
      if (key && value) {
        const maybeNumber = Number(value.trim());
        if (Number.isFinite(maybeNumber)) {
          result[key.trim().toUpperCase()] = maybeNumber;
        }
      }
    });
    if (Object.keys(result).length) return result;
  }
  return {};
};
export default function AdminSipPage() {
  const [plans, setPlans] = useState<AdminSipPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm);
  const [planSaving, setPlanSaving] = useState(false);
  const [planFormError, setPlanFormError] = useState<string | null>(null);
  const [planFormSuccess, setPlanFormSuccess] = useState<string | null>(null);

  const [subscriptions, setSubscriptions] = useState<AdminSipSubscription[]>([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [subscriptionsError, setSubscriptionsError] = useState<string | null>(null);
  const [subscriptionFilters, setSubscriptionFilters] = useState({ planId: "", status: "" });

  const [orders, setOrders] = useState<AdminSipOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [orderFilters, setOrderFilters] = useState({ planId: "", status: "" });

  const [settingsForm, setSettingsForm] = useState<SipSettingsForm>(defaultSettingsForm);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);

  const hydratePlanForm = useCallback((plan: AdminSipPlan) => {
    setPlanForm({
      asset: plan.asset,
      quoteCurrency: plan.quoteCurrency,
      nickname: plan.nickname,
      description: plan.description ?? "",
      status: plan.status ?? "ACTIVE",
      allowedFrequencies: plan.allowedFrequencies ?? ["DAILY"],
      allowAmountInput: plan.allowAmountInput ?? true,
      allowQuantityInput: plan.allowQuantityInput ?? true,
      minFiatAmount: plan.minFiatAmount ? String(plan.minFiatAmount) : "",
      maxFiatAmount: plan.maxFiatAmount ? String(plan.maxFiatAmount) : "",
      minAssetQuantity: plan.minAssetQuantity ? String(plan.minAssetQuantity) : "",
      maxAssetQuantity: plan.maxAssetQuantity ? String(plan.maxAssetQuantity) : "",
    });
  }, []);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const payload = await fetchAdminSipPlans();
      setPlans(payload);
      if (!selectedPlanId && payload.length) {
        setSelectedPlanId(payload[0].id);
        hydratePlanForm(payload[0]);
      } else if (selectedPlanId) {
        const match = payload.find((plan) => plan.id === selectedPlanId);
        if (match) hydratePlanForm(match);
      }
    } catch (error) {
      setPlansError(getErrorMessage(error));
    } finally {
      setPlansLoading(false);
    }
  }, [hydratePlanForm, selectedPlanId]);

  const loadSubscriptions = useCallback(
    async (params?: { planId?: string; status?: string }) => {
      setSubscriptionsLoading(true);
      setSubscriptionsError(null);
      try {
        const payload = await fetchAdminSipSubscriptions(params);
        setSubscriptions(payload);
      } catch (error) {
        setSubscriptionsError(getErrorMessage(error));
      } finally {
        setSubscriptionsLoading(false);
      }
    },
    []
  );

  const loadOrders = useCallback(
    async (params?: { planId?: string; status?: string }) => {
      setOrdersLoading(true);
      setOrdersError(null);
      try {
        const payload = await fetchAdminSipOrders(params);
        setOrders(payload);
      } catch (error) {
        setOrdersError(getErrorMessage(error));
      } finally {
        setOrdersLoading(false);
      }
    },
    []
  );

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const payload = await fetchAdminSettings();
      setSettingsForm({
        enabled: payload.sipEnabled ?? true,
        supportedFiats: Array.isArray(payload.sipSupportedFiats)
          ? payload.sipSupportedFiats.join(",")
          : (payload.sipSupportedFiats as string) ?? defaultSettingsForm.supportedFiats,
        scheduleOptions: Array.isArray(payload.sipScheduleOptions)
          ? payload.sipScheduleOptions.join(",")
          : (payload.sipScheduleOptions as string) ?? defaultSettingsForm.scheduleOptions,
        defaultFrequency: payload.sipDefaultFrequency ?? defaultSettingsForm.defaultFrequency,
        minFiatAmount:
          payload.sipMinFiatAmount !== undefined
            ? String(payload.sipMinFiatAmount)
            : defaultSettingsForm.minFiatAmount,
        maxFiatAmount:
          payload.sipMaxFiatAmount !== undefined && payload.sipMaxFiatAmount !== null
            ? String(payload.sipMaxFiatAmount)
            : defaultSettingsForm.maxFiatAmount,
        minAssetQuantity: payload.sipMinAssetQuantity ?? defaultSettingsForm.minAssetQuantity,
        maxAssetQuantity: payload.sipMaxAssetQuantity ?? defaultSettingsForm.maxAssetQuantity,
        fxHints: stringifyFxHints(payload.sipFxHints),
        heroTitle: payload.sipHeroTitle ?? defaultSettingsForm.heroTitle,
        heroSubtitle: payload.sipHeroSubtitle ?? defaultSettingsForm.heroSubtitle,
        heroSections: parseHeroSections(payload.sipHeroSections),
        heroCtaLabel: payload.sipHeroCtaLabel ?? defaultSettingsForm.heroCtaLabel,
        heroCtaHelper: payload.sipHeroCtaHelper ?? defaultSettingsForm.heroCtaHelper,
      });
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
    void loadSubscriptions();
    void loadOrders();
    void loadSettings();
  }, [loadPlans, loadSubscriptions, loadOrders, loadSettings]);

  const handlePlanFieldChange = (field: keyof PlanFormState, value: string | boolean) => {
    setPlanForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleFrequency = (frequency: string) => {
    setPlanForm((prev) => {
      const exists = prev.allowedFrequencies.includes(frequency);
      if (exists && prev.allowedFrequencies.length === 1) {
        return prev;
      }
      return {
        ...prev,
        allowedFrequencies: exists
          ? prev.allowedFrequencies.filter((entry) => entry !== frequency)
          : [...prev.allowedFrequencies, frequency],
      };
    });
  };

  const handlePlanSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!planForm.asset.trim() || !planForm.quoteCurrency.trim() || !planForm.nickname.trim()) {
      setPlanFormError("Asset, quote currency, and nickname are required.");
      return;
    }
    if (!planForm.allowedFrequencies.length) {
      setPlanFormError("Select at least one schedule option.");
      return;
    }
    const payload: AdminSipPlanPayload = {
      asset: planForm.asset.trim().toUpperCase(),
      quoteCurrency: planForm.quoteCurrency.trim().toUpperCase(),
      nickname: planForm.nickname.trim(),
      description: planForm.description.trim(),
      status: planForm.status.trim(),
      allowedFrequencies: planForm.allowedFrequencies,
      allowAmountInput: planForm.allowAmountInput,
      allowQuantityInput: planForm.allowQuantityInput,
      minFiatAmount: planForm.minFiatAmount ? Number(planForm.minFiatAmount) : undefined,
      maxFiatAmount: planForm.maxFiatAmount ? Number(planForm.maxFiatAmount) : null,
      minAssetQuantity: planForm.minAssetQuantity || undefined,
      maxAssetQuantity: planForm.maxAssetQuantity || null,
    };
    setPlanSaving(true);
    setPlanFormError(null);
    setPlanFormSuccess(null);
    try {
      if (selectedPlanId) {
        await updateAdminSipPlan(selectedPlanId, payload);
        setPlanFormSuccess("Plan updated.");
      } else {
        const created = await createAdminSipPlan(payload);
        setPlanFormSuccess("Plan created.");
        setSelectedPlanId(Number(created.id));
      }
      await loadPlans();
    } catch (error) {
      setPlanFormError(getErrorMessage(error));
    } finally {
      setPlanSaving(false);
    }
  };

  const resetPlanForm = () => {
    setSelectedPlanId(null);
    setPlanForm(emptyPlanForm);
    setPlanFormError(null);
    setPlanFormSuccess(null);
  };

  const handleSettingsSubmit = async (event?: FormEvent) => {
    event?.preventDefault();
    setSettingsSaving(true);
    setSettingsError(null);
    setSettingsSuccess(null);
    try {
      const payload: Partial<AdminSettings> = {
        sipEnabled: settingsForm.enabled,
        sipSupportedFiats: normaliseListInput(settingsForm.supportedFiats),
        sipScheduleOptions: normaliseListInput(settingsForm.scheduleOptions),
        sipDefaultFrequency: settingsForm.defaultFrequency,
        sipMinFiatAmount: settingsForm.minFiatAmount ? Number(settingsForm.minFiatAmount) : undefined,
        sipMaxFiatAmount: settingsForm.maxFiatAmount ? Number(settingsForm.maxFiatAmount) : null,
        sipMinAssetQuantity: settingsForm.minAssetQuantity || undefined,
        sipMaxAssetQuantity: settingsForm.maxAssetQuantity || null,
        sipFxHints: parseFxHintsInput(settingsForm.fxHints),
        sipHeroTitle: settingsForm.heroTitle,
        sipHeroSubtitle: settingsForm.heroSubtitle,
        sipHeroSections: settingsForm.heroSections.filter((section) => section.title || section.body),
        sipHeroCtaLabel: settingsForm.heroCtaLabel,
        sipHeroCtaHelper: settingsForm.heroCtaHelper,
      };
      await updateAdminSettings(payload);
      setSettingsSuccess("SIP presentation settings updated.");
      await loadSettings();
    } catch (error) {
      setSettingsError(getErrorMessage(error));
    } finally {
      setSettingsSaving(false);
    }
  };

  const planSummary = useMemo(() => {
    const active = plans.filter((plan) => plan.status === "ACTIVE").length;
    const paused = plans.filter((plan) => plan.status !== "ACTIVE").length;
    const totalSubs = subscriptions.length;
    const latestOrder =
      orders
        .slice()
        .sort((a, b) => Date.parse(b.executedAt ?? b.nextRunAt ?? "") - Date.parse(a.executedAt ?? a.nextRunAt ?? ""))[0] ?? null;
    return [
      { label: "Live plans", value: active.toString(), helper: `${plans.length} total` },
      { label: "Paused plans", value: paused.toString(), helper: "Draft or inactive" },
      { label: "Total subscriptions", value: totalSubs.toString(), helper: "Across all users" },
      {
        label: "Last execution",
        value: latestOrder ? formatDateTime(latestOrder.executedAt ?? latestOrder.nextRunAt) : "--",
        helper: latestOrder?.status ?? "No orders",
      },
    ];
  }, [plans, subscriptions, orders]);

  const applySubscriptionFilters = () => {
    const params: { planId?: string; status?: string } = {};
    if (subscriptionFilters.planId) params.planId = subscriptionFilters.planId;
    if (subscriptionFilters.status) params.status = subscriptionFilters.status;
    void loadSubscriptions(params);
  };

  const applyOrderFilters = () => {
    const params: { planId?: string; status?: string } = {};
    if (orderFilters.planId) params.planId = orderFilters.planId;
    if (orderFilters.status) params.status = orderFilters.status;
    void loadOrders(params);
  };

  const heroSectionControls = settingsForm.heroSections.map((section, index) => (
    <div key={index} className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Section {index + 1}</div>
        {settingsForm.heroSections.length > 1 ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() =>
              setSettingsForm((prev) => ({
                ...prev,
                heroSections: prev.heroSections.filter((_, idx) => idx !== index),
              }))
            }
          >
            Remove
          </Button>
        ) : null}
      </div>
      <Input
        value={section.title}
        onChange={(event) =>
          setSettingsForm((prev) => {
            const next = [...prev.heroSections];
            next[index] = { ...next[index], title: event.target.value };
            return { ...prev, heroSections: next };
          })
        }
        placeholder="Title"
      />
      <textarea
        value={section.body}
        onChange={(event) =>
          setSettingsForm((prev) => {
            const next = [...prev.heroSections];
            next[index] = { ...next[index], body: event.target.value };
            return { ...prev, heroSections: next };
          })
        }
        className="w-full rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
        rows={3}
        placeholder="Body copy"
      />
    </div>
  ));
  return (
    <div className="space-y-6 text-slate-100">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-950/80 to-emerald-900/40 p-6 shadow-[0_35px_120px_-70px_rgba(16,185,129,0.5)]">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-emerald-300/80">Sip control</p>
            <h1 className="text-3xl font-semibold text-white">Systematic Investment Plans</h1>
            <p className="text-sm text-slate-300/80">
              Manage managed plan templates, defaults, and observe user adoption.
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={loadPlans} disabled={plansLoading}>
              {plansLoading ? "Syncing plans…" : "Reload plans"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void loadSubscriptions()} disabled={subscriptionsLoading}>
              {subscriptionsLoading ? "Syncing subs…" : "Reload subs"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void loadOrders()} disabled={ordersLoading}>
              {ordersLoading ? "Syncing orders…" : "Reload orders"}
            </Button>
          </div>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {planSummary.map((card) => (
            <div key={card.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{card.label}</div>
              <div className="mt-1 text-2xl font-semibold text-white">{card.value}</div>
              <div className="text-xs text-emerald-300/80">{card.helper}</div>
            </div>
          ))}
        </div>
      </header>

      {plansError && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{plansError}</div>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Plan catalog</div>
              <p className="text-sm text-slate-300/80">Snapshot of all SIP templates and guardrails.</p>
            </div>
            <Button size="sm" variant="ghost" onClick={resetPlanForm}>
              New plan
            </Button>
          </div>
          <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
            {plans.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-sm text-slate-300/80">
                No SIP plans configured yet.
              </div>
            )}
            {plans.map((plan) => {
              const isSelected = selectedPlanId === plan.id;
              return (
                <div
                  key={plan.id}
                  className={`rounded-2xl border px-4 py-3 transition ${
                    isSelected
                      ? "border-emerald-400/70 bg-emerald-500/15 shadow-[0_25px_80px_-55px_rgba(16,185,129,0.8)]"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-lg font-semibold text-white">{plan.nickname}</div>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-200">
                      {plan.asset}/{plan.quoteCurrency}
                    </span>
                    <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] text-indigo-100">
                      {plan.allowedFrequencies.join(" • ")}
                    </span>
                    <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-slate-300">
                      {plan.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-300/80">{plan.description}</p>
                  <div className="mt-2 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                    <span>
                      Amounts: {plan.allowAmountInput ? `${formatCurrency(plan.minFiatAmount, plan.quoteCurrency)} - ${formatCurrency(plan.maxFiatAmount, plan.quoteCurrency)}` : "Disabled"}
                    </span>
                    <span>
                      Quantity: {plan.allowQuantityInput ? `${plan.minAssetQuantity ?? "0"} - ${plan.maxAssetQuantity ?? "8"}` : "Disabled"}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                    <span>Subs: {plan.subscriptionsCount ?? 0}</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setSelectedPlanId(plan.id);
                        hydratePlanForm(plan);
                      }}
                    >
                      {isSelected ? "Editing" : "Edit"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Plan form</div>
              <p className="text-sm text-slate-300/80">
                {selectedPlanId ? `Editing plan #${selectedPlanId}` : "Create a new SIP template"}
              </p>
            </div>
          </div>
          <form className="space-y-3 text-sm text-slate-200" onSubmit={handlePlanSubmit}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-400">Asset</label>
                <Input value={planForm.asset} onChange={(event) => handlePlanFieldChange("asset", event.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Quote currency</label>
                <Input
                  value={planForm.quoteCurrency}
                  onChange={(event) => handlePlanFieldChange("quoteCurrency", event.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400">Nickname</label>
              <Input
                value={planForm.nickname}
                onChange={(event) => handlePlanFieldChange("nickname", event.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Description</label>
              <textarea
                value={planForm.description}
                onChange={(event) => handlePlanFieldChange("description", event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                rows={3}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Status</label>
              <select
                value={planForm.status}
                onChange={(event) => handlePlanFieldChange("status", event.target.value)}
                className="mt-1 w-full rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              >
                {"ACTIVE,PAUSED,HIDDEN".split(",").map((status) => (
                  <option key={status} value={status} className="bg-slate-900 text-white">
                    {status}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="text-xs text-slate-400">Allowed schedules</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {FREQUENCY_OPTIONS.map((frequency) => (
                  <label key={frequency} className="flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-1">
                    <input
                      type="checkbox"
                      checked={planForm.allowedFrequencies.includes(frequency)}
                      onChange={() => toggleFrequency(frequency)}
                      className="h-4 w-4 rounded border border-white/30 bg-transparent"
                    />
                    <span className="text-xs text-slate-200">{frequency}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={planForm.allowAmountInput}
                  onChange={(event) => handlePlanFieldChange("allowAmountInput", event.target.checked)}
                  className="h-4 w-4 rounded border border-white/30 bg-transparent"
                />
                Allow fiat amount entry
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={planForm.allowQuantityInput}
                  onChange={(event) => handlePlanFieldChange("allowQuantityInput", event.target.checked)}
                  className="h-4 w-4 rounded border border-white/30 bg-transparent"
                />
                Allow asset quantity entry
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-400">Min fiat</label>
                <Input
                  type="number"
                  value={planForm.minFiatAmount}
                  onChange={(event) => handlePlanFieldChange("minFiatAmount", event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Max fiat</label>
                <Input
                  type="number"
                  value={planForm.maxFiatAmount}
                  onChange={(event) => handlePlanFieldChange("maxFiatAmount", event.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-400">Min quantity</label>
                <Input
                  value={planForm.minAssetQuantity}
                  onChange={(event) => handlePlanFieldChange("minAssetQuantity", event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Max quantity</label>
                <Input
                  value={planForm.maxAssetQuantity}
                  onChange={(event) => handlePlanFieldChange("maxAssetQuantity", event.target.value)}
                />
              </div>
            </div>
            {planFormError && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                {planFormError}
              </div>
            )}
            {planFormSuccess && (
              <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                {planFormSuccess}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={planSaving}>
                {planSaving ? "Saving…" : selectedPlanId ? "Update plan" : "Create plan"}
              </Button>
              <Button type="button" variant="ghost" onClick={resetPlanForm}>
                Reset
              </Button>
            </div>
          </form>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Catalog defaults & hero</div>
            <p className="text-sm text-slate-300/80">These fields drive /api/sip/catalog responses.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={loadSettings} disabled={settingsLoading}>
            {settingsLoading ? "Reloading…" : "Reload"}
          </Button>
        </div>
        <form className="space-y-4 text-sm text-slate-200" onSubmit={handleSettingsSubmit}>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={settingsForm.enabled}
              onChange={(event) => setSettingsForm((prev) => ({ ...prev, enabled: event.target.checked }))}
              className="h-4 w-4 rounded border border-white/30 bg-transparent"
            />
            Enable SIP catalog for customers
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400">Supported fiats (comma separated)</label>
              <Input
                value={settingsForm.supportedFiats}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, supportedFiats: event.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Schedule options (comma separated)</label>
              <Input
                value={settingsForm.scheduleOptions}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, scheduleOptions: event.target.value }))}
              />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400">Default frequency</label>
              <select
                value={settingsForm.defaultFrequency}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, defaultFrequency: event.target.value }))}
                className="mt-1 w-full rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              >
                {FREQUENCY_OPTIONS.map((frequency) => (
                  <option key={frequency} value={frequency} className="bg-slate-900 text-white">
                    {frequency}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-slate-400">Min fiat amount</label>
                <Input
                  type="number"
                  value={settingsForm.minFiatAmount}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, minFiatAmount: event.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">Max fiat amount</label>
                <Input
                  type="number"
                  value={settingsForm.maxFiatAmount}
                  onChange={(event) => setSettingsForm((prev) => ({ ...prev, maxFiatAmount: event.target.value }))}
                />
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400">Min quantity</label>
              <Input
                value={settingsForm.minAssetQuantity}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, minAssetQuantity: event.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Max quantity</label>
              <Input
                value={settingsForm.maxAssetQuantity}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, maxAssetQuantity: event.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400">FX hints (JSON or key:value pairs)</label>
            <textarea
              value={settingsForm.fxHints}
              onChange={(event) => setSettingsForm((prev) => ({ ...prev, fxHints: event.target.value }))}
              className="mt-1 w-full rounded-2xl border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              rows={4}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400">Hero title</label>
              <Input
                value={settingsForm.heroTitle}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, heroTitle: event.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Hero subtitle</label>
              <Input
                value={settingsForm.heroSubtitle}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, heroSubtitle: event.target.value }))}
              />
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Hero sections</div>
            <div className="mt-2 grid gap-3 md:grid-cols-2">{heroSectionControls}</div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() =>
                setSettingsForm((prev) => ({
                  ...prev,
                  heroSections: [...prev.heroSections, { title: "", body: "" }],
                }))
              }
            >
              Add section
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400">CTA label</label>
              <Input
                value={settingsForm.heroCtaLabel}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, heroCtaLabel: event.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">CTA helper</label>
              <Input
                value={settingsForm.heroCtaHelper}
                onChange={(event) => setSettingsForm((prev) => ({ ...prev, heroCtaHelper: event.target.value }))}
              />
            </div>
          </div>
          {settingsError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {settingsError}
            </div>
          )}
          {settingsSuccess && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
              {settingsSuccess}
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={settingsSaving}>
              {settingsSaving ? "Saving…" : "Save settings"}
            </Button>
            <Button type="button" variant="ghost" onClick={loadSettings} disabled={settingsLoading}>
              Reset
            </Button>
          </div>
        </form>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Subscriptions</div>
              <p className="text-sm text-slate-300/80">Filter by plan or status to investigate lifecycle.</p>
            </div>
            <div className="ml-auto flex gap-2">
              <select
                value={subscriptionFilters.planId}
                onChange={(event) => setSubscriptionFilters((prev) => ({ ...prev, planId: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="">All plans</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id} className="bg-slate-900 text-white">
                    {plan.nickname}
                  </option>
                ))}
              </select>
              <select
                value={subscriptionFilters.status}
                onChange={(event) => setSubscriptionFilters((prev) => ({ ...prev, status: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="">All statuses</option>
                {"ACTIVE,PAUSED,CANCELLED,FAILED".split(",").map((status) => (
                  <option key={status} value={status} className="bg-slate-900 text-white">
                    {status}
                  </option>
                ))}
              </select>
              <Button size="xs" variant="ghost" onClick={applySubscriptionFilters} disabled={subscriptionsLoading}>
                Apply
              </Button>
            </div>
          </div>
          {subscriptionsError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {subscriptionsError}
            </div>
          )}
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1 text-sm text-slate-200">
            {subscriptionsLoading && <div className="text-xs text-slate-400">Loading subscriptions…</div>}
            {!subscriptionsLoading && subscriptions.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300/80">
                No subscriptions match the current filters.
              </div>
            )}
            {subscriptions.map((sub) => (
              <div key={sub.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">#{sub.id}</div>
                  <div className="text-white">{sub.plan?.nickname ?? sub.asset}</div>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{sub.user?.email ?? sub.userId}</span>
                  <span className="ml-auto rounded-full bg-emerald-500/10 px-3 py-0.5 text-xs text-emerald-200">
                    {sub.status}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
                  <span>
                    Contribution: {formatCurrency(sub.amountFiat, sub.quoteCurrency)} / {formatQuantity(sub.amountAsset)} {sub.asset}
                  </span>
                  <span>Next run: {formatDateTime(sub.nextRunAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Execution log</div>
              <p className="text-sm text-slate-300/80">Latest orders dispatched by the SIP engine.</p>
            </div>
            <div className="ml-auto flex gap-2">
              <select
                value={orderFilters.planId}
                onChange={(event) => setOrderFilters((prev) => ({ ...prev, planId: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="">All plans</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id} className="bg-slate-900 text-white">
                    {plan.nickname}
                  </option>
                ))}
              </select>
              <select
                value={orderFilters.status}
                onChange={(event) => setOrderFilters((prev) => ({ ...prev, status: event.target.value }))}
                className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1 text-xs text-white focus:border-emerald-400 focus:outline-none"
              >
                <option value="">All statuses</option>
                {"PENDING,FILLED,FAILED".split(",").map((status) => (
                  <option key={status} value={status} className="bg-slate-900 text-white">
                    {status}
                  </option>
                ))}
              </select>
              <Button size="xs" variant="ghost" onClick={applyOrderFilters} disabled={ordersLoading}>
                Apply
              </Button>
            </div>
          </div>
          {ordersError && (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {ordersError}
            </div>
          )}
          <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1 text-sm text-slate-200">
            {ordersLoading && <div className="text-xs text-slate-400">Loading orders…</div>}
            {!ordersLoading && orders.length === 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-slate-300/80">
                No orders match the current filters.
              </div>
            )}
            {orders.map((order) => (
              <div key={order.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Order #{order.id}</div>
                  <div className="rounded-full bg-white/10 px-2 py-0.5 text-xs">Sub #{order.subscriptionId}</div>
                  <span className="ml-auto rounded-full bg-indigo-500/15 px-3 py-0.5 text-xs text-indigo-100">
                    {order.status}
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
                  <span>
                    Amount: {formatCurrency(order.amountFiat, order.quoteCurrency)} / {formatQuantity(order.amountAsset)} {order.asset}
                  </span>
                  <span>Executed: {formatDateTime(order.executedAt ?? order.nextRunAt)}</span>
                </div>
                {order.failureReason && (
                  <div className="mt-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                    {order.failureReason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

