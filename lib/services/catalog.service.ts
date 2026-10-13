import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { computeEanCheckDigit, eanChecksumValid } from "@/lib/domain/barcode";
import { ApiError, badRequest, notFound } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";
import { adjustStock } from "./inventory.service";

/**
 * Catalog service — products, variants, barcodes, categories, kits,
 * promotions and CSV import/export. Duplicate validation on SKU and
 * barcode is enforced by unique indexes AND pre-checked for good errors.
 */

export interface ProductInput {
  name: string;
  type?: "simple" | "variant" | "composite" | "service";
  description?: string;
  categoryId?: string | null;
  sku: string;
  basePriceCents: number;
  costCents?: number;
  taxRateBps?: number;
  unit?: string;
  saleMode?: "units" | "weight";
  trackStock?: boolean;
  allowNegative?: boolean | null;
  status?: "active" | "discontinued" | "archived";
  attributes?: Record<string, unknown>;
  supplierId?: string | null;
  reorderPointMilli?: number | null;
  reorderQtyMilli?: number | null;
  shelfLifeDays?: number | null;
  trackBatches?: boolean;
  trackSerials?: boolean;
  barcodes?: { code: string; variantId?: string | null; embeddedKind?: "price" | "weight" | null }[];
  variants?: VariantInput[];
}

export interface VariantInput {
  sku: string;
  label: string;
  priceCents?: number | null;
  costCents?: number | null;
  taxRateBps?: number | null;
  attributes?: Record<string, unknown>;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  type: string;
  description: string | null;
  category_id: string | null;
  base_price_cents: number;
  cost_cents: number;
  tax_rate_bps: number;
  unit: string;
  sale_mode: string;
  track_stock: number;
  allow_negative: number | null;
  status: string;
  attributes: string;
  supplier_id: string | null;
  reorder_point_milli: number | null;
  reorder_qty_milli: number | null;
  shelf_life_days: number | null;
  track_batches: number;
  track_serials: number;
  image_url: string | null;
  created_at: number;
  updated_at: number;
}

export function createProduct(
  orgId: string,
  input: ProductInput,
  actor: { userId: string; label: string },
): string {
  validateProductInput(input);
  const db = getDb();
  assertSkuFree(db, orgId, input.sku);
  const productId = newId("prod");
  const now = Date.now();
  tx(db, () => {
    db.prepare(
      `INSERT INTO products
        (id, org_id, type, name, description, category_id, sku, base_price_cents, cost_cents,
         tax_rate_bps, unit, sale_mode, track_stock, allow_negative, status, attributes,
         supplier_id, reorder_point_milli, reorder_qty_milli, shelf_life_days,
         track_batches, track_serials, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      productId, orgId, input.type ?? "simple", input.name.trim(), input.description ?? null,
      input.categoryId ?? null, input.sku.trim().toUpperCase(), input.basePriceCents,
      input.costCents ?? 0, input.taxRateBps ?? 2300, input.unit ?? "un",
      input.saleMode ?? "units", input.trackStock === false ? 0 : 1,
      input.allowNegative == null ? null : input.allowNegative ? 1 : 0,
      input.status ?? "active", JSON.stringify(input.attributes ?? {}),
      input.supplierId ?? null, input.reorderPointMilli ?? null,
      input.reorderQtyMilli ?? null, input.shelfLifeDays ?? null,
      input.trackBatches ? 1 : 0, input.trackSerials ? 1 : 0,
      actor.userId, now, now,
    );

    for (const variant of input.variants ?? []) {
      insertVariant(db, orgId, productId, variant, now);
    }
    for (const barcode of input.barcodes ?? []) {
      insertBarcode(db, orgId, productId, barcode.code, barcode.variantId ?? null, barcode.embeddedKind ?? null);
    }
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "product.create", resourceType: "product", resourceId: productId, after: input },
      db,
    );
  });
  return productId;
}

function insertVariant(
  db: ReturnType<typeof getDb>,
  orgId: string,
  productId: string,
  variant: VariantInput,
  now: number,
): string {
  assertSkuFree(db, orgId, variant.sku);
  const id = newId("var");
  db.prepare(
    `INSERT INTO product_variants (id, org_id, product_id, sku, label, price_cents, cost_cents, tax_rate_bps, attributes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(
    id, orgId, productId, variant.sku.trim().toUpperCase(), variant.label.trim(),
    variant.priceCents ?? null, variant.costCents ?? null, variant.taxRateBps ?? null,
    JSON.stringify(variant.attributes ?? {}), now,
  );
  return id;
}

function insertBarcode(
  db: ReturnType<typeof getDb>,
  orgId: string,
  productId: string,
  code: string,
  variantId: string | null,
  embeddedKind: "price" | "weight" | null,
): void {
  const normalized = code.trim();
  if (!normalized) return;
  const existing = db
    .prepare(`SELECT product_id FROM barcodes WHERE org_id = ? AND code = ?`)
    .get(orgId, normalized) as { product_id: string } | undefined;
  if (existing) {
    throw new ApiError(409, `Código de barras ${normalized} já está atribuído a outro produto.`, "duplicate_barcode");
  }
  db.prepare(
    `INSERT INTO barcodes (id, org_id, product_id, variant_id, code, embedded_kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId("bc"), orgId, productId, variantId, normalized, embeddedKind, Date.now());
}

export function updateProduct(
  orgId: string,
  productId: string,
  patch: Partial<ProductInput> & { imageUrl?: string | null },
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  const before = db.prepare(`SELECT * FROM products WHERE id = ? AND org_id = ?`).get(productId, orgId) as ProductRow | undefined;
  if (!before) notFound("Produto");
  if (patch.sku && patch.sku.trim().toUpperCase() !== before!.sku) {
    assertSkuFree(db, orgId, patch.sku, productId);
  }
  tx(db, () => {
    db.prepare(
      `UPDATE products SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        category_id = COALESCE(?, category_id),
        sku = COALESCE(?, sku),
        base_price_cents = COALESCE(?, base_price_cents),
        cost_cents = COALESCE(?, cost_cents),
        tax_rate_bps = COALESCE(?, tax_rate_bps),
        unit = COALESCE(?, unit),
        sale_mode = COALESCE(?, sale_mode),
        track_stock = COALESCE(?, track_stock),
        allow_negative = COALESCE(?, allow_negative),
        status = COALESCE(?, status),
        supplier_id = COALESCE(?, supplier_id),
        reorder_point_milli = COALESCE(?, reorder_point_milli),
        reorder_qty_milli = COALESCE(?, reorder_qty_milli),
        shelf_life_days = COALESCE(?, shelf_life_days),
        track_batches = COALESCE(?, track_batches),
        track_serials = COALESCE(?, track_serials),
        image_url = COALESCE(?, image_url),
        updated_at = ?
       WHERE id = ? AND org_id = ?`,
    ).run(
      patch.name?.trim() ?? null, patch.description ?? null, patch.categoryId ?? null,
      patch.sku?.trim().toUpperCase() ?? null, patch.basePriceCents ?? null,
      patch.costCents ?? null, patch.taxRateBps ?? null, patch.unit ?? null,
      patch.saleMode ?? null,
      patch.trackStock === undefined ? null : patch.trackStock ? 1 : 0,
      patch.allowNegative === undefined || patch.allowNegative === null ? null : patch.allowNegative ? 1 : 0,
      patch.status ?? null, patch.supplierId ?? null,
      patch.reorderPointMilli ?? null, patch.reorderQtyMilli ?? null,
      patch.shelfLifeDays ?? null,
      patch.trackBatches === undefined ? null : patch.trackBatches ? 1 : 0,
      patch.trackSerials === undefined ? null : patch.trackSerials ? 1 : 0,
      patch.imageUrl ?? null,
      Date.now(), productId, orgId,
    );
    if (patch.barcodes) {
      db.prepare(`DELETE FROM barcodes WHERE org_id = ? AND product_id = ?`).run(orgId, productId);
      for (const b of patch.barcodes) {
        insertBarcode(db, orgId, productId, b.code, b.variantId ?? null, b.embeddedKind ?? null);
      }
    }
    if (patch.variants) {
      // Additive sync: existing variants by SKU are kept, new ones inserted.
      const existingSkus = new Set(
        (db.prepare(`SELECT sku FROM product_variants WHERE org_id = ? AND product_id = ?`).all(orgId, productId) as { sku: string }[]).map((v) => v.sku),
      );
      for (const variant of patch.variants) {
        if (!existingSkus.has(variant.sku.trim().toUpperCase())) {
          insertVariant(db, orgId, productId, variant, Date.now());
        }
      }
    }
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "product.update", resourceType: "product", resourceId: productId, before, after: patch },
      db,
    );
  });
}

function validateProductInput(input: ProductInput): void {
  if (!input.name?.trim()) badRequest("Nome do produto é obrigatório.");
  if (!input.sku?.trim()) badRequest("SKU é obrigatório.");
  if (input.basePriceCents < 0 || !Number.isInteger(input.basePriceCents)) {
    badRequest("Preço deve ser um inteiro não-negativo (cêntimos).");
  }
  if (input.saleMode === "weight" && input.unit === "un") {
    badRequest("Produtos vendidos a peso devem usar unidade de peso (kg, g).");
  }
  for (const b of input.barcodes ?? []) {
    const code = (b.code ?? "").trim();
    if (!code) badRequest("Código de barras não pode ser vazio.");
    // Códigos com forma EAN/UPC (8/12/13/14 dígitos) têm de ter checksum válido.
    // Códigos internos alfanuméricos continuam a ser aceites sem validação EAN.
    if (/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code) && !eanChecksumValid(code)) {
      badRequest(`Código de barras "${code}" tem dígito de controlo inválido.`);
    }
  }
}

function assertSkuFree(
  db: ReturnType<typeof getDb>,
  orgId: string,
  sku: string,
  ignoreProductId?: string,
): void {
  const normalized = sku.trim().toUpperCase();
  const product = db
    .prepare(`SELECT id FROM products WHERE org_id = ? AND sku = ?`)
    .get(orgId, normalized) as { id: string } | undefined;
  if (product && product.id !== ignoreProductId) {
    throw new ApiError(409, `SKU ${normalized} já existe noutro produto.`, "duplicate_sku");
  }
  const variant = db
    .prepare(`SELECT id FROM product_variants WHERE org_id = ? AND sku = ?`)
    .get(orgId, normalized) as { id: string } | undefined;
  if (variant) {
    throw new ApiError(409, `SKU ${normalized} já existe numa variante.`, "duplicate_sku");
  }
}

/* --------------------------- Search ------------------------------ */

export interface PosSearchResult {
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  sku: string;
  priceCents: number;
  costCents: number;
  taxRateBps: number;
  unit: string;
  saleMode: string;
  trackStock: boolean;
  status: string;
  stockMilli: number | null;
  image: string | null;
  barcode: string | null;
  hasVariants: boolean;
  trackBatches: boolean;
  trackSerials: boolean;
}

/** Instant POS search: name, SKU or exact barcode. Server-paginated. */
export function searchForPos(
  orgId: string,
  query: string,
  opts: { branchWarehouseId?: string; limit?: number } = {},
): PosSearchResult[] {
  const db = getDb();
  const q = query.trim();
  const limit = Math.min(opts.limit ?? 20, 50);
  if (!q) return [];

  // Exact barcode first
  const barcodeRow = db
    .prepare(
      `SELECT b.product_id, b.variant_id, b.code FROM barcodes b WHERE b.org_id = ? AND b.code = ?`,
    )
    .get(orgId, q) as { product_id: string; variant_id: string | null; code: string } | undefined;

  const rows = barcodeRow
    ? (db
        .prepare(
          `SELECT p.*, v.id as v_id, v.label as v_label, v.sku as v_sku, v.price_cents as v_price,
                  v.cost_cents as v_cost, v.tax_rate_bps as v_tax
           FROM products p LEFT JOIN product_variants v ON v.product_id = p.id AND v.id = ?
           WHERE p.org_id = ? AND p.id = ?`,
        )
        .all(orgId, barcodeRow.variant_id, barcodeRow.product_id) as (ProductRow & VariantCols)[])
    : (db
        .prepare(
          `SELECT p.*, v.id as v_id, v.label as v_label, v.sku as v_sku, v.price_cents as v_price,
                  v.cost_cents as v_cost, v.tax_rate_bps as v_tax,
                  (SELECT code FROM barcodes b WHERE b.org_id = p.org_id AND b.product_id = p.id AND b.variant_id IS v.id LIMIT 1) as bc
           FROM products p
           LEFT JOIN product_variants v ON v.product_id = p.id
           WHERE p.org_id = ? AND p.status = 'active'
             AND (p.name LIKE ? OR p.sku LIKE ? OR COALESCE(v.label,'') LIKE ? OR COALESCE(v.sku,'') LIKE ?)
           ORDER BY CASE WHEN p.sku = ? THEN 0 ELSE 1 END, p.name
           LIMIT ?`,
        )
        .all(orgId, `%${q}%`, `%${q.toUpperCase()}%`, `%${q}%`, `%${q.toUpperCase()}%`, q.toUpperCase(), limit) as (ProductRow & VariantCols)[]);

  return rows.slice(0, limit).map((r) => {
    const stock = opts.branchWarehouseId
      ? (db
          .prepare(
            `SELECT COALESCE(SUM(qty_milli),0) q FROM stock_levels
             WHERE warehouse_id = ? AND product_id = ? AND variant_id IS ?`,
          )
          .get(opts.branchWarehouseId, r.id, r.v_id ?? null) as { q: number } | undefined)
      : null;
    const variantCount = (
      db.prepare(`SELECT COUNT(*) c FROM product_variants WHERE product_id = ?`).get(r.id) as { c: number }
    ).c;
    return {
      productId: r.id,
      variantId: r.v_id ?? null,
      name: r.name,
      variantLabel: r.v_label ?? null,
      sku: (r.v_sku as string | undefined) ?? r.sku,
      priceCents: (r.v_price as number | undefined | null) ?? r.base_price_cents,
      costCents: (r.v_cost as number | undefined | null) ?? r.cost_cents,
      taxRateBps: (r.v_tax as number | undefined | null) ?? r.tax_rate_bps,
      unit: r.unit,
      saleMode: r.sale_mode,
      trackStock: r.track_stock === 1,
      status: r.status,
      stockMilli: stock ? stock.q : null,
      image: r.image_url,
      barcode: (r as { bc?: string | null }).bc ?? barcodeRow?.code ?? null,
      hasVariants: variantCount > 0,
      trackBatches: r.track_batches === 1,
      trackSerials: r.track_serials === 1,
    };
  });
}

type VariantCols = {
  v_id: string | null;
  v_label: string | null;
  v_sku: string | null;
  v_price: number | null;
  v_cost: number | null;
  v_tax: number | null;
  bc?: string | null;
};

export function getProductDetail(orgId: string, productId: string) {
  const db = getDb();
  const product = db.prepare(`SELECT * FROM products WHERE id = ? AND org_id = ?`).get(productId, orgId) as ProductRow | undefined;
  if (!product) notFound("Produto");
  const variants = db.prepare(`SELECT * FROM product_variants WHERE product_id = ? ORDER BY label`).all(productId);
  const barcodes = db.prepare(`SELECT * FROM barcodes WHERE product_id = ?`).all(productId);
  const category = product!.category_id
    ? db.prepare(`SELECT id, name FROM categories WHERE id = ?`).get(product!.category_id)
    : null;
  const kitItems = db
    .prepare(
      `SELECT k.*, p.name as component_name, p.sku as component_sku
       FROM kit_items k JOIN products p ON p.id = k.component_product_id
       WHERE k.product_id = ?`,
    )
    .all(productId);
  return { product: product!, variants, barcodes, category, kitItems };
}

export function listProducts(
  orgId: string,
  opts: { search?: string; categoryId?: string; status?: string; limit?: number; offset?: number; sort?: string } = {},
): { rows: ProductRow[]; total: number } {
  const db = getDb();
  const where: string[] = ["org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.search) {
    where.push("(name LIKE ? OR sku LIKE ?)");
    params.push(`%${opts.search}%`, `%${opts.search.toUpperCase()}%`);
  }
  if (opts.categoryId) {
    where.push("category_id = ?");
    params.push(opts.categoryId);
  }
  if (opts.status) {
    where.push("status = ?");
    params.push(opts.status);
  }
  const allowedSorts: Record<string, string> = {
    name: "name ASC",
    name_desc: "name DESC",
    price: "base_price_cents ASC",
    price_desc: "base_price_cents DESC",
    created: "created_at DESC",
    updated: "updated_at DESC",
  };
  const orderBy = allowedSorts[opts.sort ?? "name"] ?? "name ASC";
  const limit = Math.min(opts.limit ?? 25, 200);
  const offset = opts.offset ?? 0;
  const rows = db
    .prepare(`SELECT * FROM products WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as ProductRow[];
  const total = (db.prepare(`SELECT COUNT(*) c FROM products WHERE ${where.join(" AND ")}`).get(...params) as { c: number }).c;
  return { rows, total };
}

/* -------------------------- Categories --------------------------- */

export function listCategories(orgId: string) {
  return getDb()
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count,
              parent.name as parent_name
       FROM categories c LEFT JOIN categories parent ON parent.id = c.parent_id
       WHERE c.org_id = ? ORDER BY c.name`,
    )
    .all(orgId);
}

export function createCategory(
  orgId: string,
  data: { name: string; parentId?: string | null },
): string {
  const db = getDb();
  const id = newId("cat");
  db.prepare(
    `INSERT INTO categories (id, org_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, orgId, data.parentId ?? null, data.name.trim(), Date.now());
  return id;
}

/* --------------------------- Variants ---------------------------- */

export function addVariant(
  orgId: string,
  productId: string,
  variant: VariantInput,
  actor: { userId: string; label: string },
): string {
  const db = getDb();
  const product = db.prepare(`SELECT id FROM products WHERE id = ? AND org_id = ?`).get(productId, orgId);
  if (!product) notFound("Produto");
  let id = "";
  tx(db, () => {
    id = insertVariant(db, orgId, productId, variant, Date.now());
    db.prepare(`UPDATE products SET type = 'variant', updated_at = ? WHERE id = ? AND type = 'simple'`).run(Date.now(), productId);
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "variant.create", resourceType: "product_variant", resourceId: id, after: variant },
      db,
    );
  });
  return id;
}

export function addBarcode(
  orgId: string,
  productId: string,
  code: string,
  variantId: string | null = null,
): void {
  const db = getDb();
  tx(db, () => insertBarcode(db, orgId, productId, code, variantId, null));
}

/* ------------------------------ Kits ------------------------------ */

export function setKitComponents(
  orgId: string,
  productId: string,
  components: { componentProductId: string; componentVariantId?: string | null; qtyMilli: number }[],
): void {
  const db = getDb();
  tx(db, () => {
    db.prepare(`DELETE FROM kit_items WHERE org_id = ? AND product_id = ?`).run(orgId, productId);
    const insert = db.prepare(
      `INSERT INTO kit_items (id, org_id, product_id, component_product_id, component_variant_id, qty_milli)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const c of components) {
      if (c.componentProductId === productId) {
        throw new ApiError(400, "Um kit não pode conter-se a si próprio.");
      }
      insert.run(newId("kit"), orgId, productId, c.componentProductId, c.componentVariantId ?? null, c.qtyMilli);
    }
    db.prepare(`UPDATE products SET type = 'composite', updated_at = ? WHERE id = ?`).run(Date.now(), productId);
  });
}

/* --------------------------- Promotions --------------------------- */

export interface PromotionInput {
  name: string;
  kind: "quantity_discount" | "period_price";
  productId: string;
  variantId?: string | null;
  params: { minQtyMilli?: number; discountBps?: number; priceCents?: number };
  startsAt?: number | null;
  endsAt?: number | null;
}

export function createPromotion(orgId: string, input: PromotionInput): string {
  const db = getDb();
  if (input.kind === "quantity_discount") {
    if (!input.params.minQtyMilli || !input.params.discountBps) {
      badRequest("Promoção de quantidade exige minQtyMilli e discountBps.");
    }
    if ((input.params.discountBps ?? 0) > 10000) badRequest("Desconto máximo é 100%.");
  } else {
    if (input.params.priceCents == null) badRequest("Preço de período exige priceCents.");
  }
  const id = newId("promo");
  db.prepare(
    `INSERT INTO promotions (id, org_id, name, kind, product_id, variant_id, params, starts_at, ends_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(id, orgId, input.name.trim(), input.kind, input.productId, input.variantId ?? null, JSON.stringify(input.params), input.startsAt ?? null, input.endsAt ?? null, Date.now());
  return id;
}

export function listPromotions(orgId: string) {
  return getDb()
    .prepare(
      `SELECT pr.*, p.name as product_name FROM promotions pr
       JOIN products p ON p.id = pr.product_id
       WHERE pr.org_id = ? ORDER BY pr.created_at DESC`,
    )
    .all(orgId);
}

export function setPromotionStatus(orgId: string, promotionId: string, status: "active" | "paused"): void {
  getDb()
    .prepare(`UPDATE promotions SET status = ? WHERE id = ? AND org_id = ?`)
    .run(status, promotionId, orgId);
}

/**
 * Resolves the best active quantity promotion for a product/variant at a
 * given quantity and time. Period-price promotions override unit price.
 */
export function resolveActivePromotion(
  db: ReturnType<typeof getDb>,
  orgId: string,
  productId: string,
  variantId: string | null,
  now = Date.now(),
): { quantity?: { id: string; minQtyMilli: number; discountBps: number }; periodPriceCents?: number; periodPromotionId?: string } | null {
  const rows = db
    .prepare(
      `SELECT * FROM promotions
       WHERE org_id = ? AND product_id = ? AND variant_id IS ? AND status = 'active'
         AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
       ORDER BY priority ASC`,
    )
    .all(orgId, productId, variantId, now, now) as {
    id: string;
    kind: string;
    params: string;
  }[];
  if (!rows.length) return null;
  const result: {
    quantity?: { id: string; minQtyMilli: number; discountBps: number };
    periodPriceCents?: number;
    periodPromotionId?: string;
  } = {};
  for (const row of rows) {
    const params = JSON.parse(row.params) as PromotionInput["params"];
    if (row.kind === "quantity_discount" && !result.quantity) {
      result.quantity = {
        id: row.id,
        minQtyMilli: params.minQtyMilli ?? 0,
        discountBps: params.discountBps ?? 0,
      };
    }
    if (row.kind === "period_price" && result.periodPriceCents === undefined) {
      result.periodPriceCents = params.priceCents;
      result.periodPromotionId = row.id;
    }
  }
  return Object.keys(result).length ? result : null;
}

/* --------------------------- CSV import --------------------------- */

export interface CsvImportRowResult {
  line: number;
  status: "created" | "updated" | "error";
  sku: string;
  message?: string;
}

/**
 * Assisted CSV import (upsert by SKU). Columns:
 * sku,name,price,cost,tax_bps,unit,sale_mode,category,barcode,stock,reorder_point
 * price/cost accept decimal ("1.99"). stock/reorder_point in units.
 * Each row is validated independently; errors never abort valid rows.
 */
export function importProductsCsv(
  orgId: string,
  csv: string,
  actor: { userId: string; label: string },
): { results: CsvImportRowResult[]; created: number; updated: number; errors: number } {
  const db = getDb();
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) badRequest("CSV vazio ou sem linhas de dados.");
  const header = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const required = ["sku", "name", "price"];
  for (const r of required) {
    if (col(r) < 0) badRequest(`Coluna obrigatória em falta: ${r}`);
  }
  const results: CsvImportRowResult[] = [];
  let created = 0;
  let updated = 0;
  let errors = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]!);
    const sku = (fields[col("sku")] ?? "").trim().toUpperCase();
    const name = (fields[col("name")] ?? "").trim();
    const lineNo = i + 1;
    try {
      if (!sku) throw new Error("SKU em falta");
      if (!name) throw new Error("Nome em falta");
      const priceCents = parseMoneyField(fields[col("price")] ?? "");
      if (priceCents == null) throw new Error("Preço inválido");
      const costCents = col("cost") >= 0 ? parseMoneyField(fields[col("cost")] ?? "") ?? 0 : 0;
      const taxBps = col("tax_bps") >= 0 ? parseInt(fields[col("tax_bps")] ?? "2300", 10) : 2300;
      const unit = col("unit") >= 0 ? (fields[col("unit")] ?? "un").trim() || "un" : "un";
      const saleModeRaw = col("sale_mode") >= 0 ? (fields[col("sale_mode")] ?? "units").trim() : "units";
      const saleMode = saleModeRaw === "weight" ? "weight" : "units";
      const barcode = col("barcode") >= 0 ? (fields[col("barcode")] ?? "").trim() : "";

      let categoryId: string | null = null;
      if (col("category") >= 0 && (fields[col("category")] ?? "").trim()) {
        const catName = fields[col("category")]!.trim();
        const existing = db.prepare(`SELECT id FROM categories WHERE org_id = ? AND parent_id IS NULL AND name = ?`).get(orgId, catName) as { id: string } | undefined;
        if (existing) categoryId = existing.id;
        else categoryId = createCategory(orgId, { name: catName });
      }

      const existingProduct = db.prepare(`SELECT id FROM products WHERE org_id = ? AND sku = ?`).get(orgId, sku) as { id: string } | undefined;
      if (existingProduct) {
        updateProduct(orgId, existingProduct.id, {
          name, basePriceCents: priceCents, costCents, taxRateBps: taxBps, unit, saleMode, categoryId,
        }, actor);
        if (barcode) {
          try { addBarcode(orgId, existingProduct.id, barcode); } catch { /* duplicate barcode on same product is fine */ }
        }
        results.push({ line: lineNo, status: "updated", sku });
        updated++;
      } else {
        createProduct(orgId, {
          name, sku, basePriceCents: priceCents, costCents, taxRateBps: taxBps, unit, saleMode, categoryId,
          barcodes: barcode ? [{ code: barcode }] : [],
        }, actor);
        results.push({ line: lineNo, status: "created", sku });
        created++;
      }

      // Initial stock load (only for new products, when provided)
      if (!existingProduct && col("stock") >= 0) {
        const stockUnits = parseFloat((fields[col("stock")] ?? "").replace(",", "."));
        if (!Number.isNaN(stockUnits) && stockUnits !== 0) {
          const warehouse = db.prepare(`SELECT id FROM warehouses WHERE org_id = ? AND is_default = 1 LIMIT 1`).get(orgId) as { id: string } | undefined;
          if (warehouse) {
            const productId = (db.prepare(`SELECT id FROM products WHERE org_id = ? AND sku = ?`).get(orgId, sku) as { id: string }).id;
            adjustStock({
              orgId, warehouseId: warehouse.id, productId, mode: "delta",
              qtyMilli: Math.round(stockUnits * 1000), reasonCode: "initial_load",
              note: "Importação CSV — carga inicial", actor,
            });
          }
        }
      }
      if (col("reorder_point") >= 0) {
        const rp = parseFloat((fields[col("reorder_point")] ?? "").replace(",", "."));
        if (!Number.isNaN(rp)) {
          db.prepare(`UPDATE products SET reorder_point_milli = ? WHERE org_id = ? AND sku = ?`).run(Math.round(rp * 1000), orgId, sku);
        }
      }
    } catch (err) {
      errors++;
      results.push({ line: lineNo, status: "error", sku, message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }
  writeAudit({
    orgId, actorUserId: actor.userId, actorLabel: actor.label,
    action: "products.import_csv", resourceType: "catalog",
    after: { created, updated, errors, totalLines: lines.length - 1 },
  });
  return { results, created, updated, errors };
}

export function exportProductsCsv(orgId: string): string {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.sku, p.name, p.base_price_cents, p.cost_cents, p.tax_rate_bps, p.unit, p.sale_mode,
              c.name as category, b.code as barcode, p.status
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN barcodes b ON b.product_id = p.id AND b.variant_id IS NULL
       WHERE p.org_id = ? ORDER BY p.name`,
    )
    .all(orgId) as Record<string, string | number | null>[];
  const header = "sku,name,price,cost,tax_bps,unit,sale_mode,category,barcode,status";
  const lines = rows.map((r) =>
    [
      r.sku, csvEscape(String(r.name)), (Number(r.base_price_cents) / 100).toFixed(2),
      (Number(r.cost_cents) / 100).toFixed(2), r.tax_rate_bps, r.unit, r.sale_mode,
      csvEscape(String(r.category ?? "")), csvEscape(String(r.barcode ?? "")), r.status,
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseMoneyField(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s?€$/, "").replace(",", ".");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (Number.isNaN(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Utility for creating a self-checking internal EAN for label printing. */
export function generateInternalBarcode(prefix5: string, seq: number): string {
  const body = `${prefix5}${String(seq).padStart(7, "0")}`.slice(0, 12);
  return `${body}${computeEanCheckDigit(body)}`;
}
