import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { getAuthContext, hasPermission } from "@/lib/auth/context";
import { dailyBrief, detectAnomalies, nlSearch } from "@/lib/ai/insights";
import { getLlmAvailability } from "@/lib/ai/llm-adapter";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await getAuthContext();
  if (!ctx) return { available: false };
  return {
    available: hasPermission(ctx, "insights.view"),
    llm: getLlmAvailability(),
    engine: "deterministic",
  };
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("brief"), branchId: z.string().optional() }),
  z.object({ action: z.literal("anomalies") }),
  z.object({ action: z.literal("search"), query: z.string().min(2).max(200) }),
]);

export const POST = routeHandler(async (body) => {
  const ctx = await getAuthContext();
  if (!ctx || !hasPermission(ctx, "insights.view")) {
    return { error: "Sem permissão insights.view." };
  }
  switch (body.action) {
    case "brief":
      return dailyBrief(ctx.orgId, body.branchId);
    case "anomalies":
      return detectAnomalies(ctx.orgId);
    case "search":
      return nlSearch(ctx.orgId, body.query, {
        reports: hasPermission(ctx, "reports.view"),
        inventory: hasPermission(ctx, "inventory.view"),
        customers: hasPermission(ctx, "customers.view"),
      });
  }
}, schema);
