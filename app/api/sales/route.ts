import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { listSales } from "@/lib/services/sales.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("sales.view");
  const url = new URL(request.url);
  return listSales(ctx.orgId, {
    branchId: url.searchParams.get("branchId") ?? undefined,
    customerId: url.searchParams.get("customerId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    from: url.searchParams.get("from") ? Number(url.searchParams.get("from")) : undefined,
    to: url.searchParams.get("to") ? Number(url.searchParams.get("to")) : undefined,
    search: url.searchParams.get("search") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 25) || 25,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
  });
});
