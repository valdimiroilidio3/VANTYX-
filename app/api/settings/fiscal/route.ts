import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("settings.view");
  const db = getDb();
  const series = await db
    .prepare(
      `SELECT *, (next_number - 1) as issued_count FROM document_series
       WHERE org_id = ? ORDER BY fiscal_year DESC, doc_type, prefix`,
    )
    .all(ctx.orgId);
  const lastDocuments = await db
    .prepare(
      `SELECT document_number, status, total_cents, created_at, hash, prev_hash, atcud
       FROM sales WHERE org_id = ? AND document_number IS NOT NULL
       ORDER BY created_at DESC LIMIT 10`,
    )
    .all(ctx.orgId);
  const creditNotes = await db
    .prepare(
      `SELECT document_number, total_cents, created_at, hash FROM returns
       WHERE org_id = ? ORDER BY created_at DESC LIMIT 10`,
    )
    .all(ctx.orgId);
  return {
    series,
    lastDocuments,
    creditNotes,
    complianceNotice:
      "Numeração sequencial por série/exercício + assinatura SHA-1/Base-64 (Portaria 363/2010 e Despacho 8632/2014) + QR Code (Portaria 195/2020) implementados. O software AINDA NÃO é certificado pela AT: a certificação é um processo administrativo da empresa produtora — ver docs/CERTIFICACAO-AT.md. Documentos finalizados nunca são editados; correções apenas via nota de crédito.",
  };
});

const schema = z.object({
  docType: z.enum(["FT", "FR", "NC", "GT", "RC"]),
  prefix: z.string().min(1).max(8),
  fiscalYear: z.number().int().min(2000).max(2100),
});

/** Creates/updates a series prefix for the NEXT fiscal year (never rewrites
 * an in-use series mid-year — that would break sequential numbering). */
export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("fiscal.manage");
  const db = getDb();
  const currentYear = new Date().getFullYear();
  if (body.fiscalYear <= currentYear) {
    const existing = (await db
      .prepare(`SELECT next_number FROM document_series WHERE org_id = ? AND doc_type = ? AND fiscal_year = ?`)
      .get(ctx.orgId, body.docType, body.fiscalYear)) as { next_number: number } | undefined;
    if (existing && existing.next_number > 1) {
      return {
        error: "Série em uso num ano iniciado não pode ser alterada (integridade da numeração sequencial).",
      };
    }
  }
  const { newId } = await import("@/lib/domain/ids");
  await db.prepare(
    `INSERT INTO document_series (id, org_id, doc_type, prefix, fiscal_year, next_number)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(org_id, doc_type, prefix, fiscal_year) DO NOTHING`,
  ).run(newId("dser"), ctx.orgId, body.docType, body.prefix.toUpperCase(), body.fiscalYear);
  return { saved: true };
}, schema);
