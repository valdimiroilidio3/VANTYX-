/**
 * Inventory domain rules — pure functions shared by services and tests.
 * Quantities are milli-units; costs are cents.
 */

export type StockPolicy = "block_negative" | "allow_negative" | "warn_negative";

export interface StockCheckInput {
  requestedMilli: number;
  availableMilli: number; // qty - reserved
  policy: StockPolicy;
  productAllowNegative?: boolean | null; // per-product override
}

export type StockCheckResult =
  | { ok: true; warning?: string }
  | { ok: false; reason: string };

export function canFulfillStock(input: StockCheckInput): StockCheckResult {
  const policy: StockPolicy =
    input.productAllowNegative === true
      ? "allow_negative"
      : input.productAllowNegative === false
        ? "block_negative"
        : input.policy;
  const missing = input.requestedMilli - input.availableMilli;
  if (missing <= 0) return { ok: true };
  switch (policy) {
    case "allow_negative":
      return { ok: true, warning: `Stock negativo (${missing / 1000})` };
    case "warn_negative":
      return { ok: true, warning: `Stock insuficiente — venda em negativo autorizada pela política` };
    case "block_negative":
    default:
      return {
        ok: false,
        reason: `Stock insuficiente: disponível ${input.availableMilli / 1000}, pedido ${input.requestedMilli / 1000}`,
      };
  }
}

/** Weighted average cost update on goods receipt. */
export function weightedAverageCost(
  currentQtyMilli: number,
  currentAvgCostCents: number,
  receivedQtyMilli: number,
  receivedUnitCostCents: number,
): number {
  const totalQty = currentQtyMilli + receivedQtyMilli;
  if (totalQty <= 0) return receivedUnitCostCents;
  const currentValue = currentQtyMilli * currentAvgCostCents;
  const receivedValue = receivedQtyMilli * receivedUnitCostCents;
  return Math.round((currentValue + receivedValue) / totalQty);
}

export interface ReorderSuggestionInput {
  qtyMilli: number;
  reservedMilli: number;
  reorderPointMilli: number | null;
  reorderQtyMilli: number | null;
  avgDailySalesMilli: number;
  leadTimeDays: number;
}

/**
 * Replenishment suggestion: order when projected available stock during
 * supplier lead time falls below the reorder point (or below lead-time
 * demand when no explicit point is configured).
 */
export function needsReorder(input: ReorderSuggestionInput): boolean {
  const available = input.qtyMilli - input.reservedMilli;
  if (input.reorderPointMilli != null) {
    return available <= input.reorderPointMilli;
  }
  if (input.avgDailySalesMilli <= 0) return false;
  const leadTimeDemand = input.avgDailySalesMilli * Math.max(1, input.leadTimeDays);
  return available <= leadTimeDemand;
}

export function suggestedOrderQty(
  input: ReorderSuggestionInput,
): number {
  if (input.reorderQtyMilli) return input.reorderQtyMilli;
  const available = input.qtyMilli - input.reservedMilli;
  const target =
    input.reorderPointMilli ??
    input.avgDailySalesMilli * Math.max(1, input.leadTimeDays) * 2;
  return Math.max(0, target - available);
}

/** FEFO batch allocation: consumes earliest-expiry batches first. */
export interface BatchCandidate {
  id: string;
  qtyRemainingMilli: number;
  expiryDate: number | null;
}

export function allocateBatchesFEFO(
  batches: BatchCandidate[],
  qtyMilli: number,
): { batchId: string; qtyMilli: number }[] {
  const sorted = [...batches].sort((a, b) => {
    const ae = a.expiryDate ?? Number.MAX_SAFE_INTEGER;
    const be = b.expiryDate ?? Number.MAX_SAFE_INTEGER;
    return ae - be;
  });
  const allocation: { batchId: string; qtyMilli: number }[] = [];
  let remaining = qtyMilli;
  for (const batch of sorted) {
    if (remaining <= 0) break;
    if (batch.qtyRemainingMilli <= 0) continue;
    const take = Math.min(batch.qtyRemainingMilli, remaining);
    allocation.push({ batchId: batch.id, qtyMilli: take });
    remaining -= take;
  }
  return allocation;
}

/** Expiry risk classification for dashboards/alerts. */
export function expiryRisk(
  expiryDate: number | null,
  now: number,
): "none" | "expired" | "critical" | "soon" {
  if (expiryDate == null) return "none";
  const days = (expiryDate - now) / 86_400_000;
  if (days < 0) return "expired";
  if (days <= 3) return "critical";
  if (days <= 14) return "soon";
  return "none";
}

export const ADJUSTMENT_REASONS = [
  "count_variance",
  "damage",
  "theft_loss",
  "spoilage",
  "internal_use",
  "correction",
  "initial_load",
  "other",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const MOVEMENT_REASONS = [
  "purchase_receipt",
  "sale",
  "sale_return",
  "adjustment",
  "transfer_out",
  "transfer_in",
  "count",
  "waste",
  "work_order",
  "initial_load",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];
