import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { notFound, badRequest, conflict } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";

/**
 * Scheduling service (salon/barber, clinics, spas, pet care, personal
 * trainers). Resources (staff/rooms/equipment) hold a calendar; appointments
 * are booked against a resource with server-side overlap rejection and
 * enforced status transitions. Tenant isolation on every query.
 */

export const APPT_STATUS = ["booked", "confirmed", "in_progress", "done", "cancelled", "no_show"] as const;
export type ApptStatus = (typeof APPT_STATUS)[number];

const APPT_TRANSITIONS: Record<ApptStatus, ApptStatus[]> = {
  booked: ["confirmed", "in_progress", "cancelled", "no_show"],
  confirmed: ["in_progress", "cancelled", "no_show"],
  in_progress: ["done", "cancelled"],
  done: [],
  cancelled: [],
  no_show: [],
};

export interface ResourceRow {
  id: string;
  branch_id: string;
  branch_name?: string;
  user_id: string | null;
  user_name?: string | null;
  name: string;
  kind: string;
  commission_bps: number;
  color: string | null;
  active: number;
}

export interface AppointmentRow {
  id: string;
  branch_id: string;
  branch_name?: string;
  resource_id: string;
  resource_name?: string;
  resource_color?: string | null;
  customer_id: string | null;
  customer_name: string;
  phone: string | null;
  product_id: string | null;
  product_name?: string | null;
  starts_at: number;
  duration_min: number;
  status: ApptStatus;
  price_cents: number | null;
  notes: string | null;
  created_at: number;
}

export async function listResources(orgId: string, opts: { branchId?: string; includeInactive?: boolean } = {}): Promise<ResourceRow[]> {
  const db = getDb();
  const where = ["r.org_id = ?"];
  const params: unknown[] = [orgId];
  if (!opts.includeInactive) where.push("r.active = 1");
  if (opts.branchId) {
    where.push("r.branch_id = ?");
    params.push(opts.branchId);
  }
  return (await db
    .prepare(
      `SELECT r.*, b.name as branch_name, u.name as user_name
       FROM service_resources r
       LEFT JOIN branches b ON b.id = r.branch_id
       LEFT JOIN users u ON u.id = r.user_id
       WHERE ${where.join(" AND ")}
       ORDER BY r.name`,
    )
    .all(...params)) as ResourceRow[];
}

export async function createResource(
  orgId: string,
  input: { branchId: string; name: string; kind?: string; userId?: string; commissionBps?: number; color?: string },
  actor: { userId: string; label: string },
): Promise<string> {
  const db = getDb();
  const branch = await db.prepare(`SELECT id FROM branches WHERE id = ? AND org_id = ?`).get(input.branchId, orgId);
  if (!branch) badRequest("Filial inválida.");
  const kind = input.kind ?? "staff";
  if (!["staff", "room", "equipment"].includes(kind)) badRequest("Tipo de recurso inválido.");
  const commissionBps = Math.min(Math.max(input.commissionBps ?? 0, 0), 10000);
  const id = newId("sres");
  await tx(db, async () => {
    await db.prepare(
      `INSERT INTO service_resources (id, org_id, branch_id, user_id, name, kind, commission_bps, color, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(id, orgId, input.branchId, input.userId ?? null, input.name.trim(), kind, commissionBps, input.color ?? null, Date.now());
    await writeAudit(
      {
        orgId, actorUserId: actor.userId, actorLabel: actor.label,
        action: "resource.create", resourceType: "service_resource", resourceId: id,
        after: { name: input.name, kind },
      },
      db,
    );
  });
  return id;
}

export async function listAppointments(
  orgId: string,
  opts: { from?: number; to?: number; resourceId?: string; status?: string; branchId?: string; limit?: number; offset?: number } = {},
) {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const where = ["a.org_id = ?"];
  const params: unknown[] = [orgId];
  if (opts.from) {
    where.push("a.starts_at >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("a.starts_at < ?");
    params.push(opts.to);
  }
  if (opts.resourceId) {
    where.push("a.resource_id = ?");
    params.push(opts.resourceId);
  }
  if (opts.status) {
    where.push("a.status = ?");
    params.push(opts.status);
  }
  if (opts.branchId) {
    where.push("a.branch_id = ?");
    params.push(opts.branchId);
  }
  const clause = where.join(" AND ");
  const rows = (await db
    .prepare(
      `SELECT a.*, r.name as resource_name, r.color as resource_color, b.name as branch_name, p.name as product_name
       FROM appointments a
       JOIN service_resources r ON r.id = a.resource_id
       LEFT JOIN branches b ON b.id = a.branch_id
       LEFT JOIN products p ON p.id = a.product_id
       WHERE ${clause}
       ORDER BY a.starts_at LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)) as AppointmentRow[];
  const total = ((await db.prepare(`SELECT COUNT(*) c FROM appointments a WHERE ${clause}`).get(...params)) as { c: number }).c;
  return { rows, total };
}

/** Rejects double-booking server-side: same resource, overlapping window. */
export async function createAppointment(
  orgId: string,
  input: {
    resourceId: string;
    customerName: string;
    customerId?: string;
    phone?: string;
    productId?: string;
    startsAt: number;
    durationMin?: number;
    priceCents?: number;
    notes?: string;
  },
  actor: { userId: string; label: string },
): Promise<string> {
  const db = getDb();
  const resource = (await db
    .prepare(`SELECT id, branch_id FROM service_resources WHERE id = ? AND org_id = ? AND active = 1`)
    .get(input.resourceId, orgId)) as { id: string; branch_id: string } | undefined;
  if (!resource) badRequest("Recurso inválido ou inativo.");
  if (!Number.isFinite(input.startsAt) || input.startsAt <= 0) badRequest("Data/hora de início inválida.");
  const durationMin = Math.min(Math.max(input.durationMin ?? 30, 5), 720);
  if (input.customerId) {
    const c = await db.prepare(`SELECT id FROM customers WHERE id = ? AND org_id = ?`).get(input.customerId, orgId);
    if (!c) badRequest("Cliente inválido.");
  }
  if (input.productId) {
    const p = await db.prepare(`SELECT id FROM products WHERE id = ? AND org_id = ?`).get(input.productId, orgId);
    if (!p) badRequest("Serviço/produto inválido.");
  }
  const endsAt = input.startsAt + durationMin * 60_000;
  const id = newId("appt");
  await tx(db, async () => {
    const clash = await db
      .prepare(
        `SELECT id FROM appointments
         WHERE org_id = ? AND resource_id = ? AND status NOT IN ('cancelled','no_show')
           AND starts_at < ? AND (starts_at + duration_min * 60000) > ?`,
      )
      .get(orgId, input.resourceId, endsAt, input.startsAt);
    if (clash) conflict("Já existe uma marcação sobreposta para este recurso.");
    await db.prepare(
      `INSERT INTO appointments
       (id, org_id, branch_id, resource_id, customer_id, customer_name, phone, product_id,
        starts_at, duration_min, status, price_cents, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?, ?)`,
    ).run(
      id, orgId, resource.branch_id, input.resourceId, input.customerId ?? null,
      input.customerName.trim(), input.phone ?? null, input.productId ?? null,
      input.startsAt, durationMin, input.priceCents ?? null, input.notes ?? null, Date.now(),
    );
    await writeAudit(
      {
        orgId, actorUserId: actor.userId, actorLabel: actor.label,
        action: "appointment.create", resourceType: "appointment", resourceId: id,
        after: { resourceId: input.resourceId, startsAt: input.startsAt, durationMin },
      },
      db,
    );
  });
  return id;
}

export async function updateAppointmentStatus(
  orgId: string,
  id: string,
  status: ApptStatus,
  actor: { userId: string; label: string },
): Promise<void> {
  const db = getDb();
  const appt = (await db.prepare(`SELECT status FROM appointments WHERE id = ? AND org_id = ?`).get(id, orgId)) as
    | { status: ApptStatus }
    | undefined;
  if (!appt) notFound("Marcação");
  if (!APPT_TRANSITIONS[appt.status].includes(status)) {
    badRequest(`Transição inválida: ${appt.status} → ${status}.`);
  }
  await tx(db, async () => {
    await db.prepare(`UPDATE appointments SET status = ? WHERE id = ? AND org_id = ?`).run(status, id, orgId);
    await writeAudit(
      {
        orgId, actorUserId: actor.userId, actorLabel: actor.label,
        action: "appointment.status", resourceType: "appointment", resourceId: id,
        before: { status: appt.status }, after: { status },
      },
      db,
    );
  });
}
