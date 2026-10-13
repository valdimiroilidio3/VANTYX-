import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { ApiError, badRequest, notFound } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";

/**
 * CRM — customer records, purchase history, segmentation, loyalty and
 * data-subject requests (access/rectification/erasure) handled with
 * legal traceability: erasure anonymizes financial-linked records rather
 * than silently deleting history (financial history must remain intact).
 */

export interface CustomerInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  tags?: string[];
  marketingConsent?: boolean;
  customerType?: "individual" | "business";
  priceListId?: string | null;
  creditLimitCents?: number;
}

export function createCustomer(
  orgId: string,
  input: CustomerInput,
  actor: { userId: string; label: string },
): string {
  if (!input.name?.trim()) badRequest("Nome do cliente é obrigatório.");
  const db = getDb();
  if (input.email) {
    const dup = db.prepare(`SELECT id FROM customers WHERE org_id = ? AND lower(email) = lower(?)`).get(orgId, input.email.trim());
    if (dup) throw new ApiError(409, "Já existe um cliente com este email.", "duplicate_customer");
  }
  const id = newId("cust");
  tx(db, () => {
    db.prepare(
      `INSERT INTO customers
        (id, org_id, name, email, phone, tax_id, address, city, notes, tags,
         marketing_consent, customer_type, price_list_id, credit_limit_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, orgId, input.name.trim(), input.email?.trim() ?? null, input.phone?.trim() ?? null,
      input.taxId?.trim() ?? null, input.address ?? null, input.city ?? null, input.notes ?? null,
      JSON.stringify(input.tags ?? []), input.marketingConsent ? 1 : 0,
      input.customerType ?? "individual", input.priceListId ?? null,
      input.creditLimitCents ?? 0, Date.now(), Date.now(),
    );
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "customer.create", resourceType: "customer", resourceId: id, after: input },
      db,
    );
  });
  return id;
}

export function updateCustomer(
  orgId: string,
  customerId: string,
  patch: Partial<CustomerInput> & { status?: "active" | "blocked" | "archived" },
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  const before = db.prepare(`SELECT * FROM customers WHERE id = ? AND org_id = ?`).get(customerId, orgId);
  if (!before) notFound("Cliente");
  tx(db, () => {
    db.prepare(
      `UPDATE customers SET
        name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone),
        tax_id = COALESCE(?, tax_id), address = COALESCE(?, address), city = COALESCE(?, city),
        notes = COALESCE(?, notes), tags = COALESCE(?, tags),
        marketing_consent = COALESCE(?, marketing_consent),
        customer_type = COALESCE(?, customer_type), price_list_id = COALESCE(?, price_list_id),
        credit_limit_cents = COALESCE(?, credit_limit_cents), status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ? AND org_id = ?`,
    ).run(
      patch.name?.trim() ?? null, patch.email?.trim() ?? null, patch.phone?.trim() ?? null,
      patch.taxId ?? null, patch.address ?? null, patch.city ?? null, patch.notes ?? null,
      patch.tags ? JSON.stringify(patch.tags) : null,
      patch.marketingConsent === undefined ? null : patch.marketingConsent ? 1 : 0,
      patch.customerType ?? null, patch.priceListId ?? null, patch.creditLimitCents ?? null,
      patch.status ?? null, Date.now(), customerId, orgId,
    );
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "customer.update", resourceType: "customer", resourceId: customerId, before, after: patch },
      db,
    );
  });
}

export function listCustomers(
  orgId: string,
  opts: { search?: string; tag?: string; status?: string; limit?: number; offset?: number } = {},
): { rows: CustomerRow[]; total: number } {
  const db = getDb();
  const where: string[] = ["org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.search) {
    where.push("(name LIKE ? OR COALESCE(email,'') LIKE ? OR COALESCE(phone,'') LIKE ?)");
    const like = `%${opts.search}%`;
    params.push(like, like, like);
  }
  if (opts.status) { where.push("status = ?"); params.push(opts.status); }
  if (opts.tag) { where.push("tags LIKE ?"); params.push(`%"${opts.tag}"%`); }
  const limit = Math.min(opts.limit ?? 25, 200);
  const offset = opts.offset ?? 0;
  const whereSql = where.join(" AND ");
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM sales s WHERE s.customer_id = c.id AND s.status != 'void') as sales_count,
        (SELECT COALESCE(SUM(s.total_cents),0) FROM sales s WHERE s.customer_id = c.id AND s.status != 'void') as lifetime_cents,
        (SELECT MAX(s.created_at) FROM sales s WHERE s.customer_id = c.id AND s.status != 'void') as last_purchase_at
       FROM customers c
       WHERE ${whereSql}
       ORDER BY c.name LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as CustomerRow[];
  const total = (
    db.prepare(`SELECT COUNT(*) n FROM customers WHERE ${whereSql}`).get(...params) as { n: number }
  ).n;
  return { rows, total };
}

export interface CustomerRow {
  id: string;
  org_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  tags: string;
  marketing_consent: number;
  customer_type: string;
  price_list_id: string | null;
  credit_limit_cents: number;
  credit_balance_cents: number;
  status: string;
  sales_count?: number;
  lifetime_cents?: number;
  last_purchase_at?: number | null;
  created_at: number;
  updated_at: number;
}

export function getCustomerDetail(orgId: string, customerId: string) {
  const db = getDb();
  const customer = db.prepare(`SELECT * FROM customers WHERE id = ? AND org_id = ?`).get(customerId, orgId) as CustomerRow | undefined;
  if (!customer) notFound("Cliente");
  const sales = db
    .prepare(
      `SELECT id, document_number, total_cents, status, channel, created_at
       FROM sales WHERE org_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 50`,
    )
    .all(orgId, customerId);
  const loyalty = db.prepare(`SELECT * FROM loyalty_accounts WHERE org_id = ? AND customer_id = ?`).get(orgId, customerId) ?? null;
  const loyaltyTx = loyalty
    ? db.prepare(`SELECT * FROM loyalty_transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`).all((loyalty as { id: string }).id)
    : [];
  const topProducts = db
    .prepare(
      `SELECT p.name, SUM(sl.qty_milli) qty_milli, SUM(sl.total_cents) total_cents, COUNT(*) purchases
       FROM sale_lines sl
       JOIN sales s ON s.id = sl.sale_id AND s.status != 'void'
       JOIN products p ON p.id = sl.product_id
       WHERE s.org_id = ? AND s.customer_id = ?
       GROUP BY p.id ORDER BY total_cents DESC LIMIT 10`,
    )
    .all(orgId, customerId);
  const dataRequests = db.prepare(`SELECT * FROM data_requests WHERE org_id = ? AND customer_id = ? ORDER BY requested_at DESC`).all(orgId, customerId);
  return { customer: customer!, sales, loyalty, loyaltyTx, topProducts, dataRequests };
}

/* ------------------------------ Loyalty ----------------------------- */

export function adjustLoyaltyPoints(
  orgId: string,
  customerId: string,
  delta: number,
  note: string,
  actor: { userId: string; label: string },
): { balance: number } {
  const db = getDb();
  let balance = 0;
  tx(db, () => {
    let account = db.prepare(`SELECT * FROM loyalty_accounts WHERE org_id = ? AND customer_id = ?`).get(orgId, customerId) as { id: string; points_balance: number } | undefined;
    if (!account) {
      const id = newId("loy");
      db.prepare(`INSERT INTO loyalty_accounts (id, org_id, customer_id, points_balance, tier, created_at) VALUES (?, ?, ?, 0, 'base', ?)`).run(id, orgId, customerId, Date.now());
      account = { id, points_balance: 0 };
    }
    const newBalance = account!.points_balance + delta;
    if (newBalance < 0) badRequest("Ajuste deixaria o saldo de pontos negativo.");
    db.prepare(`UPDATE loyalty_accounts SET points_balance = ? WHERE id = ?`).run(newBalance, account!.id);
    db.prepare(
      `INSERT INTO loyalty_transactions (id, org_id, account_id, delta_points, reason, ref_type, note, created_at)
       VALUES (?, ?, ?, ?, 'adjust', 'manual', ?, ?)`,
    ).run(newId("loytx"), orgId, account!.id, delta, note, Date.now());
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "loyalty.adjust", resourceType: "loyalty_account", resourceId: account!.id, after: { delta, note } },
      db,
    );
    balance = newBalance;
  });
  return { balance };
}

/* ------------------------- Data requests (GDPR) ---------------------- */

export function createDataRequest(
  orgId: string,
  customerId: string,
  kind: "access" | "rectification" | "erasure" | "portability",
  note: string | undefined,
  actor: { userId: string; label: string },
): string {
  const db = getDb();
  const id = newId("dreq");
  tx(db, () => {
    db.prepare(
      `INSERT INTO data_requests (id, org_id, customer_id, kind, status, note, requested_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    ).run(id, orgId, customerId, kind, note ?? null, Date.now());
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: `gdpr.request_${kind}`, resourceType: "data_request", resourceId: id },
      db,
    );
  });
  return id;
}

/**
 * Resolves a data request.
 *  - access/portability: exports the customer's data as JSON.
 *  - erasure: ANONYMIZES personal fields; sales history is preserved
 *    (legal requirement: financial documents cannot be deleted) and the
 *    customer record is archived. This is a controlled, audited process —
 *    never a silent deletion.
 */
export function resolveDataRequest(
  orgId: string,
  requestId: string,
  resolution: "fulfilled" | "rejected",
  actor: { userId: string; label: string },
  rejectionReason?: string,
): { exportData?: unknown } {
  const db = getDb();
  const request = db.prepare(`SELECT * FROM data_requests WHERE id = ? AND org_id = ?`).get(requestId, orgId) as { id: string; kind: string; customer_id: string; status: string } | undefined;
  if (!request) notFound("Pedido de dados");
  if (request!.status !== "pending") throw new ApiError(409, "Pedido já resolvido.", "already_resolved");

  let exportData: unknown;
  tx(db, () => {
    if (resolution === "fulfilled") {
      if (request!.kind === "access" || request!.kind === "portability") {
        exportData = getCustomerDetail(orgId, request!.customer_id);
      }
      if (request!.kind === "erasure") {
        const customer = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(request!.customer_id) as Record<string, unknown>;
        db.prepare(
          `UPDATE customers SET name = 'Cliente eliminado (' || substr(id, 6, 6) || ')',
             email = NULL, phone = NULL, tax_id = NULL, address = NULL, city = NULL,
             notes = 'Registo anonimizado a pedido do titular (RGPD). Histórico financeiro preservado por obrigação legal.',
             tags = '[]', marketing_consent = 0, status = 'archived', updated_at = ?
           WHERE id = ?`,
        ).run(Date.now(), request!.customer_id);
        exportData = { anonymized: true, preserved: "sales history (legal obligation)", before: { name: customer?.name } };
      }
    }
    db.prepare(
      `UPDATE data_requests SET status = ?, resolved_at = ?, resolved_by = ?, note = COALESCE(note,'') || ? WHERE id = ?`,
    ).run(resolution, Date.now(), actor.userId, rejectionReason ? ` | Rejeição: ${rejectionReason}` : "", requestId);
    writeAudit(
      {
        orgId, actorUserId: actor.userId, actorLabel: actor.label,
        action: `gdpr.resolve_${resolution}`, resourceType: "data_request", resourceId: requestId,
        after: { kind: request!.kind, rejectionReason: rejectionReason ?? null },
      },
      db,
    );
  });
  return { exportData };
}
