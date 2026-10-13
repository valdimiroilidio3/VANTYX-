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
  const profile = getOrgProfile(ctx.orgId);
  const filter = { from, to, branchId };
  const previousLength = to - from;

  return {
    period: { from, to, branchId },
    summary: comparePeriods(
      ctx.orgId,
      filter,
      { from: from - previousLength, to: from, branchId },
    ),
    byDay: salesByDay(ctx.orgId, filter, profile.timezone),
    byHour: salesByHour(ctx.orgId, filter, profile.timezone),
    byBranch: salesByBranch(ctx.orgId, filter),
    byCategory: marginByCategory(ctx.orgId, filter),
    byStaff: performanceByUser(ctx.orgId, filter),
    topProducts: topProducts(ctx.orgId, filter, 20),
    paymentMix: paymentMix(ctx.orgId, filter),
    returns: returnRate(ctx.orgId, filter),
    rotation: stockRotation(ctx.orgId, Math.max(1, Math.round(previousLength / 86_400_000))),
    cashDifferences: cashDifferences(ctx.orgId, 10),
  };
});
