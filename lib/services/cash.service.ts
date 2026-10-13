import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { ApiError, badRequest, conflict, notFound } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";
import { emitDomainEvent } from "@/lib/domain/events";

/**
 * Cash control — sessions per terminal, opening float, justified
 * movements, closing reconciliation and auditable differences.
 */

export interface CashSessionRow {
  id: string;
  org_id: string;
  branch_id: string;
  branch_name?: string;
  terminal_id: string;
  terminal_name?: string;
  shift_id: string | null;
  status: "open" | "closed";
  opening_float_cents: number;
  opened_by: string;
  opened_by_name?: string;
  opened_at: number;
  closed_by: string | null;
  closed_at: number | null;
  expected_cash_cents: number | null;
  counted_cash_cents: number | null;
  difference_cents: number | null;
  closing_note: string | null;
  totals: string | null;
}

export function openSession(
  orgId: string,
  data: {
    branchId: string;
    terminalId: string;
    openingFloatCents: number;
    shiftLabel?: string;
    actor: { userId: string; label: string };
  },
): { sessionId: string } {
  if (data.openingFloatCents < 0) badRequest("Fundo inicial não pode ser negativo.");
  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM cash_sessions WHERE terminal_id = ? AND status = 'open'`)
    .get(data.terminalId) as { id: string } | undefined;
  if (existing) {
    throw new ApiError(409, "Já existe uma sessão de caixa aberta neste terminal.", "session_already_open");
  }
  const sessionId = newId("cs");
  let shiftId: string | null = null;
  tx(db, () => {
    if (data.shiftLabel !== undefined) {
      shiftId = newId("shift");
      db.prepare(
        `INSERT INTO shifts (id, org_id, branch_id, user_id, label, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(shiftId, orgId, data.branchId, data.actor.userId, data.shiftLabel || null, Date.now());
    }
    db.prepare(
      `INSERT INTO cash_sessions
        (id, org_id, branch_id, terminal_id, shift_id, status, opening_float_cents, opened_by, opened_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(sessionId, orgId, data.branchId, data.terminalId, shiftId, data.openingFloatCents, data.actor.userId, Date.now());
    writeAudit(
      {
        orgId, actorUserId: data.actor.userId, actorLabel: data.actor.label,
        action: "cash.open", resourceType: "cash_session", resourceId: sessionId,
        branchId: data.branchId,
        after: { terminalId: data.terminalId, openingFloatCents: data.openingFloatCents },
      },
      db,
    );
  });
  emitDomainEvent("cash.session_opened", { orgId, sessionId, by: data.actor.userId });
  return { sessionId };
}

export interface SessionCounters {
  salesCount: number;
  grossCents: number;
  netCents: number;
  taxCents: number;
  discountCents: number;
  returnsCents: number;
  byMethod: Record<string, number>;
  cashSalesCents: number;
  cashReturnsCents: number;
  movementsInCents: number;
  movementsOutCents: number;
  expectedCashCents: number;
}

export function computeSessionCounters(
  orgId: string,
  sessionId: string,
): SessionCounters {
  const db = getDb();
  const sales = db
    .prepare(
      `SELECT COALESCE(SUM(total_cents),0) gross, COALESCE(SUM(net_cents),0) net,
              COALESCE(SUM(tax_cents),0) tax, COALESCE(SUM(discount_cents),0) disc, COUNT(*) c
       FROM sales WHERE cash_session_id = ? AND org_id = ? AND status != 'void'`,
    )
    .get(sessionId, orgId) as { gross: number; net: number; tax: number; disc: number; c: number };

  const byMethodRows = db
    .prepare(
      `SELECT sp.method_key, COALESCE(SUM(sp.amount_cents),0) total
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.cash_session_id = ? AND s.org_id = ? AND s.status != 'void' AND sp.status = 'confirmed'
       GROUP BY sp.method_key`,
    )
    .all(sessionId, orgId) as { method_key: string; total: number }[];
  const byMethod: Record<string, number> = {};
  for (const row of byMethodRows) byMethod[row.method_key] = row.total;

  const cashMethods = db
    .prepare(`SELECT key FROM payment_methods WHERE org_id = ? AND is_cash = 1`)
    .all(orgId) as { key: string }[];
  const cashKeys = new Set(cashMethods.map((m) => m.key));
  const cashSalesCents = byMethodRows
    .filter((r) => cashKeys.has(r.method_key))
    .reduce((a, r) => a + r.total, 0);

  // Change given reduces drawer cash
  const changeRow = db
    .prepare(
      `SELECT COALESCE(SUM(sp.change_cents),0) change_total
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
       WHERE s.cash_session_id = ? AND s.org_id = ? AND s.status != 'void'`,
    )
    .get(sessionId, orgId) as { change_total: number };

  const returnsRows = db
    .prepare(
      `SELECT rp.method_key, COALESCE(SUM(rp.amount_cents),0) total
       FROM return_payments rp
       JOIN returns r ON r.id = rp.return_id
       JOIN sales s ON s.id = r.sale_id
       WHERE s.cash_session_id = ? AND r.org_id = ? AND r.status = 'completed'
       GROUP BY rp.method_key`,
    )
    .all(sessionId, orgId) as { method_key: string; total: number }[];
  const returnsCents = returnsRows.reduce((a, r) => a + r.total, 0);
  const cashReturnsCents = returnsRows
    .filter((r) => cashKeys.has(r.method_key))
    .reduce((a, r) => a + r.total, 0);

  const movements = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind='in' THEN amount_cents ELSE 0 END),0) ins,
              COALESCE(SUM(CASE WHEN kind='out' THEN amount_cents ELSE 0 END),0) outs
       FROM cash_movements WHERE cash_session_id = ? AND org_id = ?`,
    )
    .get(sessionId, orgId) as { ins: number; outs: number };

  const session = db
    .prepare(`SELECT opening_float_cents FROM cash_sessions WHERE id = ? AND org_id = ?`)
    .get(sessionId, orgId) as { opening_float_cents: number } | undefined;
  if (!session) notFound("Sessão de caixa");

  const expectedCashCents =
    session!.opening_float_cents +
    cashSalesCents -
    changeRow.change_total -
    cashReturnsCents +
    movements.ins -
    movements.outs;

  return {
    salesCount: sales.c,
    grossCents: sales.gross,
    netCents: sales.net,
    taxCents: sales.tax,
    discountCents: sales.disc,
    returnsCents,
    byMethod,
    cashSalesCents,
    cashReturnsCents,
    movementsInCents: movements.ins,
    movementsOutCents: movements.outs,
    expectedCashCents,
  };
}

export function closeSession(
  orgId: string,
  sessionId: string,
  data: {
    countedCashCents: number;
    note?: string;
    actor: { userId: string; label: string };
  },
): { differenceCents: number; counters: SessionCounters } {
  const db = getDb();
  const session = db
    .prepare(`SELECT * FROM cash_sessions WHERE id = ? AND org_id = ?`)
    .get(sessionId, orgId) as CashSessionRow | undefined;
  if (!session) notFound("Sessão de caixa");
  if (session!.status === "closed") conflict("Sessão já fechada.");

  const counters = computeSessionCounters(orgId, sessionId);
  const difference = data.countedCashCents - counters.expectedCashCents;

  tx(db, () => {
    const now = Date.now();
    db.prepare(
      `UPDATE cash_sessions SET status = 'closed', closed_by = ?, closed_at = ?,
         expected_cash_cents = ?, counted_cash_cents = ?, difference_cents = ?,
         closing_note = ?, totals = ?
       WHERE id = ?`,
    ).run(
      data.actor.userId, now, counters.expectedCashCents, data.countedCashCents,
      difference, data.note ?? null, JSON.stringify(counters), sessionId,
    );
    if (session!.shift_id) {
      db.prepare(`UPDATE shifts SET ended_at = ? WHERE id = ? AND ended_at IS NULL`).run(now, session!.shift_id);
    }
    writeAudit(
      {
        orgId, actorUserId: data.actor.userId, actorLabel: data.actor.label,
        action: "cash.close", resourceType: "cash_session", resourceId: sessionId,
        after: {
          expectedCashCents: counters.expectedCashCents,
          countedCashCents: data.countedCashCents,
          differenceCents: difference,
        },
        detail: difference !== 0 ? `Diferença de caixa: ${difference} cêntimos` : null,
      },
      db,
    );
  });

  emitDomainEvent("cash.session_closed", { orgId, sessionId, differenceCents: difference });
  return { differenceCents: difference, counters };
}

export function addMovement(
  orgId: string,
  sessionId: string,
  data: {
    kind: "in" | "out";
    amountCents: number;
    reasonCode: string;
    note?: string;
    actor: { userId: string; label: string };
  },
): string {
  if (data.amountCents <= 0) badRequest("Valor deve ser positivo.");
  if (!data.reasonCode) badRequest("Motivo é obrigatório.");
  const db = getDb();
  const session = db.prepare(`SELECT status FROM cash_sessions WHERE id = ? AND org_id = ?`).get(sessionId, orgId) as { status: string } | undefined;
  if (!session) notFound("Sessão de caixa");
  if (session!.status !== "open") conflict("Sessão de caixa fechada.");
  const id = newId("csm");
  tx(db, () => {
    db.prepare(
      `INSERT INTO cash_movements (id, org_id, cash_session_id, kind, amount_cents, reason_code, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, orgId, sessionId, data.kind, data.amountCents, data.reasonCode, data.note ?? null, data.actor.userId, Date.now());
    writeAudit(
      {
        orgId, actorUserId: data.actor.userId, actorLabel: data.actor.label,
        action: `cash.movement_${data.kind}`, resourceType: "cash_movement", resourceId: id,
        after: data,
      },
      db,
    );
  });
  return id;
}

export function listSessions(
  orgId: string,
  opts: { branchId?: string; status?: string; limit?: number; offset?: number } = {},
): { rows: CashSessionRow[]; total: number } {
  const db = getDb();
  const where: string[] = ["cs.org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.branchId) { where.push("cs.branch_id = ?"); params.push(opts.branchId); }
  if (opts.status) { where.push("cs.status = ?"); params.push(opts.status); }
  const limit = Math.min(opts.limit ?? 25, 200);
  const offset = opts.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT cs.*, b.name as branch_name, t.name as terminal_name, u.name as opened_by_name
       FROM cash_sessions cs
       JOIN branches b ON b.id = cs.branch_id
       JOIN terminals t ON t.id = cs.terminal_id
       LEFT JOIN users u ON u.id = cs.opened_by
       WHERE ${where.join(" AND ")}
       ORDER BY cs.opened_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as CashSessionRow[];
  const total = (db.prepare(`SELECT COUNT(*) c FROM cash_sessions cs WHERE ${where.join(" AND ")}`).get(...params) as { c: number }).c;
  return { rows, total };
}

export function getSession(orgId: string, sessionId: string): { session: CashSessionRow; counters: SessionCounters; movements: unknown[] } {
  const db = getDb();
  const session = db
    .prepare(
      `SELECT cs.*, b.name as branch_name, t.name as terminal_name, u.name as opened_by_name
       FROM cash_sessions cs
       JOIN branches b ON b.id = cs.branch_id
       JOIN terminals t ON t.id = cs.terminal_id
       LEFT JOIN users u ON u.id = cs.opened_by
       WHERE cs.id = ? AND cs.org_id = ?`,
    )
    .get(sessionId, orgId) as CashSessionRow | undefined;
  if (!session) notFound("Sessão de caixa");
  const counters = computeSessionCounters(orgId, sessionId);
  const movements = db
    .prepare(
      `SELECT m.*, u.name as user_name FROM cash_movements m
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.cash_session_id = ? ORDER BY m.created_at DESC`,
    )
    .all(sessionId);
  return { session: session!, counters, movements };
}

export function openSessionForTerminal(
  orgId: string,
  terminalId: string,
): CashSessionRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT cs.*, b.name as branch_name, t.name as terminal_name, u.name as opened_by_name
         FROM cash_sessions cs
         JOIN branches b ON b.id = cs.branch_id
         JOIN terminals t ON t.id = cs.terminal_id
         LEFT JOIN users u ON u.id = cs.opened_by
         WHERE cs.org_id = ? AND cs.terminal_id = ? AND cs.status = 'open'`,
      )
      .get(orgId, terminalId) as CashSessionRow | undefined) ?? null
  );
}

export function listPaymentMethods(orgId: string) {
  return getDb()
    .prepare(`SELECT * FROM payment_methods WHERE org_id = ? ORDER BY sort_order`)
    .all(orgId) as PaymentMethodRow[];
}

export interface PaymentMethodRow {
  id: string;
  org_id: string;
  key: string;
  name: string;
  kind: string;
  enabled: number;
  is_cash: number;
  requires_terminal: number;
  sort_order: number;
  config: string;
}

export function setPaymentMethodEnabled(orgId: string, methodId: string, enabled: boolean): void {
  getDb()
    .prepare(`UPDATE payment_methods SET enabled = ? WHERE id = ? AND org_id = ?`)
    .run(enabled ? 1 : 0, methodId, orgId);
}
