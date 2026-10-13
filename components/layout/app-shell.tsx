"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import {
  Bell,
  ChevronsUpDown,
  LogOut,
  Menu,
  Moon,
  Search,
  Store,
  Sun,
  TriangleAlert,
  X,
} from "lucide-react";
import { iconFor } from "./icons";
import { useWorkspace, type NavItem } from "./workspace";
import { useTheme } from "@/components/system/theme-provider";
import { Badge } from "@/components/ui";
import { api } from "@/lib/api/client";
import { fmtTime } from "@/lib/format";

const SECTION_LABELS: Record<NavItem["section"], string> = {
  operate: "Operar",
  manage: "Gerir",
  analyze: "Analisar",
  configure: "Configurar",
};

const SECTION_ORDER: NavItem["section"][] = ["operate", "manage", "analyze", "configure"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const workspace = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<
    { id: string; title: string; severity: string; created_at: number; read_at: number | null }[]
  >([]);

  // Notification polling (30s) — cheap COUNT + recent list
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await api<{
          unread: number;
          rows: { id: string; title: string; severity: string; created_at: number; read_at: number | null }[];
        }>("/api/notifications", { query: { limit: 8 } });
        if (!alive) return;
        setUnread(data.unread);
        setNotifications(data.rows);
      } catch {
        /* notifications are best-effort */
      }
    };
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [pathname]);

  useEffect(() => setSidebarOpen(false), [pathname]);

  const grouped = SECTION_ORDER.map((section) => ({
    section,
    items: workspace.navigation
      .filter((n) => n.section === section)
      .sort((a, b) => a.order - b.order),
  })).filter((g) => g.items.length > 0);

  const branchTerminals = workspace.terminals.filter((t) => t.branchId === workspace.branchId);

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-graphite-700 bg-graphite-850 dark:bg-graphite-950">
      <div className="flex items-center gap-2 px-4 py-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-lime-brand font-mono text-sm font-black text-graphite-900">
            V
          </span>
          <span className="font-mono text-sm font-bold tracking-widest text-mist-100">
            VANTYX<span className="align-super text-[8px]">®</span>
          </span>
        </Link>
        <button
          className="ml-auto rounded p-1 text-graphite-400 hover:text-mist-100 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Fechar menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-y border-graphite-700/60 px-3 py-2.5">
        <p className="truncate text-xs font-semibold text-mist-100">{workspace.org.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <p className="truncate text-[11px] text-graphite-400">{workspace.org.industryLabel}</p>
          {workspace.org.demo && <Badge tone="warning">DEMO</Badge>}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Navegação principal">
        {grouped.map((group) => (
          <div key={group.section} className="mb-4">
            <p className="px-2 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-graphite-500">
              {SECTION_LABELS[group.section]}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = iconFor(item.icon);
                const active =
                  pathname === item.path ||
                  (item.path !== "/dashboard" && pathname.startsWith(item.path));
                return (
                  <li key={item.path + item.label}>
                    <Link
                      href={item.path}
                      aria-current={active ? "page" : undefined}
                      className={clsx(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
                        active
                          ? "bg-graphite-700/70 text-lime-brand"
                          : "text-graphite-300 hover:bg-graphite-800 hover:text-mist-100",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-graphite-700/60 px-4 py-3">
        <p className="font-mono text-[9px] tracking-wider text-graphite-500">
          ONE PLATFORM · EVERY BUSINESS
        </p>
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-mist-50 text-graphite-900 dark:bg-graphite-900 dark:text-mist-100">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">{sidebar}</div>
      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="absolute inset-y-0 left-0">{sidebar}</div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-13 shrink-0 items-center gap-2 border-b border-mist-200 bg-white px-3 dark:border-graphite-700 dark:bg-graphite-850">
          <button
            className="rounded p-1.5 text-graphite-500 hover:bg-mist-100 dark:hover:bg-graphite-700 lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Branch selector */}
          <div className="relative flex items-center gap-1.5 rounded-md border border-mist-200 px-2 py-1 dark:border-graphite-600">
            <Store className="h-3.5 w-3.5 text-graphite-400" />
            <select
              aria-label="Filial"
              value={workspace.branchId}
              onChange={(e) => workspace.setBranchId(e.target.value)}
              className="max-w-[10rem] bg-transparent text-xs font-medium outline-none"
            >
              {workspace.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Terminal selector */}
          {branchTerminals.length > 0 && (
            <div className="relative hidden items-center gap-1.5 rounded-md border border-mist-200 px-2 py-1 sm:flex dark:border-graphite-600">
              <ChevronsUpDown className="h-3.5 w-3.5 text-graphite-400" />
              <select
                aria-label="Terminal"
                value={workspace.terminalId ?? ""}
                onChange={(e) => workspace.setTerminalId(e.target.value || null)}
                className="max-w-[9rem] bg-transparent text-xs font-medium outline-none"
              >
                <option value="">Terminal…</option>
                {branchTerminals.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex-1" />

          {/* Global search shortcut → products/POS */}
          <Link
            href="/products"
            className="hidden items-center gap-1.5 rounded-md border border-mist-200 px-2.5 py-1.5 text-xs text-graphite-400 hover:border-graphite-400 md:flex dark:border-graphite-600"
            aria-label="Pesquisa global"
          >
            <Search className="h-3.5 w-3.5" />
            Pesquisar…
          </Link>

          {/* Notifications */}
          <div className="relative">
            <button
              className="relative rounded-md p-1.5 text-graphite-500 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700"
              onClick={() => setNotifOpen((v) => !v)}
              aria-label={`Notificações (${unread} por ler)`}
            >
              <Bell className="h-4.5 w-4.5" />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-0.5 text-[9px] font-bold text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="animate-slide-in absolute right-0 top-10 z-50 w-80 rounded-[10px] border border-mist-200 bg-white shadow-xl dark:border-graphite-600 dark:bg-graphite-800">
                <div className="flex items-center justify-between border-b border-mist-200 px-3 py-2 dark:border-graphite-700">
                  <p className="text-xs font-semibold">Notificações</p>
                  <button
                    className="text-[11px] text-graphite-400 hover:text-lime-dim"
                    onClick={async () => {
                      await api("/api/notifications", { method: "POST", body: { action: "read_all" } });
                      setUnread(0);
                      setNotifications((n) => n.map((x) => ({ ...x, read_at: Date.now() })));
                    }}
                  >
                    Marcar todas como lidas
                  </button>
                </div>
                <ul className="max-h-80 divide-y divide-mist-100 overflow-y-auto dark:divide-graphite-700">
                  {notifications.length === 0 && (
                    <li className="px-3 py-6 text-center text-xs text-graphite-400">
                      Sem notificações.
                    </li>
                  )}
                  {notifications.map((n) => (
                    <li key={n.id} className={clsx("px-3 py-2", !n.read_at && "bg-lime-brand/5")}>
                      <div className="flex items-start gap-2">
                        {n.severity !== "info" && (
                          <TriangleAlert
                            className={clsx(
                              "mt-0.5 h-3.5 w-3.5 shrink-0",
                              n.severity === "critical" ? "text-danger" : "text-warning",
                            )}
                          />
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{n.title}</p>
                          <p className="text-[10px] text-graphite-400">{fmtTime(n.created_at)}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="border-t border-mist-200 p-2 dark:border-graphite-700">
                  <Link
                    href="/notifications"
                    className="block rounded px-2 py-1 text-center text-xs font-medium text-graphite-500 hover:bg-mist-100 dark:hover:bg-graphite-700"
                    onClick={() => setNotifOpen(false)}
                  >
                    Ver centro de notificações
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* Theme */}
          <button
            className="rounded-md p-1.5 text-graphite-500 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700"
            onClick={toggle}
            aria-label="Alternar tema"
          >
            {theme === "dark" ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
          </button>

          {/* User menu */}
          <div className="relative">
            <button
              className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-mist-100 dark:hover:bg-graphite-700"
              onClick={() => setUserMenuOpen((v) => !v)}
              aria-label="Menu do utilizador"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-graphite-900 text-xs font-bold text-lime-brand dark:bg-graphite-700">
                {workspace.user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden text-left md:block">
                <span className="block text-xs font-semibold leading-tight">{workspace.user.name}</span>
                <span className="block text-[10px] leading-tight text-graphite-400">
                  {workspace.user.roleName}
                </span>
              </span>
            </button>
            {userMenuOpen && (
              <div className="animate-slide-in absolute right-0 top-11 z-50 w-56 rounded-[10px] border border-mist-200 bg-white p-1.5 shadow-xl dark:border-graphite-600 dark:bg-graphite-800">
                <div className="border-b border-mist-200 px-2.5 pb-2 pt-1 dark:border-graphite-700">
                  <p className="text-xs font-semibold">{workspace.user.name}</p>
                  <p className="truncate text-[11px] text-graphite-400">{workspace.user.email}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-graphite-400">
                    {workspace.user.roleName} · {workspace.org.industryLabel}
                  </p>
                </div>
                <Link
                  href="/settings"
                  className="mt-1 block rounded px-2.5 py-1.5 text-xs hover:bg-mist-100 dark:hover:bg-graphite-700"
                  onClick={() => setUserMenuOpen(false)}
                >
                  Definições
                </Link>
                <button
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-danger hover:bg-red-500/10"
                  onClick={async () => {
                    await api("/api/auth/logout", { method: "POST", body: {} });
                    router.push("/login");
                    router.refresh();
                  }}
                >
                  <LogOut className="h-3.5 w-3.5" /> Terminar sessão
                </button>
              </div>
            )}
          </div>
        </header>

        {!workspace.org.onboarded && (
          <div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs">
            <TriangleAlert className="h-3.5 w-3.5 text-warning" />
            <span>Configuração inicial incompleta.</span>
            <Link href="/onboarding?continue=1" className="font-semibold underline">
              Continuar onboarding
            </Link>
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* Close popovers on outside click */}
      {(notifOpen || userMenuOpen) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setNotifOpen(false);
            setUserMenuOpen(false);
          }}
        />
      )}
    </div>
  );
}
