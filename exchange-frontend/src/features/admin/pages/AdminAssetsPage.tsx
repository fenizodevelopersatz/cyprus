import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import Dialog from "../../../ui/Dialog";
import {
  createAdminSignalAsset,
  deriveAdminSignalAssetHotWallet,
  fetchAdminSignalAssets,
  updateAdminSignalAsset,
  verifyAdminSignalAssetPassword,
  type AdminSignalAsset,
  type AdminSignalAssetPayload,
} from "../api/admin.api";

const cardCls = "rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl";
const configuredSecretPlaceholder = "__configured__";

type FormState = AdminSignalAssetPayload;

const defaultForm: FormState = {
  asset: "USDT",
  network: "ERC20",
  displayName: "USDT ERC20",
  networkType: "EVM",
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

const maskLastFive = (value: string | null | undefined) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const tail = raw.slice(-5);
  return raw.length <= 5 ? tail : `${"*".repeat(8)}${tail}`;
};

const buildCreatePayload = (state: FormState): AdminSignalAssetPayload => {
  const payload = { ...state };
  if (!String(payload.privateKey ?? "").trim()) {
    delete payload.privateKey;
  }
  return payload;
};

const buildUpdatePayload = (state: FormState): Partial<AdminSignalAssetPayload> => {
  const payload: Partial<AdminSignalAssetPayload> = { ...state };
  const privateKey = String(payload.privateKey ?? "").trim();
  if (!privateKey || privateKey === configuredSecretPlaceholder) {
    delete payload.privateKey;
  } else {
    payload.privateKey = privateKey;
  }
  return payload;
};

export default function AdminAssetsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AdminSignalAsset | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [secretUnlocked, setSecretUnlocked] = useState(false);
  const [secretAuthDialogOpen, setSecretAuthDialogOpen] = useState(false);
  const [secretAuthPassword, setSecretAuthPassword] = useState("");
  const [secretAuthError, setSecretAuthError] = useState<string | null>(null);
  const [secretDialogOpen, setSecretDialogOpen] = useState(false);
  const [secretPrivateKey, setSecretPrivateKey] = useState("");
  const [secretError, setSecretError] = useState<string | null>(null);
  const [secretPreviewAddress, setSecretPreviewAddress] = useState("");
  const [secretPreviewError, setSecretPreviewError] = useState<string | null>(null);
  const [secretPreviewLoading, setSecretPreviewLoading] = useState(false);
  const [secretUpdateDepositWallet, setSecretUpdateDepositWallet] = useState(false);
  const [existingPrivateKeyLast5, setExistingPrivateKeyLast5] = useState<string | null>(null);

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

  const verifyPasswordMutation = useMutation({
    mutationFn: verifyAdminSignalAssetPassword,
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
  const secretNetworkLabel = `${form.networkType}${form.network ? ` / ${form.network}` : ""}`;
  const privateKeyMask =
    form.privateKey === configuredSecretPlaceholder && existingPrivateKeyLast5
      ? `********${existingPrivateKeyLast5}`
      : maskLastFive(form.privateKey);
  const hasValidSecretPrivateKey = Boolean(secretPrivateKey.trim() && secretPreviewAddress && !secretPreviewError && !secretPreviewLoading);

  useEffect(() => {
    if (!secretDialogOpen) return;

    const privateKey = secretPrivateKey.trim();
    setSecretPreviewError(null);

    if (!privateKey) {
      setSecretPreviewLoading(false);
      setSecretPreviewAddress(String(form.hotWallet ?? "").trim());
      return;
    }

    let cancelled = false;
    setSecretPreviewAddress("");
    setSecretPreviewLoading(true);

    const timer = window.setTimeout(() => {
      deriveAdminSignalAssetHotWallet({
        networkType: form.networkType,
        privateKey,
      })
        .then((result) => {
          if (cancelled) return;
          setSecretPreviewAddress(result.address);
          setSecretPreviewError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setSecretPreviewAddress("");
          setSecretPreviewError(getErrorMessage(error));
        })
        .finally(() => {
          if (!cancelled) setSecretPreviewLoading(false);
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [secretDialogOpen, secretPrivateKey, form.networkType, form.hotWallet]);

  const openCreate = () => {
    setEditing(null);
    setForm(defaultForm);
    setFormError(null);
    setSecretUnlocked(false);
    setSecretAuthDialogOpen(false);
    setSecretAuthPassword("");
    setSecretAuthError(null);
    setSecretDialogOpen(false);
    setSecretPrivateKey("");
    setSecretError(null);
    setSecretPreviewAddress("");
    setSecretPreviewError(null);
    setSecretPreviewLoading(false);
    setSecretUpdateDepositWallet(false);
    setExistingPrivateKeyLast5(null);
    setModalOpen(true);
  };

  const openEdit = (item: AdminSignalAsset) => {
    setEditing(item);
    setForm({
      asset: item.asset,
      network: item.network,
      displayName: item.displayName,
      networkType: item.networkType === "TRON" ? "TRON" : item.networkType === "SOLANA" ? "SOLANA" : "EVM",
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
    setSecretUnlocked(false);
    setSecretAuthDialogOpen(false);
    setSecretAuthPassword("");
    setSecretAuthError(null);
    setSecretDialogOpen(false);
    setSecretPrivateKey("");
    setSecretError(null);
    setSecretPreviewAddress("");
    setSecretPreviewError(null);
    setSecretPreviewLoading(false);
    setSecretUpdateDepositWallet(false);
    setExistingPrivateKeyLast5(item.privateKeyLast5 ?? null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (createMutation.isPending || updateMutation.isPending) return;
    setModalOpen(false);
  };

  const clearDerivedHotWallet = () => {
    const shouldClearDerivedValues = secretUnlocked;
    setSecretUnlocked(false);
    if (shouldClearDerivedValues) {
      setForm((prev) => ({
        ...prev,
        hotWallet: "",
        privateKey: "",
      }));
    }
  };

  const openSecretAuthDialog = () => {
    setSecretAuthError(null);
    setSecretAuthPassword("");
    setSecretAuthDialogOpen(true);
  };

  const closeSecretAuthDialog = () => {
    if (verifyPasswordMutation.isPending) return;
    setSecretAuthDialogOpen(false);
    setSecretAuthPassword("");
    setSecretAuthError(null);
  };

  const openSecretDialog = () => {
    const currentHotWallet = String(form.hotWallet ?? "").trim();
    setSecretError(null);
    setSecretPrivateKey("");
    setSecretPreviewAddress(currentHotWallet);
    setSecretPreviewError(null);
    setSecretPreviewLoading(false);
    setSecretUpdateDepositWallet(Boolean(currentHotWallet && currentHotWallet === String(form.depositWallet ?? "").trim()));
    setSecretDialogOpen(true);
  };

  const closeSecretDialog = () => {
    setSecretDialogOpen(false);
    setSecretPrivateKey("");
    setSecretError(null);
    setSecretPreviewAddress("");
    setSecretPreviewError(null);
    setSecretPreviewLoading(false);
    setSecretUpdateDepositWallet(false);
  };

  const onSecretAuthSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSecretAuthError(null);
    const currentPassword = secretAuthPassword.trim();
    if (!currentPassword) return setSecretAuthError("Admin password is required.");

    try {
      await verifyPasswordMutation.mutateAsync({ currentPassword });
      setSecretAuthDialogOpen(false);
      setSecretAuthPassword("");
      openSecretDialog();
    } catch (error) {
      setSecretAuthError(getErrorMessage(error));
    }
  };

  const onDeriveHotWallet = async (event: FormEvent) => {
    event.preventDefault();
    setSecretError(null);
    const privateKey = secretPrivateKey.trim();

    if (!privateKey) return setSecretError("Admin hot wallet private key is required.");
    if (secretPreviewLoading) return setSecretError("Checking private key address.");
    if (secretPreviewError) return setSecretError(secretPreviewError);
    if (!secretPreviewAddress) return setSecretError(secretPreviewError || "Unable to derive wallet address.");

    try {
      setForm((prev) => ({
        ...prev,
        hotWallet: secretPreviewAddress,
        depositWallet: secretUpdateDepositWallet ? secretPreviewAddress : prev.depositWallet,
        privateKey,
      }));
      setExistingPrivateKeyLast5(privateKey.slice(-5));
      setSecretUnlocked(true);
      setSecretDialogOpen(false);
      setSecretPrivateKey("");
      setSecretUpdateDepositWallet(false);
    } catch (error) {
      setSecretError(getErrorMessage(error));
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, payload: buildUpdatePayload(form) });
      } else {
        await createMutation.mutateAsync(buildCreatePayload(form));
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
          {/* <Button size="sm" onClick={openCreate}>
            Create Network
          </Button> */}
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
                <th className="px-4 py-3">Confirmations</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {assetsQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading assets...</td>
                </tr>
              )}
              {!assetsQuery.isLoading && assets.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">No assets configured.</td>
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
        panelClassName="!max-w-4xl"
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
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Asset"><Input value={form.asset} onChange={(e) => setForm((prev) => ({ ...prev, asset: e.target.value.toUpperCase() }))} /></Field>
            <Field label="Network"><Input value={form.network} onChange={(e) => { clearDerivedHotWallet(); setForm((prev) => ({ ...prev, network: e.target.value.toUpperCase() })); }} /></Field>
            <Field label="Display Name"><Input value={form.displayName} onChange={(e) => setForm((prev) => ({ ...prev, displayName: e.target.value }))} /></Field>
            <Field label="Network Type">
              <select value={form.networkType} onChange={(e) => { clearDerivedHotWallet(); setForm((prev) => ({ ...prev, networkType: e.target.value as "EVM" | "TRON" | "SOLANA" })); }} className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white">
                <option value="EVM">EVM</option>
                <option value="TRON">TRON</option>
                <option value="SOLANA">SOLANA</option>
              </select>
            </Field>
            <Field label="RPC URL" className="md:col-span-2"><Input value={form.rpcUrl ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, rpcUrl: e.target.value }))} /></Field>
            <Field label="Chain ID"><Input value={form.chainId ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, chainId: e.target.value }))} /></Field>
            <Field label="Decimals"><Input type="number" value={form.decimals} onChange={(e) => setForm((prev) => ({ ...prev, decimals: Number(e.target.value) }))} /></Field>
            <Field label="Contract Address" className="md:col-span-2"><Input value={form.contractAddress ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, contractAddress: e.target.value }))} /></Field>            
            <div className="relative md:col-span-2">
              <div className={`grid gap-4 rounded-2xl border border-white/10 bg-black/10 p-3 transition ${secretUnlocked ? "" : "pointer-events-none select-none blur-[3px]"}`}>
                <Field label="Admin Hot Wallet"><Input readOnly value={maskLastFive(form.hotWallet)} className="cursor-default" /></Field>
                <Field label="Admin Hot Wallet Private Key"><Input readOnly value={privateKeyMask} className="cursor-default" /></Field>
              </div>
              {!secretUnlocked ? (
                <button
                  type="button"
                  onClick={openSecretAuthDialog}
                  className="absolute inset-0 flex items-center justify-center rounded-2xl border border-cyan-300/20 bg-[#070b14]/55 px-4 text-sm font-semibold text-cyan-100 backdrop-blur-[2px] transition hover:border-cyan-300/40 hover:bg-[#070b14]/70"
                >
                  Update hot wallet
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openSecretAuthDialog}
                  className="absolute right-3 top-3 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300/45 hover:bg-cyan-300/15"
                >
                  Update
                </button>
              )}
            </div>
            <Field label="Deposit Admin Wallet" className="md:col-span-2"><Input value={form.depositWallet ?? ""} onChange={(e) => setForm((prev) => ({ ...prev, depositWallet: e.target.value }))} /></Field>
            <Field label="Confirmations"><Input type="number" value={form.confirmations} onChange={(e) => setForm((prev) => ({ ...prev, confirmations: Number(e.target.value) }))} /></Field>
            <Field label="Sort Order"><Input type="number" value={form.sortOrder} onChange={(e) => setForm((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))} /></Field>
            <Field label="Full Host" className="md:col-span-2"><Input value={form.fullHost ?? ""} onChange={(e) => { clearDerivedHotWallet(); setForm((prev) => ({ ...prev, fullHost: e.target.value })); }} /></Field>
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

      <Dialog
        open={secretAuthDialogOpen}
        onClose={closeSecretAuthDialog}
        title="Admin Authentication"
        panelClassName="!max-w-xl"
      >
        <form className="space-y-4" onSubmit={onSecretAuthSubmit}>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2">
            <span className="text-xs uppercase tracking-[0.18em] text-cyan-100">Network</span>
            <span className="rounded-full border border-cyan-200/25 bg-black/20 px-3 py-1 text-xs font-semibold text-white">
              {secretNetworkLabel}
            </span>
          </div>
          <Field label="Admin Password">
            <Input
              type="password"
              value={secretAuthPassword}
              onChange={(event) => setSecretAuthPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {secretAuthError ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{secretAuthError}</div>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-white/8 pt-4">
            <Button type="button" variant="ghost" onClick={closeSecretAuthDialog} disabled={verifyPasswordMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={verifyPasswordMutation.isPending}>
              {verifyPasswordMutation.isPending ? "Checking..." : "Continue"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={secretDialogOpen}
        onClose={closeSecretDialog}
        title="Update Hot Wallet"
        panelClassName="!max-w-2xl"
      >
        <form className="space-y-4" onSubmit={onDeriveHotWallet}>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-3 py-2">
            <span className="text-xs uppercase tracking-[0.18em] text-cyan-100">Network</span>
            <span className="rounded-full border border-cyan-200/25 bg-black/20 px-3 py-1 text-xs font-semibold text-white">
              {secretNetworkLabel}
            </span>
          </div>
          <Field label="Admin Hot Wallet Private Key">
            <Input
              type="password"
              value={secretPrivateKey}
              onChange={(event) => setSecretPrivateKey(event.target.value)}
              autoComplete="off"
              placeholder={existingPrivateKeyLast5 ? `********${existingPrivateKeyLast5}` : ""}
            />
          </Field>
          <Field label="Derived Wallet Address">
            <Input
              readOnly
              value={secretPreviewAddress}
              placeholder={
                secretPreviewLoading
                  ? "Checking private key with backend"
                  : !secretPrivateKey.trim()
                    ? "Current hot wallet address"
                    : "Wallet address will appear here"
              }
              className="cursor-default font-mono"
            />
          </Field>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-sm text-slate-200">
            <span>Also update Deposit Admin Wallet</span>
            <input
              type="checkbox"
              checked={secretUpdateDepositWallet}
              onChange={(event) => setSecretUpdateDepositWallet(event.target.checked)}
              className="h-4 w-4 accent-cyan-300"
            />
          </label>
          {secretPreviewError ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">{secretPreviewError}</div>
          ) : null}
          {secretError ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">{secretError}</div>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-white/8 pt-4">
            <Button type="button" variant="ghost" onClick={closeSecretDialog}>
              Cancel
            </Button>
            {hasValidSecretPrivateKey ? (
              <Button type="submit">
                Update
              </Button>
            ) : null}
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`min-w-0 text-xs text-slate-400 ${className}`.trim()}>
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
