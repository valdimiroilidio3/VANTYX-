import { getDb } from "@/lib/db/client";
import {
  comparePeriods,
  dayBounds,
  salesByDay,
  salesSummary,
  topProducts,
} from "@/lib/services/analytics.service";
import { noMovementProducts, stockValuation } from "@/lib/services/inventory.service";
import { purchaseSuggestions } from "@/lib/services/purchasing.service";
import { getOrgProfile } from "@/lib/services/org.service";

/**
 * VANTYX Business Assistant — deterministic insight engine.
 *
 * Principles:
 *  - Every statement cites its data source and method.
 *  - Facts, estimates and projections are explicitly distinguished.
 *  - No fabricated values, no guarantees: anomaly detection is a
 *    statistical signal, not a verdict.
 *  - An optional LLM adapter exists (see llm-adapter.ts); without
 *    credentials the platform runs fully on this deterministic engine.
 */

export interface BriefSection {
  title: string;
  facts: string[];
  source: string;
  kind: "fact" | "estimate" | "projection";
}

export interface DailyBrief {
  generatedAt: number;
  sections: BriefSection[];
  engine: "deterministic";
  disclaimer: string;
}

function fmtMoney(cents: number, currency: string): string {
  return `${(cents / 100).toLocaleString("pt-PT", { minimumFractionDigits: 2 })} ${currency}`;
}

export async function dailyBrief(orgId: string, branchId?: string): Promise<DailyBrief> {
  const profile = await getOrgProfile(orgId);
  const currency = profile.currency;
  const tz = profile.timezone;
  const now = Date.now();
  const today = dayBounds(tz, now, 0);
  const yesterday = dayBounds(tz, now, -1);

  const todaySummary = await salesSummary(orgId, { from: today.start, to: now, branchId });
  const comparison = await comparePeriods(
    orgId,
    { from: today.start, to: now, branchId },
    { from: yesterday.start, to: yesterday.start + (now - today.start), branchId },
  );

  const sections: BriefSection[] = [];

  sections.push({
    title: "Vendas de hoje (até agora)",
    facts: [
      `Receita bruta: ${fmtMoney(todaySummary.grossCents, currency)} em ${todaySummary.transactions} transações.`,
      `Ticket médio: ${fmtMoney(todaySummary.avgTicketCents, currency)}.`,
      `Imposto incluído: ${fmtMoney(todaySummary.taxCents, currency)} · Descontos: ${fmtMoney(todaySummary.discountCents, currency)}.`,
    ],
    source: "tabela sales, período: hoje 00:00 → agora (fuso da organização)",
    kind: "fact",
  });

  const pct = (bps: number) => `${bps >= 0 ? "+" : ""}${(bps / 100).toFixed(1)}%`;
  sections.push({
    title: "Variação vs. ontem (mesma hora)",
    facts: [
      `Receita bruta ${pct(comparison.deltaBps.gross)} · Transações ${pct(comparison.deltaBps.transactions)} · Ticket médio ${pct(comparison.deltaBps.avgTicket)}.`,
      Math.abs(comparison.deltaBps.gross) >= 2000
        ? `Desvio relevante (${pct(comparison.deltaBps.gross)}). Verifique eventos locais, promoções ou ruturas de stock antes de concluir.`
        : `Dentro da variação normal (<20%).`,
    ],
    source: "comparação sales hoje vs. ontem à mesma hora",
    kind: "fact",
  });

  sections.push({
    title: "Margem estimada (hoje)",
    facts: [
      `Lucro bruto estimado: ${fmtMoney(todaySummary.estimatedGrossProfitCents, currency)} (${(todaySummary.estimatedMarginBps / 100).toFixed(1)}% da receita líquida).`,
      `Nota: margem estimada = receita líquida − custo registado dos produtos vendidos. Não inclui custos operacionais; não é lucro líquido.`,
    ],
    source: "sale_lines.cost_cents (custos registados)",
    kind: "estimate",
  });

  const top = await topProducts(orgId, { from: today.start, to: now, branchId }, 3);
  if (top.length) {
    sections.push({
      title: "Mais vendidos hoje",
      facts: top.map(
        (t) => `${t.name}: ${(t.qty_milli / 1000).toLocaleString("pt-PT")} un. (${fmtMoney(t.total_cents, currency)})`,
      ),
      source: "sale_lines agrupado por produto",
      kind: "fact",
    });
  }

  const suggestions = await purchaseSuggestions(orgId, 30, 5);
  if (suggestions.length) {
    sections.push({
      title: "Reposição sugerida",
      facts: suggestions.map((s) => {
        const stock = s.stock_milli / 1000;
        const velocity = (s.avg_daily_milli / 1000).toFixed(1);
        const suggested = s.reorder_qty_milli
          ? s.reorder_qty_milli / 1000
          : Math.max(1, Math.round((s.avg_daily_milli * 7 - s.stock_milli) / 1000));
        return `${s.name}: stock ${stock} · vende ~${velocity}/dia · sugerido encomendar ${suggested}`;
      }),
      source: "velocidade de venda 30d + stock atual (sugestão, não previsão garantida)",
      kind: "projection",
    });
  }

  const dead = await noMovementProducts(orgId, now - 60 * 86_400_000, 3);
  if (dead.length) {
    sections.push({
      title: "Sem movimento (60 dias)",
      facts: dead.map((d) => `${d.name} (SKU ${d.sku}): ${(d.qty_milli / 1000).toLocaleString("pt-PT")} un. paradas`),
      source: "stock_movements: sem saídas em 60 dias",
      kind: "fact",
    });
  }

  const valuation = await stockValuation(orgId);
  sections.push({
    title: "Inventário",
    facts: [
      `Valor do stock (custo médio ponderado): ${fmtMoney(valuation.valueCents, currency)} em ${valuation.positions} posições.`,
    ],
    source: "stock_levels × avg_cost_cents",
    kind: "estimate",
  });

  return {
    generatedAt: now,
    sections,
    engine: "deterministic",
    disclaimer:
      "Gerado pelo motor determinístico VANTYX a partir de dados reais da organização. Factos, estimativas e projeções estão identificados por secção. Projeções são sugestões operacionais, não garantias.",
  };
}

/* -------------------------- Anomaly detection -------------------------- */

export interface Anomaly {
  date: string;
  totalCents: number;
  expectedCents: number;
  zScore: number;
  direction: "above" | "below";
  severity: "moderate" | "high";
}

export interface AnomalyReport {
  method: string;
  windowDays: number;
  anomalies: Anomaly[];
  note: string;
}

/**
 * Z-score anomaly detection over daily revenue (last 28 days).
 * Statistical signal only — explicitly not a conclusion.
 */
export async function detectAnomalies(orgId: string, windowDays = 28): Promise<AnomalyReport> {
  const profile = await getOrgProfile(orgId);
  const now = Date.now();
  const from = dayBounds(profile.timezone, now, -windowDays).start;
  const days = await salesByDay(orgId, { from, to: now }, profile.timezone);
  if (days.length < 7) {
    return {
      method: "z-score sobre receita diária",
      windowDays,
      anomalies: [],
      note: `Dados insuficientes (${days.length} dias com vendas; mínimo 7). Nenhum desvio reportado — sem histórico não há deteção honesta.`,
    };
  }
  const values = days.map((d) => d.total_cents);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const anomalies: Anomaly[] = [];
  if (std > 0) {
    for (const day of days) {
      const z = (day.total_cents - mean) / std;
      if (Math.abs(z) >= 2) {
        anomalies.push({
          date: day.day,
          totalCents: day.total_cents,
          expectedCents: Math.round(mean),
          zScore: Math.round(z * 100) / 100,
          direction: z > 0 ? "above" : "below",
          severity: Math.abs(z) >= 3 ? "high" : "moderate",
        });
      }
    }
  }
  return {
    method: "z-score sobre receita diária (média e desvio-padrão da janela)",
    windowDays,
    anomalies,
    note: anomalies.length
      ? "Sinal estatístico: investigue causas operacionais (eventos, promoções, ruturas, erros de lançamento) antes de decidir. Um desvio não é, por si só, um problema."
      : "Nenhum desvio relevante (|z| ≥ 2) na janela analisada.",
  };
}

/* ---------------------- Natural-language search ------------------------ */

export interface NlSearchResult {
  intent: string;
  answer: string;
  data: unknown;
  source: string;
}

/**
 * Lightweight NL search over AUTHORIZED data only (read-only intents).
 * Deterministic intent matching — an optional LLM adapter can extend it
 * when credentials are configured (never required).
 */
export async function nlSearch(
  orgId: string,
  query: string,
  permissions: { reports: boolean; inventory: boolean; customers: boolean },
): Promise<NlSearchResult> {
  const q = query.toLowerCase().trim();
  const profile = await getOrgProfile(orgId);
  const now = Date.now();

  if (!permissions.reports && !permissions.inventory && !permissions.customers) {
    return { intent: "unauthorized", answer: "Sem permissões para consultar dados.", data: null, source: "rbac" };
  }

  // "vendas hoje/ontem/semana"
  const salesMatch = q.match(/vendas?\s+(de\s+)?(hoje|ontem|semana|mês|mes)/);
  if (salesMatch && permissions.reports) {
    const when = salesMatch[2]!;
    const filter =
      when === "hoje"
        ? { from: dayBounds(profile.timezone, now, 0).start, to: now }
        : when === "ontem"
          ? { from: dayBounds(profile.timezone, now, -1).start, to: dayBounds(profile.timezone, now, -1).end }
          : when === "semana"
            ? { from: dayBounds(profile.timezone, now, -6).start, to: now }
            : { from: dayBounds(profile.timezone, now, -29).start, to: now };
    const summary = await salesSummary(orgId, filter);
    return {
      intent: "sales_summary",
      answer: `Receita bruta ${fmtMoney(summary.grossCents, profile.currency)} · ${summary.transactions} transações · ticket médio ${fmtMoney(summary.avgTicketCents, profile.currency)} · margem estimada ${(summary.estimatedMarginBps / 100).toFixed(1)}%.`,
      data: summary,
      source: `sales (${when})`,
    };
  }

  // "stock de <produto>"
  const stockMatch = q.match(/stock\s+(de|do|da)\s+(.+)/);
  if (stockMatch && permissions.inventory) {
    const term = `%${stockMatch[2]!.trim()}%`;
    const rows = (await getDb()
      .prepare(
        `SELECT p.name, p.sku, COALESCE(SUM(s.qty_milli),0) qty_milli, p.unit
         FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id AND s.org_id = p.org_id
         WHERE p.org_id = ? AND (p.name LIKE ? OR p.sku LIKE ?)
         GROUP BY p.id ORDER BY p.name LIMIT 10`,
      )
      .all(orgId, term, term)) as { name: string; sku: string; qty_milli: number; unit: string }[];
    if (!rows.length) {
      return { intent: "stock_query", answer: "Nenhum produto encontrado com esse termo.", data: [], source: "products" };
    }
    return {
      intent: "stock_query",
      answer: rows.map((r) => `${r.name} (${r.sku}): ${(r.qty_milli / 1000).toLocaleString("pt-PT")} ${r.unit}`).join(" · "),
      data: rows,
      source: "stock_levels",
    };
  }

  // "top produtos"
  if (/top|mais vend/.test(q) && permissions.reports) {
    const top = await topProducts(orgId, { from: dayBounds(profile.timezone, now, -29).start, to: now }, 5);
    return {
      intent: "top_products",
      answer: top.length
        ? top.map((t, i) => `${i + 1}. ${t.name} — ${(t.qty_milli / 1000).toLocaleString("pt-PT")} un.`).join(" · ")
        : "Sem vendas nos últimos 30 dias.",
      data: top,
      source: "sale_lines (30 dias)",
    };
  }

  return {
    intent: "unknown",
    answer:
      "Não reconheci a pergunta. Posso responder sobre: vendas (hoje/ontem/semana/mês), stock de um produto, top de produtos. A pesquisa usa apenas dados autorizados ao seu perfil.",
    data: null,
    source: "intent matcher determinístico",
  };
}
