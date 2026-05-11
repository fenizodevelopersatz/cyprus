import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import Dialog from "../../../ui/Dialog";
import {
  createAdminSignalAsset,
  fetchAdminSignalAssets,
  updateAdminSignalAsset,
  type AdminSignalAsset,
  type AdminSignalAssetPayload,
} from "../api/admin.api";

const cardCls = "rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl";

type FormState = AdminSignalAssetPayload;

const defaultForm: FormState = {
  asset: "USDT",
  network: "ERC20",
  displayName: "USDT ERC20",
  networkType: "EVM",
  minDeposit: "0",
  minWithdraw: "0",
  withdrawFeeType: "FIXED",
  withdrawFee: "0",
  rpcUrl: "",
  chainId: "1",
  contractAddress: "",
  decimals: 6,
  depositWallet: "",
  hotWallet: "",
  privateKey: "",
  confirmations: 12,
  fullHost: "",
  status: "ENABLED",
  isEnabled: true,
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

export default function AdminAssetsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminSignalAsset | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);

  const assetsQuery = useQuery({
    queryKey: ["admin", "signal-assets", statusFilter],
    queryFn: () =>
      fetchAdminSignalAssets({
        status: statusFilter === "ALL" ? undefined : statusFilter,
        includeDisabled: true,
      }),
  });

  const invalidateAssets = () => queryClient.invalidateQueries({ queryKey: ["admin", "signal-assets"] });

  const createMutation = useMutation({
    mutationFn: createAdminSignalAsset,
    onSuccess: () => invalidateAssets(),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number | string; payload: Partial<AdminSignalAssetPayload> }) =>
      updateAdminSignalAsset(id, payload),
    onSuccess: () => invalidateAssets(),
  });

  const assets = assetsQuery.data ?? [];
  const summary = useMemo(
    () => ({
      total: assets.length,
      enabled: assets.filter((item) => item.isEnabled).length,
      disabled: assets.filter((item) => !item.isEnabled).length,
      uniqueAssets: new Set(assets.map((item) => item.asset)).size,
    }),
    [assets]
  );

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (item: AdminSignalAsset) => {
    setEditing(item);
    setForm({
      asset: item.asset,
      network: item.network,
      displayName: item.displayName,
      networkType: item.networkType === "TRON" ? "TRON" : "EVM",
      minDeposit: String(item.minDeposit ?? "0"),
      minWithdraw: String(item.minWithdraw ?? "0"),
      withdrawFeeType: item.withdrawFeeType === "PERCENT" ? "PERCENT" : "FIXED",
      withdrawFee: String(item.withdrawFee ?? "0"),
      rpcUrl: item.rpcUrl ?? "",
      chainId: item.chainId ?? "",
      contractAddress: item.contractAddress ?? "",
      decimals: Number(item.decimals ?? 0),
      depositWallet: item.depositWallet ?? "",
      hotWallet: item.hotWallet ?? "",
      privateKey: item.privateKey ?? "",
      confirmations: Number(item.confirmations ?? 0),
      fullHost: item.fullHost ?? "",
      status: item.status === "DISABLED" ? "DISABLED" : "ENABLED",
      isEnabled: Boolean(item.isEnabled),
      sortOrder: Number(item.sortOrder ?? 0),
    });
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (createMutation.isPending || updateMutation.isPending) return;
    setModalOpen(false);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, payload: form });
      } else {
        await createMutation.mutateAsync(form);
      }
      setModalOpen(false);
    } catch (error) {
      setFormError(getErrorMessage(error));
    }
  };

  const submitFromFooter = () => {
    void onSubmit({ preventDefault() {} } as FormEvent);
  };

  const toggleStatus = (item: AdminSignalAsset) => {
    const isEnabled = !item.isEnabled;
    updateMutation.mutate({
      id: item.id,
      payload: { isEnabled, status: isEnabled ? "ENABLED" : "DISABLED" },
    });
  };

  return (
    <div className="space-y-6 text-slate-100">
      <header className="flex flex-wrap items-center gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.3em] text-cyan-300/80">Signal Assets</div>
          <h2 className="text-2xl font-semibold text-white">Asset & network management</h2>
          <p className="text-sm text-slate-300/80">Create, edit, and enable or disable supported deposit and withdrawal networks.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">All statuses</option>
            <option value="ENABLED">Enabled</option>
            <option value="DISABLED">Disabled</option>
          </select>
          <Button variant="ghost" size="sm" onClick={() => assetsQuery.refetch()}>
            Refresh
          </Button>          
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-4">
        <StatCard label="Rows" value={summary.total} />
        <StatCard label="Enabled" value={summary.enabled} accent="text-emerald-200" />
        <StatCard label="Disabled" value={summary.disabled} accent="text-amber-200" />
        <StatCard label="Unique Assets" value={summary.uniqueAssets} accent="text-cyan-200" />
      </section>

      <section className={cardCls}>
        <div className="overflow-auto rounded-2xl border border-white/10">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-[0.2em] text-slate-400">
              <tr>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Network</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Minimums</th>
                <th className="px-4 py-3">Fee</th>
                <th className="px-4 py-3">Confirmations</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assetsQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading assets...</td>
                </tr>
              )}
              {!assetsQuery.isLoading && assets.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">No assets configured.</td>
                </tr>
              )}
              {assets.map((item) => (
                <tr key={item.id} className="border-t border-white/5 text-slate-200">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-white">{item.asset}</div>
                    <div className="text-xs text-slate-400">{item.displayName}</div>
                  </td>
                  <td className="px-4 py-3">{item.network}</td>
                  <td className="px-4 py-3">{item.networkType}</td>
                  <td className="px-4 py-3">{String(item.minDeposit)} / {String(item.minWithdraw)}</td>
                  <td className="px-4 py-3">
                    {String(item.withdrawFee)} {item.withdrawFeeType === "PERCENT" ? "%" : item.asset}
                  </td>
                  <td className="px-4 py-3">{item.confirmations}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.isEnabled ? "bg-emerald-500/20 text-emerald-200" : "bg-amber-500/20 text-amber-200"}`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Button size="xs" variant="secondary" onClick={() => openEdit(item)}>Edit</Button>
                      <Button size="xs" variant="ghost" onClick={() => toggleStatus(item)}>
                        {item.isEnabled ? "Disable" : "Enable"}
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
        title={editing ? "Edit Asset Network" : "Create Asset Network"}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={createMutation.isPending || updateMutation.isPending}>Cancel</Button>
            <Button onClick={submitFromFooter} disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Asset"><Input value={form.asset} onChange={(e) => setForm((prev) => ({ ...prev, asset: e.target.value.toUpperCase() }))} /></Field>
            <Field label="Network"><Input value={form.network} onChange={(e) => setForm((prev) => ({ ...prev, network: e.target.value.toUpperCase() }))} /></Field>
            <Field label="Display Name"><Input value={form.displayName} onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))} /></Field>
            <Field label="Network Type">
              <select value={form.networkType} onChange={(e) => setForm((prev) => ({ ...prev, networkType: e.target.value as "EVM" | "TRON" }))} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white">
                <option value="EVM">EVM</option>
                <option value="TRON">TRON</option>
              </select>
            </Field>
            <Field label="Min Deposit"><Input value={String(form.minDeposit)} onChange={(e) => setForm((prev) => ({ ...prev, minDeposit: e.target.value }))} /></Field>
            <Field label="Min Withdraw"><Input value={String(form.minWithdraw)} onChange={(e) => setForm((prev) => ({ ...prev, minWithdraw: e.target.value }))} /></Field>
            <Field label="Withdraw Fee Type">
              <select value={form.withdrawFeeType} onChange={(e) => setForm((prev) => ({ ...prev, withdrawFeeType: e.target.value as "FIXED" | "PERCENT" }))} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white">
                <option value="FIXED">Fixed</option>
                <option value="PERCENT">Percent</option>
              </select>
            </Field>
            <Field label="Withdraw Fee"><Input value={String(form.withdrawFee)} onChange={(e) => setForm((prev) => ({ ...prev, withdrawFee: e.target.value }))} /></Field>
            <Field label="RPC URL"><Input value={form.rpcUrl ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, rpcUrl: e.target.value }))} /></Field>
            <Field label="Chain ID"><Input value={form.chainId ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, chainId: e.target.value }))} /></Field>
            <Field label="Contract Address"><Input value={form.contractAddress ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, contractAddress: e.target.value }))} /></Field>
            <Field label="Decimals"><Input type="number" value={form.decimals} onChange={(e) => setForm((prev) => ({ ...prev, decimals: Number(e.target.value) }))} /></Field>
            <Field label="Deposit Wallet"><Input value={form.depositWallet ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, depositWallet: e.target.value }))} /></Field>
            <Field label="Hot Wallet"><Input value={form.hotWallet ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, hotWallet: e.target.value }))} /></Field>
            <Field label="Private Key"><Input type="password" value={form.privateKey ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, privateKey: e.target.value }))} /></Field>
            <Field label="Confirmations"><Input type="number" value={form.confirmations} onChange={(e) => setForm((prev) => ({ ...prev, confirmations: Number(e.target.value) }))} /></Field>
            <Field label="Full Host"><Input value={form.fullHost ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, fullHost: e.target.value }))} /></Field>
            <Field label="Sort Order"><Input type="number" value={form.sortOrder} onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))} /></Field>
          </div>
          <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm">
            <span>Enable this network</span>
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  isEnabled: e.target.checked,
                  status: e.target.checked ? "ENABLED" : "DISABLED",
                }))
              }
            />
          </label>
          {formError && <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{formError}</div>}
        </form>
      </Dialog>
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

function StatCard({ label, value, accent = "text-white" }: { label: string; value: number; accent?: string }) {
  return (
    <div className={cardCls}>
      <div className="text-xs uppercase tracking-[0.22em] text-slate-400">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${accent}`}>{value}</div>
    </div>
  );
}
