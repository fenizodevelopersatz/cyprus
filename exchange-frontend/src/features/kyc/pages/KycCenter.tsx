import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { withAccessToken } from "../../../app/protectedAsset";
import Button from "../../../ui/Button";
import Dialog from "../../../ui/Dialog";
import { useAuth } from "../../auth/state/auth.store";
import { useKycData } from "../hooks/useKycData";
import type { KycDocument, KycStep, KycStepStatus } from "../api/kyc.api";

type StepStatus = "complete" | "current" | "upcoming";

type ProgressStep = {
  id: 1 | 2 | 3;
  key: "info" | "id" | "face";
  label: string;
  title: string;
  description: string;
  status: StepStatus;
};

type DocumentOption = {
  id: string;
  label: string;
  hint: string;
  primaryLabel: string;
  secondaryLabel: string;
};

type PreviewAsset = {
  title: string;
  url: string;
  mimeType?: string;
  filename?: string;
};

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png"]);
const ALLOWED_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png"];

const documentOptions: DocumentOption[] = [
  {
    id: "passport",
    label: "Passport",
    hint: "Upload a high-resolution scan of the photo page.",
    primaryLabel: "Passport photo page",
    secondaryLabel: "Secondary page or support file",
  },
  {
    id: "driversLicense",
    label: "Driver Licence",
    hint: "Provide front and back in separate files.",
    primaryLabel: "Front of ID",
    secondaryLabel: "Back of ID",
  },
  {
    id: "residence",
    label: "Proof of Residence",
    hint: "Utility bill or bank statement dated within 3 months.",
    primaryLabel: "Proof of address",
    secondaryLabel: "Supporting page",
  },
];

function normalizeStatus(status?: string): KycStepStatus | undefined {
  const value = String(status || "").trim().toUpperCase();
  if (!value) return undefined;
  if (value === "APPROVED" || value === "REJECTED" || value === "IN_REVIEW" || value === "PENDING") {
    return value;
  }
  return undefined;
}

function normalizeDocumentTypeKey(value?: string | null) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.includes("passport")) return "passport";
  if (normalized.includes("driver")) return "driversLicense";
  if (normalized.includes("residence") || normalized.includes("address")) return "residence";
  return normalized;
}

function getApprovedDocumentTypeCount(documents: KycDocument[] = []) {
  return new Set(
    documents
      .filter((doc) => normalizeStatus(doc.status) === "APPROVED")
      .map((doc) => normalizeDocumentTypeKey(doc.type))
      .filter(Boolean)
  ).size;
}

function getPendingDocumentTypeCount(documents: KycDocument[] = []) {
  return new Set(
    documents
      .filter((doc) => normalizeStatus(doc.status) === "IN_REVIEW" || normalizeStatus(doc.status) === "PENDING")
      .map((doc) => normalizeDocumentTypeKey(doc.type))
      .filter(Boolean)
  ).size;
}

function mapProgressSteps(
  backendSteps: KycStep[] | undefined,
  overallStatus?: string,
  documents: KycDocument[] = [],
  verified = false
): ProgressStep[] {
  const normalizedOverall = normalizeStatus(overallStatus);
  const infoStep = backendSteps?.find((step) => /account|profile|info/i.test(step.title) || /account|profile|info/i.test(step.code));
  const idStep = backendSteps?.find((step) => /identity|id/i.test(step.title) || /identity|id/i.test(step.code));
  const faceStep = backendSteps?.find((step) => /face|video|enhanced/i.test(step.title) || /face|video|enhanced/i.test(step.code));
  const uploadedDocuments = Array.isArray(documents) ? documents : [];
  const requiredDocumentTypeCount = documentOptions.length;
  const hasUploadedDocuments = uploadedDocuments.length > 0;
  const infoApproved = normalizeStatus(infoStep?.status) === "APPROVED";
  const approvedDocumentTypeCount = getApprovedDocumentTypeCount(uploadedDocuments);
  const hasApprovedIdentityDocument = approvedDocumentTypeCount > 0;
  const hasReviewingIdentityDocument = uploadedDocuments.some((doc) => {
    const status = normalizeStatus(doc.status);
    return status === "IN_REVIEW" || status === "PENDING" || status === "REJECTED";
  });
  const hasCompletedAllRequiredDocuments = approvedDocumentTypeCount >= requiredDocumentTypeCount;
  const idStatus =
    normalizeStatus(idStep?.status) ??
    (hasCompletedAllRequiredDocuments ? "APPROVED" : hasApprovedIdentityDocument || hasReviewingIdentityDocument ? "IN_REVIEW" : undefined) ??
    normalizedOverall ??
    "PENDING";
  const faceStatus = hasCompletedAllRequiredDocuments ? normalizeStatus(faceStep?.status) ?? "APPROVED" : "PENDING";

  const infoState: StepStatus = infoApproved ? "complete" : "current";
  const idState: StepStatus = !infoApproved && !hasUploadedDocuments
    ? "upcoming"
    : !hasUploadedDocuments
    ? "upcoming"
    : hasCompletedAllRequiredDocuments
      ? "complete"
      : idStatus === "IN_REVIEW" || idStatus === "REJECTED" || idStatus === "PENDING"
        ? "current"
        : "upcoming";
  const faceState: StepStatus =
    hasCompletedAllRequiredDocuments && idStatus === "APPROVED"
      ? "current"
      : "upcoming";

  return [
    {
      id: 1,
      key: "info",
      label: "Info",
      title: "Profile basics",
      description: "Account details and residency information reviewed.",
      status: infoState,
    },
    {
      id: 2,
      key: "id",
      label: "ID",
      title: "Identity verification",
      description: "Upload your government-issued identification documents.",
      status: idState,
    },
    {
      id: 3,
      key: "face",
      label: "Face",
      title: "Face match",
      description: "Selfie or photo verification for enhanced access.",
      status: faceState,
    },
  ];
}

function badgeTone(status?: string) {
  switch (normalizeStatus(status)) {
    case "APPROVED":
      return "border-emerald-400/30 bg-emerald-500/15 text-emerald-100";
    case "REJECTED":
      return "border-rose-400/30 bg-rose-500/15 text-rose-100";
    case "IN_REVIEW":
      return "border-amber-400/30 bg-amber-500/15 text-amber-100";
    default:
      return "border-white/10 bg-white/5 text-slate-200";
  }
}

function formatStatusLabel(status?: string) {
  const normalized = normalizeStatus(status);
  if (!normalized) return "Pending";
  return normalized.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value?: string | null) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDocumentRoleLabel(doc?: KycDocument | null) {
  if (!doc) return "";
  return doc.isSecondary ? "Optional file" : "Primary file";
}

function getUploadCardLabel(option?: DocumentOption) {
  return option?.id === "driversLicense" ? "Identity Verification" : option?.label ?? "Document Upload";
}

function findDocumentForSlot(documents: KycDocument[], preferred: string[]) {
  const lowered = preferred.map((value) => value.toLowerCase());
  return (
    documents.find((doc) => {
      const haystack = `${doc.type} ${doc.filename} ${doc.notes || ""}`.toLowerCase();
      return lowered.some((token) => haystack.includes(token));
    }) ?? null
  );
}

function findDocumentByType(documents: KycDocument[], documentType?: string | null, isSecondary?: boolean) {
  const normalizedType = normalizeDocumentTypeKey(documentType);
  if (!normalizedType) return null;
  return (
    documents.find((doc) => {
      if (normalizeDocumentTypeKey(doc.type) !== normalizedType) return false;
      if (typeof isSecondary === "boolean") return Boolean(doc.isSecondary) === isSecondary;
      return true;
    }) ?? null
  );
}

function getPreviewIdentity(asset: PreviewAsset | null) {
  return `${asset?.mimeType || ""} ${asset?.filename || ""} ${asset?.title || ""} ${asset?.url || ""}`.toLowerCase();
}

function isImagePreview(asset: PreviewAsset | null) {
  const identity = getPreviewIdentity(asset);
  if (!identity) return false;
  if (identity.includes("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\s|$|\?|#)/i.test(identity);
}

function isPdfPreview(asset: PreviewAsset | null) {
  const identity = getPreviewIdentity(asset);
  if (!identity) return false;
  if (identity.includes("application/pdf")) return true;
  return /\.pdf(\s|$|\?|#)/i.test(identity);
}

function isAllowedImageFile(file: File | null) {
  if (!file) return false;
  const normalizedMimeType = String(file.type || "").trim().toLowerCase();
  const normalizedName = String(file.name || "").trim().toLowerCase();
  const hasAllowedMimeType = ALLOWED_IMAGE_MIME_TYPES.has(normalizedMimeType);
  const hasAllowedExtension = ALLOWED_IMAGE_EXTENSIONS.some((extension) => normalizedName.endsWith(extension));
  return hasAllowedMimeType || hasAllowedExtension;
}

function ProgressRail({ steps }: { steps: ProgressStep[] }) {
  return (
    <div className="rounded-[24px] border border-[#2c2a1e] bg-[linear-gradient(180deg,#111417,#0b0d10)] px-3 py-4 shadow-[0_22px_70px_-48px_rgba(255,214,61,0.35)] sm:rounded-[28px] sm:px-6 sm:py-5">
      <div className="flex items-start justify-between gap-2 sm:gap-4">
        {steps.map((step, index) => {
          const active = step.status === "current";
          const complete = step.status === "complete";
          return (
            <div key={step.key} className="flex min-w-0 flex-1 items-start gap-2 sm:gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-black transition sm:h-12 sm:w-12 sm:text-base ${
                      complete || active
                        ? "border-[#ffd84f] bg-[#ffd84f] text-[#111111] shadow-[0_0_0_4px_rgba(255,216,79,0.12),0_0_28px_rgba(255,216,79,0.22)]"
                        : "border-[#5c5132] bg-transparent text-[#b6a780]"
                    }`}
                  >
                    {step.id}
                  </div>
                  {index < steps.length - 1 ? (
                    <div
                      className={`h-[2px] flex-1 rounded-full ${
                        complete ? "bg-[#ffd84f]" : "bg-white/10"
                      }`}
                    />
                  ) : null}
                </div>
                <div className={`mt-2 text-[9px] font-semibold uppercase tracking-[0.2em] sm:mt-3 sm:text-[10px] sm:tracking-[0.24em] ${complete || active ? "text-[#ffd84f]" : "text-[#9d9270]"}`}>
                  {step.label}
                </div>
                <div className="mt-1 hidden text-[11px] text-slate-400 sm:block">{step.description}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UploadSlot({
  title,
  subtitle,
  file,
  existing,
  required = false,
  inputRef,
  onChange,
  onPreview,
}: {
  title: string;
  subtitle: string;
  file: File | null;
  existing: KycDocument | null;
  required?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (file: File | null) => void;
  onPreview: (doc: KycDocument) => void;
}) {
  const filename = file?.name || existing?.filename || "No file selected";
  const existingRejected = normalizeStatus(existing?.status) === "REJECTED";
  const showPreviewAction = Boolean(existing?.previewUrl) && !existingRejected && !file;
  const helperText = file
    ? "Ready to upload"
    : existing
      ? existingRejected
        ? "Rejected previously - select a new file to resend for review"
        : `${formatStatusLabel(existing.status)} • ${formatDateTime(existing.updatedAt || existing.uploadedAt)}`
      : "JPG, JPEG or PNG (max 10 MB)";

  return (
    <div className="min-w-0 overflow-hidden rounded-[22px] border border-[#3a331f] bg-[linear-gradient(180deg,rgba(29,31,34,0.96),rgba(21,22,24,0.98))] p-3 shadow-[0_18px_60px_-44px_rgba(255,216,79,0.18)] sm:rounded-[26px] sm:p-4">
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        className="hidden"
        onChange={(event) => onChange(event.currentTarget.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full min-w-0 flex-col gap-4 text-left"
      >
        <div className="min-w-0 overflow-hidden rounded-[20px] border border-dashed border-[#5a5030] bg-[radial-gradient(circle_at_top,rgba(255,216,79,0.08),transparent_60%),linear-gradient(180deg,#2a2c30,#1b1d20)] p-4 sm:rounded-[24px] sm:p-5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#ffd84f] text-[#151515] shadow-[0_0_28px_rgba(255,216,79,0.28)] sm:h-16 sm:w-16 sm:rounded-[22px]">
              <svg viewBox="0 0 24 24" className="h-7 w-7 sm:h-8 sm:w-8" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7a2 2 0 0 1 2-2h3l2-2h2l2 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                <circle cx="12" cy="13" r="3" />
                <path d="M19 9v-2" />
                <path d="M18 8h2" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[0.95rem] font-bold leading-tight text-white sm:text-[1.05rem]">{title}</div>
              <div className="mt-1 text-[11px] text-[#c5b894] sm:text-[13px]">{subtitle}</div>
              <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-slate-500 sm:text-[11px]">{required ? "Required upload" : "Optional upload"}</div>
            </div>
          </div>
        </div>
      </button>

      <div className="mt-4 flex min-w-0 flex-col gap-3 overflow-hidden rounded-[18px] border border-white/8 bg-[#1e2125] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:rounded-[22px] sm:px-4">
        <div className="min-w-0">
          <div className="break-words text-[13px] font-medium text-white sm:text-sm">{filename}</div>
          <div className={`mt-1 text-[11px] sm:text-xs ${existingRejected ? "text-rose-200" : "text-[#b8aa83]"}`}>
            {helperText}
          </div>
        </div>
        {showPreviewAction ? (
          <button
            type="button"
            onClick={() => onPreview(existing)}
            className="inline-flex h-9 w-fit min-w-[112px] items-center justify-center self-start rounded-full border border-cyan-400/30 bg-cyan-500/10 px-4 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-500/20 sm:h-auto sm:min-w-0 sm:w-auto sm:self-center sm:py-1"
          >
            Preview
          </button>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`inline-flex h-9 w-fit min-w-[112px] items-center justify-center self-start rounded-full border px-4 text-xs font-semibold transition sm:h-auto sm:min-w-0 sm:w-auto sm:self-center sm:py-1 ${
              existingRejected
                ? "border-rose-400/30 bg-rose-500/10 text-rose-100 hover:bg-rose-500/20"
                : "border-[#5a5030] text-[#ffd84f] hover:bg-[#ffd84f]/10"
            }`}
          >
            {existingRejected ? "Resend" : "Select"}
          </button>
        )}
      </div>
    </div>
  );
}

function MiniStatusCard({
  eyebrow,
  title,
  description,
  highlight = false,
}: {
  eyebrow: string;
  title: string;
  description: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-[22px] border p-4 sm:rounded-[28px] sm:p-5 ${
        highlight
          ? "border-emerald-500/45 bg-[linear-gradient(180deg,rgba(58,60,64,0.96),rgba(36,39,43,0.98))] shadow-[0_0_0_1px_rgba(52,211,153,0.14),0_20px_60px_-40px_rgba(52,211,153,0.15)]"
          : "border-white/8 bg-[linear-gradient(180deg,rgba(35,38,41,0.96),rgba(28,31,35,0.98))]"
      }`}
    >
      <div className={`text-[9px] font-semibold uppercase tracking-[0.2em] sm:text-[10px] sm:tracking-[0.24em] ${highlight ? "text-emerald-300" : "text-[#cbb98b]"}`}>{eyebrow}</div>
      <div className="truncate whitespace-nowrap text-[1.05rem] font-extrabold leading-none text-white sm:mt-3 sm:text-[1.55rem]">{title}</div>
      <div className="mt-2 text-[11px] text-[#b8aa83] sm:mt-3 sm:text-[13px]">{description}</div>
    </div>
  );
}

export default function KycCenter() {
  const navigate = useNavigate();
  const user = useAuth((state) => state.user);
  const { status, history, loading, error, submitDocuments } = useKycData();

  const [selectedDocument, setSelectedDocument] = useState(documentOptions[0].id);
  const [note, setNote] = useState("");
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [secondaryFile, setSecondaryFile] = useState<File | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<PreviewAsset | null>(null);
  const primaryInputRef = useRef<HTMLInputElement | null>(null);
  const secondaryInputRef = useRef<HTMLInputElement | null>(null);

  const documents = useMemo(() => status?.documents ?? [], [status?.documents]);
  const verified = Boolean(status?.kycVerified);
  const approvedDocumentTypeCount = useMemo(() => getApprovedDocumentTypeCount(documents), [documents]);
  const pendingDocumentTypeCount = useMemo(() => getPendingDocumentTypeCount(documents), [documents]);
  const hasCompletedAllRequiredDocuments = approvedDocumentTypeCount >= documentOptions.length;
  const fullyVerified = verified && hasCompletedAllRequiredDocuments;
  const rawOverall = status?.overallStatus ?? (user?.kycStatus === "approved" ? "APPROVED" : undefined);
  const overallStatus = fullyVerified ? "APPROVED" : rawOverall;
  const canSubmitDocuments = status?.canSubmitDocuments ?? true;
  const allowedDocumentTypes = useMemo(
    () => (status?.allowedDocumentTypes ?? []).map((item) => String(item)),
    [status?.allowedDocumentTypes]
  );
  const availableDocumentOptions = useMemo(() => {
    if (allowedDocumentTypes.length === 0) return documentOptions;
    return documentOptions.filter((doc) => allowedDocumentTypes.includes(doc.id));
  }, [allowedDocumentTypes]);
  const selectedDocMeta = availableDocumentOptions.find((doc) => doc.id === selectedDocument) ?? availableDocumentOptions[0];
  const selectedDocumentAllowed = Boolean(selectedDocMeta);
  const progressSteps = useMemo(
    () => mapProgressSteps(status?.steps, overallStatus, documents, verified),
    [status?.steps, overallStatus, documents, verified]
  );
  const hasPendingPrimaryFile = Boolean(primaryFile);
  const allowSubmissions = selectedDocumentAllowed && canSubmitDocuments && !hasCompletedAllRequiredDocuments && hasPendingPrimaryFile;

  const currentLevelTitle = fullyVerified ? "Verified" : normalizeStatus(overallStatus) === "IN_REVIEW" ? "In Review" : "Basic";
  const currentLevelNote = fullyVerified
    ? "Daily withdrawal up to 50,000 USD"
    : normalizeStatus(overallStatus) === "REJECTED"
    ? "Update the rejected files to continue verification."
    : pendingDocumentTypeCount > 0
      ? "Some document types are already pending review. Upload only the remaining document types."
    : approvedDocumentTypeCount > 0
      ? `Upload the remaining ${Math.max(documentOptions.length - approvedDocumentTypeCount, 0)} document type(s) to complete verification.`
      : "Submit valid documents to unlock higher limits.";

  const rejectedHistory = history.find((entry) => /reject/i.test(entry.event) || /reject/i.test(entry.message));
  const adminReviewNote =
    typeof status?.notes === "string" && status.notes.trim()
      ? status.notes.trim()
      : typeof rejectedHistory?.metadata === "object" && rejectedHistory?.metadata && "notes" in rejectedHistory.metadata
        ? String((rejectedHistory.metadata as Record<string, unknown>).notes || "").trim() || null
        : null;
  const inReviewMessage = status?.uploadBlockedReason || statusMessage || "Documents are checked by compliance within 24 hours.";

  const primaryExistingDoc = useMemo(() => {
    const explicitPrimary = findDocumentByType(documents, selectedDocMeta?.id, false);
    if (explicitPrimary) return explicitPrimary;
    if (selectedDocMeta?.id === "driversLicense") {
      return findDocumentForSlot(documents, ["front", "primary", "license"]);
    }
    return findDocumentForSlot(documents, [selectedDocMeta?.id || "", "primary", "photo"]);
  }, [documents, selectedDocMeta]);

  const secondaryExistingDoc = useMemo(() => {
    const explicitSecondary = findDocumentByType(documents, selectedDocMeta?.id, true);
    if (explicitSecondary) return explicitSecondary;
    if (selectedDocMeta?.id === "driversLicense") {
      return findDocumentForSlot(documents, ["back", "secondary"]);
    }
    return findDocumentForSlot(documents, ["secondary", "support", "back"]);
  }, [documents, selectedDocMeta]);

  useEffect(() => {
    if (selectedDocMeta && selectedDocument !== selectedDocMeta.id) {
      setSelectedDocument(selectedDocMeta.id);
    }
  }, [selectedDocMeta, selectedDocument]);

  const openPreview = (doc: KycDocument) => {
    if (!doc.previewUrl) return;
    setPreviewAsset({
      title: doc.filename,
      url: withAccessToken(doc.previewUrl),
      mimeType: doc.mimeType,
      filename: doc.filename,
    });
  };
  const activePreviewDoc = useMemo(
    () => documents.find((doc) => doc.filename === previewAsset?.filename) ?? null,
    [documents, previewAsset]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedDocMeta || !selectedDocumentAllowed || !canSubmitDocuments || hasCompletedAllRequiredDocuments) return;
    setSubmitError(null);
    setStatusMessage(null);

    if (!primaryFile) {
      setSubmitError(`Upload ${selectedDocMeta.primaryLabel.toLowerCase()} before submitting.`);
      return;
    }

    if (!isAllowedImageFile(primaryFile)) {
      setSubmitError("Only JPG, JPEG, and PNG images are allowed.");
      return;
    }

    if (secondaryFile && !isAllowedImageFile(secondaryFile)) {
      setSubmitError("Secondary file must be JPG, JPEG, or PNG.");
      return;
    }

    try {
      setSubmitting(true);
      const response = await submitDocuments({
        documentType: selectedDocument,
        primary: primaryFile,
        secondary: secondaryFile ?? undefined,
        notes: note || undefined,
      });
      setStatusMessage(response.message ?? "Documents submitted. Compliance will review them shortly.");
      setPrimaryFile(null);
      setSecondaryFile(null);
      setNote("");
      if (primaryInputRef.current) primaryInputRef.current.value = "";
      if (secondaryInputRef.current) secondaryInputRef.current.value = "";
    } catch (err) {
      const fallback =
        err && typeof err === "object" && "message" in err
          ? (err as { message?: string }).message
          : "Unable to submit documents. Try again shortly.";
      setSubmitError(fallback ?? "Unable to submit documents. Try again shortly.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 overflow-x-hidden text-slate-100 sm:space-y-5">
      <header className="flex items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,#14181d,#101317)] px-3 py-3 shadow-[0_18px_60px_-45px_rgba(255,216,79,0.16)] sm:rounded-[28px] sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-[#191c20] text-[#ffd84f] transition hover:border-white/20 hover:bg-[#20252a] sm:h-11 sm:w-11"
            aria-label="Go back"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="min-w-0">
            <div className="truncate whitespace-nowrap text-[clamp(0.9rem,1vw,1.5rem)] font-extrabold tracking-[-0.03em] text-[#ffd84f]">Compliance Center</div>
            <div className="mt-1 text-[11px] text-slate-400 sm:text-[13px]">Modern KYC flow for compliance review.</div>
          </div>
        </div>
      </header>

      <ProgressRail steps={progressSteps} />

      {error ? (
        <div className="rounded-[26px] border border-rose-400/25 bg-rose-500/12 px-5 py-4 text-[13px] text-rose-100 sm:text-sm">{error}</div>
      ) : null}

      {normalizeStatus(overallStatus) === "REJECTED" ? (
        <div className="rounded-[22px] border border-rose-400/20 bg-[linear-gradient(180deg,rgba(76,17,22,0.94),rgba(50,12,16,0.98))] px-4 py-4 shadow-[0_22px_60px_-44px_rgba(244,63,94,0.25)] sm:rounded-[28px] sm:px-5 sm:py-5">
          <div className="flex items-start gap-3 sm:gap-4">
            <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-200/12 text-rose-100 sm:h-12 sm:w-12 sm:rounded-2xl">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                <path d="M12 3 1.8 20.5c-.3.5.1 1.1.7 1.1h19c.6 0 1-.6.7-1.1zM11 9h2v6h-2zm0 8h2v2h-2z" />
              </svg>
            </div>
            <div>
              <div className="text-[15px] font-bold leading-tight text-rose-50 sm:text-[1.35rem]">Verification Rejected</div>
              <div className="mt-2 max-w-2xl text-[12px] leading-5 text-rose-100/90 sm:text-[14px] sm:leading-6">
                {adminReviewNote || rejectedHistory?.message || "The previous document was rejected. Re-upload a sharper file with all details fully visible and without flash glare."}
              </div>
            </div>
          </div>
        </div>
      ) : normalizeStatus(overallStatus) === "IN_REVIEW" ? (
        <div className="rounded-[22px] border border-amber-400/20 bg-[linear-gradient(180deg,rgba(62,44,8,0.88),rgba(38,30,8,0.98))] px-4 py-4 text-amber-50 shadow-[0_22px_60px_-44px_rgba(251,191,36,0.18)] sm:rounded-[28px] sm:px-5 sm:py-5">
          <div className="text-[13px] font-bold leading-tight sm:text-lg">Documents in Review</div>
          <div className="mt-2 max-w-2xl text-[11px] leading-5 text-amber-100/85 sm:text-[13px] sm:leading-6">{inReviewMessage}</div>
        </div>
      ) : null}

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.35fr)_400px] xl:gap-5">
        <form
          onSubmit={handleSubmit}
          className="min-w-0 space-y-4 rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,#121518,#0b0d10)] p-4 shadow-[0_28px_80px_-52px_rgba(255,216,79,0.16)] sm:space-y-5 sm:rounded-[30px] sm:p-6"
        >
          <div>
            <div className="text-[clamp(1rem,1.6vw,2.35rem)] font-black leading-none tracking-[-0.05em] text-white">Identity Verification</div>
            <p className="mt-2 max-w-2xl text-[12px] leading-5 text-[#b8aa83] sm:mt-3 sm:text-[14px] sm:leading-7">
              Please upload your government-issued ID and supporting files so compliance can complete your review.
            </p>
          </div>
          
          <div className="min-w-0 rounded-[22px] border border-white/8 bg-[#111418] p-4 sm:rounded-[28px] sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cbb98b]">Upload Documents</div>
                <div className="mt-1 text-[11px] text-slate-400 sm:mt-2 sm:text-[13px]">{selectedDocMeta?.hint}</div>
              </div>
              <select
                value={selectedDocMeta?.id ?? ""}
                onChange={(event) => setSelectedDocument(event.target.value)}
                disabled={availableDocumentOptions.length === 0}
                className="w-full rounded-2xl border border-slate-500/35 bg-[#1a1e22] px-4 py-3 text-[11px] text-white outline-none transition focus:border-slate-400/60 sm:max-w-[220px] sm:text-[13px]"
              >
                {availableDocumentOptions.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.label}
                  </option>
                ))}
              </select>
            </div>
            {availableDocumentOptions.length === 0 ? (
              <div className="mt-4 rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 text-[11px] text-slate-300 sm:text-[13px]">
                All available document types for re-upload are already approved or pending review.
              </div>
            ) : null}

            <div className="mt-4 grid min-w-0 gap-3 sm:mt-5 sm:gap-4">
              <UploadSlot
                title={selectedDocMeta?.primaryLabel ?? "Primary document"}
                subtitle={getUploadCardLabel(selectedDocMeta)}
                file={primaryFile}
                existing={primaryExistingDoc}
                required
                inputRef={primaryInputRef}
                onChange={setPrimaryFile}
                onPreview={openPreview}
              />
              <UploadSlot
                title={selectedDocMeta?.secondaryLabel ?? "Secondary document"}
                subtitle="Optional supporting file"
                file={secondaryFile}
                existing={secondaryExistingDoc}
                inputRef={secondaryInputRef}
                onChange={setSecondaryFile}
                onPreview={openPreview}
              />
            </div>
          </div>

          <div className="rounded-[22px] border border-white/8 bg-[#12161a] p-4 sm:rounded-[28px] sm:p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cbb98b]">Notes for reviewer</div>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={4}
              className="mt-3 w-full rounded-[18px] border border-slate-500/35 bg-[#1a1f23] px-4 py-3 text-[11px] text-white outline-none transition placeholder:text-slate-500 focus:border-slate-400/60 sm:mt-4 sm:rounded-[22px] sm:py-4 sm:text-[13px]"
              placeholder="Add any context about your document quality, address format, or recent name changes."
            />
          </div>

          {submitError ? (
            <div className="rounded-[22px] border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-100 sm:text-sm">{submitError}</div>
          ) : null}
          {statusMessage ? (
            <div className="rounded-[22px] border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-100 sm:text-sm">{statusMessage}</div>
          ) : null}

          <Button
            type="submit"
            size="lg"
            disabled={submitting || !allowSubmissions}
            className="w-full rounded-[20px] border-0 bg-[linear-gradient(180deg,#ffe37a,#ffd84f)] py-3.5 text-[14px] font-extrabold text-[#151515] shadow-[0_14px_40px_rgba(255,216,79,0.26)] hover:brightness-105 sm:rounded-[24px] sm:py-4 sm:text-base"
          >
            {submitting ? "Submitting..." : allowSubmissions ? "Submit for Review" : "Select a new document to submit"}
          </Button>
        </form>

        <aside className="min-w-0 space-y-4 sm:space-y-5">
          <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,#121519,#0d1013)] p-4 shadow-[0_24px_70px_-48px_rgba(56,189,248,0.18)] sm:rounded-[30px] sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cbb98b]">Verification Status</div>
                <div className="truncate whitespace-nowrap text-[1rem] font-bold text-white sm:text-[1.35rem]">{formatStatusLabel(overallStatus)}</div>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${badgeTone(overallStatus)}`}>
                Tier {status?.tier ?? 1}
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {progressSteps.map((step) => (
                <div key={step.key} className="min-w-0 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 sm:rounded-[20px] sm:px-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate whitespace-nowrap text-[12px] font-semibold text-white sm:text-[15px]">{step.title}</div>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                      step.status === "complete"
                        ? "bg-emerald-500/15 text-emerald-100"
                        : step.status === "current"
                          ? "bg-[#ffd84f]/15 text-[#ffd84f]"
                          : "bg-white/6 text-slate-400"
                    }`}>
                      {step.status}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-400 sm:text-[13px]">{step.description}</div>
                </div>
              ))}
            </div>
          </div>

          {documents.length > 0 ? (
            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,#121519,#0d1013)] p-4 sm:rounded-[30px] sm:p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cbb98b]">Submitted Files</div>
              <div className="mt-4 space-y-3">
                {documents.slice(0, 4).map((doc) => (
                  <div
                    key={doc.id}
                    className="rounded-[20px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-4 shadow-[0_18px_60px_-46px_rgba(0,0,0,0.35)] sm:rounded-[24px]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-semibold text-white sm:text-[15px]">{doc.filename}</div>
                        <div className="mt-1 text-[11px] text-slate-400 sm:text-xs">
                          {doc.type} • {doc.isSecondary ? "Optional file" : "Primary file"}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${badgeTone(doc.status)}`}>
                        {formatStatusLabel(doc.status)}
                      </span>
                    </div>

                    <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-3 text-[10px] text-slate-500 sm:text-[11px]">
                      <span>{formatDateTime(doc.updatedAt || doc.uploadedAt)}</span>
                      {doc.previewUrl ? (
                        <button
                          type="button"
                          onClick={() => openPreview(doc)}
                          className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 font-semibold text-cyan-100 transition hover:bg-cyan-500/20"
                        >
                          Open preview
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {history.length > 0 ? (
            <div className="rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,#121519,#0d1013)] p-4 sm:rounded-[30px] sm:p-5">
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cbb98b]">Activity Log</div>
              <div className="mt-4 space-y-3">
                {history.slice(0, 4).map((entry) => (
                  <div key={entry.id} className="min-w-0 rounded-[18px] border border-white/8 bg-white/[0.03] px-3 py-3 sm:rounded-[20px] sm:px-4">
                    <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 truncate whitespace-nowrap text-[12px] font-semibold text-white sm:text-[15px]">{entry.event}</div>
                    <div className="shrink-0 text-[10px] text-slate-500 sm:text-[11px]">{formatDateTime(entry.createdAt)}</div>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400 sm:text-[13px]">{entry.message}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </section>

      {loading && !status ? (
        <div className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-3 text-[13px] text-slate-300 sm:text-sm">Loading latest KYC status...</div>
      ) : null}

      <Dialog
        open={Boolean(previewAsset)}
        onClose={() => setPreviewAsset(null)}
        title={previewAsset?.title ?? "Document preview"}
        panelClassName="max-w-5xl p-4 sm:p-6"
        footer={
          previewAsset ? (
            <a
              href={previewAsset.url}
              download={previewAsset.filename || previewAsset.title}
              className="inline-flex items-center justify-center rounded-full border border-[#5a5030] px-4 py-2 text-sm font-semibold text-[#ffd84f] transition hover:border-[#ffd84f] hover:bg-[#ffd84f]/10"
            >
              Download document
            </a>
          ) : null
        }
      >
        <div className="space-y-4 sm:space-y-5">
          {activePreviewDoc ? (
            <div className="rounded-[18px] border border-white/8 bg-white/[0.03] p-3 sm:rounded-[22px] sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="break-words text-sm font-semibold text-white sm:text-base">{activePreviewDoc.filename}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400 sm:text-xs">
                    <span>{activePreviewDoc.type}</span>
                    <span>{formatDocumentRoleLabel(activePreviewDoc)}</span>
                    <span>{formatDateTime(activePreviewDoc.updatedAt || activePreviewDoc.uploadedAt)}</span>
                  </div>
                </div>
                <span className={`w-fit rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${badgeTone(activePreviewDoc.status)}`}>
                  {formatStatusLabel(activePreviewDoc.status)}
                </span>
              </div>
            </div>
          ) : null}

          {isImagePreview(previewAsset) ? (
            <div className="overflow-hidden rounded-[18px] border border-white/8 bg-black/30 sm:rounded-[22px]">
              <img
                src={previewAsset?.url}
                alt={previewAsset?.title || "Proof preview"}
                className="max-h-[52vh] w-full object-contain sm:max-h-[72vh]"
              />
            </div>
          ) : isPdfPreview(previewAsset) ? (
            <div className="overflow-hidden rounded-[18px] border border-white/8 bg-[#0f1216] sm:rounded-[22px]">
            <iframe
              src={previewAsset?.url}
              title={previewAsset?.title || "Document preview"}
              className="h-[50vh] w-full sm:h-[72vh]"
            />
          </div>
        ) : (
          <div className="rounded-[18px] border border-white/8 bg-[#101419] p-4 text-[13px] text-slate-300 sm:rounded-[22px] sm:p-6 sm:text-sm">
            Preview is not available inline for this file type. Use the download button below to view the document.
          </div>
          )}

          {activePreviewDoc?.notes || adminReviewNote ? (
            <div className="grid gap-3 md:grid-cols-2">
              {activePreviewDoc?.notes ? (
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 sm:rounded-[20px]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#cbb98b]">User Review Notes</div>
                  <div className="mt-2 break-words text-[12px] leading-6 text-slate-300 sm:text-[13px]">{activePreviewDoc.notes}</div>
                </div>
              ) : null}
              {adminReviewNote ? (
                <div className="rounded-[18px] border border-white/8 bg-white/[0.03] px-4 py-3 sm:rounded-[20px]">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#cbb98b]">Admin Review Notes</div>
                  <div className="mt-2 break-words text-[12px] leading-6 text-slate-300 sm:text-[13px]">{adminReviewNote}</div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
