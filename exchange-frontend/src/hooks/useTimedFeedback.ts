import { useCallback, useEffect, useState } from "react";

export type TimedFeedback = {
  tone: "success" | "error" | "info";
  text: string;
};

const DEFAULT_TIMEOUT_MS = 60_000;

export function useTimedFeedback(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const [feedback, setFeedbackState] = useState<TimedFeedback | null>(null);

  useEffect(() => {
    if (!feedback) return;
    const timeoutId = window.setTimeout(() => setFeedbackState(null), timeoutMs);
    return () => window.clearTimeout(timeoutId);
  }, [feedback, timeoutMs]);

  const setFeedback = useCallback((next: TimedFeedback | null) => {
    setFeedbackState(next);
  }, []);

  const clearFeedback = useCallback(() => {
    setFeedbackState(null);
  }, []);

  return { feedback, setFeedback, clearFeedback };
}
