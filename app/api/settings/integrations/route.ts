import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  listIntegrationStates,
  saveIntegrationConfig,
  testIntegration,
} from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("settings.view");
  return listIntegrationStates(ctx.orgId).map((s) => ({
    key: s.definition.key,
    name: s.definition.name,
    category: s.definition.category,
    description: s.definition.description,
    requires: s.definition.requires,
    configFields: s.definition.configFields,
    requiresCredentials: s.definition.requiresCredentials,
    builtin: Boolean(s.definition.builtin),
    docsNote: s.definition.docsNote,
    status: s.status,
    config: s.config,
    credentialsSet: s.credentialsSet,
    lastTestAt: s.lastTestAt,
    lastError: s.lastError,
    missing: s.missing,
  }));
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    key: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    /** Whether required credentials were placed in server env. */
    credentialsSet: z.boolean(),
  }),
  z.object({ action: z.literal("test"), key: z.string().min(1) }),
]);

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("integrations.manage");
  if (body.action === "save") {
    // Secrets themselves are NEVER accepted through this API — only the
    // non-secret config and a boolean stating env credentials exist.
    saveIntegrationConfig(ctx.orgId, body.key, body.config, body.credentialsSet);
    return listIntegrationStates(ctx.orgId);
  }
  return testIntegration(ctx.orgId, body.key);
}, schema);
