import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { createCountSheet } from "@/lib/services/inventory.service";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("inventory.count");
  return await getDb()
    .prepare(
      `SELECT cs.*, w.name as warehouse_name,
        (SELECT COUNT(*) FROM count_sheet_lines l WHERE l.sheet_id = cs.id) as line_count,
        (SELECT COUNT(*) FROM count_sheet_lines l WHERE l.sheet_id = cs.id AND l.counted_milli IS NOT NULL) as counted_count
       FROM count_sheets cs JOIN warehouses w ON w.id = cs.warehouse_id
       WHERE cs.org_id = ? ORDER BY cs.created_at DESC LIMIT 50`,
    )
    .all(ctx.orgId);
});

const schema = z.object({
  warehouseId: z.string().min(1),
  productIds: z.array(z.string()).nullable().optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("inventory.count");
  return createCountSheet(ctx.orgId, body.warehouseId, body.productIds ?? null, {
    userId: ctx.userId,
    label: ctx.userName,
  });
}, schema);
