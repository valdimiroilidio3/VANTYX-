import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { createCategory, listCategories } from "@/lib/services/catalog.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("products.view");
  return listCategories(ctx.orgId);
});

const schema = z.object({
  name: z.string().min(1).max(120),
  parentId: z.string().nullable().optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("products.manage");
  return { categoryId: await createCategory(ctx.orgId, body) };
}, schema);
