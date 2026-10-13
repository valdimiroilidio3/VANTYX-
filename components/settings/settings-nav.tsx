"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";

export type SettingsTabId =
  | "profile"
  | "modules"
  | "team"
  | "structure"
  | "approvals"
  | "audit";

const TAB_LABELS: Record<SettingsTabId, string> = {
  profile: "Perfil",
  modules: "Módulos",
  team: "Equipa",
  structure: "Estrutura",
  approvals: "Aprovações",
  audit: "Auditoria",
};

const ACTIVE = "bg-lime-brand text-graphite-900 font-semibold";
const IDLE =
  "text-graphite-600 hover:bg-mist-100 hover:text-graphite-900 dark:text-graphite-300 dark:hover:bg-graphite-700 dark:hover:text-mist-100";

/**
 * Settings navigation: internal tabs of /settings (buttons) + the three
 * dedicated sub-pages (links). Works standalone on sub-pages (no tab props).
 */
export function SettingsNav({ tab, onTab }: { tab?: SettingsTabId; onTab?: (t: SettingsTabId) => void }) {
  const pathname = usePathname();
  const isMain = pathname === "/settings";
  return (
    <nav className="no-scrollbar mb-5 flex gap-1 overflow-x-auto rounded-lg border border-mist-200 bg-white p-1 dark:border-graphite-700 dark:bg-graphite-850">
      {(Object.keys(TAB_LABELS) as SettingsTabId[]).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => {
            if (isMain) onTab?.(t);
            else window.location.assign(`/settings?tab=${t}`);
          }}
          className={clsx(
            "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors",
            isMain && tab === t ? ACTIVE : IDLE,
          )}
        >
          {TAB_LABELS[t]}
        </button>
      ))}
      <Link
        href="/settings/rules"
        className={clsx("shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors", pathname === "/settings/rules" ? ACTIVE : IDLE)}
      >
        Regras
      </Link>
      <Link
        href="/settings/integrations"
        className={clsx(
          "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors",
          pathname === "/settings/integrations" ? ACTIVE : IDLE,
        )}
      >
        Integrações
      </Link>
      <Link
        href="/settings/fiscal"
        className={clsx("shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors", pathname === "/settings/fiscal" ? ACTIVE : IDLE)}
      >
        Fiscal
      </Link>
    </nav>
  );
}
