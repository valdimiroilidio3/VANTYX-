"use client";

/**
 * Relatórios — análises derivadas exclusivamente de documentos reais.
 * Distinção permanente: receita (facto) ≠ lucro bruto (estimativa com
 * custos registados) ≠ fluxo de caixa (sessões/numerário).
 * Export CSV pt-PT (separador ';') audited via reports.export.
 */

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { BarChart3, Download, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { Badge, Button, Card, CardHeader, EmptyState, Stat } from "@/components/ui";
import { api } from "@/lib/api/client";
import { fmtDate, fmtMoney, fmtPct, fmtQty } from "@/lib/format";

interface SummaryBlock {
  grossCents: number;
  netCents: number;
  taxCents: number;
  discountCents: number;
  returnsCents: number;
  costCents: number;
  estimatedGrossProfitCents: number;
  estimatedMarginBps: number;
  transactions: number;
  avgTicketCents: number;
  itemsSold: number;
}

interface ReportsData {
  period: { from: number; to: number; branchId?: string };
  summary: { current: SummaryBlock; previous: SummaryBlock; deltaBps: { gross: number; transactions: number; avgTicket: number; margin: number } };
  byDay: { day: string; tx: number; total_cents: number; net_cents: number; cost_cents: number }[];
  byHour: { hour: number; tx: number; totalCents: number }[];
  byBranch: { id: string; name: string; tx: number; total_cents: number }[];
  byCategory: { category: string; total_cents: number; net_cents: number; cost_cents: number }[];
  byStaff: { name: string; tx: number; total_cents: number; discount_cents: number }[];
  topProducts: { name: string; qty_milli: number; total_cents: number; sales_count?: number }[];
  paymentMix: { method_key: string; name?: string; n: number; total_cents: number }[];
  returns: { salesCount: number; returnsCount: number; countRateBps: number; valueRateBps: number; returnedCents: number };
  rotation: { id: string; name: string; sku: string; sold_milli: number; stock_milli: number }[];
  cashDifferences: { id: string; branch_name?: string; terminal_name?: string; difference_cents: number; closed_at: number }[];
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const currency = workspace.org.currency;

  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [branchFilter, setBranchFilter] = useState("");
  const [data, setData] = useState<ReportsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setBranchFilter(workspace.branchId ?? "");
  }, [workspace.branchId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fromMs = new Date(from + "T00:00:00").getTime();
      const toMs = new Date(to + "T23:59:59.999").getTime();
      const d = await api<ReportsData>("/api/reports", {
        query: { from: fromMs, to: toMs, branchId: branchFilter || undefined },
      });
      setData(d);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao gerar relatório");
    } finally {
      setLoading(false);
    }
  }, [from, to, branchFilter, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function exportCsv() {
    setExporting(true);
    try {
      const fromMs = new Date(from + "T00:00:00").getTime();
      const toMs = new Date(to + "T23:59:59.999").getTime();
      const res = await fetch(`/api/reports/export?from=${fromMs}&to=${toMs}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vantyx-vendas-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Exportação concluída", "Operação registada na auditoria (reports.export).");
    } catch {
      toast.error("Falha ao exportar (permissão reports.export necessária).");
    } finally {
      setExporting(false);
    }
  }

  const maxDay = Math.max(1, ...(data?.byDay.map((d) => d.total_cents) ?? [1]));
  const maxHour = Math.max(1, ...(data?.byHour.map((h) => h.totalCents) ?? [1]));

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle="Factos derivados de documentos reais — receita, lucro bruto estimado e caixa são apresentados separadamente"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} />}>
              Gerar
            </Button>
            {workspace.can("reports.export") && (
              <Button variant="accent" size="sm" loading={exporting} onClick={exportCsv} icon={<Download className="h-3.5 w-3.5" />}>
                Exportar CSV (contabilidade)
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3 border-b border-mist-200 bg-white px-4 py-2.5 dark:border-graphite-700 dark:bg-graphite-850">
        <label className="text-xs">
          <span className="label-base">De</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-base h-8 w-auto" />
        </label>
        <label className="text-xs">
          <span className="label-base">Até</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base h-8 w-auto" />
        </label>
        <div className="flex gap-1">
          {[
            { label: "Hoje", f: daysAgo(0), t: daysAgo(0) },
            { label: "7d", f: daysAgo(6), t: daysAgo(0) },
            { label: "30d", f: daysAgo(29), t: daysAgo(0) },
            { label: "90d", f: daysAgo(89), t: daysAgo(0) },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => { setFrom(p.f); setTo(p.t); }}
              className={clsx(
                "rounded-md border px-2.5 py-1 text-xs font-medium",
                from === p.f && to === p.t
                  ? "border-lime-brand bg-lime-brand/10 text-lime-dim dark:text-lime-brand"
                  : "border-mist-200 text-graphite-500 hover:border-graphite-400 dark:border-graphite-600 dark:text-graphite-300",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="input-base ml-auto h-8 w-auto"
          aria-label="Filial"
        >
          <option value="">Todas as filiais</option>
          {workspace.branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-4 p-4">
        {loading && !data ? (
          <div className="grid gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : data ? (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Receita bruta (facto)" value={fmtMoney(data.summary.current.grossCents, currency)} delta={{ bps: data.summary.deltaBps.gross, label: "vs período anterior" }} tone="accent" />
              <Stat label="Receita líquida (facto)" value={fmtMoney(data.summary.current.netCents, currency)} hint={`IVA ${fmtMoney(data.summary.current.taxCents, currency)} · desc. ${fmtMoney(data.summary.current.discountCents, currency)}`} />
              <Stat label="Lucro bruto (estimativa)" value={fmtMoney(data.summary.current.estimatedGrossProfitCents, currency)} hint={`margem ${fmtPct(data.summary.current.estimatedMarginBps)} — só custos registados`} delta={{ bps: data.summary.deltaBps.margin }} />
              <Stat label="Transações (facto)" value={String(data.summary.current.transactions)} delta={{ bps: data.summary.deltaBps.transactions }} hint={`ticket médio ${fmtMoney(data.summary.current.avgTicketCents, currency)}`} />
            </div>

            {/* by day */}
            <Card>
              <CardHeader title="Vendas por dia" subtitle="Receita bruta diária (documentos não anulados)" />
              {data.byDay.length === 0 ? (
                <EmptyState title="Sem vendas no período" icon={<BarChart3 className="h-8 w-8" />} />
              ) : (
                <div className="flex h-40 items-end gap-1 px-4 py-3">
                  {data.byDay.map((d) => (
                    <div key={d.day} className="group relative flex-1" title={`${fmtDate(new Date(d.day + "T12:00:00").getTime())}: ${fmtMoney(d.total_cents, currency)} · ${d.tx} tx`}>
                      <div
                        className="w-full rounded-t bg-lime-brand/80 transition-colors group-hover:bg-lime-brand"
                        style={{ height: `${Math.max(2, (d.total_cents / maxDay) * 128)}px` }}
                      />
                      {data.byDay.length <= 15 && (
                        <p className="mt-1 truncate text-center text-[8px] text-graphite-400">{d.day.slice(8)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <div className="grid gap-3 lg:grid-cols-2">
              {/* by hour */}
              <Card>
                <CardHeader title="Distribuição horária" subtitle="Picos de afluência no período" />
                <div className="flex h-28 items-end gap-[2px] px-4 py-3">
                  {data.byHour.map((h) => (
                    <div key={h.hour} className="group relative flex-1" title={`${h.hour}h: ${fmtMoney(h.totalCents, currency)} · ${h.tx} tx`}>
                      <div className={clsx("w-full rounded-t-sm", h.totalCents > 0 ? "bg-graphite-700 group-hover:bg-lime-brand dark:bg-graphite-300" : "bg-mist-200 dark:bg-graphite-700")} style={{ height: `${Math.max(2, (h.totalCents / maxHour) * 84)}px` }} />
                    </div>
                  ))}
                </div>
              </Card>

              {/* payment mix */}
              <Card>
                <CardHeader title="Métodos de pagamento" subtitle="Mix confirmado (facto)" />
                <ul className="divide-y divide-mist-100 px-4 dark:divide-graphite-700/60">
                  {data.paymentMix.map((p) => {
                    const total = data.paymentMix.reduce((a, x) => a + x.total_cents, 0) || 1;
                    return (
                      <li key={p.method_key} className="flex items-center gap-3 py-1.5">
                        <span className="w-28 shrink-0 truncate text-xs font-medium">{p.name ?? p.method_key}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-mist-200 dark:bg-graphite-700">
                          <span className="block h-full rounded-full bg-lime-brand" style={{ width: `${(p.total_cents / total) * 100}%` }} />
                        </span>
                        <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums">{fmtMoney(p.total_cents, currency)}</span>
                        <span className="w-12 shrink-0 text-right text-[10px] text-graphite-400">{fmtPct(Math.round((p.total_cents * 10000) / total), 0)}</span>
                      </li>
                    );
                  })}
                  {data.paymentMix.length === 0 && <li className="py-4 text-center text-xs text-graphite-400">Sem pagamentos no período.</li>}
                </ul>
              </Card>

              {/* top products */}
              <Card>
                <CardHeader title="Top produtos" subtitle="20 mais vendidos (quantidade)" />
                <ul className="max-h-64 divide-y divide-mist-100 overflow-y-auto px-4 dark:divide-graphite-700/60">
                  {data.topProducts.map((p, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate text-xs"><span className="mr-1.5 font-mono text-[10px] text-graphite-400">{i + 1}º</span>{p.name}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums">{fmtQty(p.qty_milli)} · {fmtMoney(p.total_cents, currency)}</span>
                    </li>
                  ))}
                  {data.topProducts.length === 0 && <li className="py-4 text-center text-xs text-graphite-400">Sem vendas no período.</li>}
                </ul>
              </Card>

              {/* categories */}
              <Card>
                <CardHeader title="Margem por categoria" subtitle="Estimativa — receita líquida − custo registado" />
                <ul className="max-h-64 divide-y divide-mist-100 overflow-y-auto px-4 dark:divide-graphite-700/60">
                  {data.byCategory.map((c) => {
                    const margin = c.net_cents > 0 ? Math.round(((c.net_cents - c.cost_cents) * 10000) / c.net_cents) : 0;
                    return (
                      <li key={c.category} className="flex items-baseline justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate text-xs">{c.category}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums">
                          {fmtMoney(c.total_cents, currency)} · <span className={margin >= 0 ? "text-success" : "text-danger"}>{fmtPct(margin)}</span>
                        </span>
                      </li>
                    );
                  })}
                  {data.byCategory.length === 0 && <li className="py-4 text-center text-xs text-graphite-400">Sem dados.</li>}
                </ul>
              </Card>

              {/* staff */}
              <Card>
                <CardHeader title="Desempenho por operador" subtitle="Vendas e descontos concedidos (facto)" />
                <ul className="max-h-64 divide-y divide-mist-100 overflow-y-auto px-4 dark:divide-graphite-700/60">
                  {data.byStaff.map((s) => (
                    <li key={s.name} className="flex items-baseline justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate text-xs">{s.name}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums">
                        {s.tx} vendas · {fmtMoney(s.total_cents, currency)}
                        {s.discount_cents > 0 && <span className="text-warning"> · desc. {fmtMoney(s.discount_cents, currency)}</span>}
                      </span>
                    </li>
                  ))}
                  {data.byStaff.length === 0 && <li className="py-4 text-center text-xs text-graphite-400">Sem vendas no período.</li>}
                </ul>
              </Card>

              {/* branches */}
              {data.byBranch.length > 1 && (
                <Card>
                  <CardHeader title="Vendas por filial" subtitle="Consolidado do período" />
                  <ul className="divide-y divide-mist-100 px-4 dark:divide-graphite-700/60">
                    {data.byBranch.map((b) => (
                      <li key={b.id} className="flex items-baseline justify-between gap-2 py-1.5">
                        <span className="min-w-0 truncate text-xs">{b.name}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums">{b.tx} · {fmtMoney(b.total_cents, currency)}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              {/* returns + cash differences */}
              <Card>
                <CardHeader title="Devoluções & caixa" subtitle="Taxas de devolução e diferenças de fecho" />
                <div className="grid grid-cols-2 gap-3 p-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-graphite-400">Taxa devolução (nº)</p>
                    <p className="font-mono text-lg font-bold tabular-nums">{fmtPct(data.returns.countRateBps)}</p>
                    <p className="text-[10px] text-graphite-400">
                      {data.returns.returnsCount}/{data.returns.salesCount} vendas · valor {fmtMoney(data.returns.returnedCents, currency)} ({fmtPct(data.returns.valueRateBps)})
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-graphite-400">Diferenças de caixa</p>
                    {data.cashDifferences.length === 0 ? (
                      <p className="mt-1 text-xs text-success">Nenhuma diferença relevante.</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {data.cashDifferences.slice(0, 4).map((c) => (
                          <li key={c.id} className="flex justify-between text-[11px]">
                            <span className="truncate">{c.terminal_name ?? c.branch_name ?? "terminal"} · {fmtDate(c.closed_at)}</span>
                            <span className={clsx("shrink-0 font-mono tabular-nums", Math.abs(c.difference_cents) > 500 ? "font-bold text-danger" : "text-warning")}>
                              {c.difference_cents > 0 ? "+" : ""}{fmtMoney(c.difference_cents, currency)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Card>

              {/* rotation */}
              <Card>
                <CardHeader
                  title="Rotação de stock"
                  subtitle="Vendido vs. stock atual (período)"
                  action={<Badge tone="info">top 200 por saída</Badge>}
                />
                <ul className="max-h-64 divide-y divide-mist-100 overflow-y-auto px-4 dark:divide-graphite-700/60">
                  {data.rotation.slice(0, 30).map((r) => (
                    <li key={r.id} className="flex items-baseline justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate text-xs">{r.name}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums">
                        vendido {fmtQty(r.sold_milli)} · stock {fmtQty(r.stock_milli)}
                      </span>
                    </li>
                  ))}
                  {data.rotation.length === 0 && <li className="py-4 text-center text-xs text-graphite-400">Sem produtos com stock controlado.</li>}
                </ul>
              </Card>
            </div>

            <p className="text-[10px] leading-relaxed text-graphite-400">
              Metodologia: “facto” = soma de documentos não anulados; “estimativa” = lucro bruto usando custos registados
              (exclui custos operacionais, rendas, salários); devoluções apresentadas separadamente da receita.
              Exportações CSV ficam registadas na auditoria.
            </p>
          </>
        ) : null}
      </div>
    </>
  );
}
