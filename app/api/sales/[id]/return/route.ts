import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { createReturn } from "@/lib/services/sales.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  lines: z
    .array(
      z.object({
        saleLineId: z.string().min(1),
        qtyMilli: z.number().int().positive(),
        restock: z.boolean().optional(),
      }),
    )
    .min(1),
  reasonCode: z.string().min(2).max(60),
  note: z.string().max(500).optional(),
  restock: z.boolean(),
  warehouseId: z.string().nullable().optional(),
  payments: z
    .array(z.object({ methodKey: z.string().min(1), amountCents: z.number().int().min(0) }))
    .min(1),
});

export const POST = routeHandler(async (body, _request, context) => {
  const ctx = await requirePermission("pos.refund");
  const { id } = await context.params;
  return createReturn({
    orgId: ctx.orgId,
    saleId: id,
    ...body,
    actor: { userId: ctx.userId, label: ctx.userName },
  });
}, schema);
