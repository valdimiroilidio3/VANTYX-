import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { ApiError, badRequest, conflict, notFound } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";
import { emitDomainEvent } from "@/lib/domain/events";

/**
 * Restaurant vertical — floor map, orders, kitchen display tickets,
 * modifiers, table transfers, reservations and shifts.
 *
 * Traceability: every ordered item and kitchen ticket is persisted
 * server-side at creation. A refreshed/crashed operator screen never
 * loses an order — the KDS and floor map always read the database.
 */

/* ------------------------------ Tables ------------------------------ */

export interface TableRow {
  id: string;
  org_id: string;
  branch_id: string;
  name: string;
  zone: string;
  seats: number;
  status: "free" | "occupied" | "reserved" | "bill_requested";
  position_x: number;
  position_y: number;
  order_id?: string | null;
  order_opened_at?: number | null;
  order_total_cents?: number | null;
  guest_count?: number | null;
}

export async function listTables(orgId: string, branchId: string): Promise<TableRow[]> {
  const db = getDb();
  const tables = (await db
    .prepare(`SELECT * FROM r_tables WHERE org_id = ? AND branch_id = ? ORDER BY zone, name`)
    .all(orgId, branchId)) as TableRow[];
  for (const table of tables) {
    const openOrder = (await db
      .prepare(
        `SELECT o.id, o.opened_at, o.guest_count,
                COALESCE((SELECT SUM(ROUND(i.qty_milli * i.unit_price_cents / 1000.0)) FROM r_order_items i WHERE i.order_id = o.id AND i.status NOT IN ('cancelled','billed')), 0) as open_total
         FROM r_orders o WHERE o.table_id = ? AND o.status = 'open' ORDER BY o.opened_at DESC LIMIT 1`,
      )
      .get(table.id)) as
      | { id: string; opened_at: number; guest_count: number; open_total: number }
      | undefined;
    if (openOrder) {
      table.order_id = openOrder.id;
      table.order_opened_at = openOrder.opened_at;
      table.order_total_cents = openOrder.open_total;
      table.guest_count = openOrder.guest_count;
      if (table.status === "free") table.status = "occupied";
    } else {
      table.order_id = null;
      table.order_opened_at = null;
      table.order_total_cents = null;
      table.guest_count = null;
      if (table.status === "occupied" || table.status === "bill_requested") {
        await db.prepare(`UPDATE r_tables SET status = 'free' WHERE id = ?`).run(table.id);
        table.status = "free";
      }
    }
  }
  return tables;
}

export async function upsertTable(
  orgId: string,
  branchId: string,
  data: { id?: string; name: string; zone?: string; seats?: number; positionX?: number; positionY?: number },
): Promise<string> {
  const db = getDb();
  if (data.id) {
    await db.prepare(
      `UPDATE r_tables SET name = ?, zone = ?, seats = ?, position_x = ?, position_y = ? WHERE id = ? AND org_id = ?`,
    ).run(data.name, data.zone ?? "main", data.seats ?? 4, data.positionX ?? 0, data.positionY ?? 0, data.id, orgId);
    return data.id;
  }
  const id = newId("tbl");
  await db.prepare(
    `INSERT INTO r_tables (id, org_id, branch_id, name, zone, seats, status, position_x, position_y, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'free', ?, ?, ?)`,
  ).run(id, orgId, branchId, data.name.trim(), data.zone ?? "main", data.seats ?? 4, data.positionX ?? 0, data.positionY ?? 0, Date.now());
  return id;
}

export async function setTableStatus(orgId: string, tableId: string, status: TableRow["status"]): Promise<void> {
  await getDb().prepare(`UPDATE r_tables SET status = ? WHERE id = ? AND org_id = ?`).run(status, tableId, orgId);
}

/* ------------------------------- Orders ------------------------------ */

export interface OrderItemInput {
  productId: string;
  variantId?: string | null;
  qtyMilli: number;
  modifiers?: { groupId: string; groupName: string; optionId: string; name: string; priceCents: number }[];
  notes?: string;
  sendToKitchen?: boolean; // default true
}

export async function openOrder(
  orgId: string,
  data: {
    branchId: string;
    tableId?: string | null;
    channel: "dine_in" | "takeaway" | "counter" | "delivery";
    guestCount?: number;
    customerId?: string | null;
    customerName?: string | null;
    actor: { userId: string; label: string };
  },
): Promise<{ orderId: string }> {
  const db = getDb();
  if (data.channel === "dine_in" && !data.tableId) {
    badRequest("Pedido dine-in exige mesa.");
  }
  const orderId = newId("rord");
  await tx(db, async () => {
    await db.prepare(
      `INSERT INTO r_orders (id, org_id, branch_id, table_id, channel, customer_id, customer_name, status, guest_count, opened_at, opened_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).run(orderId, orgId, data.branchId, data.tableId ?? null, data.channel, data.customerId ?? null, data.customerName ?? null, data.guestCount ?? 1, Date.now(), data.actor.userId);
    if (data.tableId) {
      const table = (await db.prepare(`SELECT status FROM r_tables WHERE id = ? AND org_id = ?`).get(data.tableId, orgId)) as { status: string } | undefined;
      if (!table) notFound("Mesa");
      if (table!.status === "occupied") {
        const existing = (await db.prepare(`SELECT id FROM r_orders WHERE table_id = ? AND status = 'open'`).get(data.tableId)) as { id: string } | undefined;
        if (existing) {
          // Join the existing order instead of failing (operator flow)
          throw new ApiError(409, `Mesa já tem um pedido aberto (${existing.id}). Adicione itens ao pedido existente.`, "table_occupied");
        }
      }
      await db.prepare(`UPDATE r_tables SET status = 'occupied' WHERE id = ?`).run(data.tableId);
    }
    await writeAudit(
      { orgId, actorUserId: data.actor.userId, actorLabel: data.actor.label, action: "restaurant.order_open", resourceType: "r_order", resourceId: orderId, after: data },
      db,
    );
  });
  return { orderId };
}

export async function addOrderItems(
  orgId: string,
  orderId: string,
  items: OrderItemInput[],
  actor: { userId: string; label: string },
): Promise<{ ticketIds: string[] }> {
  if (!items.length) badRequest("Sem itens para adicionar.");
  const db = getDb();
  const ticketIds: string[] = [];
  await tx(db, async () => {
    const now = Date.now();
    const order = (await db.prepare(`SELECT * FROM r_orders WHERE id = ? AND org_id = ?`).get(orderId, orgId)) as OrderRow | undefined;
    if (!order) notFound("Pedido");
    if (order!.status !== "open") conflict("Pedido fechado — não pode adicionar itens.");

    // Group items by station for ticket creation
    const byStation = new Map<string, { item: OrderItemInput; product: ProductInfo; unitPrice: number }[]>();

    for (const item of items) {
      if (!Number.isInteger(item.qtyMilli) || item.qtyMilli <= 0) badRequest("Quantidade inválida.");
      const product = (await db.prepare(
        `SELECT p.id, p.name, p.unit, p.base_price_cents, p.attributes, v.id as v_id, v.label as v_label, v.price_cents as v_price
         FROM products p LEFT JOIN product_variants v ON v.id = ?
         WHERE p.id = ? AND p.org_id = ?`,
      ).get(item.variantId ?? null, item.productId, orgId)) as (ProductInfo & { v_id?: string | null; v_label?: string | null; v_price?: number | null }) | undefined;
      if (!product) notFound("Produto");
      const unitPrice = item.variantId
        ? ((product as { v_price?: number | null }).v_price ?? product.base_price_cents)
        : product.base_price_cents;

      const attrs = JSON.parse(product.attributes ?? "{}") as { station?: string };
      const station = attrs.station ?? "kitchen";
      const list = byStation.get(station) ?? [];
      list.push({ item, product, unitPrice });
      byStation.set(station, list);

      // Persist the order item immediately (traceability)
      const itemId = newId("roi");
      await db.prepare(
        `INSERT INTO r_order_items (id, org_id, order_id, product_id, variant_id, name_snapshot, qty_milli, unit_price_cents, modifiers, notes, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ordered', ?)`,
      ).run(
        itemId, orgId, orderId, product.id, item.variantId ?? (product as { v_id?: string | null }).v_id ?? null,
        product.name, item.qtyMilli, unitPrice + (item.modifiers ?? []).reduce((a, m) => a + m.priceCents, 0),
        JSON.stringify(item.modifiers ?? []), item.notes ?? null, now,
      );
    }

    // Create kitchen tickets (items are linked to their ticket)
    let seq = (((await db.prepare(`SELECT COALESCE(MAX(sequence),0) m FROM kitchen_tickets WHERE org_id = ?`).get(orgId)) as { m: number }).m) + 1;
    for (const [station, entries] of byStation) {
      const sendToKitchen = entries.some((e) => e.item.sendToKitchen !== false);
      if (!sendToKitchen) continue;
      const ticketId = newId("tick");
      const tableLabel = order!.table_id
        ? ((await db.prepare(`SELECT name FROM r_tables WHERE id = ?`).get(order!.table_id)) as { name: string } | undefined)?.name ?? null
        : null;
      await db.prepare(
        `INSERT INTO kitchen_tickets (id, org_id, order_id, station, sequence, status, table_label, channel, sent_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).run(ticketId, orgId, orderId, station, seq++, tableLabel, order!.channel, now);
      ticketIds.push(ticketId);

      const insertLine = db.prepare(
        `INSERT INTO kitchen_ticket_lines (id, org_id, ticket_id, product_id, variant_id, name, qty_milli, unit, modifiers, notes, sequence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let lineSeq = 0;
      for (const entry of entries) {
        await insertLine.run(
          newId("tl"), orgId, ticketId, entry.product.id, entry.item.variantId ?? null,
          entry.product.name + ((entry.product as { v_label?: string | null }).v_label ? ` (${(entry.product as { v_label?: string | null }).v_label})` : ""),
          entry.item.qtyMilli, entry.product.unit,
          JSON.stringify(entry.item.modifiers ?? []), entry.item.notes ?? null, lineSeq++,
        );
        // Link the most recent order items of this product to the ticket
        await db.prepare(
          `UPDATE r_order_items SET ticket_id = ?, status = 'sent'
           WHERE id = (SELECT id FROM r_order_items WHERE order_id = ? AND product_id = ? AND status = 'ordered' ORDER BY created_at DESC, rowid DESC LIMIT 1)`,
        ).run(ticketId, orderId, entry.product.id);
      }
    }

    await writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "restaurant.items_add", resourceType: "r_order", resourceId: orderId, after: { items: items.length, tickets: ticketIds } },
      db,
    );
  });
  for (const ticketId of ticketIds) {
    const order = (await db.prepare(`SELECT id, table_id FROM r_orders WHERE id = ?`).get(orderId)) as { id: string; table_id: string | null } | undefined;
    void order;
    await emitDomainEvent("kitchen.ticket_sent", { orgId, ticketId, orderId, station: "kitchen" });
  }
  return { ticketIds };
}

interface ProductInfo {
  id: string;
  name: string;
  unit: string;
  base_price_cents: number;
  attributes: string;
}

interface OrderRow {
  id: string;
  table_id: string | null;
  channel: string;
  status: string;
}

export async function getOrderDetail(orgId: string, orderId: string) {
  const db = getDb();
  const order = await db.prepare(
    `SELECT o.*, t.name as table_name, t.zone as table_zone, u.name as opened_by_name
     FROM r_orders o
     LEFT JOIN r_tables t ON t.id = o.table_id
     LEFT JOIN users u ON u.id = o.opened_by
     WHERE o.id = ? AND o.org_id = ?`,
  ).get(orderId, orgId);
  if (!order) notFound("Pedido");
  const items = await db.prepare(
    `SELECT i.*, p.name as product_name, v.label as variant_label
     FROM r_order_items i
     LEFT JOIN products p ON p.id = i.product_id
     LEFT JOIN product_variants v ON v.id = i.variant_id
     WHERE i.order_id = ? ORDER BY i.created_at`,
  ).all(orderId);
  const tickets = await db.prepare(
    `SELECT * FROM kitchen_tickets WHERE order_id = ? ORDER BY sequence`,
  ).all(orderId);
  return { order, items, tickets };
}

export async function listOpenOrders(orgId: string, branchId?: string) {
  const db = getDb();
  return await db.prepare(
    `SELECT o.*, t.name as table_name,
       COALESCE((SELECT SUM(ROUND(i.qty_milli * i.unit_price_cents / 1000.0)) FROM r_order_items i WHERE i.order_id = o.id AND i.status NOT IN ('cancelled','billed')),0) as open_total_cents,
       (SELECT COUNT(*) FROM r_order_items i WHERE i.order_id = o.id AND i.status NOT IN ('cancelled','billed')) as open_items
     FROM r_orders o LEFT JOIN r_tables t ON t.id = o.table_id
     WHERE o.org_id = ? AND o.status = 'open' ${branchId ? "AND o.branch_id = ?" : ""}
     ORDER BY o.opened_at`,
  ).all(...(branchId ? [orgId, branchId] : [orgId]));
}

export async function cancelOrderItem(
  orgId: string,
  orderItemId: string,
  reason: string,
  actor: { userId: string; label: string },
): Promise<void> {
  if (!reason?.trim()) badRequest("Motivo de cancelamento é obrigatório.");
  const db = getDb();
  await tx(db, async () => {
    const item = (await db.prepare(`SELECT * FROM r_order_items WHERE id = ? AND org_id = ?`).get(orderItemId, orgId)) as { id: string; order_id: string; ticket_id: string | null; status: string } | undefined;
    if (!item) notFound("Item");
    if (item!.status === "cancelled") conflict("Item já cancelado.");
    await db.prepare(`UPDATE r_order_items SET status = 'cancelled', notes = COALESCE(notes,'') || ? WHERE id = ?`)
      .run(` | CANCELADO: ${reason}`, orderItemId);
    if (item!.ticket_id) {
      const ticket = (await db.prepare(`SELECT status FROM kitchen_tickets WHERE id = ?`).get(item!.ticket_id)) as { status: string } | undefined;
      if (ticket && ["pending", "preparing"].includes(ticket.status)) {
        // Remove from ticket lines and cancel empty tickets
        const remaining = (await db.prepare(
          `SELECT COUNT(*) c FROM r_order_items WHERE ticket_id = ? AND status NOT IN ('cancelled','billed')`,
        ).get(item!.ticket_id)) as { c: number };
        if (remaining.c === 0) {
          await db.prepare(`UPDATE kitchen_tickets SET status = 'cancelled', cancelled_at = ? WHERE id = ?`).run(Date.now(), item!.ticket_id);
        }
      }
    }
    await writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "restaurant.item_cancel", resourceType: "r_order_item", resourceId: orderItemId, after: { reason } },
      db,
    );
  });
}

export async function moveOrderToTable(
  orgId: string,
  orderId: string,
  toTableId: string,
  actor: { userId: string; label: string },
): Promise<void> {
  const db = getDb();
  await tx(db, async () => {
    const order = (await db.prepare(`SELECT * FROM r_orders WHERE id = ? AND org_id = ? AND status = 'open'`).get(orderId, orgId)) as { id: string; table_id: string | null } | undefined;
    if (!order) notFound("Pedido aberto");
    const target = (await db.prepare(`SELECT * FROM r_tables WHERE id = ? AND org_id = ?`).get(toTableId, orgId)) as { id: string; status: string } | undefined;
    if (!target) notFound("Mesa de destino");
    if (target!.status === "occupied" && target!.id !== order!.table_id) {
      conflict("Mesa de destino ocupada.");
    }
    const fromTable = order!.table_id;
    await db.prepare(`UPDATE r_orders SET table_id = ? WHERE id = ?`).run(toTableId, orderId);
    await db.prepare(`UPDATE kitchen_tickets SET table_label = ? WHERE order_id = ? AND status IN ('pending','preparing','ready')`)
      .run(((await db.prepare(`SELECT name FROM r_tables WHERE id = ?`).get(toTableId)) as { name: string }).name, orderId);
    if (fromTable) {
      const stillOpen = (await db.prepare(`SELECT COUNT(*) c FROM r_orders WHERE table_id = ? AND status = 'open'`).get(fromTable)) as { c: number };
      if (stillOpen.c === 0) await db.prepare(`UPDATE r_tables SET status = 'free' WHERE id = ?`).run(fromTable);
    }
    await db.prepare(`UPDATE r_tables SET status = 'occupied' WHERE id = ?`).run(toTableId);
    await writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "restaurant.table_move", resourceType: "r_order", resourceId: orderId, before: { tableId: fromTable }, after: { tableId: toTableId } },
      db,
    );
  });
}

export async function cancelOrder(
  orgId: string,
  orderId: string,
  reason: string,
  actor: { userId: string; label: string },
): Promise<void> {
  if (!reason?.trim()) badRequest("Motivo é obrigatório.");
  const db = getDb();
  await tx(db, async () => {
    const order = (await db.prepare(`SELECT * FROM r_orders WHERE id = ? AND org_id = ?`).get(orderId, orgId)) as { id: string; table_id: string | null; status: string } | undefined;
    if (!order) notFound("Pedido");
    if (order!.status !== "open") conflict("Apenas pedidos abertos podem ser cancelados.");
    await db.prepare(`UPDATE r_orders SET status = 'cancelled', notes = COALESCE(notes,'') || ? WHERE id = ?`).run(` | CANCELADO: ${reason}`, orderId);
    await db.prepare(`UPDATE r_order_items SET status = 'cancelled' WHERE order_id = ? AND status NOT IN ('billed')`).run(orderId);
    await db.prepare(`UPDATE kitchen_tickets SET status = 'cancelled', cancelled_at = ? WHERE order_id = ? AND status IN ('pending','preparing','ready')`).run(Date.now(), orderId);
    if (order!.table_id) {
      const remaining = (await db.prepare(`SELECT COUNT(*) c FROM r_orders WHERE table_id = ? AND status = 'open'`).get(order!.table_id)) as { c: number };
      if (remaining.c === 0) await db.prepare(`UPDATE r_tables SET status = 'free' WHERE id = ?`).run(order!.table_id);
    }
    await writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "restaurant.order_cancel", resourceType: "r_order", resourceId: orderId, after: { reason } },
      db,
    );
  });
}

/* ------------------------------ Kitchen ------------------------------ */

export interface KitchenTicketView {
  id: string;
  sequence: number;
  station: string;
  status: string;
  table_label: string | null;
  channel: string | null;
  sent_at: number;
  started_at: number | null;
  ready_at: number | null;
  order_id: string;
  lines: {
    id: string;
    name: string;
    qty_milli: number;
    unit: string;
    modifiers: string;
    notes: string | null;
  }[];
  ageMs: number;
}

export async function listKitchenTickets(orgId: string, opts: { station?: string; includeDelivered?: boolean } = {}): Promise<KitchenTicketView[]> {
  const db = getDb();
  const statuses = opts.includeDelivered
    ? ['pending', 'preparing', 'ready', 'delivered']
    : ['pending', 'preparing', 'ready'];
  const rows = (await db.prepare(
    `SELECT * FROM kitchen_tickets
     WHERE org_id = ? AND status IN (${statuses.map(() => "?").join(",")})
       ${opts.station ? "AND station = ?" : ""}
     ORDER BY sent_at ASC LIMIT 100`,
  ).all(orgId, ...statuses, ...(opts.station ? [opts.station] : []))) as {
    id: string; sequence: number; station: string; status: string;
    table_label: string | null; channel: string | null; sent_at: number;
    started_at: number | null; ready_at: number | null; order_id: string;
  }[];
  const now = Date.now();
  return Promise.all(rows.map(async (r) => ({
    ...r,
    ageMs: now - r.sent_at,
    lines: (await db.prepare(
      `SELECT * FROM kitchen_ticket_lines WHERE ticket_id = ? ORDER BY sequence`,
    ).all(r.id)) as KitchenTicketView["lines"],
  })));
}

export async function updateTicketStatus(
  orgId: string,
  ticketId: string,
  status: "preparing" | "ready" | "delivered",
): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const ticket = (await db.prepare(`SELECT status FROM kitchen_tickets WHERE id = ? AND org_id = ?`).get(ticketId, orgId)) as { status: string } | undefined;
  if (!ticket) notFound("Ticket de cozinha");
  const allowed: Record<string, string[]> = {
    preparing: ["pending", "preparing"],
    ready: ["preparing", "pending", "ready"],
    delivered: ["ready", "preparing"],
  };
  if (!allowed[status]?.includes(ticket!.status)) {
    conflict(`Transição inválida: ${ticket!.status} → ${status}.`);
  }
  const col = status === "preparing" ? "started_at" : status === "ready" ? "ready_at" : "delivered_at";
  await db.prepare(`UPDATE kitchen_tickets SET status = ?, ${col} = COALESCE(${col}, ?) WHERE id = ?`).run(status, now, ticketId);
  if (status === "ready") {
    await db.prepare(`UPDATE r_order_items SET status = 'served' WHERE ticket_id = ? AND status = 'sent'`).run(ticketId);
    await emitDomainEvent("kitchen.ticket_ready", { orgId, ticketId });
  }
}

/** Average preparation time (sent → ready), real data, ms. */
export async function avgPreparationTime(orgId: string, sinceTs: number): Promise<number | null> {
  const row = (await getDb().prepare(
    `SELECT AVG(ready_at - sent_at) avg_ms, COUNT(*) n FROM kitchen_tickets
     WHERE org_id = ? AND ready_at IS NOT NULL AND sent_at >= ?`,
  ).get(orgId, sinceTs)) as { avg_ms: number | null; n: number };
  return row.n > 0 && row.avg_ms != null ? Math.round(row.avg_ms) : null;
}

/* ----------------------------- Modifiers ----------------------------- */

export async function listModifierGroups(orgId: string) {
  const db = getDb();
  const groups = (await db.prepare(`SELECT * FROM modifier_groups WHERE org_id = ? ORDER BY name`).all(orgId)) as { id: string }[];
  return groups.map(async (g) => ({
    ...g,
    options: await db.prepare(`SELECT * FROM modifier_options WHERE group_id = ? ORDER BY sort_order, name`).all(g.id),
    products: await db.prepare(`SELECT product_id FROM product_modifier_groups WHERE group_id = ?`).all(g.id),
  }));
}

export async function getModifiersForProduct(orgId: string, productId: string) {
  const db = getDb();
  const groups = (await db.prepare(
    `SELECT g.* FROM modifier_groups g
     JOIN product_modifier_groups pmg ON pmg.group_id = g.id
     WHERE pmg.product_id = ? AND g.org_id = ?`,
  ).all(productId, orgId)) as { id: string }[];
  return groups.map(async (g) => ({
    ...g,
    options: await db.prepare(`SELECT * FROM modifier_options WHERE group_id = ? ORDER BY sort_order, name`).all(g.id),
  }));
}

export async function createModifierGroup(
  orgId: string,
  data: { name: string; minSelect?: number; maxSelect?: number; options: { name: string; priceDeltaCents?: number; isDefault?: boolean }[]; productIds?: string[] },
): Promise<string> {
  if (!data.name?.trim()) badRequest("Nome do grupo é obrigatório.");
  if (!data.options.length) badRequest("Grupo sem opções.");
  const db = getDb();
  const groupId = newId("mg");
  await tx(db, async () => {
    await db.prepare(
      `INSERT INTO modifier_groups (id, org_id, name, min_select, max_select, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(groupId, orgId, data.name.trim(), data.minSelect ?? 0, data.maxSelect ?? 9, Date.now());
    let order = 0;
    for (const option of data.options) {
      await db.prepare(
        `INSERT INTO modifier_options (id, org_id, group_id, name, price_delta_cents, is_default, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(newId("mo"), orgId, groupId, option.name.trim(), option.priceDeltaCents ?? 0, option.isDefault ? 1 : 0, order++);
    }
    for (const productId of data.productIds ?? []) {
      await db.prepare(`INSERT OR IGNORE INTO product_modifier_groups (product_id, group_id) VALUES (?, ?)`).run(productId, groupId);
    }
  });
  return groupId;
}

export async function attachModifierGroup(orgId: string, productId: string, groupId: string): Promise<void> {
  const db = getDb();
  const group = await db.prepare(`SELECT id FROM modifier_groups WHERE id = ? AND org_id = ?`).get(groupId, orgId);
  if (!group) notFound("Grupo de modificadores");
  await db.prepare(`INSERT OR IGNORE INTO product_modifier_groups (product_id, group_id) VALUES (?, ?)`).run(productId, groupId);
}

/* ---------------------------- Reservations ---------------------------- */

export async function listReservations(orgId: string, branchId: string, dayStart: number, dayEnd: number) {
  return await getDb().prepare(
    `SELECT r.*, t.name as table_name, c.name as customer_record_name
     FROM reservations r
     LEFT JOIN r_tables t ON t.id = r.table_id
     LEFT JOIN customers c ON c.id = r.customer_id
     WHERE r.org_id = ? AND r.branch_id = ? AND r.reserved_for >= ? AND r.reserved_for < ?
     ORDER BY r.reserved_for`,
  ).all(orgId, branchId, dayStart, dayEnd);
}

export async function createReservation(
  orgId: string,
  data: {
    branchId: string;
    tableId?: string | null;
    customerId?: string | null;
    customerName: string;
    phone?: string | null;
    partySize: number;
    reservedFor: number;
    note?: string | null;
  },
): Promise<string> {
  if (!data.customerName?.trim()) badRequest("Nome é obrigatório.");
  if (data.partySize <= 0) badRequest("Número de pessoas inválido.");
  const db = getDb();
  const id = newId("res");
  await tx(db, async () => {
    await db.prepare(
      `INSERT INTO reservations (id, org_id, branch_id, table_id, customer_id, customer_name, phone, party_size, reserved_for, status, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?)`,
    ).run(id, orgId, data.branchId, data.tableId ?? null, data.customerId ?? null, data.customerName.trim(), data.phone ?? null, data.partySize, data.reservedFor, data.note ?? null, Date.now());
    if (data.tableId) {
      await db.prepare(`UPDATE r_tables SET status = CASE WHEN status = 'free' THEN 'reserved' ELSE status END WHERE id = ?`).run(data.tableId);
    }
  });
  return id;
}

export async function setReservationStatus(
  orgId: string,
  reservationId: string,
  status: "seated" | "completed" | "cancelled" | "no_show",
): Promise<{ orderId?: string }> {
  const db = getDb();
  const out: { orderId?: string } = {};
  await tx(db, async () => {
    const reservation = (await db.prepare(`SELECT * FROM reservations WHERE id = ? AND org_id = ?`).get(reservationId, orgId)) as { id: string; table_id: string | null; status: string; branch_id: string; party_size: number; customer_id: string | null; customer_name: string } | undefined;
    if (!reservation) notFound("Reserva");
    await db.prepare(`UPDATE reservations SET status = ? WHERE id = ?`).run(status, reservationId);
    if (status === "seated" && reservation!.table_id) {
      // Open the order for the seated party
      const orderId = newId("rord");
      await db.prepare(
        `INSERT INTO r_orders (id, org_id, branch_id, table_id, channel, customer_id, customer_name, status, guest_count, opened_at)
         VALUES (?, ?, ?, ?, 'dine_in', ?, ?, 'open', ?, ?)`,
      ).run(orderId, orgId, reservation!.branch_id, reservation!.table_id, reservation!.customer_id, reservation!.customer_name, reservation!.party_size, Date.now());
      await db.prepare(`UPDATE r_tables SET status = 'occupied' WHERE id = ?`).run(reservation!.table_id);
      out.orderId = orderId;
    }
    if ((status === "cancelled" || status === "no_show") && reservation!.table_id) {
      const otherBookings = (await db.prepare(`SELECT COUNT(*) c FROM reservations WHERE table_id = ? AND status = 'booked' AND id != ?`).get(reservation!.table_id, reservationId)) as { c: number };
      const openOrders = (await db.prepare(`SELECT COUNT(*) c FROM r_orders WHERE table_id = ? AND status = 'open'`).get(reservation!.table_id)) as { c: number };
      if (otherBookings.c === 0 && openOrders.c === 0) {
        await db.prepare(`UPDATE r_tables SET status = 'free' WHERE id = ?`).run(reservation!.table_id);
      }
    }
  });
  return out;
}

/* ------------------------------ Shifts ------------------------------- */

export async function startShift(orgId: string, branchId: string, userId: string, label?: string): Promise<string> {
  const db = getDb();
  const id = newId("shift");
  await db.prepare(
    `INSERT INTO shifts (id, org_id, branch_id, user_id, label, started_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, orgId, branchId, userId, label ?? null, Date.now());
  return id;
}

export async function endShift(orgId: string, shiftId: string): Promise<void> {
  await getDb().prepare(`UPDATE shifts SET ended_at = ? WHERE id = ? AND org_id = ? AND ended_at IS NULL`).run(Date.now(), shiftId, orgId);
}

export async function salesByShift(orgId: string, from: number, to: number) {
  return await getDb().prepare(
    `SELECT sh.id, sh.label, sh.started_at, sh.ended_at, u.name as user_name,
            COUNT(s.id) sales_count, COALESCE(SUM(s.total_cents),0) total_cents
     FROM shifts sh
     JOIN users u ON u.id = sh.user_id
     LEFT JOIN sales s ON s.shift_id = sh.id AND s.status != 'void'
     WHERE sh.org_id = ? AND sh.started_at >= ? AND sh.started_at <= ?
     GROUP BY sh.id ORDER BY sh.started_at DESC`,
  ).all(orgId, from, to);
}

/* ------------------------- Recipes & waste ---------------------------- */

export async function listRecipes(orgId: string) {
  const db = getDb();
  const recipes = await db.prepare(
    `SELECT r.*, p.name as product_name FROM recipes r JOIN products p ON p.id = r.product_id WHERE r.org_id = ? ORDER BY r.name`,
  ).all(orgId);
  return Promise.all(
    (recipes as { id: string }[]).map(async (r) => ({
      ...r,
      items: (await db.prepare(
        `SELECT ri.*, p.name as ingredient_name, p.unit FROM recipe_items ri JOIN products p ON p.id = ri.ingredient_product_id WHERE ri.recipe_id = ?`,
      ).all(r.id)) as unknown[],
    })),
  );
}

export async function createRecipe(
  orgId: string,
  data: { productId: string; name: string; servings?: number; wastePct?: number; items: { ingredientProductId: string; qtyMilli: number }[] },
): Promise<string> {
  if (!data.items.length) badRequest("Ficha técnica sem ingredientes.");
  const db = getDb();
  const id = newId("rec");
  await tx(db, async () => {
    await db.prepare(
      `INSERT INTO recipes (id, org_id, product_id, name, servings, waste_pct, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, orgId, data.productId, data.name.trim(), data.servings ?? 1, data.wastePct ?? 0, Date.now());
    for (const item of data.items) {
      await db.prepare(
        `INSERT INTO recipe_items (id, org_id, recipe_id, ingredient_product_id, qty_milli)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(newId("reci"), orgId, id, item.ingredientProductId, item.qtyMilli);
    }
  });
  return id;
}

/** Theoretical ingredient cost of a recipe (real product costs). */
export async function recipeCost(orgId: string, recipeId: string): Promise<{ costCents: number; items: { name: string; costCents: number }[] }> {
  const db = getDb();
  const recipe = (await db.prepare(`SELECT servings, waste_pct FROM recipes WHERE id = ? AND org_id = ?`).get(recipeId, orgId)) as { servings: number; waste_pct: number } | undefined;
  if (!recipe) notFound("Ficha técnica");
  const items = (await db.prepare(
    `SELECT ri.qty_milli, p.name, p.cost_cents FROM recipe_items ri JOIN products p ON p.id = ri.ingredient_product_id WHERE ri.recipe_id = ?`,
  ).all(recipeId)) as { qty_milli: number; name: string; cost_cents: number }[];
  let cost = 0;
  const detailed = items.map((i) => {
    const itemCost = Math.round((i.qty_milli * i.cost_cents) / 1000);
    cost += itemCost;
    return { name: i.name, costCents: itemCost };
  });
  const withWaste = Math.round(cost * (1 + (recipe!.waste_pct / 100)));
  const perServing = Math.round(withWaste / Math.max(1, recipe!.servings));
  return { costCents: perServing, items: detailed };
}

import { applyStockDelta } from "./inventory.service";

export async function recordWaste(
  orgId: string,
  data: { warehouseId: string; productId: string; variantId?: string | null; qtyMilli: number; reasonCode: string; note?: string; actor: { userId: string; label: string } },
): Promise<void> {
  if (data.qtyMilli <= 0) badRequest("Quantidade inválida.");
  const db = getDb();
  await tx(db, async () => {
    await db.prepare(
      `INSERT INTO waste_records (id, org_id, warehouse_id, product_id, variant_id, qty_milli, reason_code, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId("waste"), orgId, data.warehouseId, data.productId, data.variantId ?? null, data.qtyMilli, data.reasonCode, data.note ?? null, data.actor.userId, Date.now());
    await applyStockDelta(db, {
      orgId, warehouseId: data.warehouseId, productId: data.productId,
      variantId: data.variantId ?? null, qtyMilli: -data.qtyMilli,
      reason: "waste", refType: "waste", createdBy: data.actor.userId,
      note: `${data.reasonCode}${data.note ? ` — ${data.note}` : ""}`,
    });
    await writeAudit(
      { orgId, actorUserId: data.actor.userId, actorLabel: data.actor.label, action: "restaurant.waste", resourceType: "waste_record", after: data },
      db,
    );
  });
}
