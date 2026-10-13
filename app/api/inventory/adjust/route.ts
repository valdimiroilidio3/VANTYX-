import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { adjustStock } from "@/lib/services/inventory.service";
import { ADJUSTMENT_REASONS } from "@/lib/domain/inventory";

export const dynamic = "force-dynamic";

const schema = z.object({
  warehouseId: z.string().min(1),
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  mode: z.enum(["absolute", "delta"]),
  qtyMilli: z.number().int(),
  reasonCode: z.enum(ADJUSTMENT_REASONS),
  note: z.string().min(3).max(500).optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("inventory.adjust");
  return adjustStock({
    orgId: ctx.orgId,
    ...body,
    actor: { userId: ctx.userId, label: ctx.userName },
  });
}, schema);
