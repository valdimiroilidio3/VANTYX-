import { NextResponse } from "next/server";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { getDb } from "@/lib/db/client";
import { buildSaftPt } from "@/lib/fiscal/saft-pt";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/fiscal/saft-pt?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Descarrega o ficheiro SAF-T (PT) SalesInvoices do período (schema 1.04_01).
 * Permissão fiscal.manage (dados sensíveis do emitente).
 */
export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("fiscal.manage");
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json(
      { ok: false, error: { message: "Parâmetros from/to obrigatórios (YYYY-MM-DD).", code: "validation_error" } },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json(
      { ok: false, error: { message: "Período inválido: from > to.", code: "validation_error" } },
      { status: 400 },
    );
  }
  const { xml, fileName } = await buildSaftPt(getDb(), ctx.orgId, { from, to });
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
});
