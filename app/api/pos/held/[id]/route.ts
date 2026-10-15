import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { deleteHeldSale, resumeHeldSale } from "@/lib/services/sales.service";

export const dynamic = "force-dynamic";

/** POST = resume (removes the hold and returns the cart). */
export const POST = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("pos.hold");
  const { id } = await context.params;
  return resumeHeldSale(ctx.orgId, id);
});

export const DELETE = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("pos.hold");
  const { id } = await context.params;
  await deleteHeldSale(ctx.orgId, id);
  return { deleted: id };
});
