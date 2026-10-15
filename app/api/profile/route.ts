import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  getOrgProfile,
  mergeProfileSettings,
  updateOrgIdentity,
  updateProfileLocale,
} from "@/lib/services/org.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("settings.view");
  return getOrgProfile(ctx.orgId);
});

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  legalName: z.string().max(200).optional(),
  taxId: z.string().max(40).optional(),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(60).optional(),
  subIndustry: z.string().max(80).optional(),
  taxRegime: z.string().max(40).optional(),
  pricesIncludeTax: z.boolean().optional(),
  defaultTaxBps: z.number().int().min(0).max(10000).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = routeHandler(async (body) => {
  const ctx = await requirePermission("profile.manage");
  const actor = { userId: ctx.userId, label: ctx.userName };
  const { settings, ...identity } = body;
  if (identity.name || identity.legalName || identity.taxId) {
    await updateOrgIdentity(
      ctx.orgId,
      { name: identity.name, legalName: identity.legalName, taxId: identity.taxId },
      actor,
    );
  }
  const localeKeys = ["country", "currency", "locale", "timezone", "subIndustry", "taxRegime", "pricesIncludeTax", "defaultTaxBps"] as const;
  if (localeKeys.some((k) => body[k] !== undefined)) {
    await updateProfileLocale(ctx.orgId, body, actor);
  }
  if (settings) {
    await mergeProfileSettings(ctx.orgId, settings, actor);
  }
  return getOrgProfile(ctx.orgId);
}, patchSchema);
