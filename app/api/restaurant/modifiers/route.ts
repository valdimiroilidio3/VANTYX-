import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  createModifierGroup,
  listModifierGroups,
} from "@/lib/services/restaurant.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("restaurant.floor");
  return listModifierGroups(ctx.orgId);
});

const schema = z.object({
  name: z.string().min(1).max(80),
  minSelect: z.number().int().min(0).max(20).optional(),
  maxSelect: z.number().int().min(1).max(20).optional(),
  options: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        priceDeltaCents: z.number().int().min(0).optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .min(1),
  productIds: z.array(z.string()).optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("products.manage");
  return { groupId: await createModifierGroup(ctx.orgId, body) };
}, schema);
