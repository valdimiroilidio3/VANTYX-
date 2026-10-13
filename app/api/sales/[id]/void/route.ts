import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { voidSale } from "@/lib/services/sales.service";

export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().min(3).max(500) });

export const POST = routeHandler(async (body, _request, context) => {
  const ctx = await requirePermission("pos.void_sale");
  const { id } = await context.params;
  return voidSale(ctx.orgId, id, body.reason, {
    userId: ctx.userId,
    label: ctx.userName,
  });
}, schema);
