import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
};

export default function Dialog({ open, onClose, title, children, footer, panelClassName = "" }: DialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
      <div
        className="absolute inset-0"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className={`relative z-10 w-full max-w-md rounded-[18px] border border-[var(--border-yellow)] bg-[linear-gradient(180deg,#181A20_0%,#14151A_100%)] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.45)] ${panelClassName}`.trim()}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[var(--border-soft)] bg-white/5 px-2 py-1 text-sm text-[var(--text-secondary)] hover:border-[var(--border-yellow)] hover:text-white"
            aria-label="Close dialog"
          >
            &times;
          </button>
        </div>
        {children ? <div className="mt-4 text-sm text-slate-200">{children}</div> : null}
        {footer ? <div className="mt-6 flex flex-wrap items-center justify-end gap-3">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
