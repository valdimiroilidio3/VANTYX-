import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { recordWaste } from "@/lib/services/restaurant.service";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("inventory.waste");
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50) || 50;
  return await getDb()
    .prepare(
      `SELECT w.*, p.name as product_name, wh.name as warehouse_name, u.name as user_name
       FROM waste_records w
       JOIN products p ON p.id = w.product_id
       JOIN warehouses wh ON wh.id = w.warehouse_id
       LEFT JOIN users u ON u.id = w.created_by
       WHERE w.org_id = ? ORDER BY w.created_at DESC LIMIT ?`,
    )
    .all(ctx.orgId, Math.min(limit, 200));
});

const schema = z.object({
  warehouseId: z.string().min(1),
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  qtyMilli: z.number().int().positive(),
  reasonCode: z.enum(["spoilage", "preparation", "overproduction", "damage", "other"]),
  note: z.string().max(300).optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("inventory.waste");
  await recordWaste(ctx.orgId, {
    ...body,
    actor: { userId: ctx.userId, label: ctx.userName },
  });
  return { recorded: true };
}, schema);
