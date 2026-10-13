import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  createPromotion,
  listPromotions,
  setPromotionStatus,
} from "@/lib/services/catalog.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("products.view");
  return listPromotions(ctx.orgId);
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().min(1).max(120),
    kind: z.enum(["quantity_discount", "period_price"]),
    productId: z.string().min(1),
    variantId: z.string().nullable().optional(),
    params: z.object({
      minQtyMilli: z.number().int().positive().optional(),
      discountBps: z.number().int().min(0).max(10000).optional(),
      priceCents: z.number().int().min(0).optional(),
    }),
    startsAt: z.number().int().nullable().optional(),
    endsAt: z.number().int().nullable().optional(),
  }),
  z.object({
    action: z.literal("status"),
    promotionId: z.string().min(1),
    status: z.enum(["active", "paused"]),
  }),
]);

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("promotions.manage");
  if (body.action === "create") {
    const { action: _a, ...input } = body;
    return { promotionId: createPromotion(ctx.orgId, input) };
  }
  setPromotionStatus(ctx.orgId, body.promotionId, body.status);
  return listPromotions(ctx.orgId);
}, schema);
