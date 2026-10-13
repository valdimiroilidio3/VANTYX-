"use client";

/**
 * Settings — Auditoria: immutable audit trail (who/what/when, before→after).
 * Read-only by design: audit records are never editable or deletable.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Pagination } from "@/components/ui";
import { useToast } from "@/components/system/toast";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format";

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_label: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  branch_id: string | null;
  before: string | null;
  after: string | null;
  result: string;
  detail: string | null;
  ip: string | null;
  created_at: number;
}

const RESOURCE_TYPES = [
  "sale", "return", "product", "stock", "transfer", "count_sheet", "customer", "supplier",
  "purchase_order", "goods_receipt", "cash_session", "shift", "user", "invite", "module",
  "rule", "organization", "branch", "terminal", "integration", "reservation", "kitchen_ticket",
];

const LIMIT = 50;

function pretty(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}

export function AuditTab() {
  const toast = useToast();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [resourceType, setResourceType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ rows: AuditRow[]; total: number }>("/api/audit", {
        query: {
          limit: LIMIT,
          offset,
          resourceType: resourceType || undefined,
          from: fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined,
          to: toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined,
        },
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro ao carregar auditoria.");
    } finally {
      setLoading(false);
    }
  }, [offset, resourceType, fromDate, toDate, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader
        title="Registo de auditoria"
        icon={<ScrollText className="h-4 w-4" />}
        subtitle="Trilho imutável das operações sensíveis. Apenas leitura — registos de auditoria nunca são editáveis."
        action={
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-4 w-4" /> Atualizar
          </Button>
        }
      />
      <div className="p-4">
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Tipo de recurso">
            <select
              className="input-base"
              value={resourceType}
              onChange={(e) => {
                setResourceType(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Todos</option>
              {RESOURCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="De">
            <input
              type="date"
              className="input-base"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setOffset(0);
              }}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              className="input-base"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setOffset(0);
              }}
            />
          </Field>
        </div>

        {loading && !rows ? (
          <div className="flex justify-center py-10 text-graphite-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !rows?.length ? (
          <EmptyState icon={<ScrollText className="h-8 w-8" />} title="Sem registos" message="Nenhuma entrada de auditoria para estes filtros." />
        ) : (
          <ul className="divide-y divide-mist-200 dark:divide-graphite-700">
            {rows.map((r) => {
              const open = expanded === r.id;
              const hasPayload = Boolean(r.before || r.after || r.detail);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 py-2.5 text-left"
                    onClick={() => setExpanded(open ? null : r.id)}
                    disabled={!hasPayload}
                  >
                    {hasPayload ? (
                      open ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-graphite-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-graphite-400" />
                      )
                    ) : (
                      <span className="w-4 shrink-0" />
                    )}
                    <code className="shrink-0 rounded bg-mist-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-lime-dim dark:bg-graphite-800 dark:text-lime-brand">
                      {r.action}
                    </code>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {r.actor_label ?? "sistema"} · {r.resource_type}
                      {r.resource_id ? <span className="font-mono text-xs text-graphite-400"> {r.resource_id}</span> : null}
                    </span>
                    {r.result !== "success" && <Badge tone="danger">{r.result}</Badge>}
                    <span className="shrink-0 text-xs text-graphite-400">{fmtDateTime(r.created_at)}</span>
                  </button>
                  {open && hasPayload && (
                    <div className="grid grid-cols-1 gap-3 pb-3 pl-7 md:grid-cols-2">
                      {r.before && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-graphite-400">Antes</p>
                          <pre className="max-h-40 overflow-auto rounded-md bg-mist-100 p-2 font-mono text-[11px] dark:bg-graphite-800">
                            {pretty(r.before)}
                          </pre>
                        </div>
                      )}
                      {r.after && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-graphite-400">Depois</p>
                          <pre className="max-h-40 overflow-auto rounded-md bg-mist-100 p-2 font-mono text-[11px] dark:bg-graphite-800">
                            {pretty(r.after)}
                          </pre>
                        </div>
                      )}
                      {r.detail && (
                        <div className="md:col-span-2">
                          <p className="mb-1 text-xs font-semibold text-graphite-400">Detalhe</p>
                          <pre className="max-h-40 overflow-auto rounded-md bg-mist-100 p-2 font-mono text-[11px] dark:bg-graphite-800">
                            {pretty(r.detail)}
                          </pre>
                        </div>
                      )}
                      {r.ip && <p className="text-xs text-graphite-400 md:col-span-2">IP: {r.ip}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {total > LIMIT && (
          <div className="mt-4">
            <Pagination total={total} limit={LIMIT} offset={offset} onOffset={setOffset} />
          </div>
        )}
      </div>
    </Card>
  );
}
