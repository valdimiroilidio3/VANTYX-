import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { stockMovements } from "@/lib/services/inventory.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("inventory.view");
  const url = new URL(request.url);
  return stockMovements(ctx.orgId, {
    productId: url.searchParams.get("productId") ?? undefined,
    warehouseId: url.searchParams.get("warehouseId") ?? undefined,
    from: url.searchParams.get("from") ? Number(url.searchParams.get("from")) : undefined,
    to: url.searchParams.get("to") ? Number(url.searchParams.get("to")) : undefined,
    limit: Number(url.searchParams.get("limit") ?? 50) || 50,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
  });
});
