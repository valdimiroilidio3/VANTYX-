import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";
import { getOrgProfile } from "@/lib/services/org.service";
import { enabledModuleIds, navigationFor } from "@/lib/services/module.service";
import { listBranches, listTerminals } from "@/lib/services/org.service";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceProvider } from "@/components/layout/workspace";
import { ConfirmProvider } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const profile = await getOrgProfile(ctx.orgId);
  const branches = await listBranches(ctx.orgId);
  const terminals = await listTerminals(ctx.orgId);

  const bootstrap = {
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
      settings: profile.settings as Record<string, unknown>,
      onboarded: profile.onboardedAt != null,
    },
    modules: await enabledModuleIds(ctx.orgId),
    navigation: await navigationFor(ctx.orgId, ctx.permissions),
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      isDefault: b.is_default === 1,
    })),
    terminals: terminals.map((t) => ({
      id: t.id,
      name: t.name,
      code: t.code,
      kind: t.kind,
      branchId: t.branch_id,
    })),
  };

  return (
    <WorkspaceProvider bootstrap={bootstrap}>
      <ConfirmProvider>
        <AppShell>{children}</AppShell>
      </ConfirmProvider>
    </WorkspaceProvider>
  );
}
