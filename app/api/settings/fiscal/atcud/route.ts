import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { getDb, tx } from "@/lib/db/client";
import { writeAudit } from "@/lib/services/audit.service";

export const dynamic = "force-dynamic";

/**
 * Guarda o código de validação de série atribuído pela AT (após comunicação
 * da série no Portal das Finanças) para gerar ATCUD reais:
 * "ATCUD = códigoValidação-sequencial" (Portaria 195/2020, art. 3.º).
 * Sem código comunicado, o sistema NÃO inventa ATCUD.
 */
const schema = z.object({
  seriesId: z.string().min(1),
  code: z
    .string()
    .trim()
    .min(8)
    .max(32)
    .regex(/^[A-Z0-9]+$/, "O código de validação AT deve ser alfanumérico maiúsculo (≥8 caracteres).")
    .nullable(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("fiscal.manage");
  const db = getDb();
  const series = (await db
    .prepare(`SELECT id, doc_type, prefix, fiscal_year FROM document_series WHERE id = ? AND org_id = ?`)
    .get(body.seriesId, ctx.orgId)) as { id: string; doc_type: string; prefix: string; fiscal_year: number } | undefined;
  if (!series) return { error: "Série não encontrada." };

  await tx(db, async () => {
    await db.prepare(`UPDATE document_series SET atcud_validation_code = ? WHERE id = ?`).run(
      body.code,
      body.seriesId,
    );
    await writeAudit({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      actorLabel: ctx.userName,
      action: body.code ? "fiscal.atcud_code_set" : "fiscal.atcud_code_cleared",
      resourceType: "document_series",
      resourceId: body.seriesId,
      after: {
        docType: series.doc_type,
        prefix: series.prefix,
        fiscalYear: series.fiscal_year,
        // O código em si não vai para a auditoria (evita reprodução indevida);
        // regista-se apenas o facto de ter sido definido/limpo.
        hasCode: Boolean(body.code),
      },
    });
  });
  return { saved: true, atcudActive: Boolean(body.code) };
}, schema);
