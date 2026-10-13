"use client";

/**
 * Widget renderers for the Adaptive Dashboard Engine.
 * Each renderer handles its typed payload defensively and displays the
 * data provenance ("factos" vs "estimativa") where relevant.
 */

import { clsx } from "clsx";
import { AlertTriangle, Clock, Info } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, Skeleton, Stat } from "@/components/ui";
import { fmtAge, fmtDate, fmtDuration, fmtMoney, fmtPct, fmtQty, fmtTime } from "@/lib/format";

export interface WidgetPayload {
  widget: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  source?: string;
  fetchedAt: number;
}

export interface WidgetDef {
  id: string;
  title: string;
  description: string;
  size: "sm" | "md" | "lg";
}

function Rows({
  rows,
}: {
  rows: { label: string; value: string; tone?: "danger" | "warning" | "success"; sub?: string }[];
}) {
  if (!rows.length) return <EmptyState title="Sem dados no período" message="Os dados aparecem assim que houver atividade registada." />;
  return (
    <ul className="divide-y divide-mist-100 dark:divide-graphite-700/60">
      {rows.map((r, i) => (
        <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-1.5">
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">{r.label}</span>
            {r.sub && <span className="block truncate text-[10px] text-graphite-400">{r.sub}</span>}
          </span>
          <span
            className={clsx(
              "shrink-0 font-mono text-xs font-semibold tabular-nums",
              r.tone === "danger" && "text-danger",
              r.tone === "warning" && "text-warning",
              r.tone === "success" && "text-success",
            )}
          >
            {r.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SourceNote({ source }: { source?: string }) {
  if (!source) return null;
  return (
    <p className="border-t border-mist-100 px-4 py-1.5 text-[9px] leading-tight text-graphite-400 dark:border-graphite-700/60">
      Fonte: {source}
    </p>
  );
}

interface SummaryData {
  current: { grossCents: number; netCents: number; taxCents: number; discountCents: number; transactions: number; avgTicketCents: number; estimatedGrossProfitCents: number; estimatedMarginBps: number; costCents: number; returnsCents: number; itemsSold: number };
  previous: SummaryDataCurrent;
  deltaBps: { gross: number; transactions: number; avgTicket: number; margin: number };
}
type SummaryDataCurrent = SummaryData["current"];

export function WidgetBody({
  def,
  payload,
  currency,
}: {
  def: WidgetDef;
  payload: WidgetPayload | undefined;
  currency: string;
}) {
  if (!payload) {
    return (
      <Card className="flex h-full flex-col">
        <CardHeader title={def.title} />
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Card>
    );
  }
  if (!payload.ok) {
    return (
      <Card className="flex h-full flex-col">
        <CardHeader title={def.title} />
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-danger">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {payload.error}
          </span>
        </div>
      </Card>
    );
  }

  const d = payload.data as never;
  void d;

  const body = renderBody(def.id, payload.data, currency);
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title={def.title} subtitle={def.description} />
      <div className="flex-1">{body}</div>
      <SourceNote source={payload.source} />
    </Card>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function renderBody(id: string, data: any, currency: string) {
  switch (id) {
    case "sales-today":
    case "revenue-period": {
      const s = data as SummaryData;
      return (
        <div className="grid grid-cols-2 divide-x divide-mist-100 dark:divide-graphite-700/60">
          <Stat
            label="Receita bruta"
            value={fmtMoney(s.current.grossCents, currency)}
            delta={{ bps: s.deltaBps.gross, label: "vs. período anterior" }}
            tone="accent"
          />
          <div className="space-y-2 px-4 py-3 text-xs">
            <p className="flex justify-between"><span className="text-graphite-400">Receita líquida</span><span className="font-mono tabular-nums">{fmtMoney(s.current.netCents, currency)}</span></p>
            <p className="flex justify-between"><span className="text-graphite-400">Impostos</span><span className="font-mono tabular-nums">{fmtMoney(s.current.taxCents, currency)}</span></p>
            <p className="flex justify-between"><span className="text-graphite-400">Descontos</span><span className="font-mono tabular-nums">{fmtMoney(s.current.discountCents, currency)}</span></p>
            <p className="flex justify-between"><span className="text-graphite-400">Devoluções</span><span className="font-mono tabular-nums text-danger">{fmtMoney(s.current.returnsCents, currency)}</span></p>
          </div>
        </div>
      );
    }
    case "transactions-today": {
      const t = data as { transactions: number; itemsSold: number };
      return (
        <div className="grid grid-cols-2 divide-x divide-mist-100 dark:divide-graphite-700/60">
          <Stat label="Transações" value={String(t.transactions)} />
          <Stat label="Artigos vendidos" value={fmtQty(t.itemsSold)} />
        </div>
      );
    }
    case "avg-ticket": {
      const t = data as { avgTicketCents: number; transactions: number };
      return <Stat label="Ticket médio" value={fmtMoney(t.avgTicketCents, currency)} hint={`${t.transactions} transações`} tone="accent" />;
    }
    case "margin-estimate": {
      const m = data as { netCents: number; costCents: number; estimatedGrossProfitCents: number; estimatedMarginBps: number };
      return (
        <div>
          <Stat label="Lucro bruto estimado" value={fmtMoney(m.estimatedGrossProfitCents, currency)} hint={`Margem ${fmtPct(m.estimatedMarginBps)}`} tone="accent" />
          <p className="px-4 pb-2 text-[10px] leading-tight text-graphite-400">
            <Info className="mr-1 inline h-3 w-3" />
            Receita ≠ lucro: valor = receita líquida − custo registado das vendas. Exclui custos operacionais.
          </p>
        </div>
      );
    }
    case "sales-by-hour": {
      const buckets = data as { hour: number; tx: number; totalCents: number }[];
      const max = Math.max(1, ...buckets.map((b) => b.totalCents));
      return (
        <div className="flex h-32 items-end gap-[2px] px-4 py-3" role="img" aria-label="Vendas por hora">
          {buckets.map((b) => (
            <div key={b.hour} className="group relative flex-1" title={`${b.hour}h: ${fmtMoney(b.totalCents, currency)} · ${b.tx} tx`}>
              <div
                className={clsx("w-full rounded-t-sm", b.totalCents > 0 ? "bg-lime-brand/80 group-hover:bg-lime-brand" : "bg-mist-200 dark:bg-graphite-700")}
                style={{ height: `${Math.max(2, (b.totalCents / max) * 100)}px` }}
              />
            </div>
          ))}
        </div>
      );
    }
    case "sales-by-branch":
      return <Rows rows={(data as any[]).map((b) => ({ label: b.name, value: fmtMoney(b.total_cents, currency), sub: `${b.tx} transações` }))} />;
    case "top-products":
    case "high-rotation":
      return <Rows rows={(data as any[]).map((p) => ({ label: p.name, value: fmtQty(p.qty_milli ?? p.sold_milli), sub: `${fmtMoney(p.total_cents ?? 0, currency)} · ${p.sales_count ?? ""} vendas` }))} />;
    case "top-dishes":
      return <Rows rows={(data as any[]).map((p) => ({ label: p.name, value: fmtQty(p.qty_milli), sub: fmtMoney(p.total_cents, currency) }))} />;
    case "open-terminals": {
      const rows = data as any[];
      if (!rows.length) return <EmptyState title="Nenhuma caixa aberta" message="Abra uma sessão de caixa no terminal para começar a vender em dinheiro." />;
      return <Rows rows={rows.map((r) => ({ label: `${r.terminal} · ${r.branch}`, value: fmtTime(r.opened_at), sub: `aberta por ${r.opened_by ?? "?"}`, tone: "success" }))} />;
    }
    case "cash-difference": {
      const rows = data as any[];
      if (!rows.length) return <EmptyState title="Sem diferenças de caixa" message="Todas as sessões fechadas reconciliaram corretamente." />;
      return <Rows rows={rows.map((r) => ({ label: `${r.branch_name} · ${r.terminal_name}`, value: `${r.difference_cents > 0 ? "+" : ""}${fmtMoney(r.difference_cents, currency)}`, sub: fmtDate(r.closed_at), tone: Math.abs(r.difference_cents) > 500 ? "danger" : "warning" }))} />;
    }
    case "payment-mix": {
      const rows = data as any[];
      const total = rows.reduce((a, r) => a + r.total_cents, 0) || 1;
      return <Rows rows={rows.map((r) => ({ label: r.name ?? r.method_key, value: fmtMoney(r.total_cents, currency), sub: `${fmtPct(Math.round((r.total_cents * 10000) / total))} · ${r.n} pag.` }))} />;
    }
    case "low-stock":
      return <Rows rows={(data as any[]).map((s) => ({ label: `${s.product_name}${s.variant_label ? ` · ${s.variant_label}` : ""}`, value: fmtQty(s.qty_milli, s.unit), sub: s.warehouse_name, tone: "warning" }))} />;
    case "critical-stock": {
      const c = data as { count: number };
      return <Stat label="Produtos abaixo do mínimo" value={String(c.count)} tone={c.count > 0 ? undefined : "accent"} hint={c.count > 0 ? "Ver Inventário → stock baixo" : "Nenhum produto crítico"} />;
    }
    case "stock-valuation": {
      const v = data as { valueCents: number; positions: number };
      return <Stat label="Valor do inventário (custo)" value={fmtMoney(v.valueCents, currency)} hint={`${v.positions} posições de stock`} />;
    }
    case "no-movement":
    case "dead-stock-refs":
      return <Rows rows={(data as any[]).map((p) => ({ label: p.name, value: fmtQty(p.qty_milli), sub: `SKU ${p.sku}`, tone: "warning" }))} />;
    case "expiring-batches":
      return (
        <Rows
          rows={(data as any[]).map((b) => ({
            label: `${b.product_name} · lote ${b.batch_number}`,
            value: fmtDate(b.expiry_date),
            sub: `${b.warehouse_name} · ${fmtQty(b.qty_remaining_milli)} rest.`,
            tone: b.risk === "expired" ? "danger" : b.risk === "critical" ? "warning" : undefined,
          }))}
        />
      );
    case "replenishment-queue":
    case "purchase-suggestions":
      return (
        <Rows
          rows={(data as any[]).map((s) => ({
            label: s.name,
            value: `stock ${fmtQty(s.stock_milli)}`,
            sub: `~${(s.avg_daily_milli / 1000).toFixed(1)}/dia${s.supplier_name ? ` · ${s.supplier_name}` : ""}`,
            tone: s.stock_milli <= (s.reorder_point_milli ?? 0) ? "warning" : undefined,
          }))}
        />
      );
    case "pending-orders":
      return <Rows rows={(data as any[]).map((o) => ({ label: `${o.po_number} · ${o.supplier_name}`, value: fmtMoney(o.total_cents, currency), sub: o.status, tone: o.status === "pending_approval" ? "warning" : undefined }))} />;
    case "new-customers": {
      const c = data as { count: number };
      return <Stat label="Novos clientes" value={String(c.count)} />;
    }
    case "loyalty-summary": {
      const l = data as { accounts: number; points: number };
      return (
        <div className="grid grid-cols-2 divide-x divide-mist-100 dark:divide-graphite-700/60">
          <Stat label="Contas" value={String(l.accounts)} />
          <Stat label="Pontos ativos" value={l.points.toLocaleString("pt-PT")} />
        </div>
      );
    }
    case "credit-exposure": {
      const c = data as { customers: number; balance_cents: number; limit_cents: number };
      return (
        <div>
          <Stat label="Crédito utilizado" value={fmtMoney(c.balance_cents, currency)} hint={`Limite total ${fmtMoney(c.limit_cents, currency)} · ${c.customers} clientes`} tone={c.balance_cents > c.limit_cents * 0.8 ? undefined : "accent"} />
        </div>
      );
    }
    case "margin-by-category":
      return (
        <Rows
          rows={(data as any[]).map((c) => {
            const margin = c.net_cents > 0 ? Math.round(((c.net_cents - c.cost_cents) * 10000) / c.net_cents) : 0;
            return { label: c.category, value: fmtMoney(c.total_cents, currency), sub: `margem est. ${fmtPct(margin)}` };
          })}
        />
      );
    case "staff-performance":
      return <Rows rows={(data as any[]).map((u) => ({ label: u.name, value: fmtMoney(u.total_cents, currency), sub: `${u.tx} vendas · desc. ${fmtMoney(u.discount_cents, currency)}` }))} />;
    case "stockouts": {
      const c = data as { count: number };
      return <Stat label="Ruturas de stock" value={String(c.count)} hint="Vendas que deixaram stock negativo" tone={c.count > 0 ? undefined : "accent"} />;
    }
    case "active-orders": {
      const a = data as { count: number; orders: any[] };
      return (
        <div>
          <Stat label="Pedidos abertos" value={String(a.count)} tone="accent" />
          <Rows rows={a.orders.map((o: any) => ({ label: o.table_name ?? o.channel, value: fmtMoney(o.open_total_cents, currency), sub: `${o.open_items} itens · desde ${fmtTime(o.opened_at)}`, tone: Date.now() - o.opened_at > 45 * 60000 ? "warning" : undefined }))} />
        </div>
      );
    }
    case "table-occupancy": {
      const t = data as { total: number; occupied: number; reserved: number; free: number; openOrders: number };
      const pct = t.total ? Math.round((t.occupied / t.total) * 100) : 0;
      return (
        <div className="px-4 py-3">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-xl font-semibold tabular-nums text-lime-dim dark:text-lime-brand">{pct}%</span>
            <span className="text-[11px] text-graphite-400">{t.occupied}/{t.total} mesas</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-mist-200 dark:bg-graphite-700">
            <div className="h-full rounded-full bg-lime-brand" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex gap-3 text-[10px] text-graphite-400">
            <span>Livres {t.free}</span>
            <span>Reservadas {t.reserved}</span>
            <span>Pedidos {t.openOrders}</span>
          </div>
        </div>
      );
    }
    case "avg-prep-time": {
      const t = data as { avgMs: number | null };
      return <Stat label="Preparação média (24h)" value={t.avgMs == null ? "—" : fmtDuration(t.avgMs)} hint={t.avgMs == null ? "Sem tickets concluídos" : "envio → pronto"} />;
    }
    case "sales-by-shift":
      return <Rows rows={(data as any[]).map((s) => ({ label: s.user_name + (s.label ? ` (${s.label})` : ""), value: fmtMoney(s.total_cents, currency), sub: `${s.sales_count} vendas · ${fmtTime(s.started_at)}` }))} />;
    case "kitchen-load": {
      const k = data as Record<string, { count: number; avgAgeMs: number }>;
      const order = ["pending", "preparing", "ready"];
      const labels: Record<string, string> = { pending: "Pendentes", preparing: "Em preparação", ready: "Prontos" };
      return (
        <div className="grid grid-cols-3 divide-x divide-mist-100 dark:divide-graphite-700/60">
          {order.map((st) => (
            <Stat key={st} label={labels[st] ?? st} value={String(k[st]?.count ?? 0)} hint={k[st]?.count ? `idade ${fmtAge(k[st].avgAgeMs)}` : undefined} />
          ))}
        </div>
      );
    }
    case "sales-by-size":
    case "sales-by-color":
      return <Rows rows={(data as any[]).map((r) => ({ label: String(r.attr_value), value: fmtQty(r.qty_milli), sub: fmtMoney(r.total_cents, currency) }))} />;
    case "variant-stock":
      return <Rows rows={(data as any[]).map((v) => ({ label: `${v.name} · ${v.label}`, value: fmtQty(v.qty_milli), tone: v.qty_milli <= 0 ? "danger" : "warning" }))} />;
    case "return-rate": {
      const r = data as { salesCount: number; returnsCount: number; countRateBps: number; valueRateBps: number; returnedCents: number };
      return (
        <div className="grid grid-cols-2 divide-x divide-mist-100 dark:divide-graphite-700/60">
          <Stat label="Taxa (nº)" value={fmtPct(r.countRateBps)} hint={`${r.returnsCount}/${r.salesCount} vendas`} />
          <Stat label="Taxa (valor)" value={fmtPct(r.valueRateBps)} hint={fmtMoney(r.returnedCents, currency)} />
        </div>
      );
    }
    case "active-work-orders":
    case "rma-open":
      return <Rows rows={(data as any[]).map((w) => ({ label: w.status, value: String(w.c), sub: fmtMoney(w.total_cents, currency), tone: "warning" }))} />;
    case "warranty-expiring":
      return <Rows rows={(data as any[]).map((s) => ({ label: `${s.name} · ${s.serial_number}`, value: fmtDate(s.warranty_ends_at), tone: "warning" }))} />;
    case "today-agenda":
      return (
        <Rows
          rows={(data as any[]).map((a) => ({
            label: `${fmtTime(a.starts_at)} · ${a.customer_name}`,
            value: a.resource_name,
            sub: `${a.duration_min} min · ${a.status}`,
            tone: a.status === "no_show" ? "danger" : a.status === "done" ? "success" : undefined,
          }))}
        />
      );
    case "occupancy-by-staff":
      return <Rows rows={(data as any[]).map((s) => ({ label: s.name, value: `${s.appointments} marc.`, sub: `${s.minutes} min ocupados` }))} />;
    case "revenue-by-staff":
      return <Rows rows={(data as any[]).map((s) => ({ label: s.name, value: fmtMoney(s.revenue_cents, currency), sub: `${s.appointments_done} serviços · comissão ${fmtPct(s.commission_bps, 0)}` }))} />;
    case "no-shows": {
      const n = data as { noShows: number; cancelled: number; total: number; rateBps: number };
      return <Stat label="Taxa de falta" value={fmtPct(n.rateBps)} hint={`${n.noShows} faltas · ${n.cancelled} cancelamentos de ${n.total}`} tone={n.rateBps > 1500 ? undefined : "accent"} />;
    }
    case "alerts-feed": {
      const rows = data as any[];
      if (!rows.length) return <EmptyState title="Sem alertas" message="Tudo operacional." />;
      return (
        <ul className="divide-y divide-mist-100 dark:divide-graphite-700/60">
          {rows.map((n) => (
            <li key={n.id} className="flex items-start gap-2 px-4 py-1.5">
              <span className={clsx("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", n.severity === "critical" ? "bg-danger" : n.severity === "warning" ? "bg-warning" : "bg-info")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{n.title}</span>
                <span className="block text-[10px] text-graphite-400">{fmtTime(n.created_at)}</span>
              </span>
              {!n.read_at && <Badge tone="accent">novo</Badge>}
            </li>
          ))}
        </ul>
      );
    }
    case "ai-daily-brief": {
      const brief = data as { sections: { title: string; facts: string[]; source: string; kind: string }[]; disclaimer: string };
      return (
        <div className="space-y-3 px-4 py-3">
          {brief.sections.map((s, i) => (
            <div key={i}>
              <p className="flex items-center gap-1.5 text-xs font-semibold">
                {s.title}
                <Badge tone={s.kind === "fact" ? "info" : s.kind === "estimate" ? "warning" : "neutral"}>
                  {s.kind === "fact" ? "facto" : s.kind === "estimate" ? "estimativa" : "projeção"}
                </Badge>
              </p>
              <ul className="mt-1 space-y-0.5">
                {s.facts.map((f, j) => (
                  <li key={j} className="text-[11px] leading-snug text-graphite-500 dark:text-graphite-300">· {f}</li>
                ))}
              </ul>
              <p className="mt-0.5 text-[9px] text-graphite-400">origem: {s.source}</p>
            </div>
          ))}
          <p className="border-t border-mist-100 pt-2 text-[9px] leading-tight text-graphite-400 dark:border-graphite-700/60">{brief.disclaimer}</p>
        </div>
      );
    }
    case "anomalies": {
      const a = data as { method: string; anomalies: { date: string; totalCents: number; expectedCents: number; zScore: number; direction: string; severity: string }[]; note: string };
      return (
        <div>
          {a.anomalies.length === 0 ? (
            <EmptyState title="Sem anomalias" message={a.note} icon={<Clock className="h-8 w-8" />} />
          ) : (
            <Rows
              rows={a.anomalies.map((x) => ({
                label: x.date,
                value: `${x.zScore > 0 ? "+" : ""}${x.zScore}σ`,
                sub: `${fmtMoney(x.totalCents, currency)} vs. esperado ${fmtMoney(x.expectedCents, currency)}`,
                tone: x.severity === "high" ? "danger" : "warning",
              }))}
            />
          )}
          <p className="border-t border-mist-100 px-4 py-1.5 text-[9px] leading-tight text-graphite-400 dark:border-graphite-700/60">
            Método: {a.method}. {a.note}
          </p>
        </div>
      );
    }
    default:
      return <EmptyState title="Widget sem renderizador" message={id} />;
  }
}
