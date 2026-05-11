import { useEffect, useState, type ReactNode } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import {
  fetchAdminControlSettings,
  generateAdminTradeSlotToken,
  fetchAdminSignalHistoryDayWise,
  updateAdminControlSettings,
  type AdminControlSettings,
  type AdminSignalHistoryDayWiseRow,
  type UpdateAdminControlSettingsPayload,
} from "../api/admin.api";

type FormState = {
  globalRules: {
    investmentPerTradePercent: string;
    dailyPercentPerTrade: string;
    signalValidityMinutes: string;
    telegramChannelUrl: string;
  };
  tradeSlots: Array<{
    id: number | string;
    slotName: string;
    slotTime: string;
    isEnabled: boolean;
    sortOrder: number;
  }>;
  packageTiers: Array<{
    id: number | string;
    packageName: string;
    minAmount: string;
    maxAmount: string;
    signalsPerDay: string;
    requiredLevel: string;
    isEnabled: boolean;
    sortOrder: number;
  }>;
  birthdayGiftEnabled: boolean;
  birthdayGift: Array<{
    id?: number | string;
    minimumEligibleLevel: string;
    giftAmount: string;
    isEnabled: boolean;
    sortOrder: number;
  }>;
};

const cardCls = "rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl";
const tableWrapCls = "overflow-x-auto rounded-2xl border border-white/10";
const tableCls = "min-w-full text-sm";
const headCellCls = "px-4 py-3 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400";
const bodyCellCls = "px-4 py-3 align-middle text-slate-200";
const inputCls = "bg-white/5 text-white";
const selectCls = "w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white";
const levelOptions = ["None", "Level 1", "Level 2", "Level 3", "Level 4"];
const birthdayLevelOptions = Array.from({ length: 9 }, (_, index) => `Level ${index + 3}`);

const defaultFormState: FormState = {
  globalRules: {
    investmentPerTradePercent: "1",
    dailyPercentPerTrade: "0.65",
    signalValidityMinutes: "10",
    telegramChannelUrl: "",
  },
  tradeSlots: [],
  packageTiers: [],
  birthdayGiftEnabled: true,
  birthdayGift: [
    {
      minimumEligibleLevel: "Level 3",
      giftAmount: "10",
      isEnabled: true,
      sortOrder: 1,
    },
  ],
};

function mapSettingsToForm(settings: AdminControlSettings): FormState {
  const birthdayRows = Array.isArray(settings.birthdayGift) && settings.birthdayGift.length > 0
    ? settings.birthdayGift
    : [
        {
          id: "birthday-default",
          isEnabled: true,
          minimumEligibleLevel: "Level 3",
          giftAmount: 10,
          sortOrder: 1,
          isActive: true,
        },
      ];

  return {
    globalRules: {
      investmentPerTradePercent: String(settings.globalRules.investmentPerTradePercent ?? 0),
      dailyPercentPerTrade: String(settings.globalRules.dailyPercentPerTrade ?? 0),
      signalValidityMinutes: String(settings.globalRules.signalValidityMinutes ?? 1),
      telegramChannelUrl: settings.globalRules.telegramChannelUrl ?? "",
    },
    tradeSlots: settings.tradeSlots.map((slot) => ({
      id: slot.id,
      slotName: slot.slotName ?? "",
      slotTime: slot.slotTime ?? "",
      isEnabled: Boolean(slot.isEnabled),
      sortOrder: Number(slot.sortOrder ?? 0),
    })),
    packageTiers: settings.packageTiers.map((tier) => ({
      id: tier.id,
      packageName: tier.packageName ?? "",
      minAmount: String(tier.minAmount ?? 0),
      maxAmount: tier.maxAmount ?? "",
      signalsPerDay: String(tier.signalsPerDay ?? 0),
      requiredLevel: tier.requiredLevel ?? "None",
      isEnabled: Boolean(tier.isEnabled),
      sortOrder: Number(tier.sortOrder ?? 0),
    })),
    birthdayGiftEnabled: birthdayRows.some((gift) => Boolean(gift.isEnabled)),
    birthdayGift: birthdayRows.map((gift, index) => ({
      id: gift.id,
      minimumEligibleLevel: gift.minimumEligibleLevel ?? "Level 3",
      giftAmount: String(gift.giftAmount ?? 0),
      isEnabled: Boolean(gift.isEnabled),
      sortOrder: Number(gift.sortOrder ?? index + 1),
    })),
  };
}

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Request failed";
  }
  if (error instanceof Error) return error.message;
  return "Request failed";
}

function getFieldErrors(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { errors?: Record<string, string> } } }).response;
    return response?.data?.errors ?? {};
  }
  return {};
}

function buildSlotTokenMap(
  tradeSlots: FormState["tradeSlots"],
  todayHistory: AdminSignalHistoryDayWiseRow | null
) {
  const next: Record<string, string> = {};
  tradeSlots.forEach((slot) => {
    const bySlotId = todayHistory?.slotTokens?.[String(slot.id)]?.batchToken;
    if (bySlotId) {
      next[String(slot.id)] = bySlotId;
      return;
    }
    const normalized = slot.slotTime.length === 5 ? `${slot.slotTime}:00` : slot.slotTime;
    if (!todayHistory) {
      next[String(slot.id)] = "";
      return;
    }
    if (normalized === "09:00:00") next[String(slot.id)] = todayHistory["9"] ?? "";
    else if (normalized === "12:00:00") next[String(slot.id)] = todayHistory["12"] ?? "";
    else if (normalized === "15:00:00") next[String(slot.id)] = todayHistory["3"] ?? "";
    else if (normalized === "18:00:00") next[String(slot.id)] = todayHistory["6"] ?? "";
    else next[String(slot.id)] = "";
  });
  return next;
}

export default function AdminManageSignalsPage() {
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [todayHistory, setTodayHistory] = useState<AdminSignalHistoryDayWiseRow | null>(null);
  const [slotTokens, setSlotTokens] = useState<Record<string, string>>({});
  const [pendingGeneratedTokens, setPendingGeneratedTokens] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [slotSaving, setSlotSaving] = useState(false);
  const [generatingSlotId, setGeneratingSlotId] = useState<number | string | null>(null);
  const [copiedSlotId, setCopiedSlotId] = useState<number | string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchControlSettings = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const [data, history] = await Promise.all([
        fetchAdminControlSettings(),
        fetchAdminSignalHistoryDayWise(),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const nextForm = mapSettingsToForm(data);
      const nextTodayHistory = history.find((item) => item.date === today) ?? null;
      setForm(nextForm);
      setTodayHistory(nextTodayHistory);
      setSlotTokens(buildSlotTokenMap(nextForm.tradeSlots, nextTodayHistory));
      setPendingGeneratedTokens({});
      setErrors({});
    } catch (error) {
      setFeedback(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchControlSettings();
  }, []);

  const handleGlobalRuleChange = (field: keyof FormState["globalRules"], value: string) => {
    setForm((current) => ({
      ...current,
      globalRules: { ...current.globalRules, [field]: value },
    }));
  };

  const handleTradeSlotChange = (
    index: number,
    field: keyof FormState["tradeSlots"][number],
    value: string | boolean | number
  ) => {
    setForm((current) => ({
      ...current,
      tradeSlots: current.tradeSlots.map((slot, slotIndex) =>
        slotIndex === index ? { ...slot, [field]: value } : slot
      ),
    }));
  };

  const handlePackageTierChange = (
    index: number,
    field: keyof FormState["packageTiers"][number],
    value: string | boolean | number
  ) => {
    setForm((current) => ({
      ...current,
      packageTiers: current.packageTiers.map((tier, tierIndex) =>
        tierIndex === index ? { ...tier, [field]: value } : tier
      ),
    }));
  };

  const handleBirthdayGiftRowChange = (
    index: number,
    field: keyof FormState["birthdayGift"][number],
    value: string | boolean | number
  ) => {
    setForm((current) => ({
      ...current,
      birthdayGift: current.birthdayGift.map((gift, giftIndex) =>
        giftIndex === index ? { ...gift, [field]: value } : gift
      ),
    }));
  };

  const handleBirthdayGiftEnabledChange = (value: boolean) => {
    setForm((current) => ({
      ...current,
      birthdayGiftEnabled: value,
      birthdayGift: current.birthdayGift.map((gift) => ({ ...gift, isEnabled: value })),
    }));
  };

  const handleAddBirthdayGift = () => {
    setForm((current) => ({
      ...current,
      birthdayGift: [
        ...current.birthdayGift,
        {
          minimumEligibleLevel: birthdayLevelOptions.find(
            (level) => !current.birthdayGift.some((gift) => gift.minimumEligibleLevel === level)
          ) ?? "Level 3",
          giftAmount: "",
          isEnabled: current.birthdayGiftEnabled,
          sortOrder: current.birthdayGift.length + 1,
        },
      ],
    }));
  };

  const handleRemoveBirthdayGift = (index: number) => {
    setForm((current) => ({
      ...current,
      birthdayGift: current.birthdayGift
        .filter((_, giftIndex) => giftIndex !== index)
        .map((gift, giftIndex) => ({ ...gift, sortOrder: giftIndex + 1 })),
    }));
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};
    const investmentPerTradePercent = Number(form.globalRules.investmentPerTradePercent);
    const dailyPercentPerTrade = Number(form.globalRules.dailyPercentPerTrade);
    const signalValidityMinutes = Number(form.globalRules.signalValidityMinutes);
    const telegramChannelUrl = form.globalRules.telegramChannelUrl.trim();

    if (!Number.isFinite(investmentPerTradePercent) || investmentPerTradePercent < 0) {
      nextErrors.investmentPerTradePercent = "Investment per trade must be greater than or equal to 0";
    }
    if (!Number.isFinite(dailyPercentPerTrade) || dailyPercentPerTrade < 0) {
      nextErrors.dailyPercentPerTrade = "Daily percent per trade must be greater than or equal to 0";
    }
    if (!Number.isInteger(signalValidityMinutes) || signalValidityMinutes < 1) {
      nextErrors.signalValidityMinutes = "Signal validity minutes must be at least 1";
    }
    if (telegramChannelUrl) {
      try {
        const parsed = new URL(telegramChannelUrl);
        const hostname = parsed.hostname.toLowerCase();
        if (!["t.me", "telegram.me", "www.t.me", "www.telegram.me"].includes(hostname)) {
          nextErrors.telegramChannelUrl = "Telegram URL must use t.me or telegram.me";
        } else if (!parsed.pathname || parsed.pathname === "/") {
          nextErrors.telegramChannelUrl = "Telegram URL must include a channel path";
        }
      } catch {
        nextErrors.telegramChannelUrl = "Enter a valid Telegram URL";
      }
    }

    form.tradeSlots.forEach((slot, index) => {
      if (!slot.slotName.trim()) nextErrors[`tradeSlots_${index}_slotName`] = "Slot name is required";
      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(slot.slotTime)) {
        nextErrors[`tradeSlots_${index}_slotTime`] = "Enter a valid time";
      }
      if (slot.sortOrder < 0) nextErrors[`tradeSlots_${index}_sortOrder`] = "Sort order must be 0 or more";
    });

    form.packageTiers.forEach((tier, index) => {
      const minAmount = Number(tier.minAmount);
      const signalsPerDay = Number(tier.signalsPerDay);
      if (!tier.packageName.trim()) nextErrors[`packageTiers_${index}_packageName`] = "Package name is required";
      if (!Number.isFinite(minAmount) || minAmount < 0) {
        nextErrors[`packageTiers_${index}_minAmount`] = "Min amount must be greater than or equal to 0";
      }
      const isUnlimited = tier.maxAmount.trim().toLowerCase() === "unlimited";
      if (!tier.maxAmount.trim()) {
        nextErrors[`packageTiers_${index}_maxAmount`] = "Max amount is required";
      } else if (tier.maxAmount !== "Unlimited") {
        const numericMax = Number(tier.maxAmount);
        if (!Number.isFinite(numericMax) || numericMax < 0) {
          nextErrors[`packageTiers_${index}_maxAmount`] = "Max amount must be numeric or Unlimited";
        } else if (Number.isFinite(minAmount) && numericMax < minAmount) {
          nextErrors[`packageTiers_${index}_maxAmount`] = "Max amount must be greater than or equal to min amount";
        }
      }
      if (!Number.isInteger(signalsPerDay) || signalsPerDay < 1) {
        nextErrors[`packageTiers_${index}_signalsPerDay`] = "Signals per day must be at least 1";
      }
      if (!tier.requiredLevel.trim()) {
        nextErrors[`packageTiers_${index}_requiredLevel`] = "Required level is required";
      }
      if (tier.packageName.trim().toLowerCase() === "package 4" && !isUnlimited) {
        nextErrors[`packageTiers_${index}_maxAmount`] = "Package 4 must use Unlimited as max amount";
      }
    });

    const packageRanges = form.packageTiers
      .map((tier, index) => ({
        index,
        minAmount: Number(tier.minAmount),
        maxAmount: tier.maxAmount.trim().toLowerCase() === "unlimited" ? null : Number(tier.maxAmount),
      }))
      .filter((item) => Number.isFinite(item.minAmount))
      .sort((a, b) => a.minAmount - b.minAmount);

    packageRanges.forEach((current, index) => {
      if (index === 0) return;
      const previous = packageRanges[index - 1];
      if (previous.maxAmount === null || current.minAmount <= previous.maxAmount) {
        nextErrors[`packageTiers_${current.index}_minAmount`] = "Package ranges must not overlap";
      }
    });

    if (form.birthdayGift.length === 0) {
      nextErrors.birthdayGift = "At least one birthday gift row is required";
    }

    const usedLevels = new Set<string>();
    form.birthdayGift.forEach((gift, index) => {
      const level = gift.minimumEligibleLevel.trim();
      const giftAmount = Number(gift.giftAmount);
      if (!level) {
        nextErrors[`birthdayGift_${index}_minimumEligibleLevel`] = "Level is required";
      } else if (!birthdayLevelOptions.includes(level)) {
        nextErrors[`birthdayGift_${index}_minimumEligibleLevel`] = "Only Level 3 and above are allowed";
      } else {
        const key = level.toLowerCase();
        if (usedLevels.has(key)) {
          nextErrors[`birthdayGift_${index}_minimumEligibleLevel`] = "Each level can be used only once";
        }
        usedLevels.add(key);
      }

      if (!Number.isFinite(giftAmount) || giftAmount < 0) {
        nextErrors[`birthdayGift_${index}_giftAmount`] = "Gift amount must be greater than or equal to 0";
      }
    });

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    setFeedback(null);
    if (!validateForm()) return;

    const payload: UpdateAdminControlSettingsPayload = {
      globalRules: {
        investmentPerTradePercent: Number(form.globalRules.investmentPerTradePercent),
        dailyPercentPerTrade: Number(form.globalRules.dailyPercentPerTrade),
        signalValidityMinutes: Number(form.globalRules.signalValidityMinutes),
        telegramChannelUrl: form.globalRules.telegramChannelUrl.trim() || null,
      },
      tradeSlots: form.tradeSlots.map((slot) => ({
        id: slot.id,
        slotName: slot.slotName,
        slotTime: slot.slotTime,
        isEnabled: slot.isEnabled,
        sortOrder: slot.sortOrder,
      })),
      packageTiers: form.packageTiers.map((tier) => ({
        id: tier.id,
        packageName: tier.packageName,
        minAmount: Number(tier.minAmount),
        maxAmount: tier.maxAmount,
        signalsPerDay: Number(tier.signalsPerDay),
        requiredLevel: tier.requiredLevel,
        isEnabled: tier.isEnabled,
        sortOrder: tier.sortOrder,
      })),
      birthdayGift: form.birthdayGift.map((gift, index) => ({
        id: gift.id,
        isEnabled: form.birthdayGiftEnabled,
        minimumEligibleLevel: gift.minimumEligibleLevel,
        giftAmount: Number(gift.giftAmount),
        sortOrder: index + 1,
      })),
      generatedTokens: pendingGeneratedTokens,
    };

    setSaving(true);
    try {
      const data = await updateAdminControlSettings(payload);
      const nextForm = mapSettingsToForm(data);
      setForm(nextForm);
      setSlotTokens((current) => {
        const next = { ...current };
        nextForm.tradeSlots.forEach((slot) => {
          const key = String(slot.id);
          if (!(key in next)) next[key] = "";
        });
        return next;
      });
      setPendingGeneratedTokens({});
      setErrors({});
      setFeedback("Control settings updated successfully");
    } catch (error) {
      setFeedback(getErrorMessage(error));
      setErrors((current) => ({ ...current, ...getFieldErrors(error) }));
    } finally {
      setSaving(false);
    }
  };

  const buildPayload = (): UpdateAdminControlSettingsPayload => ({
    globalRules: {
      investmentPerTradePercent: Number(form.globalRules.investmentPerTradePercent),
      dailyPercentPerTrade: Number(form.globalRules.dailyPercentPerTrade),
      signalValidityMinutes: Number(form.globalRules.signalValidityMinutes),
      telegramChannelUrl: form.globalRules.telegramChannelUrl.trim() || null,
    },
    tradeSlots: form.tradeSlots.map((slot) => ({
      id: slot.id,
      slotName: slot.slotName,
      slotTime: slot.slotTime,
      isEnabled: slot.isEnabled,
      sortOrder: slot.sortOrder,
    })),
    packageTiers: form.packageTiers.map((tier) => ({
      id: tier.id,
      packageName: tier.packageName,
      minAmount: Number(tier.minAmount),
      maxAmount: tier.maxAmount,
      signalsPerDay: Number(tier.signalsPerDay),
      requiredLevel: tier.requiredLevel,
      isEnabled: tier.isEnabled,
      sortOrder: tier.sortOrder,
    })),
    birthdayGift: form.birthdayGift.map((gift, index) => ({
      id: gift.id,
      isEnabled: form.birthdayGiftEnabled,
      minimumEligibleLevel: gift.minimumEligibleLevel,
      giftAmount: Number(gift.giftAmount),
      sortOrder: index + 1,
    })),
    generatedTokens: pendingGeneratedTokens,
  });

  const saveTradeSlots = async () => {
    setFeedback(null);
    if (!validateForm()) return false;

    setSlotSaving(true);
    try {
      const data = await updateAdminControlSettings(buildPayload());
      const nextForm = mapSettingsToForm(data);
      setForm(nextForm);
      setSlotTokens((current) => {
        const next = { ...current };
        nextForm.tradeSlots.forEach((slot) => {
          const key = String(slot.id);
          if (!(key in next)) next[key] = "";
        });
        return next;
      });
      setPendingGeneratedTokens({});
      await refreshTodayHistory();
      setErrors({});
      setFeedback("Trade time slots and tokens saved successfully");
      return true;
    } catch (error) {
      setFeedback(getErrorMessage(error));
      setErrors((current) => ({ ...current, ...getFieldErrors(error) }));
      return false;
    } finally {
      setSlotSaving(false);
    }
  };

  const refreshTodayHistory = async (targetDate?: string) => {
    const history = await fetchAdminSignalHistoryDayWise();
    const fallbackToday = new Date().toISOString().slice(0, 10);
    const matchDate = targetDate ?? fallbackToday;
    const nextTodayHistory = history.find((item) => item.date === matchDate) ?? null;
    setTodayHistory(nextTodayHistory);
    setSlotTokens((current) => ({
      ...buildSlotTokenMap(form.tradeSlots, nextTodayHistory),
      ...current,
    }));
  };

  const handleGenerateToken = async (slotId: number | string) => {
    setGeneratingSlotId(slotId);
    try {
      const batch = await generateAdminTradeSlotToken(slotId, { previewOnly: true });
      setSlotTokens((current) => ({
        ...current,
        [String(slotId)]: batch.batchToken ?? "",
      }));
      setPendingGeneratedTokens((current) => ({
        ...current,
        [String(slotId)]: batch.batchToken ?? "",
      }));
      setFeedback("Token generated locally. Click Save Slots to store the new time and token in the database.");
    } catch (error) {
      setFeedback(getErrorMessage(error));
    } finally {
      setGeneratingSlotId(null);
    }
  };

  const handleCopyToken = async (slotId: number | string, token: string) => {
    if (!token) {
      setFeedback("No token available to copy");
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = token;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "absolute";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopiedSlotId(slotId);
      window.setTimeout(() => {
        setCopiedSlotId((current) => (current === slotId ? null : current));
      }, 1800);
    } catch (error) {
      console.error("Failed to copy token", error);
      setFeedback("Failed to copy token");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-white/10 bg-white/5 text-slate-300">
        Loading trading flow settings...
      </div>
    );
  }

  const getTokenForSlot = (slotId: number | string, slotTime: string) => {
    const pending = pendingGeneratedTokens[String(slotId)];
    if (pending) return pending;
    const byId = slotTokens[String(slotId)];
    if (byId) return byId;
    const normalized = slotTime.length === 5 ? `${slotTime}:00` : slotTime;
    if (!todayHistory) return "";
    if (normalized === "09:00:00") return todayHistory["9"] ?? "";
    if (normalized === "12:00:00") return todayHistory["12"] ?? "";
    if (normalized === "15:00:00") return todayHistory["3"] ?? "";
    if (normalized === "18:00:00") return todayHistory["6"] ?? "";
    return "";
  };

  return (
    <div className="space-y-6 text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-300/80">Controls</div>
          <h2 className="text-2xl font-semibold text-white">Trading Flow Settings</h2>
          <p className="text-sm text-slate-300/80">
            Configure global rules, trade slots, package tier access, and birthday rewards.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => void fetchControlSettings()} disabled={saving || slotSaving || generatingSlotId !== null}>
            Refresh
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || slotSaving || generatingSlotId !== null}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </header>

      {feedback && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {feedback}
        </div>
      )}

      <section className={cardCls}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white">Global Trading Rules</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Investment Per Trade %" error={errors.investmentPerTradePercent}>
            <Input type="number" step="0.01" value={form.globalRules.investmentPerTradePercent} onChange={(event) => handleGlobalRuleChange("investmentPerTradePercent", event.target.value)} className={inputCls} />
          </Field>
          <Field label="Per Trade %" error={errors.dailyPercentPerTrade}>
            <Input type="number" step="0.01" value={form.globalRules.dailyPercentPerTrade} onChange={(event) => handleGlobalRuleChange("dailyPercentPerTrade", event.target.value)} className={inputCls} />
          </Field>
          <Field label="Signal Validity (Minutes)" error={errors.signalValidityMinutes}>
            <Input type="number" min="1" value={form.globalRules.signalValidityMinutes} onChange={(event) => handleGlobalRuleChange("signalValidityMinutes", event.target.value)} className={inputCls} />
          </Field>
          <Field label="Telegram Channel URL" error={errors.telegramChannelUrl}>
            <Input
              type="url"
              value={form.globalRules.telegramChannelUrl}
              onChange={(event) => handleGlobalRuleChange("telegramChannelUrl", event.target.value)}
              placeholder="https://t.me/your_channel_name"
              className={inputCls}
            />
          </Field>
        </div>
      </section>

      <section className={cardCls}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Trade Time Slots(Per day wise changable)</h3>
            <p className="mt-1 text-sm text-slate-300/75">
              Save slot edits instantly, then generate the day&apos;s token for any slot.
            </p>
          </div>
          <Button type="button" variant="ghost" onClick={() => void saveTradeSlots()} disabled={saving || slotSaving || generatingSlotId !== null}>
            {slotSaving ? "Saving..." : "Save Slots"}
          </Button>
        </div>
        <div className={tableWrapCls}>
          <table className={tableCls}>
            <thead className="bg-white/5">
              <tr>
                <th className={headCellCls}>Slot</th>
                <th className={headCellCls}>Time</th>
                <th className={headCellCls}>Token</th>
                <th className={headCellCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {form.tradeSlots.map((slot, index) => (
                <tr key={slot.id} className="border-t border-white/5">
                  <td className={bodyCellCls}>
                    <Input value={slot.slotName} onChange={(event) => handleTradeSlotChange(index, "slotName", event.target.value)} className={inputCls} />
                    <InlineError error={errors[`tradeSlots_${index}_slotName`] || errors[`tradeSlots_${slot.id}`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <Input type="time" value={slot.slotTime} onChange={(event) => handleTradeSlotChange(index, "slotTime", event.target.value)} className={inputCls} />
                    <InlineError error={errors[`tradeSlots_${index}_slotTime`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const slotToken = getTokenForSlot(slot.id, slot.slotTime);
                        return (
                          <>
                      <Input
                        value={slotToken}
                        readOnly
                        placeholder="Auto-generated"
                        className={`${inputCls} min-w-[150px] text-slate-300`}
                      />
                      <button
                        type="button"
                        onClick={() => void handleCopyToken(slot.id, slotToken)}
                        disabled={!slotToken}
                        title={copiedSlotId === slot.id ? "Copied" : "Copy token"}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {copiedSlotId === slot.id ? <CopiedIcon /> : <CopyIcon />}
                      </button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleGenerateToken(slot.id)}
                        disabled={saving || slotSaving || generatingSlotId === slot.id}
                      >
                        {generatingSlotId === slot.id ? "Generating..." : "Generate"}
                      </Button>
                          </>
                        );
                      })()}
                    </div>
                  </td>
                  <td className={bodyCellCls}>
                    <label className="inline-flex items-center gap-3 text-sm text-slate-200">
                      <input type="checkbox" checked={slot.isEnabled} onChange={(event) => handleTradeSlotChange(index, "isEnabled", event.target.checked)} className="h-4 w-4 rounded border border-white/20 bg-slate-900" />
                      <span>{slot.isEnabled ? "Enabled" : "Disabled"}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={cardCls}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white">Package Tier Settings</h3>
        </div>
        <div className={tableWrapCls}>
          <table className={tableCls}>
            <thead className="bg-white/5">
              <tr>
                <th className={headCellCls}>Package</th>
                <th className={headCellCls}>Min Amount</th>
                <th className={headCellCls}>Max Amount</th>
                <th className={headCellCls}>Signals/Day</th>
                <th className={headCellCls}>Required Level</th>
                <th className={headCellCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {form.packageTiers.map((tier, index) => (
                <tr key={tier.id} className="border-t border-white/5">
                  <td className={bodyCellCls}>
                    <Input value={tier.packageName} onChange={(event) => handlePackageTierChange(index, "packageName", event.target.value)} className={inputCls} />
                    <InlineError error={errors[`packageTiers_${index}_packageName`] || errors[`packageTiers_${tier.id}`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <Input type="number" min="0" value={tier.minAmount} onChange={(event) => handlePackageTierChange(index, "minAmount", event.target.value)} className={inputCls} />
                    <InlineError error={errors[`packageTiers_${index}_minAmount`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <Input value={tier.maxAmount} onChange={(event) => handlePackageTierChange(index, "maxAmount", event.target.value)} className={inputCls} />
                    <InlineError error={errors[`packageTiers_${index}_maxAmount`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <Input type="number" min="1" value={tier.signalsPerDay} onChange={(event) => handlePackageTierChange(index, "signalsPerDay", event.target.value)} className={inputCls} />
                    <InlineError error={errors[`packageTiers_${index}_signalsPerDay`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <select
                      title="Required Level"
                      value={tier.requiredLevel}
                      onChange={(event) => handlePackageTierChange(index, "requiredLevel", event.target.value)}
                      className={selectCls}
                    >
                      {levelOptions.map((level) => (
                        <option key={level} value={level} className="bg-slate-900 text-white">
                          {level}
                        </option>
                      ))}
                    </select>
                    <InlineError error={errors[`packageTiers_${index}_requiredLevel`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <label className="inline-flex items-center gap-3 text-sm text-slate-200">
                      <input type="checkbox" checked={tier.isEnabled} onChange={(event) => handlePackageTierChange(index, "isEnabled", event.target.checked)} className="h-4 w-4 rounded border border-white/20 bg-slate-900" />
                      <span>{tier.isEnabled ? "Enabled" : "Disabled"}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={cardCls}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white">Birthday Gift Settings</h3>
        </div>
        <div className="space-y-4">
          <Field label="Enable Birthday Gift">
            <label className="inline-flex h-10 items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-200">
              <input type="checkbox" checked={form.birthdayGiftEnabled} onChange={(event) => handleBirthdayGiftEnabledChange(event.target.checked)} className="h-4 w-4 rounded border border-white/20 bg-slate-900" />
              <span>{form.birthdayGiftEnabled ? "Enabled" : "Disabled"}</span>
            </label>
          </Field>

          {errors.birthdayGift && (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {errors.birthdayGift}
            </div>
          )}

          <div className="space-y-3">
            {form.birthdayGift.map((gift, index) => (
              <div key={gift.id ?? `birthday-gift-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                  <Field
                    label="Level"
                    error={errors[`birthdayGift_${index}_minimumEligibleLevel`]}
                  >
                    <select
                      title="Level"
                      value={gift.minimumEligibleLevel}
                      onChange={(event) => handleBirthdayGiftRowChange(index, "minimumEligibleLevel", event.target.value)}
                      className={selectCls}
                    >
                      {birthdayLevelOptions.map((level) => (
                        <option key={level} value={level} className="bg-slate-900 text-white">
                          {level}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="You will get $ (USDT)"
                    error={errors[`birthdayGift_${index}_giftAmount`]}
                  >
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={gift.giftAmount}
                      onChange={(event) => handleBirthdayGiftRowChange(index, "giftAmount", event.target.value)}
                      className={inputCls}
                    />
                  </Field>

                  <div className="flex gap-2 lg:pb-[2px]">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleAddBirthdayGift}
                      disabled={birthdayLevelOptions.every((level) => form.birthdayGift.some((item) => item.minimumEligibleLevel === level))}
                    >
                      Add More
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => handleRemoveBirthdayGift(index)}
                      disabled={form.birthdayGift.length === 1}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={() => void handleSubmit()} disabled={saving || slotSaving || generatingSlotId !== null}>
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      {children}
      <InlineError error={error} />
    </label>
  );
}

function InlineError({ error }: { error?: string }) {
  if (!error) return null;
  return <div className="mt-1 text-xs text-rose-300">{error}</div>;
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 9.75A2.25 2.25 0 0 1 11.25 7.5h6A2.25 2.25 0 0 1 19.5 9.75v7.5a2.25 2.25 0 0 1-2.25 2.25h-6A2.25 2.25 0 0 1 9 17.25v-7.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M15 7.5V6.75A2.25 2.25 0 0 0 12.75 4.5h-6A2.25 2.25 0 0 0 4.5 6.75v7.5a2.25 2.25 0 0 0 2.25 2.25H9"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function CopiedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 13 4 4L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
