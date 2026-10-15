import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { listWarehouses } from "@/lib/services/org.service";

export const dynamic = "force-dynamic";

/** Warehouse list for inventory staff (no settings permission needed). */
export const GET = routeHandler(async () => {
  const ctx = await requirePermission("inventory.view");
  return (await listWarehouses(ctx.orgId)).map((w) => ({
    id: w.id,
    name: w.name,
    code: w.code,
    branchId: w.branch_id,
    isDefault: w.is_default === 1,
  }));
});
