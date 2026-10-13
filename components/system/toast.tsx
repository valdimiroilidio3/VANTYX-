"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { clsx } from "clsx";

type ToastKind = "success" | "error" | "warning" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-4), { id, kind, title, message }]);
      setTimeout(() => remove(id), kind === "error" ? 7000 : 4200);
    },
    [remove],
  );

  const value: ToastContextValue = {
    push,
    success: (t, m) => push("success", t, m),
    error: (t, m) => push("error", t, m),
    warning: (t, m) => push("warning", t, m),
    info: (t, m) => push("info", t, m),
  };

  const icons: Record<ToastKind, ReactNode> = {
    success: <CheckCircle2 className="h-4 w-4 text-success" />,
    error: <XCircle className="h-4 w-4 text-danger" />,
    warning: <AlertTriangle className="h-4 w-4 text-warning" />,
    info: <Info className="h-4 w-4 text-info" />,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              "animate-slide-in pointer-events-auto flex items-start gap-2.5 rounded-[10px] border p-3 shadow-lg backdrop-blur",
              "border-graphite-700 bg-graphite-800/95 text-mist-100",
            )}
          >
            <span className="mt-0.5 shrink-0">{icons[t.kind]}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{t.title}</p>
              {t.message && (
                <p className="mt-0.5 text-xs leading-snug text-graphite-300">
                  {t.message}
                </p>
              )}
            </div>
            <button
              onClick={() => remove(t.id)}
              className="shrink-0 rounded p-0.5 text-graphite-400 hover:text-mist-100"
              aria-label="Fechar notificação"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
