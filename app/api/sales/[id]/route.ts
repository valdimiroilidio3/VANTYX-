import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { getSaleDetail } from "@/lib/services/sales.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("sales.view");
  const { id } = await context.params;
  return getSaleDetail(ctx.orgId, id);
});
