import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { createRecipe, listRecipes, recipeCost } from "@/lib/services/restaurant.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("restaurant.recipes");
  const recipes = listRecipes(ctx.orgId) as { id: string }[];
  return recipes.map((r) => ({
    ...r,
    cost: recipeCost(ctx.orgId, r.id),
  }));
});

const schema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1).max(120),
  servings: z.number().int().min(1).max(1000).optional(),
  wastePct: z.number().int().min(0).max(100).optional(),
  items: z
    .array(
      z.object({
        ingredientProductId: z.string().min(1),
        qtyMilli: z.number().int().positive(),
      }),
    )
    .min(1),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("restaurant.recipes");
  return { recipeId: createRecipe(ctx.orgId, body) };
}, schema);
