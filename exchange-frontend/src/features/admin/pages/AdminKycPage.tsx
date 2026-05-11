import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { withAccessToken } from "../../../app/protectedAsset";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import {
  adminApproveKycRequest,
  adminDeclineKycRequest,
  fetchAdminKycRequestDetail,
  fetchAdminKycRequests,
  type AdminKycRequest,
  type AdminKycRequestDetail,
  type AdminKycRequestListResponse,
} from "../api/admin.api";

const panelCls = "rounded-2xl border border-white/10 bg-white/5 p-4";
const statusOptions = [
  { label: "All statuses", value: "" },
  { label: "In review", value: "in_review" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

const STATUS_COLORS: Record<string, string> = {
  in_review: "bg-amber-500/15 text-amber-200 border border-amber-400/30",
  approved: "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30",
  rejected: "bg-rose-500/15 text-rose-200 border border-rose-400/30",
};

const getDisplayStatus = (raw?: string) => raw?.replaceAll("_", " ").toLowerCase() ?? "unknown";

const getStatusBadgeCls = (status?: string) => {
  const normalized = status?.toLowerCase() ?? "";
  return STATUS_COLORS[normalized] ?? "bg-slate-500/15 text-slate-200 border border-slate-400/30";
};

const FINAL_STATUSES = new Set(["approved", "rejected"]);

const formatDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return date.toLocaleString();
};

const buildErrorMessage = (error: unknown) => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error) {
    const maybeAxios = error as { response?: { data?: unknown; statusText?: string } };
    const data = maybeAxios.response?.data;
    if (data) {
      if (typeof data === "string") return data;
      if (typeof data === "object") {
        if ("message" in data && typeof (data as any).message === "string") return (data as any).message;
        if ("error" in data && typeof (data as any).error === "string") return (data as any).error;
      }
    }
    if (maybeAxios.response?.statusText) return maybeAxios.response.statusText;
  }
  return "Request failed";
};

const TIER_HINTS: Record<number, { label: string; description: string }> = {
  0: { label: "Tier 0 • Basic", description: "Email verified, daily withdrawal limit 500 USDT." },
  1: { label: "Tier 1 • Identity", description: "Government ID verified, limit 50,000 USDT per day." },
  2: { label: "Tier 2 • Proof of address", description: "Utility bill or bank statement, limit 250,000 USDT per day." },
  3: { label: "Tier 3 • Enhanced", description: "Enhanced due diligence, institutional accounts." },
};

const DOC_CATEGORY_HINT: Record<string, string> = {
  passport: "Identity verification",
  driverslicense: "Identity verification",
  driversLicense: "Identity verification",
  residence: "Proof of address",
  proof_of_address: "Proof of address",
};

const isPreviewableImage = (doc: { mimeType?: string; filename?: string }) => {
  const mime = String(doc.mimeType || "").toLowerCase();
  const filename = String(doc.filename || "").toLowerCase();
  return mime.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|svg)$/.test(filename);
};

function ProfileAvatar({
  src,
  name,
  size = "md",
}: {
  src?: string | null;
  name?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const initialsSource = (name || "?").trim();
  const initials = initialsSource
    .split(/\s+/)
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const sizeClass = size === "sm" ? "h-10 w-10 text-xs" : size === "lg" ? "h-16 w-16 text-lg" : "h-12 w-12 text-sm";

  if (src) {
    return <img src={src} alt={name || "Profile"} className={`${sizeClass} rounded-full border border-white/10 object-cover`} />;
  }

  return (
    <div className={`${sizeClass} flex items-center justify-center rounded-full border border-white/10 bg-white/10 font-semibold text-white`}>
      {initials || "?"}
    </div>
  );
}

export default function AdminKycPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [notes, setNotes] = useState("");

  const listQuery = useQuery<AdminKycRequestListResponse>({
    queryKey: ["admin", "kyc", "requests", { page, statusFilter, search }],
    queryFn: () =>
      fetchAdminKycRequests({
        page,
        pageSize: 10,
        status: statusFilter || undefined,
        search: search || undefined,
      }),
  });

  const requests: AdminKycRequest[] = listQuery.data?.items ?? [];
  const meta = listQuery.data?.meta;

  useEffect(() => {
    if (!requests.length) {
      setSelectedId(null);
      return;
    }
    if (selectedId == null || !requests.some((req) => String(req.id) === String(selectedId))) {
      setSelectedId(requests[0].id);
    }
  }, [requests, selectedId]);

  const detailQuery = useQuery({
    queryKey: ["admin", "kyc", "request", selectedId],
    queryFn: () => fetchAdminKycRequestDetail(String(selectedId)),
    enabled: selectedId !== null,
  });

  useEffect(() => {
    if (detailQuery.data) {
      setNotes(detailQuery.data.notes ?? "");
    } else if (selectedId == null) {
      setNotes("");
    }
  }, [detailQuery.data, selectedId]);

  const invalidateKycQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "kyc", "requests"] });
    if (selectedId != null) {
      queryClient.invalidateQueries({ queryKey: ["admin", "kyc", "request", selectedId] });
    }
  };

  const approveMutation = useMutation({
    mutationFn: (payload: { id: string | number; notes?: string }) => adminApproveKycRequest(payload.id, { notes: payload.notes }),
    onSuccess: (updated) => {
      invalidateKycQueries();
      setNotes(updated.notes ?? "");
    },
  });

  const declineMutation = useMutation({
    mutationFn: (payload: { id: string | number; notes?: string }) => adminDeclineKycRequest(payload.id, { notes: payload.notes }),
    onSuccess: (updated) => {
      invalidateKycQueries();
      setNotes(updated.notes ?? "");
    },
  });

  const currentDetail = detailQuery.data;
  const actionError = approveMutation.error || declineMutation.error;
  const approvePending = approveMutation.isPending;
  const declinePending = declineMutation.isPending;
  const actionPending = approvePending || declinePending;

  const handleReview = (decision: "approve" | "decline") => {
    if (!selectedId) return;
    const payload = { id: selectedId, notes: notes?.trim() ? notes : undefined };
    if (decision === "approve") approveMutation.mutate(payload);
    else declineMutation.mutate(payload);
  };

  const statusSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    requests.forEach((req) => {
      const key = req.status?.toLowerCase() ?? "unknown";
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [requests]);

  return (
    <div className="space-y-6">
      <section className={panelCls}>
        <h2 className="text-xl font-semibold text-white mb-4">KYC Requests</h2>
        <div className="grid gap-3 md:grid-cols-[1fr_200px_120px]">
          <Input
            placeholder="Search email, user ID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="text-sm text-slate-300 flex items-center justify-end">
            Page {meta?.page ?? page} / {meta?.totalPages ?? 1}
          </div>
        </div>
        {Object.keys(statusSummary).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            {Object.entries(statusSummary).map(([status, count]) => (
              <div key={status} className={`${getStatusBadgeCls(status)} rounded-full px-3 py-1`}>
                {getDisplayStatus(status)}: {count}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <section className={`${panelCls} flex flex-col`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-white">Queue</h3>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1 || listQuery.isFetching}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                Prev
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!meta || page >= (meta.totalPages || 1) || listQuery.isFetching}
                onClick={() => setPage((prev) => (meta ? Math.min(meta.totalPages, prev + 1) : prev + 1))}
              >
                Next
              </Button>
            </div>
          </div>
          {listQuery.isLoading && <div className="text-sm text-slate-300/80">Loading requests...</div>}
          <div className="flex-1 space-y-3 overflow-auto">
            {requests.map((req) => {
              const active = selectedId != null && String(selectedId) === String(req.id);
              return (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => setSelectedId(req.id)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                    active ? "border-emerald-400/60 bg-emerald-500/10 text-white" : "border-white/10 bg-white/5 text-slate-200 hover:border-emerald-400/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ProfileAvatar src={req.user?.profilePhoto} name={req.user?.displayName ?? req.user?.email} size="sm" />
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">{req.user?.displayName ?? `User #${req.userId}`}</div>
                        <div className="text-xs text-slate-400 mt-1 truncate">{req.user?.email ?? "No email"}</div>
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs uppercase tracking-wide rounded-full px-2 py-0.5 ${getStatusBadgeCls(req.status)}`}>
                      {getDisplayStatus(req.status)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2 flex justify-between">
                    <span>Docs: {req.documentCount ?? 0}</span>
                    <span>Submitted: {formatDate(req.createdAt)}</span>
                  </div>
                </button>
              );
            })}
            {!listQuery.isLoading && !requests.length && (
              <div className="text-sm text-slate-400">No KYC requests match this filter.</div>
            )}
          </div>
        </section>

        <section className={panelCls}>
          <h3 className="text-lg font-semibold text-white mb-3">Request detail</h3>
          {!selectedId && <div className="text-sm text-slate-400">Select a request from the queue.</div>}
          {detailQuery.isFetching && selectedId && <div className="text-sm text-slate-300/80">Loading detail...</div>}
          {currentDetail && (
          <DetailPanel
            request={currentDetail}
            notes={notes}
            onNotesChange={setNotes}
            onApprove={() => handleReview("approve")}
            onDecline={() => handleReview("decline")}
            approvePending={approvePending}
            declinePending={declinePending}
            actionPending={actionPending}
            actionError={actionError ? buildErrorMessage(actionError) : null}
          />
        )}
      </section>
    </div>
    </div>
  );
}

type DetailPanelProps = {
  request: AdminKycRequestDetail;
  notes: string;
  onNotesChange: (val: string) => void;
  onApprove: () => void;
  onDecline: () => void;
  approvePending: boolean;
  declinePending: boolean;
  actionPending: boolean;
  actionError: string | null;
};

function DetailPanel({
  request,
  notes,
  onNotesChange,
  onApprove,
  onDecline,
  approvePending,
  declinePending,
  actionPending,
  actionError,
}: DetailPanelProps) {
  const [previewDocument, setPreviewDocument] = useState<AdminKycRequestDetail["documents"][number] | null>(null);
  const documents = request.documents ?? [];
  const activity = request.activity ?? [];
  const normalizedStatus = request.status?.toLowerCase() ?? "";
  const isFinalized = FINAL_STATUSES.has(normalizedStatus);
  const tierLevel = typeof request.user?.kycLevel === "number" ? request.user.kycLevel : 0;
  const tierMeta =
    TIER_HINTS[tierLevel] ?? { label: `Tier ${tierLevel ?? 0}`, description: "No tier information available for this user." };
  const documentPurpose =
    documents
      .map((doc) => DOC_CATEGORY_HINT[doc.type?.toLowerCase?.() ?? doc.type] ?? "")
      .find(Boolean) ?? "General verification";
  const previewDocumentUrl = previewDocument?.previewUrl ? withAccessToken(previewDocument.previewUrl) : "";
  const userSubmissionNote =
    previewDocument?.notes?.trim() ||
    documents.map((doc) => doc.notes?.trim()).find(Boolean) ||
    "";

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <ProfileAvatar src={request.user?.profilePhoto} name={request.user?.displayName ?? request.user?.email} size="lg" />
        <div className="min-w-0">
          <div className="text-xl font-semibold text-white">{request.user?.displayName ?? `User #${request.userId}`}</div>
          <div className="text-xs text-slate-400">{request.user?.email ?? "N/A"}</div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-wide ${getStatusBadgeCls(request.status)}`}>
          {getDisplayStatus(request.status)}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 text-xs text-slate-300">
        <InfoRow label="User ID" value={String(request.userId)} />
        <InfoRow label="Email" value={request.user?.email ?? "N/A"} />
        <InfoRow label="Country" value={request.user?.country ?? "N/A"} />
        <InfoRow label="KYC level" value={request.user?.kycLevel != null ? String(request.user.kycLevel) : "N/A"} />
        <InfoRow label="Submission ID" value={request.submissionId} />
        <InfoRow label="Submitted" value={formatDate(request.createdAt)} />
        <InfoRow label="Reviewed at" value={formatDate(request.reviewedAt)} />
        <InfoRow label="Reviewer" value={request.reviewerId ? String(request.reviewerId) : "—"} />
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Current tier</div>
            <div className="text-sm font-semibold text-white">{tierMeta.label}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Request intent</div>
            <div className="text-sm text-white">{documentPurpose}</div>
          </div>
        </div>
        <p className="mt-3 text-slate-300">{tierMeta.description}</p>
        {request.resubmissionRequired && (
          <div className="mt-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-amber-100">
            Compliance requested updated paperwork for this submission.
          </div>
        )}
      </section>

      <section>
        <h4 className="text-sm font-semibold text-white mb-2">Documents ({documents.length})</h4>
        <div className="space-y-3">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="overflow-hidden rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.025))] text-xs shadow-[0_20px_60px_-46px_rgba(0,0,0,0.35)]"
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="font-semibold text-white">{doc.type}</div>
                <span className={`rounded-full px-2 py-0.5 ${getStatusBadgeCls(doc.status)}`}>{getDisplayStatus(doc.status)}</span>
              </div>
              {doc.previewUrl && isPreviewableImage(doc) ? (
                <button
                  type="button"
                  onClick={() => {
                    setPreviewDocument(doc);
                  }}
                  className="block w-full overflow-hidden border-y border-white/10 bg-black/30 text-left transition hover:border-cyan-400/40"
                >
                  <img
                    src={withAccessToken(doc.previewUrl)}
                    alt={doc.filename}
                    className="h-44 w-full object-cover object-center sm:h-52"
                    loading="lazy"
                  />
                  <div className="flex items-center justify-between gap-3 bg-slate-950/40 px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-cyan-100/80">
                    <span>Tap to preview</span>
                    <span>{doc.isSecondary ? "Optional file" : "Primary file"}</span>
                  </div>
                </button>
              ) : null}

              <div className="space-y-3 px-4 py-4">
                <div>
                  <div className="truncate text-sm text-white">{doc.filename}</div>
                  <div className="text-[11px] text-slate-500">Uploaded: {formatDate(doc.uploadedAt)}</div>
                </div>

                <div className={`grid gap-3 ${request.notes?.trim() ? "md:grid-cols-2" : ""}`}>
                  <div className="rounded-[16px] border border-white/10 bg-white/[0.03] px-3 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/80">User Notes</div>
                    <div className="mt-2 text-[12px] leading-6 text-slate-300">{doc.notes?.trim() || "No user note added."}</div>
                  </div>
                  {request.notes?.trim() ? (
                    <div className="rounded-[16px] border border-white/10 bg-white/[0.03] px-3 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/80">Admin Notes</div>
                      <div className="mt-2 text-[12px] leading-6 text-slate-300">{request.notes.trim()}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          {!documents.length && <div className="text-xs text-slate-400">No documents for this submission.</div>}
        </div>
      </section>

      <section>
        <h4 className="text-sm font-semibold text-white mb-2">Activity</h4>
        <div className="space-y-2">
          {activity.map((event) => (
            <div key={event.id} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2">
              <div className="text-xs font-semibold text-white">{event.event.replaceAll("_", " ")}</div>
              <div className="text-xs text-slate-300">{event.message}</div>
              <div className="text-[11px] text-slate-500">{formatDate(event.createdAt)}</div>
            </div>
          ))}
          {!activity.length && <div className="text-xs text-slate-400">No activity recorded.</div>}
        </div>
      </section>

      <section className="space-y-2">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Admin notes</label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          readOnly={isFinalized}
          className={`w-full rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400/70 focus:outline-none ${
            isFinalized ? "opacity-60 cursor-not-allowed" : ""
          }`}
          placeholder="Optional note to attach to this decision"
        />
        {actionError && <div className="text-xs text-rose-400">{actionError}</div>}
        {isFinalized ? (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100">
            Decision recorded — this submission is already {getDisplayStatus(request.status)}. Reopen on the backend if a new decision is required.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" disabled={actionPending} onClick={onDecline}>
              {declinePending ? "Declining..." : "Decline"}
            </Button>
            <Button className="flex-1" disabled={actionPending} onClick={onApprove}>
              {approvePending ? "Approving..." : "Approve"}
            </Button>
          </div>
        )}
      </section>

      {request.notes?.trim() ? (
        <section className="rounded-[20px] border border-amber-400/20 bg-amber-500/8 px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100">Saved Admin Note</div>
          <div className="mt-2 text-sm leading-6 text-amber-50/95">{request.notes.trim()}</div>
        </section>
      ) : null}

      {previewDocument ? (
        <section className="rounded-[24px] border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(15,23,42,0.88),rgba(2,6,23,0.96))] p-4 shadow-[0_24px_80px_-48px_rgba(8,145,178,0.42)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.26em] text-cyan-200/70">Footer Preview</div>
              <div className="mt-2 truncate text-base font-semibold text-white">{previewDocument.type}</div>
              <div className="truncate text-xs text-slate-400 sm:text-sm">{previewDocument.filename}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[11px] ${getStatusBadgeCls(previewDocument.status)}`}>
                {getDisplayStatus(previewDocument.status)}
              </span>
              <button
                type="button"
                onClick={() => setPreviewDocument(null)}
                className="inline-flex h-10 items-center justify-center rounded-full border border-white/20 bg-white/5 px-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-white/10"
              >
                Hide
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-[20px] border border-white/15 bg-black/35 p-3 sm:p-4">
            <div className="flex min-h-[240px] items-center justify-center overflow-auto rounded-[16px] bg-slate-950/45">
              <img
                src={previewDocumentUrl || "/no-image.svg"}
                alt={previewDocument.filename}
                className="block max-h-[420px] w-auto max-w-full object-contain"
              />
            </div>
          </div>

          <div className={`mt-4 grid gap-3 ${notes?.trim() || request.notes?.trim() ? "sm:grid-cols-2" : ""}`}>
            <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/80">User Notes</div>
              <div className="mt-2 text-[12px] leading-6 text-slate-300">{userSubmissionNote || "No user note added."}</div>
            </div>
            {notes?.trim() || request.notes?.trim() ? (
              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/80">Admin Notes</div>
                <div className="mt-2 text-[12px] leading-6 text-slate-300">{notes?.trim() || request.notes?.trim()}</div>
              </div>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{previewDocument.filename}</div>
              <div className="text-[11px] text-slate-400">Uploaded: {formatDate(previewDocument.uploadedAt)}</div>
            </div>
            <a
              href={previewDocumentUrl || "#"}
              download={previewDocument.filename}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-500/10 px-5 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-100 transition hover:bg-cyan-500/20"
            >
              Download
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}

type InfoRowProps = { label: string; value: string };
function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="text-sm text-white">{value}</div>
    </div>
  );
}


