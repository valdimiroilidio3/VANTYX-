/**
 * Client-side cart state for the POS. All money maths mirror the server
 * pricing engine (integer cents / milli-units), but the SERVER remains
 * the pricing authority — the checkout re-calculates everything.
 */
import { qtyTimesPrice } from "@/lib/domain/money";

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
  saleMode: string; // units | weight
  trackStock: boolean;
  status: string;
  stockMilli: number | null;
  image: string | null;
  barcode: string | null;
  hasVariants: boolean;
  trackBatches: boolean;
}

export interface EmbeddedInfo {
  kind: "price" | "weight";
  productCode: string;
  value: number; // cents (price mode) or grams (weight mode)
  productId?: string;
  productName?: string;
}

export interface CartLine {
  lineId: string;
  productId: string;
  variantId: string | null;
  name: string;
  variantLabel: string | null;
  sku: string;
  unit: string;
  saleMode: string;
  priceCents: number;
  taxRateBps: number;
  qtyMilli: number;
  trackStock: boolean;
  stockMilli: number | null;
  image: string | null;
  discountCents: number;
  discountReason?: string;
  priceOverride?: boolean;
  embeddedKind?: "price" | "weight";
  notes?: string;
  orderItemId?: string | null;
}

let counter = 0;
export function newLineId(): string {
  counter += 1;
  return `L${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function lineTotalCents(line: CartLine): number {
  const gross = qtyTimesPrice(line.qtyMilli, line.priceCents);
  return Math.max(0, gross - line.discountCents);
}

export interface CartTotals {
  linesCount: number;
  grossCents: number;
  discountCents: number;
  totalCents: number;
  totalQtyMilli: number;
}

export function cartTotals(lines: CartLine[]): CartTotals {
  let gross = 0;
  let discount = 0;
  let qty = 0;
  for (const l of lines) {
    gross += qtyTimesPrice(l.qtyMilli, l.priceCents);
    discount += l.discountCents;
    qty += l.qtyMilli;
  }
  discount = Math.min(discount, gross);
  return {
    linesCount: lines.length,
    grossCents: gross,
    discountCents: discount,
    totalCents: gross - discount,
    totalQtyMilli: qty,
  };
}

/**
 * Builds a cart line from a search result. For weight-mode products an
 * explicit weight (grams) is required; for embedded scale barcodes the
 * printed label value wins (price mode) or the printed weight is used
 * with the product's price/kg (weight mode).
 */
export function lineFromResult(
  result: PosSearchResult,
  opts: { weightGrams?: number; embedded?: EmbeddedInfo | null } = {},
): CartLine {
  let priceCents = result.priceCents;
  let qtyMilli = 1000;
  let embeddedKind: CartLine["embeddedKind"];
  let priceOverride: boolean | undefined;

  if (opts.embedded?.kind === "price" && opts.embedded.productId === result.productId) {
    // Label prints the final price → honor it exactly
    priceCents = opts.embedded.value;
    qtyMilli = 1000;
    embeddedKind = "price";
    priceOverride = true;
  } else if (opts.embedded?.kind === "weight" && opts.embedded.productId === result.productId) {
    qtyMilli = Math.max(1, opts.embedded.value);
    embeddedKind = "weight";
  } else if (result.saleMode === "weight") {
    const grams = Math.max(1, Math.round(opts.weightGrams ?? 0));
    qtyMilli = grams;
  }

  return {
    lineId: newLineId(),
    productId: result.productId,
    variantId: result.variantId,
    name: result.name,
    variantLabel: result.variantLabel,
    sku: result.sku,
    unit: result.unit,
    saleMode: result.saleMode,
    priceCents,
    taxRateBps: result.taxRateBps,
    qtyMilli,
    trackStock: result.trackStock,
    stockMilli: result.stockMilli,
    image: result.image,
    discountCents: 0,
    priceOverride,
    embeddedKind,
  };
}

export function toCheckoutLines(lines: CartLine[]) {
  return lines.map((l) => ({
    productId: l.productId,
    variantId: l.variantId,
    qtyMilli: l.qtyMilli,
    ...(l.priceOverride ? { unitPriceCents: l.priceCents, priceOverride: true } : {}),
    ...(l.discountCents > 0
      ? { discountCents: l.discountCents, discountReason: l.discountReason }
      : {}),
    ...(l.notes ? { notes: l.notes } : {}),
    ...(l.orderItemId ? { orderItemId: l.orderItemId } : {}),
  }));
}

export function changeFor(totalCents: number, tenderedCents: number): number {
  return Math.max(0, tenderedCents - totalCents);
}

/* ------------------------- Offline outbox ------------------------- */

const OUTBOX_KEY = "vantyx-outbox";

export interface OutboxEntry {
  id: string;
  createdAt: number;
  branchId: string;
  terminalId: string | null;
  clientRef: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  status: "queued" | "syncing" | "failed";
  lastError?: string;
  attempts: number;
}

export function loadOutbox(): OutboxEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as OutboxEntry[];
  } catch {
    return [];
  }
}

export function saveOutbox(entries: OutboxEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(entries.slice(-100)));
}

export function newClientRef(): string {
  return `off-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
