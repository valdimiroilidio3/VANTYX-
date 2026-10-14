import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="glass-strong sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-x-0 border-t-0 px-4 py-3.5">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-xs text-graphite-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
