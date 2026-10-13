import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  disableModule,
  enableModule,
  listOrgModules,
  previewDisable,
} from "@/lib/services/module.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("settings.view");
  return listOrgModules(ctx.orgId).map((m) => ({
    id: m.module.id,
    name: m.module.name,
    description: m.module.description,
    category: m.module.category,
    version: m.module.version,
    industries: m.module.industries,
    dependencies: m.module.dependencies,
    licenseTier: m.module.licenseTier,
    enabled: m.enabled,
    dataRows: m.dataRows,
    config: m.config,
  }));
});

const actionSchema = z.object({
  moduleId: z.string().min(1),
  action: z.enum(["enable", "disable", "preview_disable"]),
  force: z.boolean().optional(),
  confirmDataLoss: z.boolean().optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("modules.manage");
  const actor = { userId: ctx.userId, label: ctx.userName };
  switch (body.action) {
    case "enable":
      return enableModule(ctx.orgId, body.moduleId, actor, { force: body.force });
    case "preview_disable":
      return previewDisable(ctx.orgId, body.moduleId);
    case "disable":
      disableModule(ctx.orgId, body.moduleId, actor, {
        confirmDataLoss: body.confirmDataLoss,
      });
      return { disabled: body.moduleId };
  }
}, actionSchema);
