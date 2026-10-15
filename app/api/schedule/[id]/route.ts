import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { APPT_STATUS, updateAppointmentStatus } from "@/lib/services/scheduling.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.literal("status"),
  status: z.enum(APPT_STATUS),
});

export const POST = routeHandler(async (body, _request, context) => {
  const ctx = await requirePermission("scheduling.manage");
  const { id } = await context.params;
  await updateAppointmentStatus(ctx.orgId, id, body.status, { userId: ctx.userId, label: ctx.userName });
  return { updated: id };
}, schema);
