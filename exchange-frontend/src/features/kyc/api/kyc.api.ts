import api from "../../../app/axios";
import { KYC_ENDPOINTS } from "../../../app/apiRoutes";

type ApiEnvelope<T> = { data: T };

const unwrap = <T,>(payload: T | ApiEnvelope<T>): T => {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
};

export type KycStepStatus = "PENDING" | "IN_REVIEW" | "APPROVED" | "REJECTED";

export type KycStep = {
  code: string;
  title: string;
  description: string;
  status: KycStepStatus;
  completedAt?: string | null;
};

export type KycDocument = {
  id: string;
  type: string;
  filename: string;
  mimeType?: string;
  isSecondary?: boolean;
  previewUrl?: string;
  storageUrl?: string;
  status: KycStepStatus;
  uploadedAt: string;
  updatedAt?: string;
  notes?: string | null;
};

export type KycStatusResponse = {
  userId: number;
  overallStatus: KycStepStatus;
  tier: number;
  dateOfBirth?: string | null;
  steps: KycStep[];
  documents: KycDocument[];
  notes?: string | null;
  resubmissionRequired?: boolean;
  kycVerified?: boolean;
  profileBasicsComplete?: boolean;
  missingProfileFields?: string[];
  canSubmitDocuments?: boolean;
  allowedDocumentTypes?: string[];
  uploadBlockedReason?: string | null;
};

export type KycHistoryEntry = {
  id: string;
  event: string;
  message: string;
  metadata?: Record<string, unknown> | string | null;
  createdAt: string;
};

export const fetchKycStatus = async (): Promise<KycStatusResponse> => {
  const response = await api.get(KYC_ENDPOINTS.status);
  return unwrap<KycStatusResponse>(response.data);
};

export const fetchKycHistory = async (): Promise<KycHistoryEntry[]> => {
  const response = await api.get(KYC_ENDPOINTS.history);
  return unwrap<KycHistoryEntry[]>(response.data);
};

export type SubmitDocumentsPayload = {
  documentType: string;
  primary: File;
  secondary?: File | null;
  notes?: string;
  dateOfBirth?: string | null;
};

export type SubmitDocumentsResponse = {
  submissionId: string;
  status: KycStepStatus;
  message?: string;
};

export const submitKycDocuments = async ({
  documentType,
  primary,
  secondary,
  notes,
  dateOfBirth,
}: SubmitDocumentsPayload): Promise<SubmitDocumentsResponse> => {
  const formData = new FormData();
  formData.append("documentType", documentType);
  formData.append("primary", primary);
  if (secondary) {
    formData.append("secondary", secondary);
  }
  if (notes) {
    formData.append("notes", notes);
  }
  if (dateOfBirth) {
    formData.append("dateOfBirth", dateOfBirth);
  }

  const response = await api.post(KYC_ENDPOINTS.documents, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return unwrap<SubmitDocumentsResponse>(response.data);
};
