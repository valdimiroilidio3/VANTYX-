/**
 * Adaptive Dashboard Engine — Dashboard Registry with typed widget
 * contracts. Dashboards are assembled from:
 *   industry default layout → user preferences → module availability →
 *   user permissions → server-side data fetch.
 *
 * Every widget's data provider queries REAL data. Providers that fail
 * return an explicit error payload (never fabricated numbers).
 */

import type { Permission } from "@/lib/domain/permissions";
import type { IndustryKey } from "@/lib/modules/industries";
import { getDb } from "@/lib/db/client";
import {
  agendaForDay,
  cashDifferences,
  comparePeriods,
  criticalStockCount,
  creditExposure,
  dayBounds,
  loyaltySummary,
  marginByCategory,
  newCustomers,
  noShowStats,
  openKitchenStats,
  openWorkOrders,
  paymentMix,
  performanceByUser,
  returnRate,
  revenueByStaff,
  salesByBranch,
  salesByHour,
  salesSummary,
  stockoutCount,
  stockRotation,
  tableOccupancy,
  topDishes,
  topProducts,
  salesByVariantAttribute,
  type PeriodFilter,
} from "@/lib/services/analytics.service";
import {
  expiringBatches,
  noMovementProducts,
  stockOverview,
  stockValuation,
} from "@/lib/services/inventory.service";
import { purchaseSuggestions } from "@/lib/services/purchasing.service";
import { avgPreparationTime, listOpenOrders, salesByShift } from "@/lib/services/restaurant.service";
import { getOrgProfile } from "@/lib/services/org.service";
import { dailyBrief, detectAnomalies } from "@/lib/ai/insights";

export type WidgetSize = "sm" | "md" | "lg";
export type PeriodKey = "today" | "yesterday" | "7d" | "30d";

export interface WidgetDefinition {
  id: string;
  title: string;
  description: string;
  size: WidgetSize;
  /** Module that must be enabled for the widget to appear. */
  module: string;
  permission?: Permission;
  industries?: IndustryKey[] | "*";
  /** Widget reacts to the global period filter. */
  periodAware: boolean;
}

export interface WidgetDataContext {
  orgId: string;
  branchId?: string;
  period: PeriodKey;
  from: number;
  to: number;
  tz: string;
}

export interface WidgetPayload<T = unknown> {
  widget: string;
  ok: boolean;
  data?: T;
  error?: string;
  /** Provenance: how the number was produced (fact vs estimate). */
  source?: string;
  fetchedAt: number;
}

export const WIDGETS: WidgetDefinition[] = [
  { id: "sales-today", title: "Vendas do período", description: "Receita bruta, líquida e transações.", size: "sm", module: "pos", periodAware: true },
  { id: "transactions-today", title: "Transações", description: "Volume de transações e ticket médio.", size: "sm", module: "pos", periodAware: true },
  { id: "avg-ticket", title: "Ticket médio", description: "Valor médio por transação.", size: "sm", module: "analytics", periodAware: true },
  { id: "revenue-period", title: "Receita vs. período anterior", description: "Comparação com o período homólogo.", size: "md", module: "analytics", periodAware: true },
  { id: "margin-estimate", title: "Margem estimada", description: "Lucro bruto estimado (receita líquida − custo das vendas). Não é resultado contabilístico.", size: "sm", module: "analytics", periodAware: true },
  { id: "sales-by-hour", title: "Vendas por hora", description: "Distribuição horária das vendas.", size: "md", module: "analytics", periodAware: true },
  { id: "sales-by-branch", title: "Vendas por filial", description: "Desempenho consolidado por filial.", size: "md", module: "multibranch", permission: "branches.manage", periodAware: true },
  { id: "top-products", title: "Produtos mais vendidos", description: "Top por quantidade vendida.", size: "md", module: "catalog", periodAware: true },
  { id: "open-terminals", title: "Caixas abertas", description: "Sessões de caixa abertas por terminal.", size: "sm", module: "cash", permission: "cash.view", periodAware: false },
  { id: "cash-difference", title: "Diferenças de caixa", description: "Últimas sessões fechadas com diferença.", size: "sm", module: "cash", permission: "cash.view", periodAware: false },
  { id: "payment-mix", title: "Métodos de pagamento", description: "Distribuição por método.", size: "sm", module: "analytics", periodAware: true },
  { id: "low-stock", title: "Stock baixo", description: "Produtos no/baixo do ponto de encomenda.", size: "md", module: "inventory", permission: "inventory.view", periodAware: false },
  { id: "critical-stock", title: "Stock crítico", description: "Contagem de produtos abaixo do mínimo.", size: "sm", module: "inventory", permission: "inventory.view", periodAware: false },
  { id: "stock-valuation", title: "Valor do inventário", description: "Σ quantidade × custo médio ponderado.", size: "sm", module: "inventory", permission: "inventory.view", periodAware: false },
  { id: "no-movement", title: "Sem movimento", description: "Produtos sem saídas nos últimos 60 dias.", size: "sm", module: "inventory", permission: "inventory.view", periodAware: false },
  { id: "expiring-batches", title: "Validades próximas", description: "Lotes expirados ou perto do prazo.", size: "md", module: "industry.supermarket", permission: "inventory.view", periodAware: false },
  { id: "high-rotation", title: "Alta rotação", description: "Artigos com maior saída no período.", size: "md", module: "industry.supermarket", periodAware: true },
  { id: "replenishment-queue", title: "Reposição prioritária", description: "Sugestões de compra por velocidade de venda.", size: "md", module: "purchasing", permission: "purchasing.view", periodAware: false },
  { id: "pending-orders", title: "Encomendas pendentes", description: "Compras por receber.", size: "sm", module: "purchasing", permission: "purchasing.view", periodAware: false },
  { id: "purchase-suggestions", title: "Sugestões de compra", description: "Baseadas em vendas e stock.", size: "md", module: "purchasing", permission: "purchasing.view", periodAware: false },
  { id: "new-customers", title: "Novos clientes", description: "Clientes criados no período.", size: "sm", module: "crm", periodAware: true },
  { id: "loyalty-summary", title: "Fidelização", description: "Contas e pontos em circulação.", size: "sm", module: "loyalty", permission: "loyalty.manage", periodAware: false },
  { id: "credit-exposure", title: "Exposição de crédito", description: "Crédito utilizado vs. limites.", size: "sm", module: "industry.wholesale", permission: "customers.view", periodAware: false },
  { id: "margin-by-category", title: "Margem por categoria", description: "Receita e margem estimada por categoria.", size: "md", module: "analytics", permission: "reports.view", periodAware: true },
  { id: "staff-performance", title: "Desempenho por colaborador", description: "Vendas por operador.", size: "md", module: "analytics", permission: "reports.view", periodAware: true },
  { id: "stockouts", title: "Ruturas", description: "Movimentos que deixaram stock negativo.", size: "sm", module: "inventory", permission: "inventory.view", periodAware: true },
  // Restaurant
  { id: "active-orders", title: "Pedidos ativos", description: "Pedidos abertos por estado.", size: "sm", module: "industry.restaurant", permission: "restaurant.floor", periodAware: false },
  { id: "table-occupancy", title: "Mesas ocupadas", description: "Ocupação atual da sala.", size: "sm", module: "industry.restaurant", permission: "restaurant.floor", periodAware: false },
  { id: "avg-prep-time", title: "Tempo médio de preparação", description: "Envio → pronto (últimas 24h).", size: "sm", module: "industry.restaurant", permission: "restaurant.kitchen", periodAware: false },
  { id: "top-dishes", title: "Mais pedidos", description: "Pratos mais vendidos no período.", size: "md", module: "industry.restaurant", periodAware: true },
  { id: "sales-by-shift", title: "Vendas por turno", description: "Receita por turno (últimas 24h).", size: "md", module: "industry.restaurant", permission: "reports.view", periodAware: false },
  { id: "kitchen-load", title: "Carga da cozinha", description: "Tickets por estado e idade média.", size: "sm", module: "industry.restaurant", permission: "restaurant.kitchen", periodAware: false },
  // Fashion
  { id: "sales-by-size", title: "Vendas por tamanho", description: "Quantidade por tamanho.", size: "sm", module: "industry.fashion", periodAware: true },
  { id: "sales-by-color", title: "Vendas por cor", description: "Quantidade por cor.", size: "sm", module: "industry.fashion", periodAware: true },
  { id: "variant-stock", title: "Stock por variante", description: "Variantes com stock baixo.", size: "md", module: "industry.fashion", permission: "inventory.view", periodAware: false },
  { id: "return-rate", title: "Taxa de devolução", description: "Devoluções sobre vendas.", size: "sm", module: "industry.fashion", periodAware: true },
  // Auto / electronics
  { id: "active-work-orders", title: "Ordens ativas", description: "Reparações por estado.", size: "sm", module: "industry.auto_parts", permission: "workorders.view", periodAware: false },
  { id: "dead-stock-refs", title: "Referências sem rotação", description: "Peças sem saída (90 dias).", size: "md", module: "industry.auto_parts", permission: "inventory.view", periodAware: false },
  { id: "rma-open", title: "RMA abertos", description: "Ordens em reparação/garantia.", size: "sm", module: "industry.electronics", permission: "workorders.view", periodAware: false },
  { id: "warranty-expiring", title: "Garantias a expirar", description: "Números de série com garantia perto do fim.", size: "sm", module: "industry.electronics", permission: "inventory.view", periodAware: false },
  // Salon
  { id: "today-agenda", title: "Agenda de hoje", description: "Marcações do dia.", size: "md", module: "industry.salon", permission: "scheduling.view", periodAware: false },
  { id: "occupancy-by-staff", title: "Ocupação por profissional", description: "Marcações por recurso hoje.", size: "sm", module: "industry.salon", permission: "scheduling.view", periodAware: false },
  { id: "revenue-by-staff", title: "Receita por colaborador", description: "Serviços concluídos no período.", size: "md", module: "industry.salon", permission: "reports.view", periodAware: true },
  { id: "no-shows", title: "Faltas e cancelamentos", description: "Taxa de no-show no período.", size: "sm", module: "industry.salon", permission: "scheduling.view", periodAware: true },
  // Alerts & insights
  { id: "alerts-feed", title: "Alertas recentes", description: "Últimas notificações operacionais.", size: "md", module: "automation", permission: "notifications.view", periodAware: false },
  { id: "ai-daily-brief", title: "Resumo do dia (IA)", description: "Resumo operacional determinístico com origem dos dados.", size: "lg", module: "insights", permission: "insights.view", periodAware: false },
  { id: "anomalies", title: "Anomalias detetadas", description: "Desvios estatísticos nas vendas diárias (factos + método).", size: "md", module: "insights", permission: "insights.view", periodAware: false },
];

export function getWidget(id: string): WidgetDefinition | undefined {
  return WIDGETS.find((w) => w.id === id);
}

export function periodToFilter(
  period: PeriodKey,
  tz: string,
  branchId?: string,
): { current: PeriodFilter; previous: PeriodFilter } {
  const now = Date.now();
  switch (period) {
    case "today": {
      const today = dayBounds(tz, now, 0);
      const yesterday = dayBounds(tz, now, -1);
      return {
        current: { from: today.start, to: now, branchId },
        previous: { from: yesterday.start, to: yesterday.start + (now - today.start), branchId },
      };
    }
    case "yesterday": {
      const y = dayBounds(tz, now, -1);
      const before = dayBounds(tz, now, -2);
      return {
        current: { from: y.start, to: y.end, branchId },
        previous: { from: before.start, to: before.end, branchId },
      };
    }
    case "7d": {
      const start = dayBounds(tz, now, -6).start;
      const prevStart = dayBounds(tz, now, -13).start;
      return {
        current: { from: start, to: now, branchId },
        previous: { from: prevStart, to: start, branchId },
      };
    }
    case "30d":
    default: {
      const start = dayBounds(tz, now, -29).start;
      const prevStart = dayBounds(tz, now, -59).start;
      return {
        current: { from: start, to: now, branchId },
        previous: { from: prevStart, to: start, branchId },
      };
    }
  }
}

type Fetcher = (ctx: WidgetDataContext) => WidgetPayload;

function ok(widget: string, data: unknown, source?: string): WidgetPayload {
  return { widget, ok: true, data, source, fetchedAt: Date.now() };
}

function fail(widget: string, error: string): WidgetPayload {
  return { widget, ok: false, error, fetchedAt: Date.now() };
}

function buildCtx(orgId: string, branchId: string | undefined, period: PeriodKey): WidgetDataContext {
  const profile = getOrgProfile(orgId);
  const { current } = periodToFilter(period, profile.timezone, branchId);
  return { orgId, branchId, period, from: current.from, to: current.to, tz: profile.timezone };
}

/**
 * Fetches data for a single widget. Errors are captured per-widget so one
 * failing provider never breaks the whole dashboard.
 */
export function fetchWidgetData(
  widgetId: string,
  orgId: string,
  opts: { branchId?: string; period?: PeriodKey } = {},
): WidgetPayload {
  const ctx = buildCtx(orgId, opts.branchId, opts.period ?? "today");
  const fetcher = FETCHERS[widgetId];
  if (!fetcher) return fail(widgetId, `Widget desconhecido: ${widgetId}`);
  try {
    return fetcher(ctx);
  } catch (err) {
    return fail(widgetId, err instanceof Error ? err.message : "Erro ao carregar dados");
  }
}

const FETCHERS: Record<string, Fetcher> = {
  "sales-today": (ctx) => {
    const { current, previous } = periodToFilter(ctx.period, ctx.tz, ctx.branchId);
    const data = comparePeriods(ctx.orgId, current, previous);
    return ok("sales-today", data, "sales (factos)");
  },
  "transactions-today": (ctx) => {
    const summary = salesSummary(ctx.orgId, { from: ctx.from, to: ctx.to, branchId: ctx.branchId });
    return ok("transactions-today", { transactions: summary.transactions, itemsSold: summary.itemsSold }, "sales (factos)");
  },
  "avg-ticket": (ctx) => {
    const summary = salesSummary(ctx.orgId, { from: ctx.from, to: ctx.to, branchId: ctx.branchId });
    return ok("avg-ticket", { avgTicketCents: summary.avgTicketCents, transactions: summary.transactions }, "sales (factos)");
  },
  "revenue-period": (ctx) => {
    const { current, previous } = periodToFilter(ctx.period, ctx.tz, ctx.branchId);
    return ok("revenue-period", comparePeriods(ctx.orgId, current, previous), "sales (factos)");
  },
  "margin-estimate": (ctx) => {
    const summary = salesSummary(ctx.orgId, { from: ctx.from, to: ctx.to, branchId: ctx.branchId });
    return ok(
      "margin-estimate",
      {
        netCents: summary.netCents,
        costCents: summary.costCents,
        estimatedGrossProfitCents: summary.estimatedGrossProfitCents,
        estimatedMarginBps: summary.estimatedMarginBps,
      },
      "estimativa: receita líquida − custo registado (não é lucro contabilístico)",
    );
  },
  "sales-by-hour": (ctx) => ok("sales-by-hour", salesByHour(ctx.orgId, { from: ctx.from, to: ctx.to, branchId: ctx.branchId }, ctx.tz), "sales (factos)"),
  "sales-by-branch": (ctx) => ok("sales-by-branch", salesByBranch(ctx.orgId, { from: ctx.from, to: ctx.to }), "sales (factos)"),
  "top-products": (ctx) => ok("top-products", topProducts(ctx.orgId, { from: ctx.from, to: ctx.to, branchId: ctx.branchId }, 8), "sale_lines (factos)"),
  "open-terminals": (ctx) => {
    const rows = getDb().prepare(
      `SELECT cs.id, t.name as terminal, b.name as branch, cs.opened_at, u.name as opened_by
       FROM cash_sessions cs JOIN terminals t ON t.id = cs.terminal_id
       JOIN branches b ON b.id = cs.branch_id LEFT JOIN users u ON u.id = cs.opened_by
       WHERE cs.org_id = ? AND cs.status = 'open' ${ctx.branchId ? "AND cs.branch_id = ?" : ""}`,
    ).all(ctx.orgId, ...(ctx.branchId ? [ctx.branchId] : []));
    return ok("open-terminals", rows, "cash_sessions (factos)");
  },
  "cash-difference": (ctx) => ok("cash-difference", cashDifferences(ctx.orgId, 5), "cash_sessions (factos)"),
  "payment-mix": (ctx) => ok("payment-mix", paymentMix(ctx.orgId, { from: ctx.from, to: ctx.to, branchId: ctx.branchId }), "sale_payments (factos)"),
  "low-stock": (ctx) => {
    const { rows } = stockOverview(ctx.orgId, { belowMin: true, warehouseId: ctx.branchId ? undefined : undefined, limit: 8 });
    return ok("low-stock", rows, "stock_levels (factos)");
  },
  "critical-stock": (ctx) => ok("critical-stock", { count: criticalStockCount(ctx.orgId) }, "stock_levels (factos)"),
  "stock-valuation": (ctx) => ok("stock-valuation", stockValuation(ctx.orgId), "estimativa: qty × custo médio ponderado"),
  "no-movement": (ctx) => ok("no-movement", noMovementProducts(ctx.orgId, Date.now() - 60 * 86_400_000, 8), "stock_movements (factos)"),
  "expiring-batches": (ctx) => ok("expiring-batches", expiringBatches(ctx.orgId).slice(0, 8), "batches (factos)"),
  "high-rotation": (ctx) => ok("high-rotation", stockRotation(ctx.orgId, Math.max(1, Math.round((ctx.to - ctx.from) / 86_400_000))).slice(0, 8), "sale_lines (factos)"),
  "replenishment-queue": (ctx) => ok("replenishment-queue", purchaseSuggestions(ctx.orgId, 30, 8), "sugestão: velocidade de venda + pontos de encomenda"),
  "pending-orders": (ctx) => {
    const rows = getDb().prepare(
      `SELECT po.po_number, po.status, po.total_cents, s.name as supplier_name, po.expected_at
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.org_id = ? AND po.status IN ('sent','pending_approval','partially_received','draft')
       ORDER BY po.expected_at IS NULL, po.expected_at LIMIT 8`,
    ).all(ctx.orgId);
    return ok("pending-orders", rows, "purchase_orders (factos)");
  },
  "purchase-suggestions": (ctx) => ok("purchase-suggestions", purchaseSuggestions(ctx.orgId, 30, 8), "sugestão: velocidade de venda + stock"),
  "new-customers": (ctx) => ok("new-customers", { count: newCustomers(ctx.orgId, { from: ctx.from, to: ctx.to }) }, "customers (factos)"),
  "loyalty-summary": (ctx) => ok("loyalty-summary", loyaltySummary(ctx.orgId), "loyalty_accounts (factos)"),
  "credit-exposure": (ctx) => ok("credit-exposure", creditExposure(ctx.orgId), "customers (factos)"),
  "margin-by-category": (ctx) => ok("margin-by-category", marginByCategory(ctx.orgId, { from: ctx.from, to: ctx.to, branchId: ctx.branchId }), "estimativa por categoria"),
  "staff-performance": (ctx) => ok("staff-performance", performanceByUser(ctx.orgId, { from: ctx.from, to: ctx.to, branchId: ctx.branchId }), "sales (factos)"),
  "stockouts": (ctx) => ok("stockouts", { count: stockoutCount(ctx.orgId, { from: ctx.from, to: ctx.to }) }, "stock_movements (factos)"),
  "active-orders": (ctx) => {
    const orders = listOpenOrders(ctx.orgId, ctx.branchId);
    return ok("active-orders", { count: orders.length, orders: orders.slice(0, 8) }, "r_orders (factos)");
  },
  "table-occupancy": (ctx) => {
    const branchId = ctx.branchId ?? defaultBranch(ctx.orgId);
    return ok("table-occupancy", tableOccupancy(ctx.orgId, branchId), "r_tables (factos)");
  },
  "avg-prep-time": (ctx) => ok("avg-prep-time", { avgMs: avgPreparationTime(ctx.orgId, Date.now() - 86_400_000) }, "kitchen_tickets (factos)"),
  "top-dishes": (ctx) => ok("top-dishes", topDishes(ctx.orgId, { from: ctx.from, to: ctx.to, branchId: ctx.branchId }, 8), "sale_lines (factos)"),
  "sales-by-shift": (ctx) => ok("sales-by-shift", salesByShift(ctx.orgId, Date.now() - 86_400_000, Date.now()), "shifts+sales (factos)"),
  "kitchen-load": (ctx) => ok("kitchen-load", openKitchenStats(ctx.orgId), "kitchen_tickets (factos)"),
  "sales-by-size": (ctx) => ok("sales-by-size", salesByVariantAttribute(ctx.orgId, { from: ctx.from, to: ctx.to }, "size"), "sale_lines+variants (factos)"),
  "sales-by-color": (ctx) => ok("sales-by-color", salesByVariantAttribute(ctx.orgId, { from: ctx.from, to: ctx.to }, "color"), "sale_lines+variants (factos)"),
  "variant-stock": (ctx) => {
    const rows = getDb().prepare(
      `SELECT p.name, v.label, s.qty_milli FROM stock_levels s
       JOIN products p ON p.id = s.product_id JOIN product_variants v ON v.id = s.variant_id
       WHERE s.org_id = ? AND s.qty_milli <= 2000 ORDER BY s.qty_milli ASC LIMIT 8`,
    ).all(ctx.orgId);
    return ok("variant-stock", rows, "stock_levels (factos)");
  },
  "return-rate": (ctx) => ok("return-rate", returnRate(ctx.orgId, { from: ctx.from, to: ctx.to }), "returns/sales (factos)"),
  "active-work-orders": (ctx) => ok("active-work-orders", openWorkOrders(ctx.orgId), "work_orders (factos)"),
  "dead-stock-refs": (ctx) => ok("dead-stock-refs", noMovementProducts(ctx.orgId, Date.now() - 90 * 86_400_000, 8), "stock_movements (factos)"),
  "rma-open": (ctx) => ok("rma-open", openWorkOrders(ctx.orgId), "work_orders (factos)"),
  "warranty-expiring": (ctx) => {
    const rows = getDb().prepare(
      `SELECT s.serial_number, p.name, s.warranty_ends_at FROM serials s
       JOIN products p ON p.id = s.product_id
       WHERE s.org_id = ? AND s.status = 'sold' AND s.warranty_ends_at IS NOT NULL
         AND s.warranty_ends_at BETWEEN ? AND ?
       ORDER BY s.warranty_ends_at LIMIT 8`,
    ).all(ctx.orgId, Date.now(), Date.now() + 30 * 86_400_000);
    return ok("warranty-expiring", rows, "serials (factos)");
  },
  "today-agenda": (ctx) => {
    const branchId = ctx.branchId ?? defaultBranch(ctx.orgId);
    const day = dayBounds(ctx.tz, Date.now(), 0);
    return ok("today-agenda", agendaForDay(ctx.orgId, branchId, day.start, day.end), "appointments (factos)");
  },
  "occupancy-by-staff": (ctx) => {
    const branchId = ctx.branchId ?? defaultBranch(ctx.orgId);
    const day = dayBounds(ctx.tz, Date.now(), 0);
    const rows = getDb().prepare(
      `SELECT sr.name, COUNT(a.id) appointments, COALESCE(SUM(a.duration_min),0) minutes
       FROM service_resources sr
       LEFT JOIN appointments a ON a.resource_id = sr.id AND a.starts_at >= ? AND a.starts_at < ? AND a.status NOT IN ('cancelled','no_show')
       WHERE sr.org_id = ? AND sr.branch_id = ? AND sr.active = 1
       GROUP BY sr.id ORDER BY appointments DESC`,
    ).all(day.start, day.end, ctx.orgId, branchId);
    return ok("occupancy-by-staff", rows, "appointments (factos)");
  },
  "revenue-by-staff": (ctx) => ok("revenue-by-staff", revenueByStaff(ctx.orgId, { from: ctx.from, to: ctx.to }), "appointments (factos)"),
  "no-shows": (ctx) => ok("no-shows", noShowStats(ctx.orgId, { from: ctx.from, to: ctx.to }), "appointments (factos)"),
  "alerts-feed": (ctx) => {
    const rows = getDb().prepare(
      `SELECT id, kind, severity, title, body, created_at, read_at FROM notifications
       WHERE org_id = ? ORDER BY created_at DESC LIMIT 8`,
    ).all(ctx.orgId);
    return ok("alerts-feed", rows, "notifications (factos)");
  },
  "ai-daily-brief": (ctx) =>
    ok("ai-daily-brief", dailyBrief(ctx.orgId, ctx.branchId), "motor determinístico sobre dados reais"),
  "anomalies": (ctx) =>
    ok("anomalies", detectAnomalies(ctx.orgId), "z-score sobre vendas diárias (28 dias)"),
};

function defaultBranch(orgId: string): string {
  const row = getDb()
    .prepare(`SELECT id FROM branches WHERE org_id = ? ORDER BY is_default DESC, code LIMIT 1`)
    .get(orgId) as { id: string } | undefined;
  if (!row) throw new Error("Organização sem filiais.");
  return row.id;
}

/** Fetches payloads for a set of widgets (used by the dashboard RSC). */
export function fetchWidgets(
  widgetIds: string[],
  orgId: string,
  opts: { branchId?: string; period?: PeriodKey } = {},
): WidgetPayload[] {
  return widgetIds.map((id) => fetchWidgetData(id, orgId, opts));
}
