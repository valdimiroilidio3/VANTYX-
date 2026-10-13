import { getDb } from "@/lib/db/client";

/**
 * Analytics — every metric derives from real transactional data.
 * No synthetic/demo numbers are ever generated here. Revenue, gross
 * profit (estimated margin), tax and cash flow are ALWAYS reported as
 * distinct figures.
 */

/* ------------------------- Time helpers ------------------------- */

export function tzOffsetMs(tz: string, at: number): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const map: Record<string, string> = {};
    for (const p of dtf.formatToParts(new Date(at))) map[p.type] = p.value;
    const asUTC = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour) % 24,
      Number(map.minute),
      Number(map.second),
    );
    return asUTC - Math.floor(at / 1000) * 1000;
  } catch {
    return 0;
  }
}

export function dayBounds(
  tz: string,
  at = Date.now(),
  dayOffset = 0,
): { start: number; end: number } {
  const offset = tzOffsetMs(tz, at);
  const local = at + offset;
  const localDayStart =
    Math.floor(local / 86_400_000) * 86_400_000 + dayOffset * 86_400_000;
  return {
    start: localDayStart - offset,
    end: localDayStart - offset + 86_400_000,
  };
}

export interface PeriodFilter {
  from: number;
  to: number;
  branchId?: string;
}

/* ------------------------- Sales metrics ------------------------- */

export interface SalesSummary {
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

export function salesSummary(orgId: string, filter: PeriodFilter): SalesSummary {
  const db = getDb();
  const params: (string | number)[] = [orgId, filter.from, filter.to];
  let branchClause = "";
  if (filter.branchId) {
    branchClause = " AND branch_id = ?";
    params.push(filter.branchId);
  }
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(total_cents),0) gross, COALESCE(SUM(net_cents),0) net,
              COALESCE(SUM(tax_cents),0) tax, COALESCE(SUM(discount_cents),0) disc,
              COALESCE(SUM(cost_cents),0) cost, COUNT(*) tx
       FROM sales WHERE org_id = ? AND created_at >= ? AND created_at < ? AND status != 'void'${branchClause}`,
    )
    .get(...params) as { gross: number; net: number; tax: number; disc: number; cost: number; tx: number };

  const returnsRow = db
    .prepare(
      `SELECT COALESCE(SUM(r.total_cents),0) total FROM returns r
       JOIN sales s ON s.id = r.sale_id
       WHERE r.org_id = ? AND r.created_at >= ? AND r.created_at < ? AND r.status = 'completed'
       ${filter.branchId ? "AND s.branch_id = ?" : ""}`,
    )
    .get(...params) as { total: number };

  const itemsRow = db
    .prepare(
      `SELECT COALESCE(SUM(sl.qty_milli),0) q FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id
       WHERE s.org_id = ? AND s.created_at >= ? AND s.created_at < ? AND s.status != 'void'${filter.branchId ? " AND s.branch_id = ?" : ""}`,
    )
    .get(...params) as { q: number };

  const grossProfit = row.net - row.cost;
  return {
    grossCents: row.gross,
    netCents: row.net,
    taxCents: row.tax,
    discountCents: row.disc,
    returnsCents: returnsRow.total,
    costCents: row.cost,
    estimatedGrossProfitCents: grossProfit,
    estimatedMarginBps: row.net > 0 ? Math.round((grossProfit * 10000) / row.net) : 0,
    transactions: row.tx,
    avgTicketCents: row.tx > 0 ? Math.round(row.gross / row.tx) : 0,
    itemsSold: itemsRow.q,
  };
}

export function salesByHour(orgId: string, filter: PeriodFilter, tz: string) {
  const db = getDb();
  const offset = tzOffsetMs(tz, filter.from);
  const rows = db
    .prepare(
      `SELECT (created_at + ?) / 3600000 % 24 as hour, COUNT(*) tx, COALESCE(SUM(total_cents),0) total
       FROM sales WHERE org_id = ? AND created_at >= ? AND created_at < ? AND status != 'void'
       ${filter.branchId ? "AND branch_id = ?" : ""}
       GROUP BY hour ORDER BY hour`,
    )
    .all(offset, orgId, filter.from, filter.to, ...(filter.branchId ? [filter.branchId] : [])) as {
    hour: number;
    tx: number;
    total: number;
  }[];
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, tx: 0, totalCents: 0 }));
  for (const r of rows) {
    const bucket = buckets[r.hour];
    if (bucket) {
      bucket.tx = r.tx;
      bucket.totalCents = r.total;
    }
  }
  return buckets;
}

export function salesByDay(orgId: string, filter: PeriodFilter, tz: string) {
  const db = getDb();
  const offset = tzOffsetMs(tz, filter.from);
  return db
    .prepare(
      `SELECT DATE((created_at + ?) / 1000, 'unixepoch') as day, COUNT(*) tx,
              COALESCE(SUM(total_cents),0) total_cents, COALESCE(SUM(net_cents),0) net_cents,
              COALESCE(SUM(cost_cents),0) cost_cents
       FROM sales WHERE org_id = ? AND created_at >= ? AND created_at < ? AND status != 'void'
       ${filter.branchId ? "AND branch_id = ?" : ""}
       GROUP BY day ORDER BY day`,
    )
    .all(offset, orgId, filter.from, filter.to, ...(filter.branchId ? [filter.branchId] : [])) as {
    day: string;
    tx: number;
    total_cents: number;
    net_cents: number;
    cost_cents: number;
  }[];
}

export function salesByBranch(orgId: string, filter: PeriodFilter) {
  return getDb()
    .prepare(
      `SELECT b.id, b.name, COUNT(s.id) tx, COALESCE(SUM(s.total_cents),0) total_cents
       FROM branches b
       LEFT JOIN sales s ON s.branch_id = b.id AND s.created_at >= ? AND s.created_at < ? AND s.status != 'void'
       WHERE b.org_id = ?
       GROUP BY b.id ORDER BY total_cents DESC`,
    )
    .all(filter.from, filter.to, orgId) as { id: string; name: string; tx: number; total_cents: number }[];
}

export function topProducts(orgId: string, filter: PeriodFilter, limit = 10) {
  return getDb()
    .prepare(
      `SELECT sl.product_id, p.name, p.sku, SUM(sl.qty_milli) qty_milli,
              SUM(sl.total_cents) total_cents, SUM(sl.net_cents) net_cents, SUM(sl.cost_cents) cost_cents,
              COUNT(DISTINCT sl.sale_id) sales_count
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id AND s.status != 'void'
       JOIN products p ON p.id = sl.product_id
       WHERE s.org_id = ? AND s.created_at >= ? AND s.created_at < ?
       ${filter.branchId ? "AND s.branch_id = ?" : ""}
       GROUP BY sl.product_id ORDER BY qty_milli DESC LIMIT ?`,
    )
    .all(orgId, filter.from, filter.to, ...(filter.branchId ? [filter.branchId] : []), limit) as TopProductRow[];
}

export interface TopProductRow {
  product_id: string;
  name: string;
  sku: string;
  qty_milli: number;
  total_cents: number;
  net_cents: number;
  cost_cents: number;
  sales_count: number;
}

export function marginByCategory(orgId: string, filter: PeriodFilter) {
  return getDb()
    .prepare(
      `SELECT COALESCE(c.name, 'Sem categoria') as category,
              SUM(sl.total_cents) total_cents, SUM(sl.net_cents) net_cents, SUM(sl.cost_cents) cost_cents
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id AND s.status != 'void'
       JOIN products p ON p.id = sl.product_id
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE s.org_id = ? AND s.created_at >= ? AND s.created_at < ?
       ${filter.branchId ? "AND s.branch_id = ?" : ""}
       GROUP BY c.id ORDER BY total_cents DESC`,
    )
    .all(orgId, filter.from, filter.to, ...(filter.branchId ? [filter.branchId] : [])) as {
    category: string;
    total_cents: number;
    net_cents: number;
    cost_cents: number;
  }[];
}

export function performanceByUser(orgId: string, filter: PeriodFilter) {
  return getDb()
    .prepare(
      `SELECT u.id, u.name, COUNT(s.id) tx, COALESCE(SUM(s.total_cents),0) total_cents,
              COALESCE(SUM(s.discount_cents),0) discount_cents
       FROM users u
       LEFT JOIN sales s ON s.created_by = u.id AND s.created_at >= ? AND s.created_at < ? AND s.status != 'void'
       ${filter.branchId ? "AND s.branch_id = ?" : ""}
       WHERE u.org_id = ?
       GROUP BY u.id HAVING tx > 0 ORDER BY total_cents DESC`,
    )
    .all(filter.from, filter.to, ...(filter.branchId ? [filter.branchId] : []), orgId) as {
    id: string;
    name: string;
    tx: number;
    total_cents: number;
    discount_cents: number;
  }[];
}

export function paymentMix(orgId: string, filter: PeriodFilter) {
  return getDb()
    .prepare(
      `SELECT sp.method_key, pm.name, COUNT(*) n, COALESCE(SUM(sp.amount_cents),0) total_cents
       FROM sale_payments sp
       JOIN sales s ON s.id = sp.sale_id AND s.status != 'void'
       LEFT JOIN payment_methods pm ON pm.key = sp.method_key AND pm.org_id = s.org_id
       WHERE sp.org_id = ? AND s.created_at >= ? AND s.created_at < ?
       ${filter.branchId ? "AND s.branch_id = ?" : ""}
       GROUP BY sp.method_key ORDER BY total_cents DESC`,
    )
    .all(orgId, filter.from, filter.to, ...(filter.branchId ? [filter.branchId] : [])) as {
    method_key: string;
    name: string | null;
    n: number;
    total_cents: number;
  }[];
}

/* ------------------------ Stock analytics ------------------------- */

export function stockRotation(orgId: string, daysBack = 30) {
  const db = getDb();
  const since = Date.now() - daysBack * 86_400_000;
  return db
    .prepare(
      `SELECT p.id, p.name, p.sku,
        COALESCE((SELECT SUM(sl.qty_milli) FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
                  WHERE sl.product_id = p.id AND s.org_id = p.org_id AND s.created_at >= ? AND s.status != 'void'),0) as sold_milli,
        COALESCE((SELECT SUM(st.qty_milli) FROM stock_levels st WHERE st.product_id = p.id AND st.org_id = p.org_id),0) as stock_milli
       FROM products p
       WHERE p.org_id = ? AND p.status = 'active' AND p.track_stock = 1
       ORDER BY sold_milli DESC LIMIT 200`,
    )
    .all(since, orgId) as { id: string; name: string; sku: string; sold_milli: number; stock_milli: number }[];
}

export function stockoutCount(orgId: string, filter: PeriodFilter) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) c FROM stock_movements
       WHERE org_id = ? AND reason_code IN ('sale') AND created_at >= ? AND created_at < ?
       AND (SELECT sl.qty_milli FROM stock_levels sl WHERE sl.org_id = stock_movements.org_id AND sl.product_id = stock_movements.product_id AND sl.variant_id IS stock_movements.variant_id LIMIT 1) < 0`,
    )
    .get(orgId, filter.from, filter.to) as { c: number };
  return row.c;
}

export function criticalStockCount(orgId: string) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(DISTINCT p.id) c
       FROM products p
       JOIN stock_levels s ON s.product_id = p.id AND s.org_id = p.org_id
       WHERE p.org_id = ? AND p.reorder_point_milli IS NOT NULL AND p.status = 'active'
       GROUP BY p.id HAVING SUM(s.qty_milli) <= p.reorder_point_milli`,
    )
    .all(orgId) as { c: number }[];
  return row.length;
}

export function cashDifferences(orgId: string, limit = 10) {
  return getDb()
    .prepare(
      `SELECT cs.id, cs.difference_cents, cs.closed_at, b.name as branch_name, t.name as terminal_name, u.name as closed_by_name
       FROM cash_sessions cs
       JOIN branches b ON b.id = cs.branch_id
       JOIN terminals t ON t.id = cs.terminal_id
       LEFT JOIN users u ON u.id = cs.closed_by
       WHERE cs.org_id = ? AND cs.status = 'closed' AND cs.difference_cents != 0
       ORDER BY cs.closed_at DESC LIMIT ?`,
    )
    .all(orgId, limit);
}

/* --------------------- Restaurant analytics ------------------------ */

export function tableOccupancy(orgId: string, branchId: string) {
  const db = getDb();
  const tables = db.prepare(`SELECT status FROM r_tables WHERE org_id = ? AND branch_id = ?`).all(orgId, branchId) as { status: string }[];
  const total = tables.length;
  const occupied = tables.filter((t) => t.status === "occupied").length;
  const reserved = tables.filter((t) => t.status === "reserved").length;
  const openOrders = (db.prepare(`SELECT COUNT(*) c FROM r_orders WHERE org_id = ? AND branch_id = ? AND status = 'open'`).get(orgId, branchId) as { c: number }).c;
  return { total, occupied, reserved, free: total - occupied - reserved, openOrders };
}

export function topDishes(orgId: string, filter: PeriodFilter, limit = 8) {
  return getDb()
    .prepare(
      `SELECT p.name, SUM(sl.qty_milli) qty_milli, SUM(sl.total_cents) total_cents
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id AND s.status != 'void'
       JOIN products p ON p.id = sl.product_id
       WHERE s.org_id = ? AND s.created_at >= ? AND s.created_at < ?
       ${filter.branchId ? "AND s.branch_id = ?" : ""}
       GROUP BY p.id ORDER BY qty_milli DESC LIMIT ?`,
    )
    .all(orgId, filter.from, filter.to, ...(filter.branchId ? [filter.branchId] : []), limit) as {
    name: string;
    qty_milli: number;
    total_cents: number;
  }[];
}

export function openKitchenStats(orgId: string) {
  const db = getDb();
  const now = Date.now();
  const rows = db.prepare(
    `SELECT status, COUNT(*) c, COALESCE(AVG(? - sent_at), 0) avg_age_ms
     FROM kitchen_tickets WHERE org_id = ? AND status IN ('pending','preparing','ready')
     GROUP BY status`,
  ).all(now, orgId) as { status: string; c: number; avg_age_ms: number }[];
  const out: Record<string, { count: number; avgAgeMs: number }> = {};
  for (const r of rows) out[r.status] = { count: r.c, avgAgeMs: Math.round(r.avg_age_ms) };
  return out;
}

/* ------------------------ Fashion analytics ------------------------- */

export function salesByVariantAttribute(
  orgId: string,
  filter: PeriodFilter,
  attribute: "size" | "color",
) {
  return getDb()
    .prepare(
      `SELECT json_extract(v.attributes, ?) as attr_value,
              SUM(sl.qty_milli) qty_milli, SUM(sl.total_cents) total_cents
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id AND s.status != 'void'
       JOIN product_variants v ON v.id = sl.variant_id
       WHERE s.org_id = ? AND s.created_at >= ? AND s.created_at < ?
       GROUP BY attr_value HAVING attr_value IS NOT NULL
       ORDER BY total_cents DESC`,
    )
    .all(`$.${attribute}`, orgId, filter.from, filter.to) as {
    attr_value: string;
    qty_milli: number;
    total_cents: number;
  }[];
}

export function returnRate(orgId: string, filter: PeriodFilter) {
  const db = getDb();
  const sales = (db.prepare(
    `SELECT COUNT(*) c, COALESCE(SUM(total_cents),0) total FROM sales
     WHERE org_id = ? AND created_at >= ? AND created_at < ? AND status != 'void'`,
  ).get(orgId, filter.from, filter.to) as { c: number; total: number });
  const returns = (db.prepare(
    `SELECT COUNT(*) c, COALESCE(SUM(total_cents),0) total FROM returns
     WHERE org_id = ? AND created_at >= ? AND created_at < ? AND status = 'completed'`,
  ).get(orgId, filter.from, filter.to) as { c: number; total: number });
  return {
    salesCount: sales.c,
    returnsCount: returns.c,
    countRateBps: sales.c > 0 ? Math.round((returns.c * 10000) / sales.c) : 0,
    valueRateBps: sales.total > 0 ? Math.round((returns.total * 10000) / sales.total) : 0,
    returnedCents: returns.total,
  };
}

/* ------------------------- Salon analytics --------------------------- */

export function agendaForDay(orgId: string, branchId: string, dayStart: number, dayEnd: number) {
  return getDb()
    .prepare(
      `SELECT a.*, sr.name as resource_name, sr.kind as resource_kind
       FROM appointments a JOIN service_resources sr ON sr.id = a.resource_id
       WHERE a.org_id = ? AND a.branch_id = ? AND a.starts_at >= ? AND a.starts_at < ?
       ORDER BY a.starts_at`,
    )
    .all(orgId, branchId, dayStart, dayEnd);
}

export function revenueByStaff(orgId: string, filter: PeriodFilter) {
  return getDb()
    .prepare(
      `SELECT sr.id, sr.name, sr.commission_bps, COUNT(a.id) appointments_done,
              COALESCE(SUM(a.price_cents),0) revenue_cents
       FROM service_resources sr
       LEFT JOIN appointments a ON a.resource_id = sr.id AND a.status = 'done'
             AND a.starts_at >= ? AND a.starts_at < ?
       WHERE sr.org_id = ? AND sr.active = 1
       GROUP BY sr.id ORDER BY revenue_cents DESC`,
    )
    .all(filter.from, filter.to, orgId) as {
    id: string;
    name: string;
    commission_bps: number;
    appointments_done: number;
    revenue_cents: number;
  }[];
}

export function noShowStats(orgId: string, filter: PeriodFilter) {
  const row = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) no_shows,
         SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) cancelled,
         COUNT(*) total
       FROM appointments WHERE org_id = ? AND starts_at >= ? AND starts_at < ?`,
    )
    .get(orgId, filter.from, filter.to) as { no_shows: number | null; cancelled: number | null; total: number };
  return {
    noShows: row.no_shows ?? 0,
    cancelled: row.cancelled ?? 0,
    total: row.total,
    rateBps: row.total > 0 ? Math.round(((row.no_shows ?? 0) * 10000) / row.total) : 0,
  };
}

/* ------------------------- CRM analytics ------------------------------ */

export function newCustomers(orgId: string, filter: PeriodFilter) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) c FROM customers WHERE org_id = ? AND created_at >= ? AND created_at < ?`,
    )
    .get(orgId, filter.from, filter.to) as { c: number };
  return row.c;
}

export function loyaltySummary(orgId: string) {
  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(*) accounts, COALESCE(SUM(points_balance),0) points FROM loyalty_accounts WHERE org_id = ?`,
  ).get(orgId) as { accounts: number; points: number };
  return row;
}

export function creditExposure(orgId: string) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) customers, COALESCE(SUM(credit_balance_cents),0) balance_cents,
              COALESCE(SUM(credit_limit_cents),0) limit_cents
       FROM customers WHERE org_id = ? AND credit_limit_cents > 0`,
    )
    .get(orgId) as { customers: number; balance_cents: number; limit_cents: number };
  return row;
}

/* ---------------------- Work orders / electronics ---------------------- */

export function openWorkOrders(orgId: string) {
  return getDb()
    .prepare(
      `SELECT status, COUNT(*) c, COALESCE(SUM(total_cents),0) total_cents
       FROM work_orders WHERE org_id = ? AND status NOT IN ('delivered','cancelled','done')
       GROUP BY status`,
    )
    .all(orgId) as { status: string; c: number; total_cents: number }[];
}

/* ------------------------- Period comparison --------------------------- */

export function comparePeriods(
  orgId: string,
  current: PeriodFilter,
  previous: PeriodFilter,
) {
  const cur = salesSummary(orgId, current);
  const prev = salesSummary(orgId, previous);
  const delta = (a: number, b: number) => (b === 0 ? (a > 0 ? 10000 : 0) : Math.round(((a - b) * 10000) / b));
  return {
    current: cur,
    previous: prev,
    deltaBps: {
      gross: delta(cur.grossCents, prev.grossCents),
      transactions: delta(cur.transactions, prev.transactions),
      avgTicket: delta(cur.avgTicketCents, prev.avgTicketCents),
      margin: delta(cur.estimatedGrossProfitCents, prev.estimatedGrossProfitCents),
    },
  };
}
