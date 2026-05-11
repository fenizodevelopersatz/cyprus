import { useEffect, useState, type ReactNode } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import {
  getLevelManagementSettings,
  updateLevelManagementSettings,
  type AdminLevelManagementConfig,
  type AdminLevelManagementLevel,
  type UpdateAdminLevelManagementSettingsPayload,
} from "../api/admin.api";

const cardCls = "rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl";
const tableWrapCls = "overflow-x-auto rounded-2xl border border-white/10";
const tableCls = "min-w-full text-sm";
const headCellCls = "px-4 py-3 text-left text-[11px] uppercase tracking-[0.2em] text-slate-400";
const bodyCellCls = "px-4 py-3 align-top text-slate-200";
const inputCls = "bg-white/5 text-white";
const textareaCls = "min-h-28 w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white";

const defaultConfig: AdminLevelManagementConfig = {
  directReferralNote: "",
  newUserRewardNote: "",
  levelAchievementNote: "",
  salaryRewardNote: "",
  oneTimeRewardNote: "",
  minimumDepositEligibilityNote: "",
  minimumEligibleDeposit: 300,
  directSponsorCommissionPercent: 5,
  joinedCommissionPercent: 2,
  isCommissionActive: true,
};

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

export default function LevelManagementSettings() {
  const [levels, setLevels] = useState<AdminLevelManagementLevel[]>([]);
  const [config, setConfig] = useState<AdminLevelManagementConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchLevelManagementSettings = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const data = await getLevelManagementSettings();
      setLevels(data.levels);
      setConfig({ ...defaultConfig, ...data.config });
      setErrors({});
    } catch (error) {
      setFeedback(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchLevelManagementSettings();
  }, []);

  const handleLevelChange = (
    index: number,
    field: keyof AdminLevelManagementLevel,
    value: string | number | boolean
  ) => {
    setLevels((current) =>
      current.map((level, levelIndex) =>
        levelIndex === index ? { ...level, [field]: value } : level
      )
    );
  };

  const handleConfigChange = (
    field: keyof AdminLevelManagementConfig,
    value: string | number | boolean
  ) => {
    setConfig((current) => ({ ...current, [field]: value }));
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};

    levels.forEach((level, index) => {
      if (!level.levelCode.trim()) {
        nextErrors[`levels_${index}_levelCode`] = "Position is required";
      }
      if (!level.qualificationText.trim()) {
        nextErrors[`levels_${index}_qualificationText`] = "Team size / qualification is required";
      }
      if (!Number.isFinite(Number(level.bonusPercent)) || Number(level.bonusPercent) < 0) {
        nextErrors[`levels_${index}_bonusPercent`] = "Bonus percent must be 0 or more";
      }
      if (!Number.isFinite(Number(level.promotionRewardUsdt)) || Number(level.promotionRewardUsdt) < 0) {
        nextErrors[`levels_${index}_promotionRewardUsdt`] = "Promotion reward must be 0 or more";
      }
    });

    const requiredConfigFields: Array<keyof AdminLevelManagementConfig> = [
      "directReferralNote",
      "newUserRewardNote",
      "levelAchievementNote",
      "salaryRewardNote",
      "oneTimeRewardNote",
      "minimumDepositEligibilityNote",
    ];

    requiredConfigFields.forEach((field) => {
      if (!String(config[field] ?? "").trim()) {
        nextErrors[field] = "This field is required";
      }
    });

    if (!Number.isFinite(Number(config.minimumEligibleDeposit)) || Number(config.minimumEligibleDeposit) < 0) {
      nextErrors.minimumEligibleDeposit = "Minimum eligible deposit must be 0 or more";
    }
    if (
      !Number.isFinite(Number(config.directSponsorCommissionPercent)) ||
      Number(config.directSponsorCommissionPercent) < 0
    ) {
      nextErrors.directSponsorCommissionPercent = "Direct sponsor commission must be 0 or more";
    }
    if (
      !Number.isFinite(Number(config.joinedCommissionPercent)) ||
      Number(config.joinedCommissionPercent) < 0
    ) {
      nextErrors.joinedCommissionPercent = "Joined commission must be 0 or more";
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    setFeedback(null);
    if (!validateForm()) return;

    const payload: UpdateAdminLevelManagementSettingsPayload = {
      levels: levels.map((level) => ({
        ...level,
        bonusPercent: Number(level.bonusPercent),
        promotionRewardUsdt: Number(level.promotionRewardUsdt),
        sortOrder: Number(level.sortOrder),
        isEnabled: Boolean(level.isEnabled),
      })),
      config: {
        ...config,
        minimumEligibleDeposit: Number(config.minimumEligibleDeposit),
        directSponsorCommissionPercent: Number(config.directSponsorCommissionPercent),
        joinedCommissionPercent: Number(config.joinedCommissionPercent),
        isCommissionActive: Boolean(config.isCommissionActive),
      },
    };

    setSaving(true);
    try {
      const data = await updateLevelManagementSettings(payload);
      setLevels(data.levels);
      setConfig({ ...defaultConfig, ...data.config });
      setErrors({});
      setFeedback("Level management settings saved successfully");
    } catch (error) {
      setFeedback(getErrorMessage(error));
      setErrors((current) => ({ ...current, ...getFieldErrors(error) }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-white/10 bg-white/5 text-slate-300">
        Loading level management settings...
      </div>
    );
  }

  const feedbackIsSuccess = feedback === "Level management settings saved successfully";

  return (
    <div className="space-y-6 text-slate-100">
      <header className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-300/80">Controls</div>
            <h2 className="text-2xl font-semibold text-white">
              Expand your agent team to earn recurring manager bonuses
            </h2>
            <p className="mt-2 text-sm text-slate-300/80">Level 1 - Level 12</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => void fetchLevelManagementSettings()} disabled={saving}>
              Refresh
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </div>
      </header>

      {feedback && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            feedbackIsSuccess
              ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              : "border border-rose-500/30 bg-rose-500/10 text-rose-100"
          }`}
        >
          {feedback}
        </div>
      )}

      <section className={cardCls}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white">Level Management Table</h3>
          <p className="mt-1 text-sm text-slate-300/75">
            Configure qualification criteria, recurring 10-day bonus percentage, promotion reward, and status for each level.
          </p>
        </div>
        <div className={tableWrapCls}>
          <table className={tableCls}>
            <thead className="bg-white/5">
              <tr>
                <th className={headCellCls}>Position</th>
                <th className={headCellCls}>Team Size / Qualification</th>
                <th className={headCellCls}>Bonus %(Every 10 Days Life Long)</th>
                <th className={headCellCls}>Promotion Reward (USDT)</th>
                <th className={headCellCls}>Status</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((level, index) => (
                <tr key={level.id} className="border-t border-white/5">
                  <td className={bodyCellCls}>
                    <div className="font-semibold text-white">{level.levelCode}</div>
                  </td>
                  <td className={bodyCellCls}>
                    <Input
                      value={level.qualificationText}
                      onChange={(event) => handleLevelChange(index, "qualificationText", event.target.value)}
                      className={inputCls}
                    />
                    <InlineError error={errors[`levels_${index}_qualificationText`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={String(level.bonusPercent)}
                      onChange={(event) => handleLevelChange(index, "bonusPercent", event.target.value)}
                      className={inputCls}
                    />
                    <InlineError error={errors[`levels_${index}_bonusPercent`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={String(level.promotionRewardUsdt)}
                      onChange={(event) =>
                        handleLevelChange(index, "promotionRewardUsdt", event.target.value)
                      }
                      className={inputCls}
                    />
                    <InlineError error={errors[`levels_${index}_promotionRewardUsdt`]} />
                  </td>
                  <td className={bodyCellCls}>
                    <label className="inline-flex items-center gap-3 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={Boolean(level.isEnabled)}
                        onChange={(event) => handleLevelChange(index, "isEnabled", event.target.checked)}
                        className="h-4 w-4 rounded border border-white/20 bg-slate-900"
                      />
                      <span>{level.isEnabled ? "Enabled" : "Disabled"}</span>
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
          <h3 className="text-lg font-semibold text-white">Important Notes</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Direct Referral Note" error={errors.directReferralNote}>
            <textarea
              value={config.directReferralNote}
              onChange={(event) => handleConfigChange("directReferralNote", event.target.value)}
              className={textareaCls}
            />
          </Field>
          <Field label="New User Reward Note" error={errors.newUserRewardNote}>
            <textarea
              value={config.newUserRewardNote}
              onChange={(event) => handleConfigChange("newUserRewardNote", event.target.value)}
              className={textareaCls}
            />
          </Field>
          <Field label="Level Achievement Note" error={errors.levelAchievementNote}>
            <textarea
              value={config.levelAchievementNote}
              onChange={(event) => handleConfigChange("levelAchievementNote", event.target.value)}
              className={textareaCls}
            />
          </Field>
          <Field label="Salary Reward Note" error={errors.salaryRewardNote}>
            <textarea
              value={config.salaryRewardNote}
              onChange={(event) => handleConfigChange("salaryRewardNote", event.target.value)}
              className={textareaCls}
            />
          </Field>
          <Field label="One-time Reward Note" error={errors.oneTimeRewardNote}>
            <textarea
              value={config.oneTimeRewardNote}
              onChange={(event) => handleConfigChange("oneTimeRewardNote", event.target.value)}
              className={textareaCls}
            />
          </Field>
          <Field
            label="Minimum Deposit Eligibility Note"
            error={errors.minimumDepositEligibilityNote}
          >
            <textarea
              value={config.minimumDepositEligibilityNote}
              onChange={(event) => handleConfigChange("minimumDepositEligibilityNote", event.target.value)}
              className={textareaCls}
            />
          </Field>
        </div>
        <div className="mt-4 max-w-sm">
          <Field label="Minimum Eligible Deposit" error={errors.minimumEligibleDeposit}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={String(config.minimumEligibleDeposit)}
              onChange={(event) => handleConfigChange("minimumEligibleDeposit", event.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
      </section>

      <section className={cardCls}>
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-white">Commission Settings</h3>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Direct Sponsor Commission %(to given from the first deposit amount) - Sponsor user"
            error={errors.directSponsorCommissionPercent}
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              value={String(config.directSponsorCommissionPercent)}
              onChange={(event) =>
                handleConfigChange("directSponsorCommissionPercent", event.target.value)
              }
              className={inputCls}
            />
          </Field>
          <Field
            label="Joined Commission %(to given from the first deposit amount) - Own User"
            error={errors.joinedCommissionPercent}
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              value={String(config.joinedCommissionPercent)}
              onChange={(event) => handleConfigChange("joinedCommissionPercent", event.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
        <div className="mt-4">
          <label className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={Boolean(config.isCommissionActive)}
              onChange={(event) => handleConfigChange("isCommissionActive", event.target.checked)}
              className="h-4 w-4 rounded border border-white/20 bg-slate-900"
            />
            <span>{config.isCommissionActive ? "Commission Active" : "Commission Inactive"}</span>
          </label>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={() => void handleSubmit()} disabled={saving}>
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
