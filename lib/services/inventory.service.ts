import { getDb, tx, type Db } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import {
  allocateBatchesFEFO,
  canFulfillStock,
  expiryRisk,
  weightedAverageCost,
  type StockPolicy,
} from "@/lib/domain/inventory";
import { ApiError, badRequest, notFound } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";
import { getOrgProfile, type OrgSettings } from "./org.service";

/**
 * Inventory service — the single write path for stock.
 * Every quantity change goes through applyStockDelta(), which keeps
 * stock_levels and stock_movements consistent inside the caller's
 * transaction and returns domain events to be emitted AFTER commit.
 */

export interface StockDeltaInput {
  orgId: string;
  warehouseId: string;
  productId: string;
  variantId?: string | null;
  /** Signed quantity in milli-units (+ receipt, − issue). */
  qtyMilli: number;
  reason: string;
  refType?: string | null;
  refId?: string | null;
  unitCostCents?: number | null;
  note?: string | null;
  createdBy?: string | null;
}

export interface PendingEvent {
  event: string;
  payload: Record<string, unknown>;
}

export interface StockLevelRow {
  id: string;
  org_id: string;
  warehouse_id: string;
  product_id: string;
  variant_id: string | null;
  qty_milli: number;
  reserved_milli: number;
  avg_cost_cents: number;
  updated_at: number;
}

export async function getStockLevel(
  db: Db,
  warehouseId: string,
  productId: string,
  variantId: string | null = null,
): Promise<StockLevelRow | undefined> {
  return (await db
    .prepare(
      `SELECT * FROM stock_levels
       WHERE warehouse_id = ? AND product_id = ? AND variant_id IS ?`,
    )
    .get(warehouseId, productId, variantId)) as StockLevelRow | undefined;
}

export async function totalStockFor(
  db: Db,
  orgId: string,
  productId: string,
  variantId: string | null = null,
): Promise<{ qtyMilli: number; reservedMilli: number }> {
  const row = (await db
    .prepare(
      `SELECT COALESCE(SUM(qty_milli),0) q, COALESCE(SUM(reserved_milli),0) r
       FROM stock_levels WHERE org_id = ? AND product_id = ? AND variant_id IS ?`,
    )
    .get(orgId, productId, variantId)) as { q: number; r: number };
  return { qtyMilli: row.q, reservedMilli: row.r };
}

/**
 * Core stock writer. MUST be called inside a transaction.
 * Returns events to emit after commit (never emits inside the tx).
 */
export async function applyStockDelta(
  db: Db,
  input: StockDeltaInput,
): Promise<{ level: StockLevelRow; events: PendingEvent[] }> {
  const events: PendingEvent[] = [];
  const now = Date.now();
  const existing = await getStockLevel(
    db,
    input.warehouseId,
    input.productId,
    input.variantId ?? null,
  );

  let newQty: number;
  let newAvg = existing?.avg_cost_cents ?? 0;

  if (!existing) {
    if (input.qtyMilli < 0) {
      // First-ever movement is negative: allow row creation with negative
      // qty only when policy permits; the caller must have checked policy.
      newQty = input.qtyMilli;
    } else {
      newQty = input.qtyMilli;
    }
    if (input.qtyMilli > 0 && input.unitCostCents != null) {
      newAvg = input.unitCostCents;
    }
    await db.prepare(
      `INSERT INTO stock_levels (id, org_id, warehouse_id, product_id, variant_id, qty_milli, reserved_milli, avg_cost_cents, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      newId("stk"),
      input.orgId,
      input.warehouseId,
      input.productId,
      input.variantId ?? null,
      newQty,
      newAvg,
      now,
    );
  } else {
    newQty = existing.qty_milli + input.qtyMilli;
    if (input.qtyMilli > 0 && input.unitCostCents != null) {
      newAvg = weightedAverageCost(
        existing.qty_milli,
        existing.avg_cost_cents,
        input.qtyMilli,
        input.unitCostCents,
      );
    }
    await db.prepare(
      `UPDATE stock_levels SET qty_milli = ?, avg_cost_cents = ?, updated_at = ?
       WHERE id = ?`,
    ).run(newQty, newAvg, now, existing.id);
  }

  await db.prepare(
    `INSERT INTO stock_movements
      (id, org_id, warehouse_id, product_id, variant_id, qty_milli, reason_code,
       ref_type, ref_id, batch_id, unit_cost_cents, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).run(
    newId("mov"),
    input.orgId,
    input.warehouseId,
    input.productId,
    input.variantId ?? null,
    input.qtyMilli,
    input.reason,
    input.refType ?? null,
    input.refId ?? null,
    input.unitCostCents ?? null,
    input.note ?? null,
    input.createdBy ?? null,
    now,
  );

  // Post-movement alerts
  if (newQty < 0) {
    events.push({
      event: "stock.negative",
      payload: {
        orgId: input.orgId,
        productId: input.productId,
        productName: "",
        qtyMilli: newQty,
      },
    });
  }

  const product = (await db
    .prepare(`SELECT name, reorder_point_milli FROM products WHERE id = ?`)
    .get(input.productId)) as
    | { name: string; reorder_point_milli: number | null }
    | undefined;
  if (product) {
    // Fill product name for events (cheap, same tx)
    for (const e of events) {
      if (e.event === "stock.negative") e.payload.productName = product.name;
    }
    if (
      product.reorder_point_milli != null &&
      newQty <= product.reorder_point_milli
    ) {
      events.push({
        event: "stock.below_min",
        payload: {
          orgId: input.orgId,
          productId: input.productId,
          variantId: input.variantId ?? null,
          productName: product.name,
          qtyMilli: newQty,
          reorderPointMilli: product.reorder_point_milli,
        },
      });
    }
  }

  const level = (await getStockLevel(
    db,
    input.warehouseId,
    input.productId,
    input.variantId ?? null,
  ))!;
  return { level, events };
}

/** Checks policy before a sale/issue; throws when blocked. */
export async function assertStockAvailable(
  db: Db,
  orgId: string,
  warehouseId: string,
  productId: string,
  variantId: string | null,
  requestedMilli: number,
  settings: OrgSettings,
  productAllowNegative?: number | null,
): Promise<void> {
  const level = await getStockLevel(db, warehouseId, productId, variantId);
  const available = (level?.qty_milli ?? 0) - (level?.reserved_milli ?? 0);
  const policy = (settings.stockPolicy ?? "warn_negative") as StockPolicy;
  const result = canFulfillStock({
    requestedMilli,
    availableMilli: available,
    policy,
    productAllowNegative:
      productAllowNegative == null ? null : productAllowNegative === 1,
  });
  if (!result.ok) {
    throw new ApiError(409, result.reason, "insufficient_stock");
  }
}

/* -------------------------- Adjustments -------------------------- */

export interface AdjustmentInput {
  orgId: string;
  warehouseId: string;
  productId: string;
  variantId?: string | null;
  /** New counted quantity (absolute) OR signed delta, see mode. */
  mode: "absolute" | "delta";
  qtyMilli: number;
  reasonCode: string;
  note?: string;
  actor: { userId: string; label: string };
}

export async function adjustStock(input: AdjustmentInput): Promise<{ newQtyMilli: number }> {
  if (!input.reasonCode) badRequest("Motivo do ajuste é obrigatório.");
  if (!input.note?.trim() && input.reasonCode !== "initial_load") {
    badRequest("Nota justificativa é obrigatória para ajustes.");
  }
  const db = getDb();
  let newQty = 0;
  await tx(db, async () => {
    const level = await getStockLevel(
      db,
      input.warehouseId,
      input.productId,
      input.variantId ?? null,
    );
    const delta =
      input.mode === "absolute"
        ? input.qtyMilli - (level?.qty_milli ?? 0)
        : input.qtyMilli;
    if (delta === 0) {
      newQty = level?.qty_milli ?? 0;
      return;
    }
    const result = await applyStockDelta(db, {
      orgId: input.orgId,
      warehouseId: input.warehouseId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      qtyMilli: delta,
      reason: "adjustment",
      refType: "adjustment",
      note: `${input.reasonCode}${input.note ? ` — ${input.note}` : ""}`,
      createdBy: input.actor.userId,
    });
    newQty = result.level.qty_milli;
    await writeAudit(
      {
        orgId: input.orgId,
        actorUserId: input.actor.userId,
        actorLabel: input.actor.label,
        action: "inventory.adjust",
        resourceType: "stock_level",
        resourceId: result.level.id,
        after: {
          productId: input.productId,
          variantId: input.variantId ?? null,
          warehouseId: input.warehouseId,
          delta,
          newQtyMilli: newQty,
          reasonCode: input.reasonCode,
          note: input.note ?? null,
        },
      },
      db,
    );
  });
  return { newQtyMilli: newQty };
}

/* -------------------------- Transfers ---------------------------- */

export interface TransferInput {
  orgId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  lines: { productId: string; variantId?: string | null; qtyMilli: number }[];
  note?: string;
  actor: { userId: string; label: string };
}

export async function createTransfer(input: TransferInput): Promise<{ transferId: string }> {
  if (input.fromWarehouseId === input.toWarehouseId) {
    badRequest("Armazéns de origem e destino devem ser diferentes.");
  }
  if (!input.lines.length) badRequest("Transferência sem linhas.");
  const db = getDb();
  const transferId = newId("trf");
  const settings = (await getOrgProfile(input.orgId)).settings;
  await tx(db, async () => {
    await db.prepare(
      `INSERT INTO stock_transfers (id, org_id, from_warehouse_id, to_warehouse_id, status, note, created_by, created_at)
       VALUES (?, ?, ?, ?, 'in_transit', ?, ?, ?)`,
    ).run(transferId, input.orgId, input.fromWarehouseId, input.toWarehouseId, input.note ?? null, input.actor.userId, Date.now());
    const insertLine = db.prepare(
      `INSERT INTO stock_transfer_lines (id, org_id, transfer_id, product_id, variant_id, qty_milli, received_qty_milli)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
    );
    for (const line of input.lines) {
      if (line.qtyMilli <= 0) continue;
      await assertStockAvailable(
        db, input.orgId, input.fromWarehouseId, line.productId,
        line.variantId ?? null, line.qtyMilli, settings, null,
      );
      await insertLine.run(newId("trfl"), input.orgId, transferId, line.productId, line.variantId ?? null, line.qtyMilli);
      await applyStockDelta(db, {
        orgId: input.orgId,
        warehouseId: input.fromWarehouseId,
        productId: line.productId,
        variantId: line.variantId ?? null,
        qtyMilli: -line.qtyMilli,
        reason: "transfer_out",
        refType: "transfer",
        refId: transferId,
        createdBy: input.actor.userId,
      });
    }
    await writeAudit(
      {
        orgId: input.orgId,
        actorUserId: input.actor.userId,
        actorLabel: input.actor.label,
        action: "inventory.transfer_create",
        resourceType: "stock_transfer",
        resourceId: transferId,
        after: input,
      },
      db,
    );
  });
  return { transferId };
}

export async function receiveTransfer(
  orgId: string,
  transferId: string,
  actor: { userId: string; label: string },
): Promise<void> {
  const db = getDb();
  await tx(db, async () => {
    const transfer = (await db
      .prepare(`SELECT * FROM stock_transfers WHERE id = ? AND org_id = ?`)
      .get(transferId, orgId)) as
      | { id: string; to_warehouse_id: string; status: string }
      | undefined;
    if (!transfer) notFound("Transferência");
    if (transfer!.status === "completed") {
      throw new ApiError(409, "Transferência já recebida.", "already_completed");
    }
    const lines = (await db
      .prepare(`SELECT * FROM stock_transfer_lines WHERE transfer_id = ?`)
      .all(transferId)) as {
      id: string;
      product_id: string;
      variant_id: string | null;
      qty_milli: number;
      received_qty_milli: number;
    }[];
    for (const line of lines) {
      const pending = line.qty_milli - line.received_qty_milli;
      if (pending <= 0) continue;
      await applyStockDelta(db, {
        orgId,
        warehouseId: transfer!.to_warehouse_id,
        productId: line.product_id,
        variantId: line.variant_id,
        qtyMilli: pending,
        reason: "transfer_in",
        refType: "transfer",
        refId: transferId,
        createdBy: actor.userId,
      });
      await db.prepare(
        `UPDATE stock_transfer_lines SET received_qty_milli = qty_milli WHERE id = ?`,
      ).run(line.id);
    }
    await db.prepare(
      `UPDATE stock_transfers SET status = 'completed', completed_at = ? WHERE id = ?`,
    ).run(Date.now(), transferId);
    await writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "inventory.transfer_receive", resourceType: "stock_transfer", resourceId: transferId },
      db,
    );
  });
}

/* ------------------------ Cycle counting -------------------------- */

export async function createCountSheet(
  orgId: string,
  warehouseId: string,
  productIds: string[] | null,
  actor: { userId: string; label: string },
): Promise<{ sheetId: string; lines: number }> {
  const db = getDb();
  const sheetId = newId("cnt");
  let lineCount = 0;
  await tx(db, async () => {
    await db.prepare(
      `INSERT INTO count_sheets (id, org_id, warehouse_id, status, created_by, created_at)
       VALUES (?, ?, ?, 'counting', ?, ?)`,
    ).run(sheetId, orgId, warehouseId, actor.userId, Date.now());
    const products = (await db
      .prepare(
        `SELECT id FROM products WHERE org_id = ? AND track_stock = 1 AND status != 'archived'`,
      )
      .all(orgId)) as { id: string }[];
    const filter = productIds ? new Set(productIds) : null;
    const insertLine = db.prepare(
      `INSERT INTO count_sheet_lines (id, sheet_id, org_id, product_id, variant_id, expected_milli)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const product of products) {
      if (filter && !filter.has(product.id)) continue;
      const variants = (await db
        .prepare(`SELECT id FROM product_variants WHERE product_id = ?`)
        .all(product.id)) as { id: string }[];
      if (variants.length === 0) {
        const level = await getStockLevel(db, warehouseId, product.id, null);
        await insertLine.run(newId("cntl"), sheetId, orgId, product.id, null, level?.qty_milli ?? 0);
        lineCount++;
      } else {
        for (const variant of variants) {
          const level = await getStockLevel(db, warehouseId, product.id, variant.id);
          await insertLine.run(newId("cntl"), sheetId, orgId, product.id, variant.id, level?.qty_milli ?? 0);
          lineCount++;
        }
      }
    }
    await writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "inventory.count_create", resourceType: "count_sheet", resourceId: sheetId, after: { warehouseId, lines: lineCount } },
      db,
    );
  });
  return { sheetId, lines: lineCount };
}

export async function recordCountLine(
  orgId: string,
  sheetId: string,
  lineId: string,
  countedMilli: number,
  actor: { userId: string; label: string },
): Promise<void> {
  const db = getDb();
  await tx(db, async () => {
    const line = (await db
      .prepare(`SELECT * FROM count_sheet_lines WHERE id = ? AND org_id = ? AND sheet_id = ?`)
      .get(lineId, orgId, sheetId)) as
      | { id: string; product_id: string; variant_id: string | null; expected_milli: number }
      | undefined;
    if (!line) notFound("Linha de contagem");
    const variance = countedMilli - line!.expected_milli;
    await db.prepare(
      `UPDATE count_sheet_lines SET counted_milli = ?, variance_milli = ?, counted_by = ?, counted_at = ?
       WHERE id = ?`,
    ).run(countedMilli, variance, actor.userId, Date.now(), lineId);
  });
}

export async function completeCountSheet(
  orgId: string,
  sheetId: string,
  actor: { userId: string; label: string },
): Promise<{ adjustments: number }> {
  const db = getDb();
  let adjustments = 0;
  await tx(db, async () => {
    const sheet = (await db
      .prepare(`SELECT * FROM count_sheets WHERE id = ? AND org_id = ?`)
      .get(sheetId, orgId)) as
      | { id: string; warehouse_id: string; status: string }
      | undefined;
    if (!sheet) notFound("Folha de contagem");
    if (sheet!.status === "completed") {
      throw new ApiError(409, "Contagem já concluída.", "already_completed");
    }
    const lines = (await db
      .prepare(
        `SELECT * FROM count_sheet_lines WHERE sheet_id = ? AND counted_milli IS NOT NULL`,
      )
      .all(sheetId)) as {
      id: string;
      product_id: string;
      variant_id: string | null;
      expected_milli: number;
      counted_milli: number;
      variance_milli: number;
    }[];
    for (const line of lines) {
      const variance = line.counted_milli - line.expected_milli;
      if (variance === 0) continue;
      await applyStockDelta(db, {
        orgId,
        warehouseId: sheet!.warehouse_id,
        productId: line.product_id,
        variantId: line.variant_id,
        qtyMilli: variance,
        reason: "count",
        refType: "count_sheet",
        refId: sheetId,
        note: `count_variance — contagem ${sheetId}`,
        createdBy: actor.userId,
      });
      adjustments++;
    }
    await db.prepare(
      `UPDATE count_sheets SET status = 'completed', completed_at = ? WHERE id = ?`,
    ).run(Date.now(), sheetId);
    await writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "inventory.count_complete", resourceType: "count_sheet", resourceId: sheetId, after: { adjustments } },
      db,
    );
  });
  return { adjustments };
}

/* ---------------------------- Batches ----------------------------- */

export async function receiveBatch(
  db: Db,
  input: {
    orgId: string;
    warehouseId: string;
    productId: string;
    variantId?: string | null;
    batchNumber: string;
    expiryDate?: number | null;
    qtyMilli: number;
    unitCostCents?: number | null;
    supplierId?: string | null;
  },
): Promise<string> {
  const now = Date.now();
  const existing = (await db
    .prepare(
      `SELECT id, qty_remaining_milli, qty_received_milli FROM batches
       WHERE org_id = ? AND warehouse_id = ? AND product_id = ? AND variant_id IS ? AND batch_number = ?`,
    )
    .get(input.orgId, input.warehouseId, input.productId, input.variantId ?? null, input.batchNumber)) as
    | { id: string; qty_remaining_milli: number; qty_received_milli: number }
    | undefined;
  if (existing) {
    await db.prepare(
      `UPDATE batches SET qty_received_milli = qty_received_milli + ?, qty_remaining_milli = qty_remaining_milli + ?, expiry_date = COALESCE(?, expiry_date)
       WHERE id = ?`,
    ).run(input.qtyMilli, input.qtyMilli, input.expiryDate ?? null, existing.id);
    return existing.id;
  }
  const id = newId("batch");
  await db.prepare(
    `INSERT INTO batches (id, org_id, warehouse_id, product_id, variant_id, batch_number, expiry_date, qty_received_milli, qty_remaining_milli, unit_cost_cents, supplier_id, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, input.orgId, input.warehouseId, input.productId, input.variantId ?? null,
    input.batchNumber, input.expiryDate ?? null, input.qtyMilli, input.qtyMilli,
    input.unitCostCents ?? null, input.supplierId ?? null, now,
  );
  return id;
}

/** Consumes batch quantities FEFO when a product has batch tracking. */
export async function consumeBatchesFEFO(
  db: Db,
  input: {
    orgId: string;
    warehouseId: string;
    productId: string;
    variantId?: string | null;
    qtyMilli: number;
  },
): Promise<{ batchId: string; qtyMilli: number }[]> {
  const rows = (await db
    .prepare(
      `SELECT id, qty_remaining_milli, expiry_date FROM batches
       WHERE org_id = ? AND warehouse_id = ? AND product_id = ? AND variant_id IS ? AND qty_remaining_milli > 0`,
    )
    .all(input.orgId, input.warehouseId, input.productId, input.variantId ?? null)) as {
    id: string;
    qty_remaining_milli: number;
    expiry_date: number | null;
  }[];
  const allocation = allocateBatchesFEFO(
    rows.map((r) => ({
      id: r.id,
      qtyRemainingMilli: r.qty_remaining_milli,
      expiryDate: r.expiry_date,
    })),
    input.qtyMilli,
  );
  for (const a of allocation) {
    await db.prepare(
      `UPDATE batches SET qty_remaining_milli = MAX(0, qty_remaining_milli - ?) WHERE id = ?`,
    ).run(a.qtyMilli, a.batchId);
  }
  return allocation;
}

export async function expiringBatches(orgId: string, now = Date.now()) {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT b.*, p.name as product_name, w.name as warehouse_name
       FROM batches b
       JOIN products p ON p.id = b.product_id
       JOIN warehouses w ON w.id = b.warehouse_id
       WHERE b.org_id = ? AND b.expiry_date IS NOT NULL AND b.qty_remaining_milli > 0
       ORDER BY b.expiry_date ASC LIMIT 100`,
    )
    .all(orgId)) as {
    id: string;
    batch_number: string;
    expiry_date: number;
    qty_remaining_milli: number;
    product_name: string;
    warehouse_name: string;
  }[];
  return rows
    .map((r) => ({ ...r, risk: expiryRisk(r.expiry_date, now) }))
    .filter((r) => r.risk !== "none");
}

/* --------------------------- Queries ------------------------------ */

export interface StockOverviewRow {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  sku: string;
  variant_label: string | null;
  unit: string;
  qty_milli: number;
  reserved_milli: number;
  avg_cost_cents: number;
  reorder_point_milli: number | null;
  warehouse_id: string;
  warehouse_name: string;
}

export async function stockOverview(
  orgId: string,
  opts: { warehouseId?: string; search?: string; belowMin?: boolean; limit?: number; offset?: number } = {},
): Promise<{ rows: StockOverviewRow[]; total: number }> {
  const db = getDb();
  const where: string[] = ["s.org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.warehouseId) {
    where.push("s.warehouse_id = ?");
    params.push(opts.warehouseId);
  }
  if (opts.search) {
    where.push("(p.name LIKE ? OR p.sku LIKE ? OR COALESCE(v.label,'') LIKE ?)");
    const like = `%${opts.search}%`;
    params.push(like, like, like);
  }
  if (opts.belowMin) {
    where.push("p.reorder_point_milli IS NOT NULL AND s.qty_milli <= p.reorder_point_milli");
  }
  const limit = Math.min(opts.limit ?? 50, 500);
  const offset = opts.offset ?? 0;
  const rows = (await db
    .prepare(
      `SELECT s.product_id, s.variant_id, p.name as product_name, p.sku, v.label as variant_label,
              p.unit, s.qty_milli, s.reserved_milli, s.avg_cost_cents, p.reorder_point_milli,
              s.warehouse_id, w.name as warehouse_name
       FROM stock_levels s
       JOIN products p ON p.id = s.product_id
       LEFT JOIN product_variants v ON v.id = s.variant_id
       JOIN warehouses w ON w.id = s.warehouse_id
       WHERE ${where.join(" AND ")}
       ORDER BY p.name LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)) as StockOverviewRow[];
  const total = (
    (await db
      .prepare(
        `SELECT COUNT(*) c FROM stock_levels s JOIN products p ON p.id = s.product_id
         LEFT JOIN product_variants v ON v.id = s.variant_id WHERE ${where.join(" AND ")}`,
      )
      .get(...params)) as { c: number }
  ).c;
  return { rows, total };
}

export async function stockMovements(
  orgId: string,
  opts: { productId?: string; warehouseId?: string; from?: number; to?: number; limit?: number; offset?: number } = {},
): Promise<{ rows: MovementRow[]; total: number }> {
  const db = getDb();
  const where: string[] = ["m.org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.productId) {
    where.push("m.product_id = ?");
    params.push(opts.productId);
  }
  if (opts.warehouseId) {
    where.push("m.warehouse_id = ?");
    params.push(opts.warehouseId);
  }
  if (opts.from) {
    where.push("m.created_at >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("m.created_at <= ?");
    params.push(opts.to);
  }
  const limit = Math.min(opts.limit ?? 50, 500);
  const offset = opts.offset ?? 0;
  const rows = (await db
    .prepare(
      `SELECT m.*, p.name as product_name, v.label as variant_label, w.name as warehouse_name
       FROM stock_movements m
       JOIN products p ON p.id = m.product_id
       LEFT JOIN product_variants v ON v.id = m.variant_id
       JOIN warehouses w ON w.id = m.warehouse_id
       WHERE ${where.join(" AND ")}
       ORDER BY m.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)) as MovementRow[];
  const total = (
    (await db.prepare(`SELECT COUNT(*) c FROM stock_movements m WHERE ${where.join(" AND ")}`).get(...params)) as { c: number }
  ).c;
  return { rows, total };
}

export interface MovementRow {
  id: string;
  org_id: string;
  warehouse_id: string;
  warehouse_name: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_label: string | null;
  qty_milli: number;
  reason_code: string;
  ref_type: string | null;
  ref_id: string | null;
  unit_cost_cents: number | null;
  note: string | null;
  created_by: string | null;
  created_at: number;
}

/** Valuation: Σ qty × weighted-average cost (real figures, no estimates). */
export async function stockValuation(orgId: string, warehouseId?: string) {
  const db = getDb();
  const params: (string | number)[] = warehouseId
    ? [orgId, warehouseId]
    : [orgId];
  const clause = warehouseId ? "AND s.warehouse_id = ?" : "";
  const row = (await db
    .prepare(
      `SELECT COALESCE(SUM(s.qty_milli * s.avg_cost_cents), 0) value_millicents,
              COUNT(*) positions
       FROM stock_levels s WHERE s.org_id = ? ${clause}`,
    )
    .get(...params)) as { value_millicents: number; positions: number };
  return {
    valueCents: Math.round(row.value_millicents / 1000),
    positions: row.positions,
  };
}

/** Products with no movement in the period (dead stock). */
export async function noMovementProducts(orgId: string, sinceTs: number, limit = 50) {
  const db = getDb();
  return (await db
    .prepare(
      `SELECT p.id, p.name, p.sku,
              COALESCE((SELECT SUM(s.qty_milli) FROM stock_levels s WHERE s.org_id = p.org_id AND s.product_id = p.id), 0) as qty_milli
       FROM products p
       WHERE p.org_id = ? AND p.status = 'active' AND p.track_stock = 1
         AND NOT EXISTS (
           SELECT 1 FROM stock_movements m
           WHERE m.org_id = p.org_id AND m.product_id = p.id AND m.created_at >= ? AND m.qty_milli < 0
         )
       ORDER BY p.name LIMIT ?`,
    )
    .all(orgId, sinceTs, limit)) as { id: string; name: string; sku: string; qty_milli: number }[];
}


/** Lists transfers with their lines (newest first). */
export async function listTransfers(orgId: string, limit = 40) {
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT t.*, wf.name as from_name, wt.name as to_name, u.name as created_by_label
       FROM stock_transfers t
       JOIN warehouses wf ON wf.id = t.from_warehouse_id
       JOIN warehouses wt ON wt.id = t.to_warehouse_id
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.org_id = ?
       ORDER BY t.created_at DESC LIMIT ?`,
    )
    .all(orgId, Math.min(limit, 200))) as Record<string, unknown>[];
  return rows.map(async (t) => ({
    ...t,
    lines: await db
      .prepare(
        `SELECT l.id, l.product_id, l.variant_id, l.qty_milli, l.received_qty_milli,
                p.name as product_name, p.unit, v.label as variant_label
         FROM stock_transfer_lines l
         JOIN products p ON p.id = l.product_id
         LEFT JOIN product_variants v ON v.id = l.variant_id
         WHERE l.transfer_id = ?`,
      )
      .all(t.id as string),
  }));
}
