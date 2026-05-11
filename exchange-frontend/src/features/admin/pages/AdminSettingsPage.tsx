import { useEffect, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import {
  changeAdminPassword,
  fetchAdminSettings,
  updateAdminSettings,
  uploadAdminSettingsAsset,
  type AdminSettings,
} from "../api/admin.api";

const panelCls = "rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.72),rgba(15,23,42,0.48))] p-5 shadow-[0_24px_80px_-60px_rgba(15,23,42,0.95)] backdrop-blur-sm md:p-6";
const fieldCls =
  "w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400/60 focus:outline-none";
const sectionBodyCls = "mt-6 space-y-5";
const allowedSettingsKeys = [
  "siteName",
  "siteLogoUrl",
  "siteFaviconUrl",
  "maintenanceMode",
  "enableKyc",
  "enableLanguageSwitcher",
  "enableDarkMode",
  "darkModeDefault",
  "requireReferralCode",
  "withdrawalLimitKyc",
  "withdrawalLimitNonKyc",
  "withdrawalAdminFeePercent",
  "withdrawalLockPeriodDays",
  "earlyWithdrawalPenaltyPercent",
  "rewardReductionEnabled",
  "minimumWithdrawalAmount",
  "maximumWithdrawalAmount",
  "withdrawalNote",
  "isWithdrawalEnabled",
  "defaultSwapMarket",
  "tradeMakerFee",
  "tradeTakerFee",
  "referralFee",
  "transferCommission",
  "disableTrades",
  "mailType",
  "mailHost",
  "mailPort",
  "mailUsername",
  "mailPassword",
  "mailSenderName",
  "mailSenderEmail",
  "mailEncryption",
  "notificationAdminEmail",
  "notifyCryptoDeposits",
  "notifyCryptoWithdrawals",
  "notifyFiatDeposits",
  "notifyFiatWithdrawals",
  "notifyKyc",
  "notifyNewUser",
  "stripePublicKey",
  "stripeSecretKey",
  "stripeBaseCurrency",
  "recaptchaEnabled",
  "recaptchaSiteKey",
  "recaptchaSecretKey",
  "socialYoutube",
  "socialFacebook",
  "socialTelegram",
  "socialTwitter",
  "socialInstagram",
  "socialLinkedin",
] as const satisfies ReadonlyArray<keyof AdminSettings>;

const sectionFieldMap = {
  brand: ["siteName", "siteLogoUrl", "siteFaviconUrl"],
  access: ["maintenanceMode", "enableKyc", "enableLanguageSwitcher", "enableDarkMode", "darkModeDefault", "requireReferralCode"],
  withdrawals: ["withdrawalLimitKyc", "withdrawalLimitNonKyc"],
  withdrawalRules: [
    "withdrawalAdminFeePercent",
    "withdrawalLockPeriodDays",
    "earlyWithdrawalPenaltyPercent",
    "rewardReductionEnabled",
    "minimumWithdrawalAmount",
    "maximumWithdrawalAmount",
    "withdrawalNote",
    "isWithdrawalEnabled",
  ],
  tradingDefaults: ["defaultSwapMarket"],
  tradingFees: ["tradeMakerFee", "tradeTakerFee", "referralFee", "transferCommission", "disableTrades"],
  mail: [
    "mailType",
    "mailHost",
    "mailPort",
    "mailUsername",
    "mailPassword",
    "mailSenderName",
    "mailSenderEmail",
    "mailEncryption",
  ],
  social: ["socialYoutube", "socialFacebook", "socialTelegram", "socialTwitter", "socialInstagram", "socialLinkedin"],
} as const satisfies Record<string, ReadonlyArray<keyof AdminSettings>>;

type SettingsSectionKey = keyof typeof sectionFieldMap;
type SectionFeedbackTone = "success" | "error";
type SectionFeedback = { tone: SectionFeedbackTone; message: string };
type SectionFeedbackMap = Partial<Record<SettingsSectionKey | "password", SectionFeedback>>;

const getErrorMessage = (error: unknown, fallback = "Request failed") => {
  if (error && typeof error === "object") {
    const maybeAxios = error as {
      response?: { data?: unknown; statusText?: string };
      message?: string;
    };
    const data = maybeAxios.response?.data;
    if (data && typeof data === "object" && "message" in data && typeof (data as { message?: unknown }).message === "string") {
      return (data as { message: string }).message;
    }
    if (maybeAxios.message) return maybeAxios.message;
    if (maybeAxios.response?.statusText) return maybeAxios.response.statusText;
  }
  if (error instanceof Error) return error.message;
  return fallback;
};

const defaultSettings: AdminSettings = {
  siteName: "",
  siteLogoUrl: "/icons/logo-white.webp",
  siteFaviconUrl: "/favicon.ico",
  maintenanceMode: false,
  enableKyc: true,
  enableLanguageSwitcher: false,
  enableDarkMode: true,
  darkModeDefault: true,
  requireReferralCode: false,
  withdrawalLimitKyc: 0,
  withdrawalLimitNonKyc: 0,
  withdrawalAdminFeePercent: 12,
  withdrawalLockPeriodDays: 55,
  earlyWithdrawalPenaltyPercent: 25,
  rewardReductionEnabled: true,
  minimumWithdrawalAmount: 0,
  maximumWithdrawalAmount: 0,
  withdrawalNote: "",
  isWithdrawalEnabled: true,
  defaultSwapMarket: "",
  tradeMakerFee: 0,
  tradeTakerFee: 0,
  referralFee: 0,
  transferCommission: 0,
  disableTrades: false,
  mailType: "smtp",
  mailHost: "",
  mailPort: 0,
  mailUsername: "",
  mailPassword: "",
  mailSenderName: "",
  mailSenderEmail: "",
  mailEncryption: "",
  notificationAdminEmail: "",
  notifyCryptoDeposits: true,
  notifyCryptoWithdrawals: true,
  notifyFiatDeposits: false,
  notifyFiatWithdrawals: false,
  notifyKyc: true,
  notifyNewUser: true,
  stripePublicKey: "",
  stripeSecretKey: "",
  stripeBaseCurrency: "usd",
  recaptchaEnabled: false,
  recaptchaSiteKey: "",
  recaptchaSecretKey: "",
  socialYoutube: "",
  socialFacebook: "",
  socialTelegram: "",
  socialTwitter: "",
  socialInstagram: "",
  socialLinkedin: "",
  currentPassword: "",
  newPassword: "",
};

export default function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["admin", "settings"],
    queryFn: fetchAdminSettings,
  });
  const [form, setForm] = useState<AdminSettings>(defaultSettings);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [activeSaveSection, setActiveSaveSection] = useState<SettingsSectionKey | null>(null);
  const [sectionFeedback, setSectionFeedback] = useState<SectionFeedbackMap>({});
  const [dragTarget, setDragTarget] = useState<"siteLogoUrl" | "siteFaviconUrl" | null>(null);
  const [uploadingField, setUploadingField] = useState<"siteLogoUrl" | "siteFaviconUrl" | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<"siteLogoUrl" | "siteFaviconUrl", string | null>>({
    siteLogoUrl: null,
    siteFaviconUrl: null,
  });

  const mutation = useMutation({
    mutationFn: updateAdminSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "settings"], data);
      setForm(data);
      if (activeSaveSection) {
        setSectionFeedback((prev) => ({
          ...prev,
          [activeSaveSection]: {
            tone: "success",
            message: `${getSectionLabel(activeSaveSection)} saved successfully.`,
          },
        }));
      }
      window.dispatchEvent(
        new CustomEvent("site-settings-updated", {
          detail: {
            siteName: data.siteName,
            siteLogoUrl: data.siteLogoUrl,
            siteFaviconUrl: data.siteFaviconUrl,
          },
        })
      );
    },
    onError: (error) => {
      if (!activeSaveSection) return;
      setSectionFeedback((prev) => ({
        ...prev,
        [activeSaveSection]: {
          tone: "error",
          message: getErrorMessage(error, `Failed to save ${getSectionLabel(activeSaveSection).toLowerCase()}.`),
        },
      }));
    },
    onSettled: () => {
      setActiveSaveSection(null);
    },
  });

  const passwordMutation = useMutation({
    mutationFn: changeAdminPassword,
    onSuccess: () => {
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setPasswordError(null);
      setSectionFeedback((prev) => ({
        ...prev,
        password: {
          tone: "success",
          message: "Admin password updated successfully.",
        },
      }));
    },
    onError: (error) => {
      setSectionFeedback((prev) => ({
        ...prev,
        password: {
          tone: "error",
          message: getErrorMessage(error, "Failed to update admin password."),
        },
      }));
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setForm(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  useEffect(() => {
    return () => {
      Object.values(imagePreviewUrls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [imagePreviewUrls]);

  const loading = settingsQuery.isLoading;
  const error = settingsQuery.error as Error | null;
  const savedSettings = settingsQuery.data ?? defaultSettings;

  const handleChange = <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) => {
    const relatedSection = findSectionForKey(key);
    if (relatedSection) {
      setSectionFeedback((prev) => {
        if (!prev[relatedSection]) return prev;
        const next = { ...prev };
        delete next[relatedSection];
        return next;
      });
    }
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSectionSave = (section: SettingsSectionKey) => {
    const validationError = validateSection(form, section);
    if (validationError) {
      setSectionFeedback((prev) => ({
        ...prev,
        [section]: {
          tone: "error",
          message: validationError,
        },
      }));
      return;
    }
    setSectionFeedback((prev) => {
      const next = { ...prev };
      delete next[section];
      return next;
    });
    setActiveSaveSection(section);
    mutation.mutate(toSectionPayload(form, section));
  };

  const handleImageUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
    field: "siteLogoUrl" | "siteFaviconUrl"
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    await applyImageFile(file, field);
    event.target.value = "";
  };

  const applyImageFile = async (file: File, field: "siteLogoUrl" | "siteFaviconUrl") => {
    setUploadError(null);
    setSectionFeedback((prev) => {
      if (!prev.brand) return prev;
      const next = { ...prev };
      delete next.brand;
      return next;
    });
    setImagePreviewUrls((current) => {
      const next = { ...current };
      if (next[field]) {
        URL.revokeObjectURL(next[field]!);
      }
      next[field] = URL.createObjectURL(file);
      return next;
    });
    setUploadingField(field);
    try {
      const asset = await uploadAdminSettingsAsset(field, file);
      handleChange(field, asset.url);
    } catch (err) {
      setUploadError(getErrorMessage(err, "Failed to upload image."));
    } finally {
      setUploadingField(null);
    }
  };

  const handleDrop = async (
    event: DragEvent<HTMLLabelElement>,
    field: "siteLogoUrl" | "siteFaviconUrl"
  ) => {
    event.preventDefault();
    setDragTarget(null);
    const file = event.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    await applyImageFile(file, field);
  };

  const handleDragState = (
    event: DragEvent<HTMLLabelElement>,
    field: "siteLogoUrl" | "siteFaviconUrl",
    active: boolean
  ) => {
    event.preventDefault();
    setDragTarget(active ? field : null);
  };

  const handlePasswordSubmit = () => {
    setPasswordError(null);
    setSectionFeedback((prev) => {
      if (!prev.password) return prev;
      const next = { ...prev };
      delete next.password;
      return next;
    });
    if (!passwordForm.currentPassword.trim()) {
      setPasswordError("Current password is required.");
      return;
    }
    if (passwordForm.newPassword.trim().length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("New password and confirm password must match.");
      return;
    }

    passwordMutation.mutate({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
  };

  const isSectionDirty = (section: SettingsSectionKey) => hasSectionChanges(form, savedSettings, section);

  return (
    <div className="space-y-6">
      <header>
        <div className="text-xs uppercase tracking-[0.3em] text-slate-400">Admin</div>
        <h2 className="text-2xl font-semibold text-white">Site settings</h2>
        <p className="text-sm text-slate-300/80">Control global toggles and platform limits.</p>
      </header>

      {loading && <div className="text-sm text-slate-300/80">Loading settings...</div>}
      {error && <div className="text-sm text-rose-300">Failed to load settings: {getErrorMessage(error, "Failed to load settings.")}</div>}

      {!loading && settingsQuery.data && (
        <div className="space-y-6">
          {/* <section className="rounded-[34px] border border-white/10 bg-gradient-to-r from-emerald-500/10 via-cyan-500/5 to-transparent px-6 py-6">
            <div className="max-w-3xl">
              <div className="text-[11px] uppercase tracking-[0.3em] text-emerald-200/75">Settings workspace</div>
              <h3 className="mt-3 text-2xl font-semibold text-white">Configure the site one section at a time.</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300/80">
                Each block below is arranged as its own settings module with a dedicated save action, so updates stay focused and easier to review.
              </p>
            </div>
          </section> */}

          <section className={`${panelCls} space-y-0`}>
            <SectionHeading
              eyebrow="Identity"
              title="Brand assets"
              description="Update the public-facing name and media assets used across the site."
              action={
                <Button
                  onClick={() => handleSectionSave("brand")}
                  disabled={!isSectionDirty("brand") || mutation.isPending || Boolean(uploadingField)}
                >
                  {mutation.isPending && isSectionDirty("brand") ? "Saving..." : "Save brand settings"}
                </Button>
              }
            />

            <div className={`${sectionBodyCls} grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]`}>
                <div className="space-y-4">
                  <TextInput
                    label="Site name"
                    value={form.siteName}
                    onChange={(val) => handleChange("siteName", val)}
                    placeholder="Primerica Exchange"
                  />
                  <div className="rounded-[24px] border border-white/10 bg-black/10 p-4">
                    <div className="text-xs uppercase tracking-[0.22em] text-slate-400">Brand upload guide</div>
                    <div className="mt-3 space-y-2 text-sm text-slate-300/85">
                      <p>Upload the site logo and favicon directly here just like the user profile photo flow.</p>
                      <p>Previews update immediately after upload, and the saved settings keep only the uploaded asset path.</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <ImageDropZone
                    label="Site logo"
                    hint="PNG, SVG, or WebP works best for header branding."
                    previewUrl={imagePreviewUrls.siteLogoUrl ?? form.siteLogoUrl ?? ""}
                    previewAlt="Site logo preview"
                    previewClassName="h-full w-full object-contain"
                    frameClassName="h-28 w-full"
                    active={dragTarget === "siteLogoUrl"}
                    onDragEnter={(event) => handleDragState(event, "siteLogoUrl", true)}
                    onDragOver={(event) => handleDragState(event, "siteLogoUrl", true)}
                    onDragLeave={(event) => handleDragState(event, "siteLogoUrl", false)}
                    onDrop={(event) => void handleDrop(event, "siteLogoUrl")}
                    onChange={(event) => void handleImageUpload(event, "siteLogoUrl")}
                    accept="image/*"
                    isUploading={uploadingField === "siteLogoUrl"}
                  />
                  <ImageDropZone
                    label="Favicon"
                    hint="Square image recommended for browser tabs and shortcuts."
                    previewUrl={imagePreviewUrls.siteFaviconUrl ?? form.siteFaviconUrl ?? ""}
                    previewAlt="Site favicon preview"
                    previewClassName="h-full w-full object-contain"
                    frameClassName="h-28 w-28"
                    active={dragTarget === "siteFaviconUrl"}
                    onDragEnter={(event) => handleDragState(event, "siteFaviconUrl", true)}
                    onDragOver={(event) => handleDragState(event, "siteFaviconUrl", true)}
                    onDragLeave={(event) => handleDragState(event, "siteFaviconUrl", false)}
                    onDrop={(event) => void handleDrop(event, "siteFaviconUrl")}
                    onChange={(event) => void handleImageUpload(event, "siteFaviconUrl")}
                    accept="image/png,image/x-icon,image/svg+xml,image/webp"
                    isUploading={uploadingField === "siteFaviconUrl"}
                  />
                </div>
              {uploadError && <div className="text-sm text-rose-300">{uploadError}</div>}
              <SectionFeedbackNotice feedback={sectionFeedback.brand} />
            </div>
          </section>

          <section className={`${panelCls} space-y-0`}>
            <SectionHeading
              eyebrow="Admin security"
              title="Profile password"
              description="Set a new admin password when credentials need to be rotated."
              action={
                <Button onClick={handlePasswordSubmit} disabled={passwordMutation.isPending}>
                  {passwordMutation.isPending ? "Updating..." : "Change admin password"}
                </Button>
              }
            />
            <div className={`${sectionBodyCls} grid gap-4 text-sm md:grid-cols-3`}>
                <TextInput
                  label="Current password"
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(val) => setPasswordForm((prev) => ({ ...prev, currentPassword: val }))}
                />
                <TextInput
                  label="New password"
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(val) => setPasswordForm((prev) => ({ ...prev, newPassword: val }))}
                />
                <TextInput
                  label="Confirm new password"
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(val) => setPasswordForm((prev) => ({ ...prev, confirmPassword: val }))}
                />
              {passwordError && <div className="md:col-span-3 text-sm text-rose-300">{passwordError}</div>}
              {!passwordError && <div className="md:col-span-3"><SectionFeedbackNotice feedback={sectionFeedback.password} /></div>}
            </div>
          </section>

          <section className={panelCls}>
            <SectionHeading
              eyebrow="Platform access"
              title="Access & experience"
              description="Control platform visibility, verification flow, and default user experience."
              action={
                <Button onClick={() => handleSectionSave("access")} disabled={!isSectionDirty("access") || mutation.isPending}>
                  {mutation.isPending && isSectionDirty("access") ? "Saving..." : "Save access settings"}
                </Button>
              }
            />
            <div className={`${sectionBodyCls} grid gap-3 md:grid-cols-2 text-sm`}>
              <ToggleField
                label="Maintenance mode"
                value={form.maintenanceMode}
                onChange={(val) => handleChange("maintenanceMode", val)}
              />
              <ToggleField label="Enable KYC" value={form.enableKyc} onChange={(val) => handleChange("enableKyc", val)} />
              <ToggleField
                label="Language switcher"
                value={form.enableLanguageSwitcher}
                onChange={(val) => handleChange("enableLanguageSwitcher", val)}
              />
              <ToggleField
                label="Enable dark mode"
                value={form.enableDarkMode}
                onChange={(val) => handleChange("enableDarkMode", val)}
              />
              <ToggleField
                label="Dark mode by default"
                value={form.darkModeDefault}
                onChange={(val) => handleChange("darkModeDefault", val)}
              />
              <ToggleField
                label="Require referral code"
                value={form.requireReferralCode}
                onChange={(val) => handleChange("requireReferralCode", val)}
              />
            </div>
            <div className="mt-4">
              <SectionFeedbackNotice feedback={sectionFeedback.access} />
            </div>
          </section>
{/* 
          <section className={panelCls}>
            <SectionHeading
              eyebrow="Risk controls"
              title="Withdrawal limits"
              description="Set the platform-wide withdrawal ceiling for verified and non-verified users."
              action={
                <Button onClick={() => handleSectionSave("withdrawals")} disabled={!isSectionDirty("withdrawals") || mutation.isPending}>
                  {mutation.isPending && isSectionDirty("withdrawals") ? "Saving..." : "Save withdrawal limits"}
                </Button>
              }
            />
            <div className={`${sectionBodyCls} grid gap-4 md:grid-cols-2 text-sm`}>
              <NumberInput
                label="KYC limit (USD)"
                value={form.withdrawalLimitKyc}
                onChange={(val) => handleChange("withdrawalLimitKyc", val)}
              />
              <NumberInput
                label="Non-KYC limit (USD)"
                value={form.withdrawalLimitNonKyc}
                onChange={(val) => handleChange("withdrawalLimitNonKyc", val)}
              />
            </div>
            <div className="mt-4">
              <SectionFeedbackNotice feedback={sectionFeedback.withdrawals} />
            </div>
          </section> */}

          <section className={panelCls}>
            <SectionHeading
              eyebrow="Payout policy"
              title="Withdrawal rules"
              description="Configure lock period, platform fee, early penalty, reward reduction, and payout availability."
              action={
                <Button onClick={() => handleSectionSave("withdrawalRules")} disabled={!isSectionDirty("withdrawalRules") || mutation.isPending}>
                  {mutation.isPending && isSectionDirty("withdrawalRules") ? "Saving..." : "Save withdrawal rules"}
                </Button>
              }
            />

            <div className={`${sectionBodyCls} grid gap-4 xl:grid-cols-[1.1fr_1fr]`}>
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <RuleSummaryCard label="Admin Fee" value={`${Number(form.withdrawalAdminFeePercent ?? 12)}%`} />
                  <RuleSummaryCard label="Lock Period" value={`${Number(form.withdrawalLockPeriodDays ?? 55)} Days`} />
                  <RuleSummaryCard label="Early Penalty" value={`${Number(form.earlyWithdrawalPenaltyPercent ?? 25)}%`} />
                  <RuleSummaryCard
                    label="Reward Reduction"
                    value={form.rewardReductionEnabled ? "Enabled" : "Disabled"}
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2 text-sm">
                  <NumberInput
                    label="Withdrawal admin fee percent"
                    value={Number(form.withdrawalAdminFeePercent ?? 12)}
                    onChange={(val) => handleChange("withdrawalAdminFeePercent", val)}
                  />
                  <NumberInput
                    label="Withdrawal lock period days"
                    value={Number(form.withdrawalLockPeriodDays ?? 55)}
                    onChange={(val) => handleChange("withdrawalLockPeriodDays", val)}
                  />
                  <NumberInput
                    label="Early withdrawal penalty percent"
                    value={Number(form.earlyWithdrawalPenaltyPercent ?? 25)}
                    onChange={(val) => handleChange("earlyWithdrawalPenaltyPercent", val)}
                  />
                  <NumberInput
                    label="Minimum withdrawal amount($)"
                    value={Number(form.minimumWithdrawalAmount ?? 0)}
                    onChange={(val) => handleChange("minimumWithdrawalAmount", val)}
                  />
                  <NumberInput
                    label="Maximum withdrawal amount($)"
                    value={Number(form.maximumWithdrawalAmount ?? 0)}
                    onChange={(val) => handleChange("maximumWithdrawalAmount", val)}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2 text-sm">
                  <ToggleField
                    label="Reward reduction enabled"
                    value={Boolean(form.rewardReductionEnabled)}
                    onChange={(val) => handleChange("rewardReductionEnabled", val)}
                  />
                  <ToggleField
                    label="Withdrawal enabled"
                    value={Boolean(form.isWithdrawalEnabled)}
                    onChange={(val) => handleChange("isWithdrawalEnabled", val)}
                  />
                </div>

                <label className="text-sm text-slate-200 flex flex-col gap-1">
                  <span>Withdrawal note / policy text</span>
                  <textarea
                    className="min-h-[110px] rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                    value={form.withdrawalNote ?? ""}
                    onChange={(e) => handleChange("withdrawalNote", e.target.value)}
                    placeholder="Explain lock period, fees, early withdrawal deductions, and reward reduction."
                  />
                </label>
              </div>

              <div className="space-y-4">
   
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="text-sm font-semibold text-white">User-side message rules</div>
                  <div className="mt-3 space-y-2 text-sm text-slate-300">
                    <p>Early withdrawal penalty applied: {Number(form.earlyWithdrawalPenaltyPercent ?? 25)}%</p>
                    <p>Admin fee applied: {Number(form.withdrawalAdminFeePercent ?? 12)}%</p>
                    {form.rewardReductionEnabled && <p>Reward reduction applied due to early withdrawal</p>}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <SectionFeedbackNotice feedback={sectionFeedback.withdrawalRules} />
            </div>
          </section>

          <section className={panelCls}>
            <SectionHeading
              eyebrow="Trading setup"
              title="Trading defaults"
              description="Set the market pair the platform should surface as the default trading context."
              action={
                <Button onClick={() => handleSectionSave("tradingDefaults")} disabled={!isSectionDirty("tradingDefaults") || mutation.isPending}>
                  {mutation.isPending && isSectionDirty("tradingDefaults") ? "Saving..." : "Save trading default"}
                </Button>
              }
            />
            <div className={sectionBodyCls}>
            <label className="text-sm text-slate-200 flex flex-col gap-1">
              <span>Default swap market</span>
              <input
                className={fieldCls}
                value={form.defaultSwapMarket}
                onChange={(e) => handleChange("defaultSwapMarket", e.target.value)}
                placeholder="BTCUSDT"
              />
            </label>
            </div>
            <div className="mt-4">
              <SectionFeedbackNotice feedback={sectionFeedback.tradingDefaults} />
            </div>
          </section>

          {/* <section className={panelCls}>
            <SectionHeading
              eyebrow="Trading economics"
              title="Trading & fees"
              description="Manage core exchange fee rates and emergency trade controls."
              action={
                <Button onClick={() => handleSectionSave("tradingFees")} disabled={!isSectionDirty("tradingFees") || mutation.isPending}>
                  {mutation.isPending && isSectionDirty("tradingFees") ? "Saving..." : "Save trading & fees"}
                </Button>
              }
            />
            <div className={`${sectionBodyCls} grid gap-4 md:grid-cols-2 text-sm`}>
              <NumberInput
                label="Maker fee (%)"
                value={form.tradeMakerFee}
                onChange={(val) => handleChange("tradeMakerFee", val)}
              />
              <NumberInput
                label="Taker fee (%)"
                value={form.tradeTakerFee}
                onChange={(val) => handleChange("tradeTakerFee", val)}
              />
              <NumberInput
                label="Referral fee (%)"
                value={form.referralFee}
                onChange={(val) => handleChange("referralFee", val)}
              />
              <NumberInput
                label="Transfer commission (%)"
                value={form.transferCommission}
                onChange={(val) => handleChange("transferCommission", val)}
              />
            </div>
            <div className="mt-4">
              <ToggleField
                label="Disable trades globally"
                value={form.disableTrades}
                onChange={(val) => handleChange("disableTrades", val)}
              />
            </div>
          </section> */}

          <section className={panelCls}>
            <SectionHeading
              eyebrow="Communications"
              title="Mail settings"
              description="Configure SMTP credentials and sender information used by the platform."
              action={
                <Button onClick={() => handleSectionSave("mail")} disabled={!isSectionDirty("mail") || mutation.isPending}>
                  {mutation.isPending && isSectionDirty("mail") ? "Saving..." : "Save mail settings"}
                </Button>
              }
            />
            <div className={`${sectionBodyCls} grid gap-4 md:grid-cols-2 text-sm`}>
              <TextInput label="Mail type" value={form.mailType} onChange={(val) => handleChange("mailType", val)} />
              <TextInput label="Host" value={form.mailHost} onChange={(val) => handleChange("mailHost", val)} />
              <NumberInput label="Port" value={form.mailPort} onChange={(val) => handleChange("mailPort", val)} />
              <TextInput label="Username" value={form.mailUsername} onChange={(val) => handleChange("mailUsername", val)} />
              <TextInput
                label="Password"
                value={form.mailPassword}
                type="password"
                onChange={(val) => handleChange("mailPassword", val)}
              />
              <TextInput
                label="Sender name"
                value={form.mailSenderName}
                onChange={(val) => handleChange("mailSenderName", val)}
              />
              <TextInput
                label="Sender email"
                value={form.mailSenderEmail}
                onChange={(val) => handleChange("mailSenderEmail", val)}
              />
              <TextInput
                label="Encryption"
                value={form.mailEncryption}
                onChange={(val) => handleChange("mailEncryption", val)}
              />
            </div>
            <div className="mt-4">
              <SectionFeedbackNotice feedback={sectionFeedback.mail} />
            </div>
          </section>
{/* 
          <section className={panelCls}>
            <h3 className="text-lg font-semibold text-white mb-3">Notifications</h3>
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <TextInput
                label="Alert email"
                value={form.notificationAdminEmail}
                onChange={(val) => handleChange("notificationAdminEmail", val)}
              />
              <ToggleField
                label="Notify crypto deposits"
                value={form.notifyCryptoDeposits}
                onChange={(val) => handleChange("notifyCryptoDeposits", val)}
              />
              <ToggleField
                label="Notify crypto withdrawals"
                value={form.notifyCryptoWithdrawals}
                onChange={(val) => handleChange("notifyCryptoWithdrawals", val)}
              />
              <ToggleField
                label="Notify fiat deposits"
                value={form.notifyFiatDeposits}
                onChange={(val) => handleChange("notifyFiatDeposits", val)}
              />
              <ToggleField
                label="Notify fiat withdrawals"
                value={form.notifyFiatWithdrawals}
                onChange={(val) => handleChange("notifyFiatWithdrawals", val)}
              />
              <ToggleField label="Notify KYC" value={form.notifyKyc} onChange={(val) => handleChange("notifyKyc", val)} />
              <ToggleField
                label="Notify new user"
                value={form.notifyNewUser}
                onChange={(val) => handleChange("notifyNewUser", val)}
              />
            </div>
          </section> */}

          {/* <section className={panelCls}>
            <h3 className="text-lg font-semibold text-white mb-3">Stripe</h3>
            <div className="grid gap-4 md:grid-cols-2 text-sm">
              <TextInput
                label="Public key"
                value={form.stripePublicKey}
                onChange={(val) => handleChange("stripePublicKey", val)}
              />
              <TextInput
                label="Secret key"
                value={form.stripeSecretKey}
                onChange={(val) => handleChange("stripeSecretKey", val)}
              />
              <TextInput
                label="Base currency"
                value={form.stripeBaseCurrency}
                onChange={(val) => handleChange("stripeBaseCurrency", val)}
              />
            </div>
          </section> */}

          {/* <section className={panelCls}>
            <h3 className="text-lg font-semibold text-white mb-3">reCAPTCHA</h3>
            <div className="space-y-3">
              <ToggleField
                label="Enable reCAPTCHA"
                value={form.recaptchaEnabled}
                onChange={(val) => handleChange("recaptchaEnabled", val)}
              />
              <TextInput
                label="Site key"
                value={form.recaptchaSiteKey}
                onChange={(val) => handleChange("recaptchaSiteKey", val)}
              />
              <TextInput
                label="Secret key"
                value={form.recaptchaSecretKey}
                onChange={(val) => handleChange("recaptchaSecretKey", val)}
              />
            </div>
          </section> */}

          {/* <section className={panelCls}>
            <SectionHeading
              eyebrow="External presence"
              title="Social links"
              description="Manage outbound brand links displayed across the public site."
              action={
                <Button onClick={() => handleSectionSave("social")} disabled={!isSectionDirty("social") || mutation.isPending}>
                  {mutation.isPending && isSectionDirty("social") ? "Saving..." : "Save social links"}
                </Button>
              }
            />
            <div className={`${sectionBodyCls} grid gap-4 md:grid-cols-2 text-sm`}>
              <TextInput
                label="YouTube"
                value={form.socialYoutube}
                onChange={(val) => handleChange("socialYoutube", val)}
              />
              <TextInput
                label="Facebook"
                value={form.socialFacebook}
                onChange={(val) => handleChange("socialFacebook", val)}
              />
              <TextInput
                label="Telegram"
                value={form.socialTelegram}
                onChange={(val) => handleChange("socialTelegram", val)}
              />
              <TextInput
                label="Twitter / X"
                value={form.socialTwitter}
                onChange={(val) => handleChange("socialTwitter", val)}
              />
              <TextInput
                label="Instagram"
                value={form.socialInstagram}
                onChange={(val) => handleChange("socialInstagram", val)}
              />
              <TextInput
                label="LinkedIn"
                value={form.socialLinkedin}
                onChange={(val) => handleChange("socialLinkedin", val)}
              />
            </div>
          </section> */}

        </div>
      )}
    </div>
  );
}

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3.5">
      <span className="text-sm text-slate-100">{label}</span>
      <button
        type="button"
        className={`h-6 w-11 rounded-full border border-white/10 transition ${
          value ? "bg-emerald-500" : "bg-slate-600"
        }`}
        onClick={() => onChange(!value)}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-white transition ${value ? "translate-x-5" : "translate-x-1"}`}
        />
      </button>
    </label>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (next: number) => void }) {
  const [draft, setDraft] = useState(() => (Number.isFinite(value) ? String(value) : ""));

  useEffect(() => {
    setDraft(Number.isFinite(value) ? String(value) : "");
  }, [value]);

  return (
    <label className="flex flex-col gap-2 text-sm text-slate-200">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        pattern="[0-9]*[.,]?[0-9]*"
        className={fieldCls}
        value={draft}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9.]/g, "");
          const normalized = cleaned.replace(/(\..*)\./g, "$1");
          setDraft(normalized);
          if (normalized !== "") {
            onChange(Number(normalized));
          }
        }}
        onBlur={() => {
          if (draft === "") {
            onChange(0);
            setDraft("0");
          }
        }}
      />
    </label>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm text-slate-200">
      <span>{label}</span>
      <input
        type={type}
        className={fieldCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function RuleSummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className="mt-2 text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/8 pb-5">
      <div className="max-w-2xl">
        <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{eyebrow}</div>
        <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300/80">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function ImageDropZone({
  label,
  hint,
  previewUrl,
  previewAlt,
  previewClassName,
  frameClassName,
  accept,
  active,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onChange,
  isUploading,
}: {
  label: string;
  hint: string;
  previewUrl: string;
  previewAlt: string;
  previewClassName: string;
  frameClassName: string;
  accept: string;
  active: boolean;
  onDragEnter: (event: DragEvent<HTMLLabelElement>) => void;
  onDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  onDragLeave: (event: DragEvent<HTMLLabelElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  isUploading?: boolean;
}) {
  return (
    <label
      className={`group flex min-h-[260px] cursor-pointer flex-col rounded-[26px] border p-5 transition ${
        active
          ? "border-emerald-400/50 bg-emerald-400/10"
          : "border-white/10 bg-black/10 hover:border-white/20 hover:bg-white/[0.03]"
      }`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-slate-100">{label}</div>
          <div className="mt-1 text-xs leading-5 text-slate-400">{hint}</div>
        </div>
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-300">
          {isUploading ? "Uploading" : "Upload"}
        </div>
      </div>
      <div className="mt-5 flex flex-1 flex-col gap-4">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.04] p-4">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Preview</div>
          <div className={`mt-3 flex items-center justify-center overflow-hidden rounded-[22px] border border-white/10 bg-white/5 p-3 ${frameClassName}`}>
            {previewUrl ? (
              <img src={previewUrl} alt={previewAlt} className={previewClassName} />
            ) : (
              <span className="text-xs text-slate-500">No image</span>
            )}
          </div>
        </div>
        <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
          <div className="text-[11px] uppercase tracking-[0.22em] text-slate-400">Upload file</div>
          <div className="mt-3 text-xs text-slate-400">
            {isUploading ? "Uploading image and saving asset URL..." : "Choose an image file or drag and drop it here."}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-white/10 bg-black/10 px-4 py-3">
            <div className="text-xs text-slate-400">Accepted image formats only</div>
            <div className="inline-flex items-center rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white transition group-hover:bg-white/10">
              {isUploading ? "Please wait" : "Choose image"}
            </div>
          </div>
        </div>
      </div>
      <input type="file" accept={accept} className="hidden" onChange={onChange} disabled={isUploading} />
    </label>
  );
}

function SectionFeedbackNotice({ feedback }: { feedback?: SectionFeedback }) {
  if (!feedback) return null;
  const toneClass =
    feedback.tone === "success"
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
      : "border-rose-400/20 bg-rose-500/10 text-rose-200";

  return <div className={`rounded-2xl border px-4 py-3 text-sm ${toneClass}`}>{feedback.message}</div>;
}

function findSectionForKey(key: keyof AdminSettings): SettingsSectionKey | null {
  const entry = (Object.entries(sectionFieldMap) as Array<[SettingsSectionKey, ReadonlyArray<keyof AdminSettings>]>).find(([, keys]) =>
    keys.includes(key)
  );
  return entry?.[0] ?? null;
}

function getSectionLabel(section: SettingsSectionKey) {
  switch (section) {
    case "brand":
      return "Brand settings";
    case "access":
      return "Access settings";
    case "withdrawals":
      return "Withdrawal limits";
    case "withdrawalRules":
      return "Withdrawal rules";
    case "tradingDefaults":
      return "Trading default";
    case "tradingFees":
      return "Trading and fees";
    case "mail":
      return "Mail settings";
    case "social":
      return "Social links";
    default:
      return "Settings";
  }
}

function toSectionPayload(form: AdminSettings, section: SettingsSectionKey): Partial<AdminSettings> {
  return sectionFieldMap[section].reduce<Partial<AdminSettings>>((payload, key) => {
    if (allowedSettingsKeys.includes(key)) {
      payload[key] = form[key];
    }
    return payload;
  }, {});
}

function hasSectionChanges(form: AdminSettings, saved: AdminSettings, section: SettingsSectionKey) {
  return sectionFieldMap[section].some((key) => form[key] !== saved[key]);
}

function validateSection(form: AdminSettings, section: SettingsSectionKey) {
  switch (section) {
    case "brand":
      if (!form.siteName.trim()) return "Site name is required.";
      if (form.siteName.trim().length > 120) return "Site name must be 120 characters or less.";
      if (!isValidAssetUrl(form.siteLogoUrl)) return "Logo URL must be a valid absolute URL or relative path.";
      if (!isValidAssetUrl(form.siteFaviconUrl)) return "Favicon URL must be a valid absolute URL or relative path.";
      return null;
    case "access":
      if (form.darkModeDefault && !form.enableDarkMode) {
        return "Enable dark mode before setting dark mode as default.";
      }
      return null;
    case "withdrawals":
      if (Number(form.withdrawalLimitKyc) < 0 || Number(form.withdrawalLimitNonKyc) < 0) {
        return "Withdrawal limits cannot be negative.";
      }
      return null;
    case "withdrawalRules":
      if (Number(form.withdrawalAdminFeePercent ?? 0) < 0 || Number(form.withdrawalAdminFeePercent ?? 0) > 100) {
        return "Withdrawal admin fee percent must be between 0 and 100.";
      }
      if (Number(form.earlyWithdrawalPenaltyPercent ?? 0) < 0 || Number(form.earlyWithdrawalPenaltyPercent ?? 0) > 100) {
        return "Early withdrawal penalty percent must be between 0 and 100.";
      }
      if (Number(form.withdrawalLockPeriodDays ?? 0) < 0) return "Withdrawal lock period days cannot be negative.";
      if (Number(form.minimumWithdrawalAmount ?? 0) < 0 || Number(form.maximumWithdrawalAmount ?? 0) < 0) {
        return "Withdrawal amounts cannot be negative.";
      }
      if (
        Number(form.maximumWithdrawalAmount ?? 0) > 0 &&
        Number(form.maximumWithdrawalAmount ?? 0) < Number(form.minimumWithdrawalAmount ?? 0)
      ) {
        return "Maximum withdrawal amount must be greater than or equal to minimum withdrawal amount.";
      }
      if ((form.withdrawalNote ?? "").length > 2000) return "Withdrawal note must be 2000 characters or less.";
      return null;
    case "tradingDefaults":
      if ((form.defaultSwapMarket ?? "").length > 32) return "Default swap market must be 32 characters or less.";
      if (form.defaultSwapMarket && !/^[A-Z0-9:_-]+$/.test(form.defaultSwapMarket.trim().toUpperCase())) {
        return "Default swap market can only contain uppercase letters, numbers, colon, underscore, or hyphen.";
      }
      return null;
    case "tradingFees":
      if (![form.tradeMakerFee, form.tradeTakerFee, form.referralFee, form.transferCommission].every(isValidPercent)) {
        return "Trading fee percentages must be between 0 and 100.";
      }
      return null;
    case "mail":
      if (form.mailPort !== null && form.mailPort !== undefined) {
        const port = Number(form.mailPort);
        if (!Number.isInteger(port) || port < 1 || port > 65535) return "Mail port must be an integer between 1 and 65535.";
      }
      if (!isOptionalEmail(form.mailSenderEmail)) return "Sender email must be a valid email address.";
      return null;
    case "social":
      if (![form.socialYoutube, form.socialFacebook, form.socialTelegram, form.socialTwitter, form.socialInstagram, form.socialLinkedin].every(isOptionalAbsoluteUrl)) {
        return "Social links must be valid absolute URLs.";
      }
      return null;
    default:
      return null;
  }
}

function isValidPercent(value: number) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
}

function isValidAssetUrl(value?: string) {
  if (!value || !value.trim()) return true;
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return true;
  return isOptionalAbsoluteUrl(trimmed);
}

function isOptionalAbsoluteUrl(value?: string) {
  if (!value || !value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isOptionalEmail(value?: string) {
  if (!value || !value.trim()) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
