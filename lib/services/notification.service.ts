import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { onDomainEvent } from "@/lib/domain/events";
import { isModuleEnabled } from "./module.service";
import { expiringBatches } from "./inventory.service";
import { purchaseSuggestions } from "./purchasing.service";

/**
 * Notifications & Automation — subscribes to domain events and records
 * notifications with dedupe keys (one alert per product/day, etc.).
 * Automation tasks are idempotent per day and logged in automation_runs.
 * Retries are controlled: failed tasks are re-run only on the next
 * invocation with the same idempotency key, never duplicated blindly.
 */

export function createNotification(
  orgId: string,
  data: {
    kind: string;
    severity: "info" | "warning" | "critical";
    title: string;
    body?: string;
    refType?: string;
    refId?: string;
    userId?: string | null;
    dedupeKey?: string;
  },
): string | null {
  const db = getDb();
  if (data.dedupeKey) {
    const existing = db
      .prepare(`SELECT id FROM notifications WHERE org_id = ? AND dedupe_key = ?`)
      .get(orgId, data.dedupeKey);
    if (existing) return null; // deduplicated
  }
  const id = newId("ntf");
  db.prepare(
    `INSERT INTO notifications (id, org_id, user_id, kind, severity, title, body, ref_type, ref_id, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, orgId, data.userId ?? null, data.kind, data.severity, data.title,
    data.body ?? null, data.refType ?? null, data.refId ?? null,
    data.dedupeKey ?? null, Date.now(),
  );
  return id;
}

export function listNotifications(
  orgId: string,
  opts: { unreadOnly?: boolean; limit?: number; offset?: number } = {},
): { rows: NotificationRow[]; total: number; unread: number } {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 30, 200);
  const offset = opts.offset ?? 0;
  const where = opts.unreadOnly ? "org_id = ? AND read_at IS NULL" : "org_id = ?";
  const rows = db
    .prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(orgId, limit, offset) as NotificationRow[];
  const total = (db.prepare(`SELECT COUNT(*) c FROM notifications WHERE ${where}`).get(orgId) as { c: number }).c;
  const unread = (db.prepare(`SELECT COUNT(*) c FROM notifications WHERE org_id = ? AND read_at IS NULL`).get(orgId) as { c: number }).c;
  return { rows, total, unread };
}

export interface NotificationRow {
  id: string;
  org_id: string;
  user_id: string | null;
  kind: string;
  severity: string;
  title: string;
  body: string | null;
  ref_type: string | null;
  ref_id: string | null;
  read_at: number | null;
  created_at: number;
}

export function markNotificationRead(orgId: string, notificationId: string): void {
  getDb()
    .prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND org_id = ?`)
    .run(Date.now(), notificationId, orgId);
}

export function markAllRead(orgId: string): void {
  getDb()
    .prepare(`UPDATE notifications SET read_at = ? WHERE org_id = ? AND read_at IS NULL`)
    .run(Date.now(), orgId);
}

/* --------------------- Event subscriptions ---------------------- */

function dayKey(ts = Date.now()): string {
  return new Date(ts).toISOString().slice(0, 10);
}

let initialized = false;

/** Registers all event→notification subscriptions exactly once. */
export function initNotificationSubscriptions(): void {
  if (initialized) return;
  const g = globalThis as { __vantyxNotificationsInit?: boolean };
  if (g.__vantyxNotificationsInit) {
    initialized = true;
    return;
  }
  g.__vantyxNotificationsInit = true;
  initialized = true;

  onDomainEvent("stock.below_min", (p) => {
    if (!isModuleEnabled(p.orgId, "automation")) return;
    createNotification(p.orgId, {
      kind: "stock.below_min",
      severity: "warning",
      title: `Stock mínimo: ${p.productName}`,
      body: `Disponível: ${(p.qtyMilli / 1000).toLocaleString("pt-PT")} · Ponto de encomenda: ${(p.reorderPointMilli / 1000).toLocaleString("pt-PT")}`,
      refType: "product",
      refId: p.productId,
      dedupeKey: `below_min:${p.productId}:${dayKey()}`,
    });
  });

  onDomainEvent("stock.negative", (p) => {
    if (!isModuleEnabled(p.orgId, "automation")) return;
    createNotification(p.orgId, {
      kind: "stock.negative",
      severity: "critical",
      title: `Stock negativo: ${p.productName}`,
      body: `Quantidade atual: ${(p.qtyMilli / 1000).toLocaleString("pt-PT")}. Reveja a política de stock ou faça um ajuste justificado.`,
      refType: "product",
      refId: p.productId,
      dedupeKey: `negative:${p.productId}:${dayKey()}`,
    });
  });

  onDomainEvent("cash.session_closed", (p) => {
    if (!isModuleEnabled(p.orgId, "automation")) return;
    if (p.differenceCents === 0) return;
    createNotification(p.orgId, {
      kind: "cash.difference",
      severity: Math.abs(p.differenceCents) > 500 ? "critical" : "warning",
      title: `Diferença de caixa: ${(p.differenceCents / 100).toFixed(2)} €`,
      body: `Sessão ${p.sessionId} fechada com diferença ${p.differenceCents > 0 ? "positiva (sobra)" : "negativa (falta)"}.`,
      refType: "cash_session",
      refId: p.sessionId,
    });
  });

  onDomainEvent("sale.voided", (p) => {
    if (!isModuleEnabled(p.orgId, "automation")) return;
    createNotification(p.orgId, {
      kind: "sale.voided",
      severity: "warning",
      title: "Venda anulada",
      body: `Motivo: ${p.reason}`,
      refType: "sale",
      refId: p.saleId,
    });
  });

  onDomainEvent("purchase.approval_required", (p) => {
    createNotification(p.orgId, {
      kind: "purchase.approval",
      severity: "info",
      title: `Encomenda ${p.poNumber} aguarda aprovação`,
      body: `Total: ${(p.totalCents / 100).toFixed(2)} €`,
      refType: "purchase_order",
      refId: p.poId,
    });
  });

  onDomainEvent("rule.blocked", (p) => {
    createNotification(p.orgId, {
      kind: "rule.blocked",
      severity: "info",
      title: `Operação bloqueada pela regra "${p.ruleKey}"`,
      body: p.reason,
      refType: p.refType ?? undefined,
      refId: p.refId ?? undefined,
      dedupeKey: `rule:${p.ruleKey}:${p.refId ?? dayKey()}`,
    });
  });

  onDomainEvent("sync.conflict", (p) => {
    createNotification(p.orgId, {
      kind: "sync.conflict",
      severity: "critical",
      title: `Conflito de sincronização: ${p.entity}`,
      body: p.detail,
    });
  });
}

/* ------------------------- Automation tasks ------------------------- */

export interface DailyTaskResult {
  taskKey: string;
  status: "success" | "failed" | "skipped_idempotent";
  detail?: string;
}

/**
 * Runs the daily automation suite for an org (expiry scan, replenishment
 * scan). Idempotent per day — safe to call from dashboards, external cron
 * or retry after failures. Executions are logged in automation_runs.
 */
export function runDailyTasks(orgId: string, at = Date.now()): DailyTaskResult[] {
  const db = getDb();
  const idemKey = `daily-${dayKey(at)}`;
  const existing = db
    .prepare(`SELECT status FROM automation_runs WHERE org_id = ? AND task_key = 'daily_suite' AND idempotency_key = ? AND status = 'success'`)
    .get(orgId, idemKey);
  if (existing) {
    return [{ taskKey: "daily_suite", status: "skipped_idempotent" }];
  }
  const runId = newId("run");
  db.prepare(
    `INSERT OR REPLACE INTO automation_runs (id, org_id, task_key, status, idempotency_key, started_at)
     VALUES (?, ?, 'daily_suite', 'running', ?, ?)`,
  ).run(runId, orgId, idemKey, at);

  const results: DailyTaskResult[] = [];
  try {
    // 1. Expiry scan (supermarket/pharmacy/pet packs)
    const expiring = expiringBatches(orgId, at);
    let expiryAlerts = 0;
    for (const batch of expiring) {
      const created = createNotification(orgId, {
        kind: "batch.expiring",
        severity: batch.risk === "expired" ? "critical" : "warning",
        title:
          batch.risk === "expired"
            ? `Lote expirado: ${batch.product_name}`
            : `Validade próxima: ${batch.product_name}`,
        body: `Lote ${batch.batch_number} · ${batch.warehouse_name} · validade ${new Date(batch.expiry_date).toLocaleDateString("pt-PT")} · restante ${(batch.qty_remaining_milli / 1000).toLocaleString("pt-PT")}`,
        refType: "batch",
        refId: batch.id,
        dedupeKey: `expiry:${batch.id}:${batch.risk}:${dayKey(at)}`,
      });
      if (created) expiryAlerts++;
    }
    results.push({ taskKey: "expiry_scan", status: "success", detail: `${expiryAlerts} alertas` });

    // 2. Replenishment scan
    const suggestions = purchaseSuggestions(orgId, 30, 100);
    if (suggestions.length > 0) {
      createNotification(orgId, {
        kind: "replenishment",
        severity: "info",
        title: `${suggestions.length} produtos precisam de reposição`,
        body: `Com base em vendas dos últimos 30 dias e pontos de encomenda. Consulte Compras → Sugestões.`,
        dedupeKey: `replenishment:${dayKey(at)}`,
      });
    }
    results.push({ taskKey: "replenishment_scan", status: "success", detail: `${suggestions.length} sugestões` });

    tx(db, () => {
      db.prepare(
        `UPDATE automation_runs SET status = 'success', finished_at = ?, result = ? WHERE id = ?`,
      ).run(Date.now(), JSON.stringify(results), runId);
    });
  } catch (err) {
    db.prepare(
      `UPDATE automation_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`,
    ).run(Date.now(), err instanceof Error ? err.message : String(err), runId);
    results.push({ taskKey: "daily_suite", status: "failed", detail: String(err) });
  }
  return results;
}

export function listAutomationRuns(orgId: string, limit = 20) {
  return getDb()
    .prepare(`SELECT * FROM automation_runs WHERE org_id = ? ORDER BY started_at DESC LIMIT ?`)
    .all(orgId, limit);
}
