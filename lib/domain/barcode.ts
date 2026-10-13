/**
 * Barcode utilities: EAN-13/EAN-8/UPC-A/GTIN-14 checksum validation and
 * parsing of "embedded" in-store barcodes (price/weight labels produced
 * by scales and label printers, e.g. 2 PPPPP VVVVVV C).
 */

/** Computes the check digit for an EAN/UPC body (rightmost weight = 3). */
export function computeEanCheckDigit(body: string): number {
  let acc = 0;
  for (let i = 0; i < body.length; i++) {
    const fromRight = body.length - 1 - i;
    acc += Number(body[i]) * (fromRight % 2 === 0 ? 3 : 1);
  }
  return (10 - (acc % 10)) % 10;
}

export function eanChecksumValid(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const body = code.slice(0, -1);
  const check = Number(code[code.length - 1]);
  return computeEanCheckDigit(body) === check;
}

export interface EmbeddedBarcodeConfig {
  /** Digit prefixes identifying in-store labels, e.g. ["20","21"] */
  prefixes: string[];
  /** What the 6-digit payload encodes. */
  mode: "price" | "weight";
  /** Length of the product code section (default 5). */
  productCodeLength?: number;
}

export interface EmbeddedBarcodeResult {
  kind: "price" | "weight";
  productCode: string;
  /** price in cents (price mode) or weight in grams (weight mode). */
  value: number;
}

/**
 * Parses embedded scale/label barcodes.
 * Layout (EAN-13, 13 digits): P…P | N…N | V…V | C
 *  - P…P: configured prefix (1–2 digits, e.g. "2" or "22")
 *  - N…N: internal product code (default 5 digits)
 *  - V…V: price in cents or weight in grams — occupies ALL remaining digits
 *    before the check digit (6 for a 1-digit prefix, 5 for a 2-digit prefix
 *    with a 5-digit product code)
 *  - C: EAN check digit
 */
export function parseEmbeddedBarcode(
  code: string,
  config: EmbeddedBarcodeConfig,
): EmbeddedBarcodeResult | null {
  if (code.length !== 13 || !/^\d{13}$/.test(code)) return null;
  const prefix = config.prefixes.find((p) => p && code.startsWith(p));
  if (!prefix) return null;
  if (!eanChecksumValid(code)) return null;
  const nLen = config.productCodeLength ?? 5;
  const start = prefix.length;
  // Value = remaining digits between the product code and the check digit.
  const valueLen = 12 - start - nLen;
  if (valueLen < 1) return null;
  const productCode = code.slice(start, start + nLen);
  const value = code.slice(start + nLen, start + nLen + valueLen);
  if (productCode.length !== nLen || value.length !== valueLen) return null;
  return {
    kind: config.mode,
    productCode,
    value: parseInt(value, 10),
  };
}

/** Normalizes scanner input (keyboard-wedge devices may append Enter/CR). */
export function normalizeScanInput(raw: string): string {
  return raw.replace(/[\r\n\t ]/g, "");
}
