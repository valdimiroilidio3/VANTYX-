/**
 * EAN-13 barcode rendering (pure). Produces the 95-module bar pattern so
 * labels can be printed without external assets. Encoding per GS1 spec.
 */

const L_CODES = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const G_CODES = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
const R_CODES = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];
const PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(first12[i]);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Returns the 95-module pattern as a string of '0'/'1' (1 = bar). */
export function ean13Modules(code: string): string | null {
  if (!isValidEan13(code)) return null;
  const first = Number(code[0]);
  const parity = PARITY[first]!;
  let modules = "101";
  for (let i = 1; i <= 6; i++) {
    const d = Number(code[i]);
    modules += parity[i - 1] === "L" ? L_CODES[d] : G_CODES[d];
  }
  modules += "01010";
  for (let i = 7; i <= 12; i++) {
    modules += R_CODES[Number(code[i])];
  }
  modules += "101";
  return modules;
}

export interface Ean13Bar {
  x: number;
  width: number;
}

/** Collapses modules into bar rectangles (module units). */
export function ean13Bars(code: string): Ean13Bar[] | null {
  const modules = ean13Modules(code);
  if (!modules) return null;
  const bars: Ean13Bar[] = [];
  let x = 0;
  while (x < modules.length) {
    if (modules[x] === "1") {
      let width = 1;
      while (x + width < modules.length && modules[x + width] === "1") width++;
      bars.push({ x, width });
      x += width;
    } else {
      x++;
    }
  }
  return bars;
}
