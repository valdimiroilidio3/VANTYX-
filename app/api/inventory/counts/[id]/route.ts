import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission, notFound } from "@/lib/auth/context";
import {
  completeCountSheet,
  recordCountLine,
} from "@/lib/services/inventory.service";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("inventory.count");
  const { id } = await context.params;
  const db = getDb();
  const sheet = db
    .prepare(
      `SELECT cs.*, w.name as warehouse_name FROM count_sheets cs
       JOIN warehouses w ON w.id = cs.warehouse_id WHERE cs.id = ? AND cs.org_id = ?`,
    )
    .get(id, ctx.orgId);
  if (!sheet) notFound("Folha de contagem");
  const lines = db
    .prepare(
      `SELECT l.*, p.name as product_name, p.sku, p.unit, v.label as variant_label
       FROM count_sheet_lines l
       JOIN products p ON p.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id
       WHERE l.sheet_id = ? ORDER BY p.name`,
    )
    .all(id);
  return { sheet, lines };
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("count"),
    lineId: z.string().min(1),
    countedMilli: z.number().int().min(0),
  }),
  z.object({ action: z.literal("complete") }),
]);

export const POST = routeHandler(async (body, _request, context) => {
  const ctx = await requirePermission("inventory.count");
  const { id } = await context.params;
  const actor = { userId: ctx.userId, label: ctx.userName };
  if (body.action === "count") {
    recordCountLine(ctx.orgId, id, body.lineId, body.countedMilli, actor);
    return { recorded: body.lineId };
  }
  return completeCountSheet(ctx.orgId, id, actor);
}, actionSchema);
