import type { TimedFeedback } from "../hooks/useTimedFeedback";

export default function InlineFeedback({
  feedback,
  className = "",
}: {
  feedback?: TimedFeedback | null;
  className?: string;
}) {
  if (!feedback) return null;

  const toneClass =
    feedback.tone === "success"
      ? "text-[var(--success)]"
      : feedback.tone === "error"
        ? "text-[var(--danger)]"
        : "text-[var(--accent-yellow)]";

  return <div className={`${toneClass} ${className}`.trim()}>{feedback.text}</div>;
}
