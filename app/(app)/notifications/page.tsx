"use client";

/** Centro de notificações — alertas reais (stock, validades, caixa, regras, sincronização). */

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { Bell, CheckCheck, RefreshCw, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/system/toast";
import { Badge, Button, EmptyState, Pagination, Toggle } from "@/components/ui";
import { api } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format";

interface NotificationRow {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string | null;
  ref_type: string | null;
  ref_id: string | null;
  read_at: number | null;
  created_at: number;
}

const PAGE_SIZE = 30;

const KIND_LABELS: Record<string, string> = {
  "stock.below_min": "stock abaixo do mínimo",
  "stock.negative": "stock negativo",
  "batch.expiring": "validades",
  "cash.difference": "caixa",
  "rule.blocked": "regra de negócio",
  "purchase.approval": "aprovação de compra",
  "sync.conflict": "sincronização",
};

export default function NotificationsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ rows: NotificationRow[]; total: number; unread: number }>("/api/notifications", {
        query: { unread: unreadOnly ? "1" : undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      });
      setRows(data.rows);
      setTotal(data.total);
      setUnread(data.unread);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar notificações");
    } finally {
      setLoading(false);
    }
  }, [unreadOnly, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function markRead(id: string) {
    try {
      await api("/api/notifications", { method: "POST", body: { action: "read", notificationId: id } });
      setRows((list) => list.map((n) => (n.id === id ? { ...n, read_at: Date.now() } : n)));
      setUnread((u) => Math.max(0, u - 1));
    } catch {
      /* best-effort */
    }
  }

  return (
    <>
      <PageHeader
        title="Notificações"
        subtitle={`${unread} por ler · alertas gerados por dados reais e regras ativas`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />}>
              Atualizar
            </Button>
            <Button
              variant="accent"
              size="sm"
              disabled={unread === 0}
              onClick={async () => {
                await api("/api/notifications", { method: "POST", body: { action: "read_all" } });
                load();
              }}
              icon={<CheckCheck className="h-3.5 w-3.5" />}
            >
              Marcar todas como lidas
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-3 border-b border-mist-200 bg-white px-4 py-2.5 dark:border-graphite-700 dark:bg-graphite-850">
        <Toggle checked={unreadOnly} onChange={(v) => { setUnreadOnly(v); setPage(0); }} label="Só não lidas" />
      </div>

      <div className="p-4">
        {loading && rows.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={unreadOnly ? "Tudo lido" : "Sem notificações"}
            message="Alertas de stock, validades, diferenças de caixa e regras aparecem aqui automaticamente."
            icon={<Bell className="h-8 w-8" />}
          />
        ) : (
          <>
            <ul className="space-y-1.5">
              {rows.map((n) => (
                <li
                  key={n.id}
                  className={clsx(
                    "card flex items-start gap-3 px-4 py-3",
                    !n.read_at && "border-l-2",
                    !n.read_at && n.severity === "critical" && "border-l-danger",
                    !n.read_at && n.severity === "warning" && "border-l-warning",
                    !n.read_at && n.severity === "info" && "border-l-info",
                  )}
                >
                  {n.severity !== "info" && (
                    <TriangleAlert className={clsx("mt-0.5 h-4 w-4 shrink-0", n.severity === "critical" ? "text-danger" : "text-warning")} />
                  )}
                  {n.severity === "info" && <Bell className="mt-0.5 h-4 w-4 shrink-0 text-graphite-400" />}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      {n.title}
                      {!n.read_at && <Badge tone="accent">nova</Badge>}
                      <Badge tone={n.severity === "critical" ? "danger" : n.severity === "warning" ? "warning" : "neutral"}>
                        {KIND_LABELS[n.kind] ?? n.kind}
                      </Badge>
                    </p>
                    {n.body && <p className="mt-0.5 text-xs leading-snug text-graphite-500 dark:text-graphite-300">{n.body}</p>}
                    <p className="mt-1 text-[10px] text-graphite-400">
                      {fmtDateTime(n.created_at)}
                      {n.ref_type ? ` · ref: ${n.ref_type}` : ""}
                    </p>
                  </div>
                  {!n.read_at && (
                    <Button variant="ghost" size="sm" onClick={() => markRead(n.id)}>
                      Marcar lida
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {total > PAGE_SIZE && (
              <div className="mt-3">
                <Pagination total={total} limit={PAGE_SIZE} offset={page * PAGE_SIZE} onOffset={(o) => setPage(Math.floor(o / PAGE_SIZE))} />
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
