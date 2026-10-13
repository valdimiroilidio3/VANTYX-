import { getDb, tx, type Db } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { notFound, badRequest } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";

/** Sequential work-order number per org/year, using the document_series table. */
function nextWoNumber(db: Db, orgId: string): string {
  const year = new Date().getFullYear();
  let series = db
    .prepare(`SELECT id, prefix, next_number FROM document_series WHERE org_id = ? AND doc_type = 'WO' AND fiscal_year = ?`)
    .get(orgId, year) as { id: string; prefix: string; next_number: number } | undefined;
  if (!series) {
    const id = newId("dser");
    db.prepare(
      `INSERT INTO document_series (id, org_id, doc_type, prefix, fiscal_year, next_number) VALUES (?, ?, 'WO', 'OS', ?, 1)`,
    ).run(id, orgId, year);
    series = { id, prefix: "OS", next_number: 1 };
  }
  const seq = series.next_number;
  db.prepare(`UPDATE document_series SET next_number = ? WHERE id = ?`).run(seq + 1, series.id);
  return `${series.prefix}-${year}/${String(seq).padStart(5, "0")}`;
}

/**
 * Workshop / work-order service (auto repair, technical assistance and
 * equipment-maintenance industries). Real persistence, tenant isolation on
 * every query, audited writes. Status flow is enforced server-side.
 */

export const WO_STATUS = [
  "quote",
  "approved",
  "in_progress",
  "waiting_parts",
  "done",
  "delivered",
  "cancelled",
] as const;
export type WoStatus = (typeof WO_STATUS)[number];

/** Legal forward transitions (cancel is always allowed until delivered). */
const WO_TRANSITIONS: Record<WoStatus, WoStatus[]> = {
  quote: ["approved", "cancelled"],
  approved: ["in_progress", "waiting_parts", "cancelled"],
  in_progress: ["waiting_parts", "done", "cancelled"],
  waiting_parts: ["in_progress", "done", "cancelled"],
  done: ["delivered", "in_progress"],
  delivered: [],
  cancelled: [],
};

export interface WoPart {
  productId: string;
  variantId?: string;
  qtyMilli: number;
  unitPriceCents: number;
}

export interface WorkOrderRow {
  id: string;
  wo_number: string;
  branch_id: string;
  branch_name?: string;
  customer_id: string | null;
  customer_name?: string | null;
  vehicle_plate: string | null;
  vehicle_info: string | null;
  equipment_serial: string | null;
  status: WoStatus;
  diagnosis: string | null;
  labor_minutes: number;
  labor_rate_cents: number;
  parts_cents: number;
  labor_cents: number;
  total_cents: number;
  warranty_ends_at: number | null;
  created_at: number;
  updated_at: number;
  part_count?: number;
}

export function listWorkOrders(
  orgId: string,
  opts: { status?: string; search?: string; branchId?: string; limit?: number; offset?: number } = {},
) {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = ["w.org_id = ?"];
  const params: unknown[] = [orgId];
  if (opts.status) {
    where.push("w.status = ?");
    params.push(opts.status);
  }
  if (opts.branchId) {
    where.push("w.branch_id = ?");
    params.push(opts.branchId);
  }
  if (opts.search) {
    where.push("(w.wo_number LIKE ? OR w.vehicle_plate LIKE ? OR w.equipment_serial LIKE ? OR c.name LIKE ?)");
    const s = `%${opts.search}%`;
    params.push(s, s, s, s);
  }
  const clause = where.join(" AND ");
  const rows = db
    .prepare(
      `SELECT w.*, b.name as branch_name, c.name as customer_name,
              (SELECT COUNT(*) FROM work_order_parts p WHERE p.work_order_id = w.id) as part_count
       FROM work_orders w
       LEFT JOIN branches b ON b.id = w.branch_id
       LEFT JOIN customers c ON c.id = w.customer_id
       WHERE ${clause}
       ORDER BY w.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as WorkOrderRow[];
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) c FROM work_orders w LEFT JOIN customers c ON c.id = w.customer_id WHERE ${clause}`,
      )
      .get(...params) as { c: number }
  ).c;
  return { rows, total };
}

export function getWorkOrder(orgId: string, id: string) {
  const db = getDb();
  const wo = db
    .prepare(
      `SELECT w.*, b.name as branch_name, c.name as customer_name, c.phone as customer_phone
       FROM work_orders w
       LEFT JOIN branches b ON b.id = w.branch_id
       LEFT JOIN customers c ON c.id = w.customer_id
       WHERE w.id = ? AND w.org_id = ?`,
    )
    .get(id, orgId) as WorkOrderRow | undefined;
  if (!wo) notFound("Ordem de serviço");
  const parts = db
    .prepare(
      `SELECT p.*, pr.name as product_name, pr.sku, v.label as variant_label
       FROM work_order_parts p
       JOIN products pr ON pr.id = p.product_id
       LEFT JOIN product_variants v ON v.id = p.variant_id
       WHERE p.work_order_id = ? AND p.org_id = ?`,
    )
    .all(id, orgId);
  return { wo, parts };
}

export function createWorkOrder(
  orgId: string,
  input: {
    branchId: string;
    customerId?: string;
    vehiclePlate?: string;
    vehicleInfo?: string;
    equipmentSerial?: string;
    diagnosis?: string;
    laborMinutes?: number;
    laborRateCents?: number;
    warrantyDays?: number;
    parts?: WoPart[];
  },
  actor: { userId: string; label: string },
): string {
  const db = getDb();
  const branch = db.prepare(`SELECT id FROM branches WHERE id = ? AND org_id = ?`).get(input.branchId, orgId);
  if (!branch) badRequest("Filial inválida.");
  if (input.customerId) {
    const c = db.prepare(`SELECT id FROM customers WHERE id = ? AND org_id = ?`).get(input.customerId, orgId);
    if (!c) badRequest("Cliente inválido.");
  }
  const parts = input.parts ?? [];
  for (const p of parts) {
    if (p.qtyMilli <= 0) badRequest("Quantidade de peça deve ser positiva.");
    if (p.unitPriceCents < 0) badRequest("Preço de peça não pode ser negativo.");
    const prod = db.prepare(`SELECT id FROM products WHERE id = ? AND org_id = ?`).get(p.productId, orgId);
    if (!prod) badRequest(`Peça/produto inválido: ${p.productId}`);
  }
  const id = newId("wo");
  const now = Date.now();
  const laborMinutes = Math.max(input.laborMinutes ?? 0, 0);
  const laborRateCents = Math.max(input.laborRateCents ?? 0, 0);
  const partsCents = parts.reduce((s, p) => s + Math.round((p.unitPriceCents * p.qtyMilli) / 1000), 0);
  const laborCents = Math.round((laborMinutes / 60) * laborRateCents);
  tx(db, () => {
    const woNumber = nextWoNumber(db, orgId);
    db.prepare(
      `INSERT INTO work_orders
       (id, org_id, branch_id, wo_number, customer_id, vehicle_plate, vehicle_info, equipment_serial,
        status, diagnosis, labor_minutes, labor_rate_cents, parts_cents, labor_cents, total_cents,
        warranty_ends_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quote', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, orgId, input.branchId, woNumber, input.customerId ?? null, input.vehiclePlate ?? null,
      input.vehicleInfo ?? null, input.equipmentSerial ?? null, input.diagnosis ?? null,
      laborMinutes, laborRateCents, partsCents, laborCents, partsCents + laborCents,
      input.warrantyDays ? now + input.warrantyDays * 86_400_000 : null,
      actor.userId, now, now,
    );
    for (const p of parts) {
      db.prepare(
        `INSERT INTO work_order_parts (id, org_id, work_order_id, product_id, variant_id, qty_milli, unit_price_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(newId("wop"), orgId, id, p.productId, p.variantId ?? null, p.qtyMilli, p.unitPriceCents);
    }
    writeAudit(
      {
        orgId, actorUserId: actor.userId, actorLabel: actor.label,
        action: "work_order.create", resourceType: "work_order", resourceId: id,
        after: { woNumber, branchId: input.branchId, parts: parts.length },
      },
      db,
    );
  });
  return id;
}

export function updateWorkOrderStatus(
  orgId: string,
  id: string,
  status: WoStatus,
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  const wo = db.prepare(`SELECT status FROM work_orders WHERE id = ? AND org_id = ?`).get(id, orgId) as
    | { status: WoStatus }
    | undefined;
  if (!wo) notFound("Ordem de serviço");
  if (!WO_TRANSITIONS[wo.status].includes(status)) {
    badRequest(`Transição inválida: ${wo.status} → ${status}.`);
  }
  tx(db, () => {
    db.prepare(`UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ? AND org_id = ?`)
      .run(status, Date.now(), id, orgId);
    writeAudit(
      {
        orgId, actorUserId: actor.userId, actorLabel: actor.label,
        action: "work_order.status", resourceType: "work_order", resourceId: id,
        before: { status: wo.status }, after: { status },
      },
      db,
    );
  });
}
