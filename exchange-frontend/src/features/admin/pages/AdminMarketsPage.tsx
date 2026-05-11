import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "../../../ui/Button";
import Dialog from "../../../ui/Dialog";
import Input from "../../../ui/Input";
import { adminUpdateFuturesContract, fetchAdminFuturesContracts, fetchAdminMarkets } from "../api/admin.api";
import type { FuturesContractAdmin } from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";
const FUTURES_CONTRACTS_KEY = ["admin", "futures", "contracts"] as const;

const getErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error) {
    const maybeAxiosError = error as { response?: { data?: unknown; statusText?: string } };
    const data = maybeAxiosError.response?.data;
    if (data !== undefined && data !== null) {
      if (typeof data === "string") return data;
      if (typeof data === "object" && "message" in data && typeof (data as any).message === "string") {
        return (data as any).message as string;
      }
      if (typeof data === "object" && "error" in data && typeof (data as any).error === "string") {
        return (data as any).error as string;
      }
    }
    if (maybeAxiosError.response?.statusText) return maybeAxiosError.response.statusText;
  }
  if (error instanceof Error) return error.message;
  return "Request failed";
};

export default function AdminMarketsPage() {
  const queryClient = useQueryClient();
  const [editingContract, setEditingContract] = useState<FuturesContractAdmin | null>(null);
  const [leverageForm, setLeverageForm] = useState({ min: "", max: "" });
  const [leverageError, setLeverageError] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<string | null>(null);

  const { data: contracts, isLoading: contractsLoading } = useQuery({
    queryKey: FUTURES_CONTRACTS_KEY,
    queryFn: fetchAdminFuturesContracts,
  });

  const { data: listings, isLoading: marketsLoading } = useQuery({
    queryKey: ["admin", "markets"],
    queryFn: fetchAdminMarkets,
  });

  const updateContractsCache = (updated: FuturesContractAdmin) => {
    queryClient.setQueryData<FuturesContractAdmin[] | undefined>(FUTURES_CONTRACTS_KEY, (prev) => {
      if (!prev) return [updated];
      let replaced = false;
      const next = prev.map((contract) => {
        if (contract.symbol === updated.symbol) {
          replaced = true;
          return { ...contract, ...updated };
        }
        return contract;
      });
      return replaced ? next : [...next, updated];
    });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ symbol, enabled, status }: { symbol: string; enabled: boolean; status: string }) =>
      adminUpdateFuturesContract(symbol, { enabled, status }),
    onMutate: ({ symbol }) => {
      setToggleTarget(symbol);
    },
    onSuccess: (updated) => {
      updateContractsCache(updated);
    },
    onSettled: () => {
      setToggleTarget(null);
    },
  });

  const leverageMutation = useMutation({
    mutationFn: ({
      symbol,
      minLeverage,
      maxLeverage,
      status,
      enabled,
    }: {
      symbol: string;
      minLeverage: number;
      maxLeverage: number;
      status?: string;
      enabled?: boolean;
    }) => adminUpdateFuturesContract(symbol, { minLeverage, maxLeverage, status, enabled }),
    onSuccess: (updated) => {
      updateContractsCache(updated);
      closeEditor();
    },
  });

  const isContractEnabled = (contract: FuturesContractAdmin) => {
    if (typeof contract.isEnabled === "boolean") return contract.isEnabled;
    const normalizedStatus = contract.status?.toLowerCase();
    return normalizedStatus === "enabled" || normalizedStatus === "active";
  };

  const getContractStatusLabel = (contract: FuturesContractAdmin) => {
    return contract.status ?? (isContractEnabled(contract) ? "enabled" : "disabled");
  };

  const handleToggle = (contract: FuturesContractAdmin) => {
    toggleMutation.reset();
    const nextEnabled = !isContractEnabled(contract);
    const nextStatus = nextEnabled ? "enabled" : "disabled";
    toggleMutation.mutate({ symbol: contract.symbol, enabled: nextEnabled, status: nextStatus });
  };

  const openEditor = (contract: FuturesContractAdmin) => {
    setLeverageError(null);
    leverageMutation.reset();
    setLeverageForm({
      min: contract.minLeverage !== undefined ? String(contract.minLeverage) : "",
      max: contract.maxLeverage !== undefined ? String(contract.maxLeverage) : "",
    });
    setEditingContract(contract);
  };

  function closeEditor() {
    setEditingContract(null);
    setLeverageForm({ min: "", max: "" });
    setLeverageError(null);
    leverageMutation.reset();
  }

  const handleLeverageSave = () => {
    if (!editingContract) return;

    const min = Number(leverageForm.min);
    const max = Number(leverageForm.max);

    if (Number.isNaN(min) || Number.isNaN(max)) {
      setLeverageError("Enter valid numeric leverage values.");
      return;
    }
    if (min < 1) {
      setLeverageError("Minimum leverage must be at least 1x.");
      return;
    }
    if (max < min) {
      setLeverageError("Maximum leverage must be greater than or equal to the minimum.");
      return;
    }

    setLeverageError(null);
    const currentlyEnabled = isContractEnabled(editingContract);
    const statusLabel = getContractStatusLabel(editingContract);
    leverageMutation.mutate({
      symbol: editingContract.symbol,
      minLeverage: min,
      maxLeverage: max,
      enabled: currentlyEnabled,
      status: statusLabel,
    });
  };

  return (
    <div className="space-y-6">
      <section className={panelCls}>
        <h2 className="text-xl font-semibold text-white mb-3">Perpetual contracts</h2>
        {contractsLoading && <div className="text-sm text-slate-300/80">Loading contracts...</div>}
        {!!contracts?.length && (
          <div className="text-xs text-slate-400 mb-3">
            Toggle availability or edit leverage bounds. Updated contracts return instantly from the PATCH response.
          </div>
        )}
        {toggleMutation.isError && (
          <div className="mb-2 text-xs text-rose-400">{getErrorMessage(toggleMutation.error)}</div>
        )}
        <div className="space-y-2 max-h-72 overflow-auto text-sm">
          {contracts?.map((c) => (
            <div key={c.symbol} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3">
              <div className="space-y-1">
                <div className="text-white font-semibold">{c.symbol}</div>
                <div className="text-xs text-slate-400">
                  {c.baseAsset}/{c.quoteAsset} • Leverage {c.minLeverage ?? 1}x - {c.maxLeverage ?? 50}x
                </div>
                <div className={`text-xs ${isContractEnabled(c) ? "text-emerald-400" : "text-slate-500"}`}>
                  {isContractEnabled(c) ? "Enabled" : "Disabled"} ({getContractStatusLabel(c)})
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="xs"
                  variant={isContractEnabled(c) ? "danger" : "primary"}
                  disabled={toggleMutation.isPending && toggleTarget === c.symbol}
                  onClick={() => handleToggle(c)}
                >
                  {toggleMutation.isPending && toggleTarget === c.symbol
                    ? "Saving..."
                    : isContractEnabled(c)
                      ? "Disable"
                      : "Enable"}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => openEditor(c)}>
                  Edit
                </Button>
              </div>
            </div>
          ))}
          {!contractsLoading && !contracts?.length && <div className="text-sm text-slate-300/80">No perpetual contracts returned.</div>}
        </div>
      </section>

      <section className={panelCls}>
        <h2 className="text-xl font-semibold text-white mb-3">Spot listings</h2>
        {marketsLoading && <div className="text-sm text-slate-300/80">Loading markets...</div>}
        <div className="space-y-2 text-sm">
          {listings?.map((market: any) => (
            <div key={market.symbol ?? market.id} className="flex items-center justify-between rounded-2xl border border-white/10 px-4 py-2">
              <div>
                <div className="text-white font-semibold">{market.symbol ?? market.name}</div>
                <div className="text-xs text-slate-400">{market.status ?? "unknown"}</div>
              </div>
              <Button size="xs" variant={market.status === "active" ? "danger" : "primary"}>
                {market.status === "active" ? "Pause" : "List"}
              </Button>
            </div>
          ))}
          {!marketsLoading && !listings?.length && <div className="text-sm text-slate-300/80">No markets returned.</div>}
        </div>
      </section>

      <Dialog
        open={Boolean(editingContract)}
        onClose={closeEditor}
        title={editingContract ? `Edit ${editingContract.symbol}` : "Edit contract"}
        footer={
          <>
            <Button variant="ghost" onClick={closeEditor} disabled={leverageMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleLeverageSave} disabled={leverageMutation.isPending}>
              {leverageMutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </>
        }
      >
        {editingContract ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Adjust the leverage bounds returned by GET /admin/futures/contracts. The backend also accepts status toggles in the same payload.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
                Min leverage
                <Input
                  type="number"
                  min={1}
                  value={leverageForm.min}
                  onChange={(e) => setLeverageForm((prev) => ({ ...prev, min: e.target.value }))}
                />
              </label>
              <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
                Max leverage
                <Input
                  type="number"
                  min={1}
                  value={leverageForm.max}
                  onChange={(e) => setLeverageForm((prev) => ({ ...prev, max: e.target.value }))}
                />
              </label>
            </div>
            {leverageError && <div className="text-xs text-rose-400">{leverageError}</div>}
            {leverageMutation.isError && <div className="text-xs text-rose-400">{getErrorMessage(leverageMutation.error)}</div>}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
