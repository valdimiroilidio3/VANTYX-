import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { badRequest, notFound } from "@/lib/auth/context";
import {
  validateRuleShape,
  type BusinessRule,
  type RuleAction,
  type RuleConditionGroup,
} from "@/lib/domain/rules-engine";
import { writeAudit } from "./audit.service";

/**
 * Business rules administration — declarative rules with validation of
 * allowed fields/operators (no dynamic code execution), history and
 * execution logs.
 */

export function listRules(orgId: string): BusinessRule[] {
  const rows = getDb()
    .prepare(`SELECT * FROM business_rules WHERE org_id = ? ORDER BY priority, key`)
    .all(orgId) as {
    id: string;
    key: string;
    name: string;
    description: string | null;
    scope: string;
    condition: string;
    action: string;
    priority: number;
    enabled: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description ?? undefined,
    scope: JSON.parse(r.scope) as BusinessRule["scope"],
    condition: JSON.parse(r.condition) as RuleConditionGroup,
    action: JSON.parse(r.action) as RuleAction,
    priority: r.priority,
    enabled: r.enabled === 1,
  })) as BusinessRule[];
}

export interface RuleInput {
  key: string;
  name: string;
  description?: string;
  scope?: BusinessRule["scope"];
  condition: RuleConditionGroup;
  action: RuleAction;
  priority?: number;
  enabled?: boolean;
}

export function createRule(
  orgId: string,
  input: RuleInput,
  actor: { userId: string; label: string },
): string {
  const errors = validateRuleShape({ condition: input.condition, action: input.action });
  if (errors.length) badRequest(errors.join("; "));
  if (!input.key?.trim() || !input.name?.trim()) badRequest("Chave e nome são obrigatórios.");
  const db = getDb();
  const id = newId("rule");
  tx(db, () => {
    db.prepare(
      `INSERT INTO business_rules (id, org_id, key, name, description, scope, condition, action, priority, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, orgId, input.key.trim(), input.name.trim(), input.description ?? null,
      JSON.stringify(input.scope ?? {}), JSON.stringify(input.condition),
      JSON.stringify(input.action), input.priority ?? 100,
      input.enabled === false ? 0 : 1, actor.userId, Date.now(), Date.now(),
    );
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "rule.create", resourceType: "business_rule", resourceId: id, after: input },
      db,
    );
  });
  return id;
}

export function updateRule(
  orgId: string,
  ruleId: string,
  patch: Partial<RuleInput>,
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  const before = db.prepare(`SELECT * FROM business_rules WHERE id = ? AND org_id = ?`).get(ruleId, orgId) as Record<string, unknown> | undefined;
  if (!before) notFound("Regra");
  const mergedCondition = (patch.condition ?? JSON.parse(String(before!.condition))) as RuleConditionGroup;
  const mergedAction = (patch.action ?? JSON.parse(String(before!.action))) as RuleAction;
  const errors = validateRuleShape({ condition: mergedCondition, action: mergedAction });
  if (errors.length) badRequest(errors.join("; "));
  tx(db, () => {
    db.prepare(
      `UPDATE business_rules SET
        name = COALESCE(?, name), description = COALESCE(?, description),
        scope = COALESCE(?, scope), condition = ?, action = ?,
        priority = COALESCE(?, priority), enabled = COALESCE(?, enabled), updated_at = ?
       WHERE id = ? AND org_id = ?`,
    ).run(
      patch.name ?? null, patch.description ?? null,
      patch.scope ? JSON.stringify(patch.scope) : null,
      JSON.stringify(mergedCondition), JSON.stringify(mergedAction),
      patch.priority ?? null,
      patch.enabled === undefined ? null : patch.enabled ? 1 : 0,
      Date.now(), ruleId, orgId,
    );
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "rule.update", resourceType: "business_rule", resourceId: ruleId, before, after: patch },
      db,
    );
  });
}

export function setRuleEnabled(orgId: string, ruleId: string, enabled: boolean, actor: { userId: string; label: string }): void {
  const db = getDb();
  tx(db, () => {
    db.prepare(`UPDATE business_rules SET enabled = ?, updated_at = ? WHERE id = ? AND org_id = ?`)
      .run(enabled ? 1 : 0, Date.now(), ruleId, orgId);
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: enabled ? "rule.enable" : "rule.disable", resourceType: "business_rule", resourceId: ruleId },
      db,
    );
  });
}

export function listRuleExecutions(orgId: string, limit = 50) {
  return getDb()
    .prepare(
      `SELECT re.*, r.name as rule_name, r.key as rule_key
       FROM rule_executions re JOIN business_rules r ON r.id = re.rule_id
       WHERE re.org_id = ? ORDER BY re.executed_at DESC LIMIT ?`,
    )
    .all(orgId, Math.min(limit, 200));
}

/* ------------------------------ Approvals ------------------------------ */

export function listApprovals(orgId: string, status?: "pending" | "approved" | "rejected") {
  return getDb()
    .prepare(
      `SELECT a.*, u.name as requested_by_name, d.name as decided_by_name
       FROM approvals a
       LEFT JOIN users u ON u.id = a.requested_by
       LEFT JOIN users d ON d.id = a.decided_by
       WHERE a.org_id = ? ${status ? "AND a.status = ?" : ""}
       ORDER BY a.created_at DESC LIMIT 100`,
    )
    .all(...(status ? [orgId, status] : [orgId]));
}

export function decideApproval(
  orgId: string,
  approvalId: string,
  decision: "approved" | "rejected",
  reason: string | undefined,
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  tx(db, () => {
    const approval = db.prepare(`SELECT * FROM approvals WHERE id = ? AND org_id = ?`).get(approvalId, orgId) as { id: string; status: string; kind: string; ref_id: string | null } | undefined;
    if (!approval) notFound("Aprovação");
    if (approval!.status !== "pending") badRequest("Aprovação já decidida.");
    db.prepare(`UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, reason = ? WHERE id = ?`)
      .run(decision, actor.userId, Date.now(), reason ?? null, approvalId);
    if (approval!.kind === "purchase" && approval!.ref_id) {
      // Keep the purchasing workflow consistent with the decision
      db.prepare(
        `UPDATE purchase_orders SET status = ?, approved_by = ?, approved_at = ?, requires_approval = 0, updated_at = ?
         WHERE id = ? AND org_id = ? AND status = 'pending_approval'`,
      ).run(
        decision === "approved" ? "draft" : "cancelled",
        decision === "approved" ? actor.userId : null,
        Date.now(),
        Date.now(),
        approval!.ref_id,
        orgId,
      );
    }
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: `approval.${decision}`, resourceType: "approval", resourceId: approvalId, after: { reason: reason ?? null } },
      db,
    );
  });
}
