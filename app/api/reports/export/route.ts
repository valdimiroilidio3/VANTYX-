import { NextResponse } from "next/server";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/**
 * Controlled export: sales CSV for accounting (real data, permission
 * gated, audited). Columns follow the csv_pt convention.
 */
export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("reports.export");
  const url = new URL(request.url);
  const from = Number(url.searchParams.get("from")) || Date.now() - 29 * 86_400_000;
  const to = Number(url.searchParams.get("to")) || Date.now();

  const rows = getDb()
    .prepare(
      `SELECT s.document_number, s.status, s.channel,
              datetime(s.created_at/1000, 'unixepoch') as data_hora,
              b.name as filial, u.name as operador, c.name as cliente, c.tax_id as cliente_nif,
              s.subtotal_cents/100.0 as subtotal, s.discount_cents/100.0 as descontos,
              s.tax_cents/100.0 as imposto, s.net_cents/100.0 as liquido,
              s.total_cents/100.0 as total, s.currency
       FROM sales s
       LEFT JOIN branches b ON b.id = s.branch_id
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.org_id = ? AND s.created_at >= ? AND s.created_at < ?
       ORDER BY s.created_at`,
    )
    .all(ctx.orgId, from, to) as Record<string, string | number | null>[];

  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header =
    "documento;estado;canal;data_hora;filial;operador;cliente;cliente_nif;subtotal;descontos;imposto;liquido;total;moeda";
  const lines = rows.map((r) =>
    [
      r.document_number, r.status, r.channel, r.data_hora, r.filial, r.operador,
      r.cliente, r.cliente_nif,
      String(r.subtotal).replace(".", ","), String(r.descontos).replace(".", ","),
      String(r.imposto).replace(".", ","), String(r.liquido).replace(".", ","),
      String(r.total).replace(".", ","), r.currency,
    ]
      .map(escape)
      .join(";"),
  );
  const csv = "\uFEFF" + [header, ...lines].join("\n");

  const { writeAudit } = await import("@/lib/services/audit.service");
  writeAudit({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    actorLabel: ctx.userName,
    action: "reports.export",
    resourceType: "report",
    after: { from, to, rows: rows.length },
  });

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="vantyx-vendas-${new Date(from).toISOString().slice(0, 10)}.csv"`,
    },
  });
});
