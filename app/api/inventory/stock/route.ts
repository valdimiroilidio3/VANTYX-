import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { stockOverview, stockValuation } from "@/lib/services/inventory.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("inventory.view");
  const url = new URL(request.url);
  const overview = stockOverview(ctx.orgId, {
    warehouseId: url.searchParams.get("warehouseId") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    belowMin: url.searchParams.get("belowMin") === "1",
    limit: Number(url.searchParams.get("limit") ?? 50) || 50,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
  });
  return { ...overview, valuation: stockValuation(ctx.orgId) };
});
