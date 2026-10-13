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
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mist-200 bg-white px-4 py-3 dark:border-graphite-700 dark:bg-graphite-850">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-xs text-graphite-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
