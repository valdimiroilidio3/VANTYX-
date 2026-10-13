"use client";

/**
 * KDS — Kitchen Display System. Polling a cada 6s. Tickets e linhas são
 * persistidos no servidor (criados quando os itens são enviados), pelo que
 * um refresh nunca perde estado. Tempos: envio → em preparação → pronto.
 */

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { AlarmClock, ChefHat, CheckCheck, Play, RefreshCw, Truck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { Badge, Button, EmptyState } from "@/components/ui";
import { api } from "@/lib/api/client";
import { fmtAge, fmtQty } from "@/lib/format";

interface TicketLine {
  id: string;
  name: string;
  qty_milli: number;
  unit: string;
  modifiers: string;
  notes: string | null;
  sequence: number;
}

interface Ticket {
  id: string;
  sequence: number;
  station: string;
  status: "pending" | "preparing" | "ready" | "delivered";
  table_label: string | null;
  channel: string | null;
  sent_at: number;
  started_at: number | null;
  ready_at: number | null;
  order_id: string;
  ageMs: number;
  lines: TicketLine[];
}

const STATIONS = [
  { key: "", label: "Todas" },
  { key: "kitchen", label: "Cozinha" },
  { key: "grill", label: "Grelhador" },
  { key: "cold", label: "Frios" },
  { key: "bar", label: "Bar" },
];

const CHANNEL_LABELS: Record<string, string> = {
  dine_in: "Mesa",
  takeaway: "Takeaway",
  counter: "Balcão",
  delivery: "Entrega",
};

function ageTone(ageMs: number, status: string) {
  if (status === "ready") return "border-green-500/60 bg-green-500/10";
  const min = ageMs / 60000;
  if (min > 20) return "border-red-500/70 bg-red-500/10";
  if (min > 10) return "border-amber-500/60 bg-amber-500/10";
  return "border-mist-200 bg-white dark:border-graphite-600 dark:bg-graphite-850";
}

export default function KitchenPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const [station, setStation] = useState("");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, forceTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const rows = await api<Ticket[]>("/api/restaurant/kitchen", {
        query: { station: station || undefined },
      });
      setTickets(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar tickets");
    } finally {
      setLoading(false);
    }
  }, [station, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Polling + 1s tick for live age counters
  useEffect(() => {
    if (!autoRefresh) return;
    const poll = setInterval(load, 6_000);
    const tick = setInterval(() => forceTick((t) => t + 1), 1_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [autoRefresh, load]);

  async function setStatus(ticketId: string, status: "preparing" | "ready" | "delivered") {
    // Optimistic update; rollback on failure
    const prev = tickets;
    setTickets((list) =>
      list.map((t) =>
        t.id === ticketId
          ? { ...t, status, started_at: t.started_at ?? (status === "preparing" ? Date.now() : t.started_at), ready_at: status === "ready" ? Date.now() : t.ready_at }
          : t,
      ).filter((t) => (status === "delivered" ? t.status !== "delivered" || t.id !== ticketId : true)),
    );
    try {
      await api("/api/restaurant/kitchen", { method: "POST", body: { ticketId, status } });
      if (status === "delivered") load();
    } catch (err) {
      setTickets(prev);
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar ticket");
    }
  }

  const counts = {
    pending: tickets.filter((t) => t.status === "pending").length,
    preparing: tickets.filter((t) => t.status === "preparing").length,
    ready: tickets.filter((t) => t.status === "ready").length,
  };

  return (
    <>
      <PageHeader
        title="Cozinha (KDS)"
        subtitle={`${counts.pending} pendentes · ${counts.preparing} em preparação · ${counts.ready} prontos`}
        actions={
          <>
            <Button
              variant={autoRefresh ? "accent" : "secondary"}
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
              icon={<RefreshCw className={clsx("h-3.5 w-3.5", autoRefresh && "animate-spin")} />}
            >
              {autoRefresh ? "Auto" : "Manual"}
            </Button>
            <Button variant="secondary" size="sm" onClick={load}>
              Atualizar
            </Button>
          </>
        }
      />

      <div className="flex gap-1.5 border-b border-mist-200 bg-white px-3 py-2 dark:border-graphite-700 dark:bg-graphite-850">
        {STATIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setStation(s.key)}
            className={clsx(
              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
              station === s.key
                ? "bg-graphite-900 text-lime-brand dark:bg-graphite-700"
                : "text-graphite-500 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="p-3">
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState
            title="Sem tickets ativos"
            message="Os tickets aparecem aqui automaticamente quando a sala envia itens (persistidos no servidor)."
            icon={<ChefHat className="h-8 w-8" />}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {tickets.map((t) => {
              const age = Date.now() - t.sent_at;
              return (
                <article
                  key={t.id}
                  className={clsx("flex flex-col rounded-lg border-2 shadow-sm", ageTone(age, t.status))}
                >
                  <header className="flex items-center gap-2 border-b border-current/10 px-3 py-2">
                    <span className="font-mono text-lg font-black tabular-nums">#{t.sequence}</span>
                    <span className="text-xs font-semibold">
                      {t.table_label ? `Mesa ${t.table_label}` : CHANNEL_LABELS[t.channel ?? ""] ?? t.channel ?? "—"}
                    </span>
                    <Badge tone={t.status === "ready" ? "success" : t.status === "preparing" ? "warning" : "neutral"} className="ml-auto">
                      {t.status === "pending" ? "novo" : t.status === "preparing" ? "em preparação" : "pronto"}
                    </Badge>
                  </header>

                  <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] text-graphite-500 dark:text-graphite-300">
                    <span className={clsx("flex items-center gap-1 font-mono font-bold tabular-nums", age > 20 * 60000 && t.status !== "ready" ? "text-danger" : age > 10 * 60000 && t.status !== "ready" ? "text-warning" : "")}>
                      <AlarmClock className="h-3 w-3" />
                      {fmtAge(age)}
                    </span>
                    <span className="uppercase tracking-wide">{t.station}</span>
                    {t.started_at && <span>iniciado {fmtAge(Date.now() - t.started_at)} atrás</span>}
                  </div>

                  <ul className="flex-1 space-y-1.5 px-3 pb-2">
                    {t.lines.map((l) => {
                      const mods = JSON.parse(l.modifiers || "[]") as { name: string }[];
                      return (
                        <li key={l.id}>
                          <p className="text-sm font-bold leading-tight">
                            <span className="mr-1.5 font-mono text-base text-lime-dim dark:text-lime-brand">{fmtQty(l.qty_milli)}×</span>
                            {l.name}
                          </p>
                          {mods.map((m, i) => (
                            <p key={i} className="pl-7 text-[11px] leading-tight text-graphite-400">+ {m.name}</p>
                          ))}
                          {l.notes && (
                            <p className="pl-7 text-[11px] font-semibold italic leading-tight text-warning">“{l.notes}”</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <footer className="flex gap-1.5 border-t border-current/10 p-2">
                    {t.status === "pending" && (
                      <Button variant="secondary" size="sm" className="flex-1" onClick={() => setStatus(t.id, "preparing")} icon={<Play className="h-3.5 w-3.5" />}>
                        Iniciar
                      </Button>
                    )}
                    {(t.status === "pending" || t.status === "preparing") && (
                      <Button variant="accent" size="sm" className="flex-1" onClick={() => setStatus(t.id, "ready")} icon={<CheckCheck className="h-3.5 w-3.5" />}>
                        Pronto
                      </Button>
                    )}
                    {t.status === "ready" && (
                      <Button variant="primary" size="sm" className="flex-1" onClick={() => setStatus(t.id, "delivered")} icon={<Truck className="h-3.5 w-3.5" />}>
                        Entregue
                      </Button>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
      {!workspace.can("restaurant.kitchen") && (
        <p className="px-4 pb-4 text-center text-[11px] text-graphite-400">
          A sua função pode ver o KDS, mas as atualizações de estado exigem permissão restaurant.kitchen.
        </p>
      )}
    </>
  );
}
