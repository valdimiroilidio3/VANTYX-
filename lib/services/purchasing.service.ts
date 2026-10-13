import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { ApiError, badRequest, conflict, notFound } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";
import { applyStockDelta, receiveBatch, type PendingEvent } from "./inventory.service";
import { emitDomainEvent } from "@/lib/domain/events";
import { evaluateRules, resolveDecisions, type RuleContext } from "@/lib/domain/rules-engine";
import { loadEnabledRules } from "./sales.service";
import { loginWithPin } from "./session.service";

/**
 * Purchasing — suppliers, purchase orders with configurable approval
 * flow (rules engine), partial/total receiving with cost update
 * (weighted average), batch/serial capture and discrepancy tracking.
 */

/* ---------------------------- Suppliers ---------------------------- */

export interface SupplierInput {
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  taxId?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  leadTimeDays?: number | null;
}

export function createSupplier(orgId: string, input: SupplierInput): string {
  if (!input.name?.trim()) badRequest("Nome do fornecedor é obrigatório.");
  const db = getDb();
  const id = newId("sup");
  db.prepare(
    `INSERT INTO suppliers (id, org_id, name, contact_name, email, phone, tax_id, address, payment_terms, lead_time_days, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(id, orgId, input.name.trim(), input.contactName ?? null, input.email ?? null, input.phone ?? null, input.taxId ?? null, input.address ?? null, input.paymentTerms ?? null, input.leadTimeDays ?? null, Date.now(), Date.now());
  return id;
}

export function listSuppliers(orgId: string, opts: { search?: string } = {}) {
  const db = getDb();
  if (opts.search) {
    return db.prepare(
      `SELECT * FROM suppliers WHERE org_id = ? AND (name LIKE ? OR COALESCE(email,'') LIKE ?) ORDER BY name`,
    ).all(orgId, `%${opts.search}%`, `%${opts.search}%`);
  }
  return db.prepare(`SELECT * FROM suppliers WHERE org_id = ? ORDER BY name`).all(orgId);
}

/* -------------------------- Purchase orders -------------------------- */

export interface PurchaseOrderInput {
  supplierId: string;
  warehouseId: string;
  expectedAt?: number | null;
  note?: string;
  lines: {
    productId: string;
    variantId?: string | null;
    qtyMilli: number;
    unitCostCents: number;
    taxRateBps?: number;
    note?: string;
  }[];
  actor: { userId: string; label: string; roleKey: string };
  supervisor?: { userId: string; pin: string } | null;
}

export function createPurchaseOrder(orgId: string, input: PurchaseOrderInput): { poId: string; poNumber: string; status: string; approvalRequired?: boolean } {
  if (!input.lines.length) badRequest("Encomenda sem linhas.");
  const db = getDb();
  const supplier = db.prepare(`SELECT id, name FROM suppliers WHERE id = ? AND org_id = ?`).get(input.supplierId, orgId);
  if (!supplier) notFound("Fornecedor");

  const now = Date.now();
  let subtotal = 0;
  let tax = 0;
  const resolved = input.lines.map((l) => {
    if (l.qtyMilli <= 0) badRequest("Quantidade inválida.");
    if (l.unitCostCents < 0) badRequest("Custo inválido.");
    const lineTotal = Math.round((l.qtyMilli * l.unitCostCents) / 1000);
    const bps = l.taxRateBps ?? 2300;
    subtotal += lineTotal;
    tax += Math.round((lineTotal * bps) / 10000);
    return { ...l, lineTotal, taxRateBps: bps };
  });
  const total = subtotal + tax;

  // Approval requirement via rules engine (e.g. purchases > limit)
  const rules = loadEnabledRules(db, orgId);
  const ctx: RuleContext = {
    "purchase.total_cents": total,
    "user.role": input.actor.roleKey,
    "user.id": input.actor.userId,
  };
  const decisions = evaluateRules(rules, ctx, { roleKey: input.actor.roleKey });
  const resolution = resolveDecisions(decisions);
  let supervisorApproved = false;
  if (resolution.approval && input.supervisor) {
    if (!loginWithPin(input.supervisor.userId, input.supervisor.pin)) {
      conflict("PIN de supervisor inválido.");
    }
    supervisorApproved = true;
  }
  const requiresApproval = Boolean(resolution.approval) && !supervisorApproved;
  if (resolution.blocked) {
    throw new ApiError(422, resolution.blocked.reason, "rule_blocked");
  }

  const poId = newId("po");
  const poNumber = `PC-${new Date(now).getFullYear()}-${String(now).slice(-6)}`;
  const status = requiresApproval ? "pending_approval" : "draft";

  tx(db, () => {
    db.prepare(
      `INSERT INTO purchase_orders
        (id, org_id, po_number, supplier_id, warehouse_id, status, expected_at,
         subtotal_cents, tax_cents, total_cents, requires_approval, approved_by, approved_at,
         note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      poId, orgId, poNumber, input.supplierId, input.warehouseId, status,
      input.expectedAt ?? null, subtotal, tax, total, requiresApproval ? 1 : 0,
      supervisorApproved ? input.supervisor!.userId : null,
      supervisorApproved ? now : null,
      input.note ?? null, input.actor.userId, now, now,
    );
    const insertLine = db.prepare(
      `INSERT INTO purchase_order_lines (id, org_id, po_id, product_id, variant_id, qty_milli, unit_cost_cents, tax_rate_bps, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of resolved) {
      insertLine.run(newId("pol"), orgId, poId, line.productId, line.variantId ?? null, line.qtyMilli, line.unitCostCents, line.taxRateBps, line.note ?? null);
    }
    // Record supplier price history
    const insertHistory = db.prepare(
      `INSERT INTO supplier_price_history (id, org_id, supplier_id, product_id, variant_id, unit_cost_cents, po_id, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of resolved) {
      insertHistory.run(newId("sph"), orgId, input.supplierId, line.productId, line.variantId ?? null, line.unitCostCents, poId, now);
    }
    writeAudit(
      {
        orgId, actorUserId: input.actor.userId, actorLabel: input.actor.label,
        action: "purchase.create", resourceType: "purchase_order", resourceId: poId,
        after: { poNumber, totalCents: total, status, requiresApproval, supervisorApproved },
      },
      db,
    );
  });

  if (requiresApproval) {
    db.prepare(
      `INSERT INTO approvals (id, org_id, kind, ref_type, ref_id, params, status, requested_by, created_at)
       VALUES (?, ?, 'purchase', 'purchase_order', ?, ?, 'pending', ?, ?)`,
    ).run(newId("appr"), orgId, poId, JSON.stringify({ totalCents: total, poNumber }), input.actor.userId, now);
    emitDomainEvent("purchase.approval_required", { orgId, poId, poNumber, totalCents: total });
  }
  return { poId, poNumber, status, approvalRequired: requiresApproval };
}

export function setPurchaseOrderStatus(
  orgId: string,
  poId: string,
  status: "sent" | "cancelled",
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  const po = db.prepare(`SELECT * FROM purchase_orders WHERE id = ? AND org_id = ?`).get(poId, orgId) as { id: string; status: string } | undefined;
  if (!po) notFound("Encomenda");
  if (!["draft", "pending_approval", "sent"].includes(po!.status)) {
    conflict(`Não pode alterar o estado de uma encomenda "${po!.status}".`);
  }
  if (po!.status === "pending_approval" && status === "sent") {
    conflict("Encomenda aguarda aprovação — aprove antes de enviar.");
  }
  tx(db, () => {
    db.prepare(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`).run(status, Date.now(), poId);
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: `purchase.status_${status}`, resourceType: "purchase_order", resourceId: poId },
      db,
    );
  });
}

export function approvePurchaseOrder(
  orgId: string,
  poId: string,
  decision: "approved" | "rejected",
  reason: string | undefined,
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  tx(db, () => {
    const po = db.prepare(`SELECT * FROM purchase_orders WHERE id = ? AND org_id = ?`).get(poId, orgId) as { id: string; status: string } | undefined;
    if (!po) notFound("Encomenda");
    if (po!.status !== "pending_approval") conflict("Encomenda não está pendente de aprovação.");
    const newStatus = decision === "approved" ? "draft" : "cancelled";
    db.prepare(`UPDATE purchase_orders SET status = ?, approved_by = ?, approved_at = ?, updated_at = ?, requires_approval = 0 WHERE id = ?`)
      .run(newStatus, decision === "approved" ? actor.userId : null, Date.now(), Date.now(), poId);
    db.prepare(
      `UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, reason = ?
       WHERE org_id = ? AND ref_id = ? AND status = 'pending'`,
    ).run(decision, actor.userId, Date.now(), reason ?? null, orgId, poId);
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: `purchase.${decision}`, resourceType: "purchase_order", resourceId: poId, after: { reason: reason ?? null } },
      db,
    );
  });
}

/* ------------------------------ Receiving ----------------------------- */

export interface ReceiptLineInput {
  poLineId: string;
  qtyMilli: number;
  unitCostCents?: number; // actual cost if different from PO
  batchNumber?: string | null;
  expiryDate?: number | null;
  serialNumbers?: string[];
}

export function receivePurchaseOrder(
  orgId: string,
  poId: string,
  lines: ReceiptLineInput[],
  data: { note?: string; actor: { userId: string; label: string } },
): { receiptId: string; discrepancies: number } {
  if (!lines.length) badRequest("Receção sem linhas.");
  const db = getDb();
  const pendingEvents: PendingEvent[] = [];
  let receiptId = "";
  let discrepancies = 0;

  tx(db, () => {
    const now = Date.now();
    const po = db.prepare(`SELECT * FROM purchase_orders WHERE id = ? AND org_id = ?`).get(poId, orgId) as PoRow | undefined;
    if (!po) notFound("Encomenda");
    if (!["sent", "draft", "partially_received"].includes(po!.status)) {
      conflict(`Encomenda no estado "${po!.status}" não pode ser recebida.`);
    }
    if (po!.status === "draft") {
      // Receiving implies the order went out; mark sent automatically.
      db.prepare(`UPDATE purchase_orders SET status = 'sent', updated_at = ? WHERE id = ?`).run(now, poId);
    }

    receiptId = newId("gr");
    db.prepare(
      `INSERT INTO goods_receipts (id, org_id, po_id, warehouse_id, note, received_by, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(receiptId, orgId, poId, po!.warehouse_id, data.note ?? null, data.actor.userId, now);

    const insertReceiptLine = db.prepare(
      `INSERT INTO goods_receipt_lines (id, org_id, receipt_id, po_line_id, product_id, variant_id, qty_milli, unit_cost_cents, batch_number, expiry_date, serial_numbers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const line of lines) {
      const poLine = db.prepare(`SELECT * FROM purchase_order_lines WHERE id = ? AND po_id = ?`).get(line.poLineId, poId) as PoLineRow | undefined;
      if (!poLine) notFound("Linha de encomenda");
      const remaining = poLine!.qty_milli - poLine!.received_milli;
      if (line.qtyMilli <= 0 || line.qtyMilli > remaining) {
        badRequest(`Quantidade recebida inválida (máx. ${remaining / 1000}).`);
      }
      const unitCost = line.unitCostCents ?? poLine!.unit_cost_cents;
      if (unitCost !== poLine!.unit_cost_cents) discrepancies++;

      insertReceiptLine.run(
        newId("grl"), orgId, receiptId, poLine!.id, poLine!.product_id, poLine!.variant_id,
        line.qtyMilli, unitCost, line.batchNumber ?? null, line.expiryDate ?? null,
        line.serialNumbers ? JSON.stringify(line.serialNumbers) : null,
      );
      db.prepare(`UPDATE purchase_order_lines SET received_milli = received_milli + ? WHERE id = ?`)
        .run(line.qtyMilli, poLine!.id);

      // Stock in + weighted average cost update
      const delta = applyStockDelta(db, {
        orgId,
        warehouseId: po!.warehouse_id,
        productId: poLine!.product_id,
        variantId: poLine!.variant_id,
        qtyMilli: line.qtyMilli,
        reason: "purchase_receipt",
        refType: "goods_receipt",
        refId: receiptId,
        unitCostCents: unitCost,
        createdBy: data.actor.userId,
      });
      pendingEvents.push(...delta.events);

      // Batch tracking
      const product = db.prepare(`SELECT track_batches, track_serials FROM products WHERE id = ?`).get(poLine!.product_id) as { track_batches: number; track_serials: number };
      if (product.track_batches === 1) {
        if (!line.batchNumber) badRequest("Produto com rastreamento de lote exige número de lote na receção.");
        receiveBatch(db, {
          orgId, warehouseId: po!.warehouse_id, productId: poLine!.product_id,
          variantId: poLine!.variant_id, batchNumber: line.batchNumber!,
          expiryDate: line.expiryDate ?? null, qtyMilli: line.qtyMilli,
          unitCostCents: unitCost, supplierId: po!.supplier_id,
        });
      }
      if (product.track_serials === 1 && line.serialNumbers?.length) {
        const insertSerial = db.prepare(
          `INSERT OR IGNORE INTO serials (id, org_id, product_id, variant_id, warehouse_id, serial_number, status, received_at)
           VALUES (?, ?, ?, ?, ?, ?, 'in_stock', ?)`,
        );
        for (const serial of line.serialNumbers) {
          insertSerial.run(newId("ser"), orgId, poLine!.product_id, poLine!.variant_id, po!.warehouse_id, serial, now);
        }
        if (line.serialNumbers.length * 1000 !== line.qtyMilli) discrepancies++;
      }
    }

    // PO status: fully or partially received
    const totals = db.prepare(
      `SELECT COALESCE(SUM(qty_milli),0) ordered, COALESCE(SUM(received_milli),0) received
       FROM purchase_order_lines WHERE po_id = ?`,
    ).get(poId) as { ordered: number; received: number };
    const newStatus = totals.received >= totals.ordered ? "received" : "partially_received";
    db.prepare(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`).run(newStatus, now, poId);

    writeAudit(
      {
        orgId, actorUserId: data.actor.userId, actorLabel: data.actor.label,
        action: "purchase.receive", resourceType: "goods_receipt", resourceId: receiptId,
        after: { poId, poNumber: po!.po_number, lines: lines.length, discrepancies },
      },
      db,
    );
  });

  for (const pending of pendingEvents) {
    if (pending.event === "stock.below_min") emitDomainEvent("stock.below_min", pending.payload as never);
    if (pending.event === "stock.negative") emitDomainEvent("stock.negative", pending.payload as never);
  }
  emitDomainEvent("purchase.received", { orgId, poId, receiptId, discrepancies });
  return { receiptId, discrepancies };
}

interface PoRow {
  id: string;
  po_number: string;
  supplier_id: string;
  warehouse_id: string;
  status: string;
  total_cents: number;
}

interface PoLineRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  qty_milli: number;
  received_milli: number;
  unit_cost_cents: number;
}

export function listPurchaseOrders(
  orgId: string,
  opts: { status?: string; supplierId?: string; limit?: number; offset?: number } = {},
): { rows: unknown[]; total: number } {
  const db = getDb();
  const where: string[] = ["po.org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.status) { where.push("po.status = ?"); params.push(opts.status); }
  if (opts.supplierId) { where.push("po.supplier_id = ?"); params.push(opts.supplierId); }
  const limit = Math.min(opts.limit ?? 25, 200);
  const offset = opts.offset ?? 0;
  const rows = db.prepare(
    `SELECT po.*, s.name as supplier_name, w.name as warehouse_name, u.name as created_by_name,
       (SELECT COUNT(*) FROM purchase_order_lines l WHERE l.po_id = po.id) as line_count
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     JOIN warehouses w ON w.id = po.warehouse_id
     LEFT JOIN users u ON u.id = po.created_by
     WHERE ${where.join(" AND ")}
     ORDER BY po.created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, limit, offset);
  const total = (db.prepare(`SELECT COUNT(*) n FROM purchase_orders po WHERE ${where.join(" AND ")}`).get(...params) as { n: number }).n;
  return { rows, total };
}

export function getPurchaseOrder(orgId: string, poId: string) {
  const db = getDb();
  const po = db.prepare(
    `SELECT po.*, s.name as supplier_name, w.name as warehouse_name
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     JOIN warehouses w ON w.id = po.warehouse_id
     WHERE po.id = ? AND po.org_id = ?`,
  ).get(poId, orgId);
  if (!po) notFound("Encomenda");
  const lines = db.prepare(
    `SELECT l.*, p.name as product_name, p.sku, v.label as variant_label
     FROM purchase_order_lines l
     JOIN products p ON p.id = l.product_id
     LEFT JOIN product_variants v ON v.id = l.variant_id
     WHERE l.po_id = ?`,
  ).all(poId);
  const receipts = db.prepare(`SELECT * FROM goods_receipts WHERE po_id = ? ORDER BY received_at DESC`).all(poId);
  return { po, lines, receipts };
}

/** Replenishment suggestions from real sales velocity + reorder points. */
export function purchaseSuggestions(orgId: string, daysBack = 30, limit = 30) {
  const db = getDb();
  const since = Date.now() - daysBack * 86_400_000;
  return db.prepare(
    `WITH velocity AS (
       SELECT sl.product_id, SUM(sl.qty_milli) / ? as avg_daily_milli
       FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
       WHERE s.org_id = ? AND s.status != 'void' AND s.created_at >= ?
       GROUP BY sl.product_id
     )
     SELECT p.id, p.name, p.sku, p.reorder_point_milli, p.reorder_qty_milli,
            COALESCE((SELECT SUM(s.qty_milli) FROM stock_levels s WHERE s.org_id = p.org_id AND s.product_id = p.id), 0) as stock_milli,
            COALESCE(v.avg_daily_milli, 0) as avg_daily_milli,
            COALESCE((SELECT sp.unit_cost_cents FROM supplier_price_history sp
                      WHERE sp.org_id = p.org_id AND sp.product_id = p.id
                      ORDER BY sp.recorded_at DESC LIMIT 1), p.cost_cents) as last_cost_cents,
            sup.name as supplier_name
     FROM products p
     LEFT JOIN velocity v ON v.product_id = p.id
     LEFT JOIN suppliers sup ON sup.id = p.supplier_id
     WHERE p.org_id = ? AND p.status = 'active' AND p.track_stock = 1
       AND (
         (p.reorder_point_milli IS NOT NULL AND COALESCE((SELECT SUM(s2.qty_milli) FROM stock_levels s2 WHERE s2.org_id = p.org_id AND s2.product_id = p.id),0) <= p.reorder_point_milli)
         OR (v.avg_daily_milli > 0 AND COALESCE((SELECT SUM(s3.qty_milli) FROM stock_levels s3 WHERE s3.org_id = p.org_id AND s3.product_id = p.id),0) <= v.avg_daily_milli * 7)
       )
     ORDER BY avg_daily_milli DESC LIMIT ?`,
  ).all(daysBack, orgId, since, orgId, limit) as PurchaseSuggestion[];
}

export interface PurchaseSuggestion {
  id: string;
  name: string;
  sku: string;
  reorder_point_milli: number | null;
  reorder_qty_milli: number | null;
  stock_milli: number;
  avg_daily_milli: number;
  last_cost_cents: number;
  supplier_name: string | null;
}
