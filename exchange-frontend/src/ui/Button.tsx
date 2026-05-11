import * as React from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
export type Size = 'xs' | 'sm' | 'md' | 'lg';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  className?: string;
  variant?: Variant;
  size?: Size;
};

const baseCls =
  "inline-flex items-center justify-center rounded-[10px] font-semibold transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(252,213,53,0.45)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#11141A] disabled:cursor-not-allowed disabled:opacity-60";

const variantCls: Record<Variant, string> = {
  primary:
    "border border-transparent bg-[var(--accent-yellow)] text-[#111] shadow-[0_12px_26px_rgba(252,213,53,0.18)] hover:bg-[var(--accent-yellow-hover)]",
  secondary:
    "border border-[var(--border-yellow)] bg-transparent text-[var(--accent-yellow)] hover:border-[var(--border-yellow-strong)] hover:bg-[rgba(252,213,53,0.08)]",
  ghost:
    "border border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-white",
  danger:
    "border border-[rgba(246,70,93,0.25)] bg-[rgba(246,70,93,0.12)] text-[var(--danger)] hover:bg-[rgba(246,70,93,0.18)]",
};

const sizeClasses: Record<Size, string> = {
  xs: 'h-7 px-2 text-xs',
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-base',
};

const Button = React.forwardRef<HTMLButtonElement, Props>(
  (
    {
      className = "",
      variant = "primary",
      size = "md",
      type = "button",
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        {...props}
        className={`${baseCls} ${variantCls[variant]} ${sizeClasses[size]} ${className}`}
      />
    );
  }
);

Button.displayName = "Button";
export default Button;
