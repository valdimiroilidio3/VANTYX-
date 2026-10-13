import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { getWorkOrder, updateWorkOrderStatus, WO_STATUS } from "@/lib/services/workshop.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("workorders.view");
  const { id } = await context.params;
  return getWorkOrder(ctx.orgId, id);
});

const schema = z.object({
  action: z.literal("status"),
  status: z.enum(WO_STATUS),
});

export const POST = routeHandler(async (body, _request, context) => {
  const ctx = await requirePermission("workorders.manage");
  const { id } = await context.params;
  updateWorkOrderStatus(ctx.orgId, id, body.status, { userId: ctx.userId, label: ctx.userName });
  return getWorkOrder(ctx.orgId, id);
}, schema);
