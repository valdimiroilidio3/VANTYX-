import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { getIndustry } from "@/lib/modules/industries";
import {
  WIDGETS,
  fetchWidgets,
  periodToFilter,
  type PeriodKey,
  type WidgetDefinition,
} from "@/lib/dashboards/registry";
import { comparePeriods } from "@/lib/services/analytics.service";
import { enabledModuleIds } from "@/lib/services/module.service";
import { getOrgProfile } from "@/lib/services/org.service";
import { runDailyTasks } from "@/lib/services/notification.service";

export const dynamic = "force-dynamic";

const PERIODS: PeriodKey[] = ["today", "yesterday", "7d", "30d"];

function availabilityFor(
  orgId: string,
  industry: string,
  permissions: Set<string>,
): { availability: Record<string, { available: boolean; reason?: string }>; enabled: Set<string> } {
  const enabled = new Set(enabledModuleIds(orgId));
  const availability: Record<string, { available: boolean; reason?: string }> = {};
  for (const w of WIDGETS) {
    if (!enabled.has(w.module)) {
      availability[w.id] = { available: false, reason: `Módulo "${w.module}" não está ativo.` };
      continue;
    }
    if (w.permission && !permissions.has(w.permission)) {
      availability[w.id] = { available: false, reason: "Sem permissão para ver estes dados." };
      continue;
    }
    if (w.industries && w.industries !== "*" && !w.industries.includes(industry as never)) {
      availability[w.id] = { available: false, reason: "Widget não se aplica ao seu setor." };
      continue;
    }
    availability[w.id] = { available: true };
  }
  return { availability, enabled };
}

/**
 * Assembles the adaptive dashboard:
 *  industry default → user layout preference → module availability →
 *  permissions → data payloads. Also runs the idempotent daily
 *  automation suite (expiry/replenishment scans).
 *
 * `?customize=1` returns the full widget catalog + availability so the
 * UI can offer honest choices (unavailable widgets show WHY).
 */
export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("notifications.view");
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? undefined;
  const periodParam = url.searchParams.get("period") ?? "today";
  const period: PeriodKey = PERIODS.includes(periodParam as PeriodKey)
    ? (periodParam as PeriodKey)
    : "today";

  runDailyTasks(ctx.orgId);

  const profile = getOrgProfile(ctx.orgId);
  const permissions = new Set<string>(ctx.permissions);
  const { availability } = availabilityFor(ctx.orgId, profile.industry, permissions);

  const definitions = new Map(WIDGETS.map((w) => [w.id, w]));

  if (url.searchParams.get("customize") === "1") {
    return {
      customize: true,
      catalog: WIDGETS.filter((w) => availability[w.id]?.available).map((w) => ({
        id: w.id,
        title: w.title,
        description: w.description,
        size: w.size,
        kind: w.module.startsWith("industry.") ? "industry" : w.module === "insights" ? "ai" : "core",
      })),
      availability,
    };
  }

  const db = getDb();
  const pref = db
    .prepare(`SELECT layout FROM dashboard_preferences WHERE org_id = ? AND user_id = ?`)
    .get(ctx.orgId, ctx.userId) as { layout: string } | undefined;
  const savedLayout = pref ? (JSON.parse(pref.layout) as { widgets?: string[] }) : null;

  const industry = getIndustry(profile.industry);
  const hasCustom = Boolean(savedLayout?.widgets?.length);
  const baseLayout = hasCustom
    ? savedLayout!.widgets!
    : (industry?.defaultDashboard ?? ["sales-today", "transactions-today"]);

  // Filter: only widgets that are available AND defined
  const layout = baseLayout.filter((id) => availability[id]?.available && definitions.has(id));

  const widgetDefs: WidgetDefinition[] = layout
    .map((id) => definitions.get(id))
    .filter((w): w is WidgetDefinition => Boolean(w));

  const payloads = fetchWidgets(layout, ctx.orgId, { branchId, period });
  const { current, previous } = periodToFilter(period, profile.timezone, branchId);
  const summary = comparePeriods(ctx.orgId, current, previous);

  return {
    industry: profile.industry,
    layout: {
      widgetIds: layout,
      source: hasCustom ? "user" : "industry",
      customizationLevel: hasCustom ? "full" : "default",
    },
    widgets: widgetDefs.map((w) => ({
      widget: w.id,
      title: w.title,
      description: w.description,
      size: w.size,
      industry: profile.industry,
    })),
    availability,
    payloads,
    period,
    summary,
  };
});

const saveSchema = z.object({
  widgetIds: z.array(z.string().min(1)).max(24),
});

export const PUT = routeHandler(async (body) => {
  const ctx = await requirePermission("notifications.view");
  const profile = getOrgProfile(ctx.orgId);
  const permissions = new Set<string>(ctx.permissions);
  const { availability } = availabilityFor(ctx.orgId, profile.industry, permissions);
  const db = getDb();
  const valid = body.widgetIds.filter((id) => WIDGETS.some((w) => w.id === id) && availability[id]?.available);
  db.prepare(
    `INSERT INTO dashboard_preferences (id, org_id, user_id, layout, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(org_id, user_id) DO UPDATE SET layout = excluded.layout, updated_at = excluded.updated_at`,
  ).run(newId("dashp"), ctx.orgId, ctx.userId, JSON.stringify({ widgets: valid }), Date.now());
  return { saved: valid };
}, saveSchema);
