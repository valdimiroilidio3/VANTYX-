/**
 * Money is always handled as INTEGER minor units (cents).
 * Quantities are INTEGER milli-units (1 unit = 1000; 1.25 kg = 1250).
 * Tax rates are INTEGER basis points (2300 = 23.00%).
 * No floating point is used in any calculation path.
 */

/** Rounds half away from zero (commercial rounding for money). */
export function roundHalfAway(num: number, den: number): number {
  if (den === 0) return 0;
  const q = num / den;
  return q >= 0 ? Math.floor(q + 0.5) : Math.ceil(q - 0.5);
}

/** qty (milli-units) × unit price (cents) → cents */
export function qtyTimesPrice(qtyMilli: number, unitPriceCents: number): number {
  return roundHalfAway(qtyMilli * unitPriceCents, 1000);
}

/** Applies a basis-point discount/percentage to an amount in cents. */
export function applyBps(amountCents: number, bps: number): number {
  return roundHalfAway(amountCents * bps, 10000);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/**
 * Distributes `totalCents` across parts proportionally to `weights`,
 * with integer precision: the remainder (caused by rounding) is added to
 * the largest weight so the parts always sum exactly to the total.
 */
export function distributeProportional(
  totalCents: number,
  weights: number[],
): number[] {
  const weightSum = sum(weights);
  if (weights.length === 0) return [];
  if (weightSum === 0) {
    // No weight: give everything to the last position (deterministic).
    const out = new Array(weights.length).fill(0);
    out[weights.length - 1] = totalCents;
    return out;
  }
  const parts = weights.map((w) => roundHalfAway(totalCents * w, weightSum));
  const drift = totalCents - sum(parts);
  if (drift !== 0) {
    let target = 0;
    for (let i = 1; i < weights.length; i++) {
      if (weights[i]! > weights[target]!) target = i;
    }
    parts[target] = (parts[target] ?? 0) + drift;
  }
  return parts;
}

const LOCALE_CURRENCY: Record<string, string> = { EUR: "EUR" };

/** Formats cents for display. Server/client safe (Intl only). */
export function formatMoney(
  cents: number,
  currency = "EUR",
  locale = "pt-PT",
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: LOCALE_CURRENCY[currency] ?? currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Formats a milli-unit quantity, trimming trailing zeros. */
export function formatQty(qtyMilli: number, unit = "un"): string {
  const value = qtyMilli / 1000;
  const text = Number.isInteger(value)
    ? String(value)
    : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return unit === "un" ? text : `${text} ${unit}`;
}

export function centsFromDecimal(value: number): number {
  return Math.round(value * 100);
}

export function milliFromDecimal(value: number): number {
  return Math.round(value * 1000);
}

export function decimalFromMilli(qtyMilli: number): number {
  return qtyMilli / 1000;
}
