"use client";

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { ChevronLeft, GripVertical, Plus, RefreshCw, Save, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { WidgetBody, type WidgetDef, type WidgetPayload } from "@/components/dashboard/widgets";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { Badge, Button, EmptyState, Stat } from "@/components/ui";
import { api } from "@/lib/api/client";
import { fmtMoney, fmtQty } from "@/lib/format";

interface DashData {
  industry: string;
  layout: { widgetIds: string[]; source: string; customizationLevel: string };
  widgets: { widget: string; title: string; description: string; size: string; industry: string }[];
  availability: Record<string, { available: boolean; reason?: string }>;
  payloads: WidgetPayload[];
  summary: {
    current: { grossCents: number; transactions: number; itemsSold: number; avgTicketCents: number };
    deltaBps: { gross: number; transactions: number; avgTicket: number };
  };
}

const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
];

const SIZE_CLASSES: Record<string, string> = {
  sm: "md:col-span-3 xl:col-span-3",
  md: "md:col-span-6 xl:col-span-4",
  lg: "md:col-span-12 xl:col-span-8",
};

export default function DashboardPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const [data, setData] = useState<DashData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("today");
  const [customizing, setCustomizing] = useState(false);
  const [layout, setLayout] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<{ id: string; title: string; description: string; size: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const branchId = workspace.branchId;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api<DashData>("/api/dashboard", { query: { period, branchId: branchId ?? undefined } });
      setData(d);
      setLayout(d.layout.widgetIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar dashboard");
    } finally {
      setLoading(false);
    }
  }, [period, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const widgetDefs = new Map<string, WidgetDef>(
    (data?.widgets ?? []).map((w) => [w.widget, { id: w.widget, title: w.title, description: w.description, size: w.size as WidgetDef["size"] }]),
  );
  const payloadMap = new Map<string, WidgetPayload>();
  for (const p of data?.payloads ?? []) payloadMap.set(p.widget, p);

  async function startCustomizing() {
    try {
      const cat = await api<{
        catalog: { id: string; title: string; description: string; size: string; kind: string }[];
        availability: Record<string, { available: boolean; reason?: string }>;
      }>("/api/dashboard?customize=1");
      setCatalog(cat.catalog.filter((c) => cat.availability[c.id]?.available !== false));
      setCustomizing(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  async function saveLayout() {
    setSaving(true);
    try {
      await api("/api/dashboard", { method: "PUT", body: { widgetIds: layout } });
      setCustomizing(false);
      toast.success("Layout guardado", "O dashboard foi personalizado para a sua conta.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao guardar");
    } finally {
      setSaving(false);
    }
  }

  function moveWidget(index: number, dir: -1 | 1) {
    setLayout((l) => {
      const next = [...l];
      const target = index + dir;
      if (target < 0 || target >= next.length) return l;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  const s = data?.summary.current;
  const deltas = data?.summary.deltaBps;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          data
            ? `Perfil ${data.industry} · widgets do setor (fonte: ${data.layout.source}, personalização: ${data.layout.customizationLevel})`
            : "Visão operacional gerada a partir dos módulos ativos"
        }
        actions={
          <>
            <div className="flex overflow-hidden rounded-md border border-mist-200 dark:border-graphite-600">
              {PERIODS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className={clsx(
                    "px-2.5 py-1.5 text-xs font-medium transition-colors",
                    period === p.key
                      ? "bg-graphite-900 text-lime-brand dark:bg-graphite-700"
                      : "text-graphite-500 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />}>
              Atualizar
            </Button>
            {customizing ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setCustomizing(false)} icon={<X className="h-3.5 w-3.5" />}>
                  Cancelar
                </Button>
                <Button variant="accent" size="sm" loading={saving} onClick={saveLayout} icon={<Save className="h-3.5 w-3.5" />}>
                  Guardar layout
                </Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={startCustomizing} icon={<Plus className="h-3.5 w-3.5" />}>
                Personalizar
              </Button>
            )}
          </>
        }
      />

      <div className="p-4">
        {error && (
          <div className="mb-4 rounded-lg border border-danger/30 bg-red-500/10 p-4 text-sm text-danger">
            {error}{" "}
            <button className="font-semibold underline" onClick={load}>
              Tentar novamente
            </button>
          </div>
        )}

        {/* KPI strip — always real data from summary */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {loading && !data ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-4">
                <div className="h-3 w-20 animate-pulse rounded bg-mist-200 dark:bg-graphite-700" />
                <div className="mt-2 h-6 w-24 animate-pulse rounded bg-mist-200 dark:bg-graphite-700" />
              </div>
            ))
          ) : (
            <>
              <Stat label="Receita bruta" value={s ? fmtMoney(s.grossCents, workspace.org.currency) : "—"} delta={deltas ? { bps: deltas.gross, label: "vs. período anterior" } : undefined} tone="accent" />
              <Stat label="Transações" value={s ? String(s.transactions) : "—"} delta={deltas ? { bps: deltas.transactions } : undefined} />
              <Stat label="Ticket médio" value={s ? fmtMoney(s.avgTicketCents, workspace.org.currency) : "—"} delta={deltas ? { bps: deltas.avgTicket } : undefined} />
              <Stat label="Artigos vendidos" value={s ? fmtQty(s.itemsSold) : "—"} />
            </>
          )}
        </div>

        {/* Widget grid */}
        {layout.length === 0 && !loading && (
          <EmptyState
            title="Nenhum widget configurado"
            message="Use “Personalizar” para adicionar widgets do seu setor."
          />
        )}

        {customizing ? (
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-graphite-400">
                Widgets ativos ({layout.length})
              </h2>
              <ul className="space-y-1.5">
                {layout.map((id, index) => {
                  const def = widgetDefs.get(id);
                  return (
                    <li key={id} className="flex items-center gap-2 rounded-lg border border-mist-200 bg-white px-3 py-2 dark:border-graphite-600 dark:bg-graphite-800">
                      <GripVertical className="h-4 w-4 shrink-0 text-graphite-400" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{def?.title ?? id}</span>
                        <span className="block truncate text-[10px] text-graphite-400">{def?.description ?? ""}</span>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => moveWidget(index, -1)} aria-label="Subir"><ChevronLeft className="h-3.5 w-3.5 rotate-90" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => moveWidget(index, 1)} aria-label="Descer"><ChevronLeft className="h-3.5 w-3.5 -rotate-90" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setLayout((l) => l.filter((x) => x !== id))} aria-label="Remover"><X className="h-3.5 w-3.5 text-danger" /></Button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-graphite-400">
                Catálogo de widgets
              </h2>
              <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto">
                {catalog.map((c) => {
                  const already = layout.includes(c.id);
                  return (
                    <li key={c.id} className="rounded-lg border border-mist-200 bg-white px-3 py-2 dark:border-graphite-600 dark:bg-graphite-800">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">{c.title}</span>
                          <span className="block truncate text-[10px] text-graphite-400">{c.description}</span>
                        </span>
                        <Button
                          variant={already ? "ghost" : "secondary"}
                          size="sm"
                          disabled={already}
                          onClick={() => setLayout((l) => [...l, c.id])}
                          icon={<Plus className="h-3.5 w-3.5" />}
                        >
                          {already ? "ativo" : "adicionar"}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            {layout.map((id) => {
              const def = widgetDefs.get(id) ?? { id, title: id, description: "", size: "md" as const };
              return (
                <div key={id} className={clsx("min-h-[7rem]", SIZE_CLASSES[def.size] ?? SIZE_CLASSES.md)}>
                  <WidgetBody def={def} payload={payloadMap.get(id)} currency={workspace.org.currency} />
                </div>
              );
            })}
          </div>
        )}

        {data && (
          <p className="mt-4 flex items-center gap-2 text-[10px] text-graphite-400">
            <Badge tone="neutral">tempo real</Badge>
            Todos os valores derivam de documentos de venda reais — nada é simulado. Atualizado {new Date(data.payloads[0]?.fetchedAt ?? Date.now()).toLocaleTimeString("pt-PT")}.
          </p>
        )}
      </div>
    </>
  );
}
