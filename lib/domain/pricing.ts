import {
  applyBps,
  distributeProportional,
  qtyTimesPrice,
  roundHalfAway,
  sum,
} from "./money";

/**
 * VANTYX pricing engine — pure, deterministic, integer-only.
 *
 * Supports both tax regimes:
 *  - prices_include_tax = true  (PT retail default): unit price already
 *    contains tax; net and tax are extracted from the gross amount.
 *  - prices_include_tax = false (B2B/wholesale): tax is added on top.
 *
 * Discounts:
 *  - line discount (absolute cents, capped at line gross)
 *  - order discount (absolute cents, distributed proportionally over
 *    discounted line grosses, remainder assigned deterministically)
 *  - quantity promotions (bps discount when qty ≥ threshold)
 */

export interface QuantityPromotion {
  id: string;
  minQtyMilli: number;
  discountBps: number;
}

export interface PriceLineInput {
  /** Stable line id (product+variant identity for allocation). */
  id: string;
  qtyMilli: number;
  unitPriceCents: number;
  taxRateBps: number;
  /** Absolute line discount in cents (before promotions). */
  discountCents?: number;
  discountReason?: string;
  /** Best applicable quantity promotion (already resolved). */
  promotion?: QuantityPromotion | null;
  /** Modifier price deltas (e.g. restaurant extras), cents per line. */
  modifierCents?: number;
}

export interface PriceLineResult {
  id: string;
  qtyMilli: number;
  unitPriceCents: number;
  taxRateBps: number;
  /** qty × unit price + modifiers, before discounts. */
  baseGrossCents: number;
  /** Manual line discount. */
  lineDiscountCents: number;
  /** Promotion discount (bps over gross after line discount). */
  promoDiscountCents: number;
  /** Share of the order-level discount. */
  orderDiscountCents: number;
  /** Final taxable amount of the line. */
  grossCents: number;
  netCents: number;
  taxCents: number;
  totalCents: number;
  promotionId?: string;
}

export interface SaleTotals {
  subtotalCents: number;
  lineDiscountCents: number;
  promoDiscountCents: number;
  orderDiscountCents: number;
  discountCents: number;
  taxCents: number;
  netCents: number;
  totalCents: number;
  /** tax per rate: { [bps]: { taxable, tax } } */
  taxBreakdown: Record<string, { taxableCents: number; taxCents: number }>;
  lines: PriceLineResult[];
}

export interface PricingContext {
  pricesIncludeTax: boolean;
}

function taxSplit(
  grossCents: number,
  taxRateBps: number,
  pricesIncludeTax: boolean,
): { net: number; tax: number; total: number } {
  if (taxRateBps <= 0) {
    return { net: grossCents, tax: 0, total: grossCents };
  }
  if (pricesIncludeTax) {
    // gross contains tax: net = gross / (1 + r)
    const net = roundHalfAway(grossCents * 10000, 10000 + taxRateBps);
    return { net, tax: grossCents - net, total: grossCents };
  }
  const tax = applyBps(grossCents, taxRateBps);
  return { net: grossCents, tax, total: grossCents + tax };
}

/** Resolves the promotion discount for a single line (pure). */
export function resolvePromotionDiscount(
  grossAfterLineDiscount: number,
  qtyMilli: number,
  promotion?: QuantityPromotion | null,
): number {
  if (!promotion) return 0;
  if (qtyMilli < promotion.minQtyMilli) return 0;
  return applyBps(grossAfterLineDiscount, promotion.discountBps);
}

/**
 * Computes full sale pricing: per-line values, order-discount allocation
 * and tax breakdown. Deterministic: same input → same output.
 */
export function calculateSale(
  inputs: PriceLineInput[],
  ctx: PricingContext,
  orderDiscountCents = 0,
): SaleTotals {
  const lines: PriceLineResult[] = inputs.map((input) => {
    const qty = Math.max(0, Math.trunc(input.qtyMilli));
    const base = qtyTimesPrice(qty, Math.max(0, input.unitPriceCents)) +
      Math.max(0, input.modifierCents ?? 0);
    const lineDiscount = Math.min(
      Math.max(0, input.discountCents ?? 0),
      base,
    );
    const afterLine = base - lineDiscount;
    const promoDiscount = resolvePromotionDiscount(
      afterLine,
      qty,
      input.promotion,
    );
    const gross = afterLine - promoDiscount;
    return {
      id: input.id,
      qtyMilli: qty,
      unitPriceCents: input.unitPriceCents,
      taxRateBps: Math.max(0, input.taxRateBps),
      baseGrossCents: base,
      lineDiscountCents: lineDiscount,
      promoDiscountCents: promoDiscount,
      orderDiscountCents: 0,
      grossCents: gross,
      netCents: 0,
      taxCents: 0,
      totalCents: 0,
      promotionId: input.promotion && promoDiscount > 0 ? input.promotion.id : undefined,
    };
  });

  // Distribute the order-level discount proportionally to line grosses.
  const discountable = sum(lines.map((l) => l.grossCents));
  const cappedOrderDiscount = Math.min(
    Math.max(0, Math.trunc(orderDiscountCents)),
    discountable,
  );
  if (cappedOrderDiscount > 0 && lines.length > 0) {
    const shares = distributeProportional(
      cappedOrderDiscount,
      lines.map((l) => l.grossCents),
    );
    lines.forEach((line, i) => {
      line.orderDiscountCents = shares[i] ?? 0;
      line.grossCents -= line.orderDiscountCents;
    });
  }

  // Tax split per final line gross.
  const breakdown: Record<
    string,
    { taxableCents: number; taxCents: number }
  > = {};
  for (const line of lines) {
    const { net, tax, total } = taxSplit(
      line.grossCents,
      line.taxRateBps,
      ctx.pricesIncludeTax,
    );
    line.netCents = net;
    line.taxCents = tax;
    line.totalCents = total;
    const key = String(line.taxRateBps);
    const bucket = breakdown[key] ?? { taxableCents: 0, taxCents: 0 };
    bucket.taxableCents += ctx.pricesIncludeTax ? net : line.grossCents;
    bucket.taxCents += tax;
    breakdown[key] = bucket;
  }

  return {
    subtotalCents: sum(lines.map((l) => l.baseGrossCents)),
    lineDiscountCents: sum(lines.map((l) => l.lineDiscountCents)),
    promoDiscountCents: sum(lines.map((l) => l.promoDiscountCents)),
    orderDiscountCents: cappedOrderDiscount,
    discountCents:
      sum(lines.map((l) => l.lineDiscountCents)) +
      sum(lines.map((l) => l.promoDiscountCents)) +
      cappedOrderDiscount,
    taxCents: sum(lines.map((l) => l.taxCents)),
    netCents: sum(lines.map((l) => l.netCents)),
    totalCents: sum(lines.map((l) => l.totalCents)),
    taxBreakdown: breakdown,
    lines,
  };
}

/** Change due for a cash tender (never negative). */
export function computeChange(tenderedCents: number, dueCents: number): number {
  return Math.max(0, tenderedCents - dueCents);
}

/** Effective discount of a sale as basis points of the subtotal. */
export function discountBpsOfSale(
  subtotalCents: number,
  discountCents: number,
): number {
  if (subtotalCents <= 0) return 0;
  return roundHalfAway(discountCents * 10000, subtotalCents);
}

/** Estimated margin (revenue basis) — never present revenue as profit. */
export function estimatedMarginBps(
  netRevenueCents: number,
  costCents: number,
): number {
  if (netRevenueCents <= 0) return 0;
  return roundHalfAway((netRevenueCents - costCents) * 10000, netRevenueCents);
}
