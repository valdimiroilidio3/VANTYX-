import { routeHandler } from "@/lib/api/respond";
import { getAuthContext } from "@/lib/auth/context";
import { getOrgProfile } from "@/lib/services/org.service";
import { enabledModuleIds, navigationFor } from "@/lib/services/module.service";
import { listBranches, listTerminals } from "@/lib/services/org.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await getAuthContext();
  if (!ctx) return { authenticated: false };
  const profile = await getOrgProfile(ctx.orgId);
  return {
    authenticated: true,
    user: {
      id: ctx.userId,
      name: ctx.userName,
      email: ctx.email,
      roleKey: ctx.roleKey,
      roleName: ctx.roleName,
      permissions: [...ctx.permissions],
      branchIds: ctx.branchIds,
    },
    org: {
      id: ctx.orgId,
      name: ctx.orgName,
      demo: ctx.demo,
      industry: profile.industry,
      industryLabel: profile.industryLabel,
      posMode: profile.posMode,
      currency: profile.currency,
      locale: profile.locale,
      timezone: profile.timezone,
      pricesIncludeTax: profile.pricesIncludeTax,
      defaultTaxBps: profile.defaultTaxBps,
      settings: profile.settings,
      onboarded: profile.onboardedAt != null,
    },
    modules: await enabledModuleIds(ctx.orgId),
    navigation: await navigationFor(ctx.orgId, ctx.permissions),
    branches: (await listBranches(ctx.orgId)).map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      isDefault: b.is_default === 1,
    })),
    terminals: (await listTerminals(ctx.orgId)).map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      kind: t.kind,
      branchId: t.branch_id,
    })),
  };
});
