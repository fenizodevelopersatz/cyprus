import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Dialog from "../../../ui/Dialog";
import Input from "../../../ui/Input";
import {
  createAdminSignalPackage,
  fetchAdminSignalPackageModule,
  updateAdminSignalPackage,
  updateAdminSignalPackageSettings,
  type AdminSignalPackage,
  type AdminSignalPackagePayload,
  type AdminSignalPackageSettings,
} from "../api/admin.api";

const cardCls = "rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl";
const fieldCls = "w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white";

const defaultSettings: AdminSignalPackageSettings = {
  minDeposit: "100",
  maxDeposit: "25000",
  investmentPerTradePct: "0",
  perTradeProfitPct: "0",
  dailyRoiPct: "0",
  unlimitedLastPackage: true,
  autoPackageAssignment: true,
  packageUpgradeAllowed: true,
};

const defaultPackageForm: AdminSignalPackagePayload = {
  name: "",
  minAmount: "",
  maxAmount: "",
  unlimitedMax: false,
  perTradeCommissionPct: "",
  signalsPerDay: 1,
  requiredLevel: 0,
  status: "ACTIVE",
  description: "",
  sortOrder: 10,
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "response" in error) {
    const maybe = error as { response?: { data?: { message?: string } } };
    return maybe.response?.data?.message ?? "Request failed";
  }
  return "Request failed";
};

export default function AdminSignalPackagesPage() {
  const queryClient = useQueryClient();
  const moduleQuery = useQuery({
    queryKey: ["admin", "signal-package-module"],
    queryFn: fetchAdminSignalPackageModule,
  });

  const [settingsForm, setSettingsForm] = useState<AdminSignalPackageSettings>(defaultSettings);
  const [settingsTouched, setSettingsTouched] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminSignalPackage | null>(null);
  const [packageForm, setPackageForm] = useState<AdminSignalPackagePayload>(defaultPackageForm);
  const [packageError, setPackageError] = useState<string | null>(null);

  useEffect(() => {
    if (!moduleQuery.data) return;
    setSettingsForm(moduleQuery.data.settings);
    setSettingsTouched(false);
  }, [moduleQuery.data]);

  const invalidateModule = () => queryClient.invalidateQueries({ queryKey: ["admin", "signal-package-module"] });

  const settingsMutation = useMutation({
    mutationFn: updateAdminSignalPackageSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(["admin", "signal-package-module"], data);
      setSettingsForm(data.settings);
      setSettingsTouched(false);
      setSettingsFeedback("Global settings saved.");
    },
  });

  const createMutation = useMutation({
    mutationFn: createAdminSignalPackage,
    onSuccess: () => invalidateModule(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string | number; payload: Partial<AdminSignalPackagePayload> }) =>
      updateAdminSignalPackage(id, payload),
    onSuccess: () => invalidateModule(),
  });

  const packages = moduleQuery.data?.packages ?? [];

  const summary = useMemo(() => {
    const active = packages.filter((item) => item.status === "ACTIVE").length;
    const unlimited = packages.filter((item) => item.unlimitedMax).length;
    const maxSignals = packages.reduce((highest, item) => Math.max(highest, Number(item.signalsPerDay || 0)), 0);
    return { total: packages.length, active, unlimited, maxSignals };
  }, [packages]);

  const openCreate = () => {
    setEditing(null);
    setPackageForm({
      ...defaultPackageForm,
      unlimitedMax: settingsForm.unlimitedLastPackage && packages.length === 0,
    });
    setPackageError(null);
    setModalOpen(true);
  };

  const openEdit = (pkg: AdminSignalPackage) => {
    setEditing(pkg);
    setPackageForm({
      name: pkg.name,
      minAmount: pkg.minAmount,
      maxAmount: pkg.maxAmount ?? "",
      unlimitedMax: pkg.unlimitedMax,
      perTradeCommissionPct: pkg.perTradeCommissionPct,
      signalsPerDay: pkg.signalsPerDay,
      requiredLevel: pkg.requiredLevel,
      status: pkg.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
      description: pkg.description ?? "",
      sortOrder: pkg.sortOrder,
    });
    setPackageError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (createMutation.isPending || updateMutation.isPending) return;
    setModalOpen(false);
  };

  const handleSettingsSubmit = async () => {
    setSettingsFeedback(null);
    try {
      await settingsMutation.mutateAsync(settingsForm);
    } catch (error) {
      setSettingsFeedback(getErrorMessage(error));
    }
  };

  const handlePackageSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setPackageError(null);
    const payload: AdminSignalPackagePayload = {
      ...packageForm,
      maxAmount: packageForm.unlimitedMax ? null : packageForm.maxAmount,
    };

    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      setModalOpen(false);
    } catch (error) {
      setPackageError(getErrorMessage(error));
    }
  };

  const togglePackageStatus = (pkg: AdminSignalPackage) => {
    updateMutation.mutate({
      id: pkg.id,
      payload: {
        status: pkg.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
      },
    });
  };

  return (
    <div className="space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-300/80">Signal Packages</div>
          <h2 className="text-2xl font-semibold text-white">Package settings</h2>
          <p className="text-sm text-slate-300/80">
            Manage global package rules and tier thresholds for the signal platform.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => moduleQuery.refetch()}>
            Refresh
          </Button>
          <Button size="sm" onClick={openCreate}>
            Add Package
          </Button>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Packages" value={summary.total} />
        <StatCard label="Active" value={summary.active} accent="text-emerald-200" />
        <StatCard label="Unlimited tiers" value={summary.unlimited} accent="text-cyan-200" />
        <StatCard label="Max signals/day" value={summary.maxSignals} accent="text-amber-200" />
      </section>

      <section className={`${cardCls} space-y-5`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Global rules</h3>
            <p className="text-sm text-slate-300/75">These values gate package validation and default assignment behavior.</p>
          </div>
          <Button size="sm" onClick={handleSettingsSubmit} disabled={!settingsTouched || settingsMutation.isPending}>
            {settingsMutation.isPending ? "Saving..." : "Save settings"}
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Min deposit">
            <Input
              value={settingsForm.minDeposit}
              onChange={(event) => {
                setSettingsForm((prev) => ({ ...prev, minDeposit: event.target.value }));
                setSettingsTouched(true);
              }}
              className="bg-white/5 text-white"
            />
          </Field>
          <Field label="Max deposit">
            <Input
              value={settingsForm.maxDeposit}
              onChange={(event) => {
                setSettingsForm((prev) => ({ ...prev, maxDeposit: event.target.value }));
                setSettingsTouched(true);
              }}
              className="bg-white/5 text-white"
            />
          </Field>
          <Field label="Investment per trade %">
            <Input
              value={settingsForm.investmentPerTradePct}
              onChange={(event) => {
                setSettingsForm((prev) => ({ ...prev, investmentPerTradePct: event.target.value }));
                setSettingsTouched(true);
              }}
              className="bg-white/5 text-white"
            />
          </Field>
          <Field label="Per trade profit %">
            <Input
              value={settingsForm.perTradeProfitPct}
              onChange={(event) => {
                setSettingsForm((prev) => ({ ...prev, perTradeProfitPct: event.target.value }));
                setSettingsTouched(true);
              }}
              className="bg-white/5 text-white"
            />
          </Field>
          <Field label="Daily ROI %">
            <Input
              value={settingsForm.dailyRoiPct}
              onChange={(event) => {
                setSettingsForm((prev) => ({ ...prev, dailyRoiPct: event.target.value }));
                setSettingsTouched(true);
              }}
              className="bg-white/5 text-white"
            />
          </Field>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <ToggleCard
            label="Unlimited last package"
            checked={settingsForm.unlimitedLastPackage}
            description="If enabled, the final package must start at max deposit and continue with no upper cap."
            onChange={(checked) => {
              setSettingsForm((prev) => ({ ...prev, unlimitedLastPackage: checked }));
              setSettingsTouched(true);
            }}
          />
          <ToggleCard
            label="Auto package assignment"
            checked={settingsForm.autoPackageAssignment}
            description="Automatically place users into the matching package after deposit checks."
            onChange={(checked) => {
              setSettingsForm((prev) => ({ ...prev, autoPackageAssignment: checked }));
              setSettingsTouched(true);
            }}
          />
          <ToggleCard
            label="Package upgrade allowed"
            checked={settingsForm.packageUpgradeAllowed}
            description="Allow users to move into higher package tiers when they qualify."
            onChange={(checked) => {
              setSettingsForm((prev) => ({ ...prev, packageUpgradeAllowed: checked }));
              setSettingsTouched(true);
            }}
          />
        </div>

        {settingsFeedback && (
          <div
            className={`rounded-2xl px-3 py-2 text-sm ${
              settingsFeedback === "Global settings saved."
                ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                : "border border-rose-500/40 bg-rose-500/10 text-rose-100"
            }`}
          >
            {settingsFeedback}
          </div>
        )}
      </section>

      <section className={cardCls}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Package tiers</h3>
            <p className="text-sm text-slate-300/75">
              No delete action is exposed here. Packages can be marked inactive to preserve assignments safely.
            </p>
          </div>
        </div>
        <div className="mt-4 overflow-auto rounded-2xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3">Range</th>
                <th className="px-4 py-3">Commission</th>
                <th className="px-4 py-3">Signals</th>
                <th className="px-4 py-3">Level</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sort</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {moduleQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading packages...</td>
                </tr>
              )}
              {!moduleQuery.isLoading && packages.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No packages configured.</td>
                </tr>
              )}
              {packages.map((pkg) => (
                <tr key={pkg.id} className="border-t border-white/5 text-slate-200">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{pkg.name}</div>
                    <div className="text-xs text-slate-400">{pkg.description || "No description"}</div>
                  </td>
                  <td className="px-4 py-3">{pkg.unlimitedMax ? `${pkg.minAmount}+` : `${pkg.minAmount} - ${pkg.maxAmount}`}</td>
                  <td className="px-4 py-3">{pkg.perTradeCommissionPct}%</td>
                  <td className="px-4 py-3">{pkg.signalsPerDay}</td>
                  <td className="px-4 py-3">Level {pkg.requiredLevel}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${pkg.status === "ACTIVE" ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"}`}>
                      {pkg.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{pkg.sortOrder}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="xs" variant="secondary" onClick={() => openEdit(pkg)}>Edit</Button>
                      <Button size="xs" variant="ghost" onClick={() => togglePackageStatus(pkg)}>
                        {pkg.status === "ACTIVE" ? "Set inactive" : "Set active"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={modalOpen}
        onClose={closeModal}
        title={editing ? "Edit signal package" : "Create signal package"}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={createMutation.isPending || updateMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={() => void handlePackageSubmit({ preventDefault() {} } as FormEvent)} disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save package"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handlePackageSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Package name">
              <Input value={packageForm.name} onChange={(event) => setPackageForm((prev) => ({ ...prev, name: event.target.value }))} className="bg-white/5 text-white" />
            </Field>
            <Field label="Sort order">
              <Input type="number" value={packageForm.sortOrder} onChange={(event) => setPackageForm((prev) => ({ ...prev, sortOrder: Number(event.target.value) }))} className="bg-white/5 text-white" />
            </Field>
            <Field label="Min amount">
              <Input value={String(packageForm.minAmount)} onChange={(event) => setPackageForm((prev) => ({ ...prev, minAmount: event.target.value }))} className="bg-white/5 text-white" />
            </Field>
            <Field label="Max amount">
              <Input
                value={packageForm.unlimitedMax ? "" : String(packageForm.maxAmount ?? "")}
                disabled={packageForm.unlimitedMax}
                onChange={(event) => setPackageForm((prev) => ({ ...prev, maxAmount: event.target.value }))}
                className="bg-white/5 text-white disabled:opacity-40"
                placeholder={packageForm.unlimitedMax ? "Unlimited" : "e.g. 24999"}
              />
            </Field>
            <Field label="Per trade commission %">
              <Input value={String(packageForm.perTradeCommissionPct)} onChange={(event) => setPackageForm((prev) => ({ ...prev, perTradeCommissionPct: event.target.value }))} className="bg-white/5 text-white" />
            </Field>
            <Field label="Signals per day">
              <Input type="number" value={packageForm.signalsPerDay} onChange={(event) => setPackageForm((prev) => ({ ...prev, signalsPerDay: Number(event.target.value) }))} className="bg-white/5 text-white" />
            </Field>
            <Field label="Required level">
              <Input type="number" value={packageForm.requiredLevel} onChange={(event) => setPackageForm((prev) => ({ ...prev, requiredLevel: Number(event.target.value) }))} className="bg-white/5 text-white" />
            </Field>
            <Field label="Status">
              <select
                value={packageForm.status}
                onChange={(event) => setPackageForm((prev) => ({ ...prev, status: event.target.value as "ACTIVE" | "INACTIVE" }))}
                className={fieldCls}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </Field>
          </div>

          <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm">
            <span>
              <span className="block font-medium text-white">Unlimited max amount</span>
              <span className="block text-xs text-slate-400">Only one package can use an open-ended upper range.</span>
            </span>
            <input
              type="checkbox"
              checked={packageForm.unlimitedMax}
              onChange={(event) =>
                setPackageForm((prev) => ({
                  ...prev,
                  unlimitedMax: event.target.checked,
                  maxAmount: event.target.checked ? null : prev.maxAmount ?? "",
                }))
              }
            />
          </label>

          <Field label="Description">
            <textarea
              value={packageForm.description ?? ""}
              onChange={(event) => setPackageForm((prev) => ({ ...prev, description: event.target.value }))}
              className="min-h-28 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white"
            />
          </Field>

          {packageError && <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{packageError}</div>}
        </form>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, accent = "text-white" }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className={cardCls}>
      <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className={`mt-3 text-2xl font-semibold ${accent}`}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-xs text-slate-400">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function ToggleCard({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-4">
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        <span className="mt-1 block text-xs text-slate-400">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
