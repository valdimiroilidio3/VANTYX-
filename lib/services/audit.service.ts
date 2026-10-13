import { getDb, type Db } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";

/**
 * Audit trail for sensitive operations.
 * Records WHO / ORG / RESOURCE / ACTION / WHEN / RESULT.
 * Never stores passwords, tokens or full card data (callers pass only
 * business payloads; the writer also scrubs known sensitive keys).
 */

export interface AuditEntry {
  orgId: string;
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
  result?: "success" | "failure";
  detail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "pin",
  "pin_hash",
  "token",
  "token_hash",
  "card_number",
  "pan",
  "cvv",
  "credentials",
  "secret",
]);

function scrub(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(scrub);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[redacted]" : scrub(v);
  }
  return out;
}

export function writeAudit(entry: AuditEntry, db: Db = getDb()): string {
  const id = newId("aud");
  db.prepare(
    `INSERT INTO audit_logs
      (id, org_id, actor_user_id, actor_label, action, resource_type, resource_id,
       branch_id, before, after, result, detail, ip, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.orgId,
    entry.actorUserId ?? null,
    entry.actorLabel ?? null,
    entry.action,
    entry.resourceType,
    entry.resourceId ?? null,
    entry.branchId ?? null,
    entry.before !== undefined ? JSON.stringify(scrub(entry.before)) : null,
    entry.after !== undefined ? JSON.stringify(scrub(entry.after)) : null,
    entry.result ?? "success",
    entry.detail ?? null,
    entry.ip ?? null,
    entry.userAgent ?? null,
    Date.now(),
  );
  return id;
}

export interface AuditQuery {
  orgId: string;
  resourceType?: string;
  resourceId?: string;
  actorUserId?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export function queryAudit(q: AuditQuery) {
  const db = getDb();
  const where: string[] = ["org_id = ?"];
  const params: (string | number)[] = [q.orgId];
  if (q.resourceType) {
    where.push("resource_type = ?");
    params.push(q.resourceType);
  }
  if (q.resourceId) {
    where.push("resource_id = ?");
    params.push(q.resourceId);
  }
  if (q.actorUserId) {
    where.push("actor_user_id = ?");
    params.push(q.actorUserId);
  }
  if (q.from) {
    where.push("created_at >= ?");
    params.push(q.from);
  }
  if (q.to) {
    where.push("created_at <= ?");
    params.push(q.to);
  }
  const limit = Math.min(q.limit ?? 50, 200);
  const offset = q.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT id, actor_user_id, actor_label, action, resource_type, resource_id,
              branch_id, result, detail, created_at
       FROM audit_logs WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const total = (
    db
      .prepare(`SELECT COUNT(*) c FROM audit_logs WHERE ${where.join(" AND ")}`)
      .get(...params) as { c: number }
  ).c;
  return { rows, total };
}
