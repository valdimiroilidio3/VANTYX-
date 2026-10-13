import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { decideApproval, listApprovals } from "@/lib/services/rule.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("settings.view");
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  return listApprovals(
    ctx.orgId,
    status === "pending" || status === "approved" || status === "rejected"
      ? status
      : undefined,
  );
});

const schema = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().max(500).optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("purchasing.approve");
  decideApproval(ctx.orgId, body.approvalId, body.decision, body.reason, {
    userId: ctx.userId,
    label: ctx.userName,
  });
  return listApprovals(ctx.orgId);
}, schema);
