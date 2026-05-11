import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchKycHistory,
  fetchKycStatus,
  submitKycDocuments,
} from "../api/kyc.api";
import type {
  KycHistoryEntry,
  KycStatusResponse,
  SubmitDocumentsPayload,
  SubmitDocumentsResponse,
} from "../api/kyc.api";

type LoadingState = "idle" | "loading" | "error";

const parseError = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const err = error as {
      message?: string;
      response?: { data?: { message?: string } };
    };
    return err.response?.data?.message ?? err.message ?? "Unable to load KYC status.";
  }
  return "Unable to load KYC status.";
};

export type UseKycData = {
  loading: boolean;
  status?: KycStatusResponse;
  history: KycHistoryEntry[];
  error?: string;
  refetch: () => void;
  submitDocuments: (payload: SubmitDocumentsPayload) => Promise<SubmitDocumentsResponse>;
};

export const useKycData = (): UseKycData => {
  const [status, setStatus] = useState<KycStatusResponse | undefined>();
  const [history, setHistory] = useState<KycHistoryEntry[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [refreshIndex, setRefreshIndex] = useState(0);

  const load = useCallback(async () => {
    setLoadingState("loading");
    setError(undefined);
    try {
      const [statusResp, historyResp] = await Promise.all([fetchKycStatus(), fetchKycHistory()]);
      setStatus(statusResp);
      setHistory(historyResp);
      setLoadingState("idle");
    } catch (err) {
      setError(parseError(err));
      setLoadingState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshIndex]);

  const refetch = useCallback(() => {
    setRefreshIndex((index) => index + 1);
  }, []);

  const submit = useCallback(
    async (payload: SubmitDocumentsPayload) => {
      const response = await submitKycDocuments(payload);
      await load();
      return response;
    },
    [load]
  );

  return useMemo(
    () => ({
      loading: loadingState === "loading" && !status,
      status,
      history,
      error,
      refetch,
      submitDocuments: submit,
    }),
    [loadingState, status, history, error, refetch, submit]
  );
};
