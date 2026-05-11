// src/ui/Input.tsx
import * as React from "react";

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

const Input = React.forwardRef<HTMLInputElement, Props>(
  ({ className = "", type = "text", ...props }, ref) => {
    const isFileInput = type === "file";
    return (
      <input
        ref={ref}
        type={type}
        {...props}
        className={`h-10 w-full rounded-[10px] border border-[rgba(148,163,184,0.26)] bg-[var(--bg-input)] px-3 text-sm text-white placeholder:text-[var(--text-muted)] transition focus:border-[rgba(148,163,184,0.52)] focus:outline-none focus:shadow-[0_0_0_3px_rgba(148,163,184,0.12)] ${
          isFileInput ? "py-1 text-[var(--text-secondary)] file:text-white" : ""
        } ${className}`}
      />
    );
  }
);

Input.displayName = "Input";
export default Input;
