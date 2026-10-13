import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { queryAudit } from "@/lib/services/audit.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("audit.view");
  const url = new URL(request.url);
  return queryAudit({
    orgId: ctx.orgId,
    resourceType: url.searchParams.get("resourceType") ?? undefined,
    resourceId: url.searchParams.get("resourceId") ?? undefined,
    actorUserId: url.searchParams.get("actorUserId") ?? undefined,
    from: url.searchParams.get("from") ? Number(url.searchParams.get("from")) : undefined,
    to: url.searchParams.get("to") ? Number(url.searchParams.get("to")) : undefined,
    limit: Number(url.searchParams.get("limit") ?? 50) || 50,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
  });
});
