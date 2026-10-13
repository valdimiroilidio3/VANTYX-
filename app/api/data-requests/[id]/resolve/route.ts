import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { resolveDataRequest } from "@/lib/services/crm.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  resolution: z.enum(["fulfilled", "rejected"]),
  rejectionReason: z.string().max(500).optional(),
});

export const POST = routeHandler(async (body, _request, context) => {
  const ctx = await requirePermission("customers.data_requests");
  const { id } = await context.params;
  return resolveDataRequest(ctx.orgId, id, body.resolution, {
    userId: ctx.userId,
    label: ctx.userName,
  }, body.rejectionReason);
}, schema);
