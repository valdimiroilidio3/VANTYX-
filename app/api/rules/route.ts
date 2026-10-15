import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  createRule,
  listRuleExecutions,
  listRules,
  updateRule,
} from "@/lib/services/rule.service";
import { ALLOWED_FIELDS, ALLOWED_OPERATORS, type RuleField, type RuleOperator } from "@/lib/domain/rules-engine";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("rules.manage");
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "executions") {
    return { executions: await listRuleExecutions(ctx.orgId, 50) };
  }
  return {
    rules: await listRules(ctx.orgId),
    allowedFields: ALLOWED_FIELDS,
    allowedOperators: ALLOWED_OPERATORS,
  };
});

const conditionSchema = z.object({
  all: z
    .array(
      z.object({
        field: z.enum(ALLOWED_FIELDS as unknown as [RuleField, ...RuleField[]]),
        op: z.enum(ALLOWED_OPERATORS as unknown as [RuleOperator, ...RuleOperator[]]),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
      }),
    )
    .optional(),
  any: z
    .array(
      z.object({
        field: z.enum(ALLOWED_FIELDS as unknown as [RuleField, ...RuleField[]]),
        op: z.enum(ALLOWED_OPERATORS as unknown as [RuleOperator, ...RuleOperator[]]),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
      }),
    )
    .optional(),
});

const actionSchemaUnion = z.discriminatedUnion("type", [
  z.object({ type: z.literal("allow") }),
  z.object({ type: z.literal("block"), reason: z.string().min(2).max(300) }),
  z.object({
    type: z.literal("require_approval"),
    kind: z.string().min(2).max(40),
    reason: z.string().max(300).optional(),
  }),
  z.object({ type: z.literal("cap_discount_bps"), maxBps: z.number().int().min(0).max(10000) }),
  z.object({
    type: z.literal("notify"),
    severity: z.enum(["info", "warning", "critical"]),
    message: z.string().min(2).max(300),
  }),
]);

const createSchema = z.object({
  id: z.string().optional(),
  key: z.string().min(2).max(60),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  scope: z
    .object({
      branches: z.array(z.string()).optional(),
      terminals: z.array(z.string()).optional(),
      roles: z.array(z.string()).optional(),
      channels: z.array(z.string()).optional(),
    })
    .optional(),
  condition: conditionSchema,
  action: actionSchemaUnion,
  priority: z.number().int().min(1).max(9999).optional(),
  enabled: z.boolean().optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("rules.manage");
  const actor = { userId: ctx.userId, label: ctx.userName };
  if (body.id) {
    const { id, key: _key, ...patch } = body;
    await updateRule(ctx.orgId, id, patch, actor);
    return { updated: id };
  }
  return { ruleId: await createRule(ctx.orgId, body, actor) };
}, createSchema);
