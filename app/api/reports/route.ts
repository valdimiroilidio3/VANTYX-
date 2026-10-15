import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  cashDifferences,
  comparePeriods,
  marginByCategory,
  paymentMix,
  performanceByUser,
  returnRate,
  salesByBranch,
  salesByDay,
  salesByHour,
  stockRotation,
  topProducts,
} from "@/lib/services/analytics.service";
import { getOrgProfile } from "@/lib/services/org.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("reports.view");
  const url = new URL(request.url);
  const from = Number(url.searchParams.get("from")) || Date.now() - 29 * 86_400_000;
  const to = Number(url.searchParams.get("to")) || Date.now();
  const branchId = url.searchParams.get("branchId") ?? undefined;
  const profile = await getOrgProfile(ctx.orgId);
  const filter = { from, to, branchId };
  const previousLength = to - from;

  return {
    period: { from, to, branchId },
    summary: await comparePeriods(
      ctx.orgId,
      filter,
      { from: from - previousLength, to: from, branchId },
    ),
    byDay: await salesByDay(ctx.orgId, filter, profile.timezone),
    byHour: await salesByHour(ctx.orgId, filter, profile.timezone),
    byBranch: await salesByBranch(ctx.orgId, filter),
    byCategory: await marginByCategory(ctx.orgId, filter),
    byStaff: await performanceByUser(ctx.orgId, filter),
    topProducts: await topProducts(ctx.orgId, filter, 20),
    paymentMix: await paymentMix(ctx.orgId, filter),
    returns: await returnRate(ctx.orgId, filter),
    rotation: await stockRotation(ctx.orgId, Math.max(1, Math.round(previousLength / 86_400_000))),
    cashDifferences: await cashDifferences(ctx.orgId, 10),
  };
});
