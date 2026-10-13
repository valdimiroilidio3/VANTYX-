"use client";

/**
 * VANTYX design system — productivity-first primitives.
 * Consistent across every module; dark/light aware; keyboard accessible.
 */

import { clsx } from "clsx";
import { X, Loader2, Inbox, ChevronLeft, ChevronRight } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/* ------------------------------ Button ------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-graphite-900 text-mist-50 hover:bg-graphite-700 dark:bg-mist-100 dark:text-graphite-900 dark:hover:bg-white border border-transparent",
  accent:
    "bg-lime-brand text-graphite-900 hover:bg-lime-soft border border-transparent font-semibold",
  secondary:
    "bg-white text-graphite-800 border border-mist-300 hover:bg-mist-100 dark:bg-graphite-800 dark:text-mist-100 dark:border-graphite-600 dark:hover:bg-graphite-700",
  ghost:
    "bg-transparent text-graphite-600 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700 border border-transparent",
  danger:
    "bg-danger text-white hover:bg-red-600 border border-transparent",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9.5 px-3.5 text-sm",
  lg: "h-11 px-5 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        buttonStyles[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ------------------------------ Inputs ------------------------------ */

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx("input-base", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx("input-base resize-y", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx("input-base pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label-base">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-graphite-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-danger">{error}</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-lime-brand" : "bg-graphite-500 dark:bg-graphite-600",
      )}
    >
      <span
        className={clsx(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}

/* ------------------------------ Surfaces ------------------------------ */

export function Card({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("card", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-mist-200 px-4 py-3 dark:border-graphite-700">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-graphite-400">{icon}</span>}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-graphite-400">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const badgeTones: Record<BadgeTone, string> = {
  neutral:
    "bg-mist-200 text-graphite-700 dark:bg-graphite-700 dark:text-mist-200",
  success: "bg-green-500/15 text-green-600 dark:text-green-400",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  danger: "bg-red-500/15 text-red-600 dark:text-red-400",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  accent: "bg-lime-brand/20 text-lime-dim dark:text-lime-brand",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------- Modal -------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={clsx(
          "animate-slide-in card flex max-h-[90vh] w-full flex-col overflow-hidden",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-mist-200 px-4 py-3 dark:border-graphite-700">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-graphite-400 hover:bg-mist-100 hover:text-graphite-900 dark:hover:bg-graphite-700 dark:hover:text-mist-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-mist-200 px-4 py-3 dark:border-graphite-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- States -------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} />;
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="text-graphite-400">{icon ?? <Inbox className="h-8 w-8" />}</span>
      <p className="text-sm font-semibold">{title}</p>
      {message && (
        <p className="max-w-sm text-xs leading-relaxed text-graphite-400">{message}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      <p className="text-sm font-medium text-danger">{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/* -------------------------------- Tabs --------------------------------- */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-mist-200 dark:border-graphite-700">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={clsx(
            "relative whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors",
            active === t.key
              ? "text-graphite-900 dark:text-lime-brand"
              : "text-graphite-400 hover:text-graphite-700 dark:hover:text-mist-200",
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 rounded-full bg-mist-200 px-1.5 py-0.5 text-[10px] font-semibold text-graphite-600 dark:bg-graphite-700 dark:text-graphite-300">
              {t.count}
            </span>
          )}
          {active === t.key && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-lime-brand" />
          )}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ Pagination ------------------------------ */

export function Pagination({
  total,
  limit,
  offset,
  onOffset,
}: {
  total: number;
  limit: number;
  offset: number;
  onOffset: (offset: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-2 text-xs text-graphite-400">
      <span>
        {total} registos · página {page}/{pages}
      </span>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={offset <= 0}
          onClick={() => onOffset(Math.max(0, offset - limit))}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={offset + limit >= total}
          onClick={() => onOffset(offset + limit)}
          aria-label="Página seguinte"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------- Stat ---------------------------------- */

export function Stat({
  label,
  value,
  delta,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  delta?: { bps: number; label?: string };
  hint?: string;
  tone?: "default" | "accent";
}) {
  const deltaPct = delta ? delta.bps / 100 : null;
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-graphite-400">
        {label}
      </p>
      <p
        className={clsx(
          "mt-1 font-mono text-xl font-semibold tabular-nums",
          tone === "accent" && "text-lime-dim dark:text-lime-brand",
        )}
      >
        {value}
      </p>
      <div className="mt-0.5 flex items-center gap-2">
        {deltaPct !== null && (
          <span
            className={clsx(
              "text-xs font-semibold tabular-nums",
              deltaPct > 0 ? "text-success" : deltaPct < 0 ? "text-danger" : "text-graphite-400",
            )}
          >
            {deltaPct > 0 ? "▲" : deltaPct < 0 ? "▼" : "■"} {Math.abs(deltaPct).toFixed(1)}%
          </span>
        )}
        {(hint || delta?.label) && (
          <span className="truncate text-[11px] text-graphite-400">{delta?.label ?? hint}</span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------- Confirm hook ------------------------------ */

const ConfirmContext = createContext<
  (opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>
>(() => Promise.resolve(false));

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger: boolean;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = (opts: {
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
  }) =>
    new Promise<boolean>((resolve) => {
      setState({
        title: opts.title,
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? "Confirmar",
        danger: opts.danger ?? false,
        resolve,
      });
    });

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={state !== null}
        onClose={() => {
          state?.resolve(false);
          setState(null);
        }}
        title={state?.title ?? ""}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                state?.resolve(false);
                setState(null);
              }}
            >
              Cancelar
            </Button>
            <Button
              variant={state?.danger ? "danger" : "accent"}
              onClick={() => {
                state?.resolve(true);
                setState(null);
              }}
            >
              {state?.confirmLabel}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-graphite-500 dark:text-graphite-300">
          {state?.message}
        </p>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
