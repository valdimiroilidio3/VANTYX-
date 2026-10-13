/**
 * VANTYX Business Rules Engine — declarative and sandboxed.
 *
 * Rules never execute arbitrary code. Conditions reference a whitelist of
 * context fields, a fixed set of comparison operators, and produce a
 * fixed set of decisions. Every relevant execution is logged.
 */

export type RuleField =
  | "sale.total_cents"
  | "sale.discount_bps"
  | "sale.line_discount_bps"
  | "sale.channel"
  | "sale.items_count"
  | "line.margin_bps"
  | "user.role"
  | "user.id"
  | "terminal.id"
  | "branch.id"
  | "purchase.total_cents"
  | "refund.total_cents"
  | "stock.qty_milli"
  | "customer.credit_balance_cents"
  | "hour_of_day";

export type RuleOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in";

export interface RuleCondition {
  field: RuleField;
  op: RuleOperator;
  value: string | number | boolean | (string | number)[];
}

export interface RuleConditionGroup {
  all?: RuleCondition[];
  any?: RuleCondition[];
}

export type RuleAction =
  | { type: "allow" }
  | { type: "block"; reason: string }
  | { type: "require_approval"; kind: string; reason?: string }
  | { type: "cap_discount_bps"; maxBps: number }
  | { type: "notify"; severity: "info" | "warning" | "critical"; message: string };

export interface BusinessRule {
  id: string;
  key: string;
  name: string;
  description?: string;
  /** Rule scope: applies when all present selectors match. */
  scope: {
    branches?: string[];
    terminals?: string[];
    roles?: string[];
    channels?: string[];
  };
  condition: RuleConditionGroup;
  action: RuleAction;
  priority: number; // lower = evaluated first
  enabled: boolean;
}

export type RuleContext = Partial<Record<RuleField, string | number | boolean>>;

export type RuleDecision =
  | { type: "allow" }
  | { type: "block"; reason: string; ruleId: string; ruleKey: string }
  | {
      type: "require_approval";
      kind: string;
      reason?: string;
      ruleId: string;
      ruleKey: string;
    }
  | { type: "cap_discount_bps"; maxBps: number; ruleId: string; ruleKey: string }
  | {
      type: "notify";
      severity: "info" | "warning" | "critical";
      message: string;
      ruleId: string;
      ruleKey: string;
    };

export const ALLOWED_FIELDS: RuleField[] = [
  "sale.total_cents",
  "sale.discount_bps",
  "sale.line_discount_bps",
  "sale.channel",
  "sale.items_count",
  "line.margin_bps",
  "user.role",
  "user.id",
  "terminal.id",
  "branch.id",
  "purchase.total_cents",
  "refund.total_cents",
  "stock.qty_milli",
  "customer.credit_balance_cents",
  "hour_of_day",
];

export const ALLOWED_OPERATORS: RuleOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
];

export function validateRuleShape(rule: {
  condition: RuleConditionGroup;
  action: RuleAction;
}): string[] {
  const errors: string[] = [];
  const conditions = [...(rule.condition.all ?? []), ...(rule.condition.any ?? [])];
  if (conditions.length === 0) errors.push("condition: pelo menos uma condição é obrigatória");
  for (const c of conditions) {
    if (!ALLOWED_FIELDS.includes(c.field)) errors.push(`condition.field inválido: ${String(c.field)}`);
    if (!ALLOWED_OPERATORS.includes(c.op)) errors.push(`condition.op inválido: ${String(c.op)}`);
    if (c.op === "in" || c.op === "not_in") {
      if (!Array.isArray(c.value)) errors.push(`condition.value deve ser lista para operador ${c.op}`);
    }
  }
  if (rule.action.type === "cap_discount_bps") {
    if (typeof rule.action.maxBps !== "number" || rule.action.maxBps < 0 || rule.action.maxBps > 10000) {
      errors.push("action.maxBps deve estar entre 0 e 10000");
    }
  }
  if (rule.action.type === "block" && !rule.action.reason) {
    errors.push("action.reason é obrigatório para bloqueios");
  }
  return errors;
}

function compare(
  actual: string | number | boolean | undefined,
  op: RuleOperator,
  expected: RuleCondition["value"],
): boolean {
  if (actual === undefined) return false;
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual as string | number);
    case "not_in":
      return Array.isArray(expected) && !expected.includes(actual as string | number);
    default:
      return false;
  }
}

export function conditionMatches(
  group: RuleConditionGroup,
  ctx: RuleContext,
): boolean {
  const all = (group.all ?? []).every((c) => compare(ctx[c.field], c.op, c.value));
  const any =
    (group.any ?? []).length === 0 ||
    (group.any ?? []).some((c) => compare(ctx[c.field], c.op, c.value));
  return all && any;
}

export function scopeMatches(
  rule: BusinessRule,
  ctx: { branchId?: string; terminalId?: string; roleKey?: string; channel?: string },
): boolean {
  const s = rule.scope;
  if (s.branches?.length && ctx.branchId && !s.branches.includes(ctx.branchId)) return false;
  if (s.terminals?.length && ctx.terminalId && !s.terminals.includes(ctx.terminalId)) return false;
  if (s.roles?.length && ctx.roleKey && !s.roles.includes(ctx.roleKey)) return false;
  if (s.channels?.length && ctx.channel && !s.channels.includes(ctx.channel)) return false;
  return true;
}

/**
 * Evaluates rules (priority order). Returns every triggered decision;
 * callers apply the strictest outcome (block > approval > cap > notify).
 */
export function evaluateRules(
  rules: BusinessRule[],
  ctx: RuleContext,
  meta: { branchId?: string; terminalId?: string; roleKey?: string; channel?: string },
): RuleDecision[] {
  const decisions: RuleDecision[] = [];
  const ordered = [...rules]
    .filter((r) => r.enabled)
    .filter((r) => scopeMatches(r, meta))
    .sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (!conditionMatches(rule.condition, ctx)) continue;
    const a = rule.action;
    switch (a.type) {
      case "allow":
        decisions.push({ type: "allow" });
        break;
      case "block":
        decisions.push({ type: "block", reason: a.reason, ruleId: rule.id, ruleKey: rule.key });
        break;
      case "require_approval":
        decisions.push({
          type: "require_approval",
          kind: a.kind,
          reason: a.reason,
          ruleId: rule.id,
          ruleKey: rule.key,
        });
        break;
      case "cap_discount_bps":
        decisions.push({ type: "cap_discount_bps", maxBps: a.maxBps, ruleId: rule.id, ruleKey: rule.key });
        break;
      case "notify":
        decisions.push({
          type: "notify",
          severity: a.severity,
          message: a.message,
          ruleId: rule.id,
          ruleKey: rule.key,
        });
        break;
    }
  }
  return decisions;
}

/** Strictest-wins resolution used by checkout and purchasing. */
export function resolveDecisions(decisions: RuleDecision[]): {
  blocked?: { reason: string; ruleKey: string };
  approval?: { kind: string; reason?: string; ruleKey: string; ruleId: string };
  discountCapBps?: number;
  notifications: RuleDecision[];
} {
  const blocked = decisions.find((d) => d.type === "block") as
    | Extract<RuleDecision, { type: "block" }>
    | undefined;
  const approval = decisions.find((d) => d.type === "require_approval") as
    | Extract<RuleDecision, { type: "require_approval" }>
    | undefined;
  const caps = decisions.filter((d) => d.type === "cap_discount_bps") as Extract<
    RuleDecision,
    { type: "cap_discount_bps" }
  >[];
  const discountCapBps = caps.length
    ? Math.min(...caps.map((c) => c.maxBps))
    : undefined;
  return {
    blocked: blocked
      ? { reason: blocked.reason, ruleKey: blocked.ruleKey }
      : undefined,
    approval: approval
      ? { kind: approval.kind, reason: approval.reason, ruleKey: approval.ruleKey, ruleId: approval.ruleId }
      : undefined,
    discountCapBps,
    notifications: decisions.filter((d) => d.type === "notify"),
  };
}
