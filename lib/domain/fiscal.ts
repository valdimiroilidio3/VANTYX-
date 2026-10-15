import { createHash } from "crypto";

/**
 * Camada fiscal — Portugal (AT).
 *
 * Implementa os requisitos técnicos legais:
 *  - Portaria n.º 363/2010 + Despacho n.º 8632/2014: assinatura (hash) de
 *    documentos — SHA-1 sobre "InvoiceDate;SystemEntryDate;InvoiceNo;
 *    GrossTotal;HashAnterior", resultado em Base-64, cadeia por série e
 *    exercício (vazio no primeiro documento da série/exercício).
 *  - Portaria n.º 195/2020: ATCUD ("códigoValidação-sequencial") e mensagem
 *    do código QR (campos A..S separados por "*", montantes com "." e 2
 *    casas decimais).
 *
 * IMPORTANTE — HONESTIDADE REGULATÓRIA: este código implementa o formato
 * legal, mas o VANTYX NÃO é (ainda) software certificado pela AT. A
 * certificação é um processo administrativo da empresa produtora (Portaria
 * 363/2010, art. 3.º): candidatura no Portal das Finanças, documentação
 * técnica e análise da AT, que atribui o número de certificado. Até lá:
 *  - `certificateNumber` permanece nulo e os documentos NÃO imprimem
 *    "Processado por programa certificado";
 *  - o campo H (ATCUD) e R (n.º certificado) do QR só são emitidos quando
 *    configurados com valores reais atribuídos pela AT;
 *  - ver docs/CERTIFICACAO-AT.md e docs/COMPLIANCE.md.
 */

/* ------------------------------ Formatos AT ------------------------------ */

/** GrossTotal AT: euros, ponto decimal, exatamente 2 casas, sem milhares. */
export function atGrossTotal(totalCents: number): string {
  return (totalCents / 100).toFixed(2);
}

function atDateParts(ts: number, timeZone: string): {
  y: string; m: string; d: string; hh: string; mm: string; ss: string;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(ts)).map((p) => [p.type, p.value]),
  );
  // Intl pode devolver "24" para meia-noite em hour12:false
  const hh = parts.hour === "24" ? "00" : (parts.hour ?? "00");
  return {
    y: parts.year ?? "1970", m: parts.month ?? "01", d: parts.day ?? "01",
    hh, mm: parts.minute ?? "00", ss: parts.second ?? "00",
  };
}

/** InvoiceDate (SAF-T): AAAA-MM-DD no fuso da organização. */
export function atInvoiceDate(ts: number, timeZone = "Europe/Lisbon"): string {
  const p = atDateParts(ts, timeZone);
  return `${p.y}-${p.m}-${p.d}`;
}

/** SystemEntryDate (SAF-T): AAAA-MM-DDTHH:MM:SS no fuso da organização. */
export function atSystemEntryDate(ts: number, timeZone = "Europe/Lisbon"): string {
  const p = atDateParts(ts, timeZone);
  return `${p.y}-${p.m}-${p.d}T${p.hh}:${p.mm}:${p.ss}`;
}

/* ------------------------- Hash (Portaria 363/2010) ------------------------ */

export interface AtHashInput {
  /** AAAA-MM-DD */
  invoiceDate: string;
  /** AAAA-MM-DDTHH:MM:SS */
  systemEntryDate: string;
  /** ex. "FT VD/143" */
  invoiceNo: string;
  /** euros com "." e 2 casas — ex. "123.45" */
  grossTotal: string;
  /** Base-64 do documento anterior da MESMA série/exercício; null/"" no primeiro */
  prevHash: string | null;
}

/**
 * Cadeia de caracteres a submeter ao SHA-1 (Despacho 8632/2014, 2.1.1):
 * os cinco elementos concatenados apenas com ";", sem aspas nem fins de linha.
 */
export function atHashPayload(i: AtHashInput): string {
  return `${i.invoiceDate};${i.systemEntryDate};${i.invoiceNo};${i.grossTotal};${i.prevHash ?? ""}`;
}

/** Assinatura do documento: Base-64 do digest SHA-1 (28 caracteres). */
export function atHash(i: AtHashInput): string {
  return createHash("sha1").update(atHashPayload(i), "utf8").digest("base64");
}

/** 4 caracteres da assinatura a imprimir / campo Q do QR (art. 6.º n.º 3 a)). */
export function atHashPrintable(hashB64: string): string {
  return hashB64.slice(0, 4);
}

/**
 * HashControl (SAF-T 4.1.4.4): "<número do certificado>.<versão da chave>".
 * Null enquanto o software não for certificado pela AT.
 */
export function atHashControl(
  certificateNumber: string | number | null | undefined,
  keyVersion = 1,
): string | null {
  if (certificateNumber == null || String(certificateNumber).trim() === "") return null;
  return `${String(certificateNumber).trim()}.${keyVersion}`;
}

/* --------------------------- ATCUD (Portaria 195/2020) --------------------------- */

/**
 * ATCUD = "códigoValidação-sequencial". O código de validação (≥8 caracteres)
 * é atribuído pela AT após comunicação da série documental. Sem código
 * comunicado devolve null — o sistema nunca inventa um ATCUD.
 */
export function buildAtcud(
  validationCode: string | null | undefined,
  sequence: number,
): string | null {
  const code = validationCode?.trim();
  if (!code || code.length < 8) return null;
  return `${code}-${sequence}`;
}

/**
 * Número completo do documento (SAF-T InvoiceNo):
 * "<código interno> <identificador da série>/<sequencial>" — ex. "FT VD/143".
 */
export function formatDocumentNumber(
  docType: string,
  prefix: string,
  sequence: number,
): string {
  return `${docType} ${prefix}/${sequence}`;
}

/* ------------------------ QR Code (Portaria 195/2020) ------------------------ */

/** Regiões fiscais PT e as respetivas taxas (bps) por escalão. */
const REGION_RATES: Record<string, { reduced: number[]; intermediate: number[]; normal: number[] }> = {
  PT: { reduced: [600], intermediate: [1300], normal: [2300] },
  "PT-AC": { reduced: [400], intermediate: [900], normal: [1600] },
  "PT-MA": { reduced: [500], intermediate: [1125, 1200], normal: [2200] },
};

export interface QrRegionTotals {
  /** Base isenta de IVA (I2/J2/K2) */
  exemptBaseCents: number;
  reducedBaseCents: number;
  reducedTaxCents: number;
  intermediateBaseCents: number;
  intermediateTaxCents: number;
  normalBaseCents: number;
  normalTaxCents: number;
}

export interface QrDocument {
  issuerTin: string;
  customerTin: string | null; // null → consumidor final (999999990)
  customerCountry: string; // "PT"
  /** Tipo SAF-T: FT, FS, NC, ND, FR, GT, ... */
  invoiceType: string;
  /** Estado SAF-T: N (normal), A (anulado), F (faturado), R (recibo) */
  invoiceStatus: string;
  documentTs: number;
  timeZone?: string;
  invoiceNo: string;
  atcud: string | null;
  /** Bloco regional → totais; pelo menos uma região (I1:PT mínimo) */
  regions: Partial<Record<"PT" | "PT-AC" | "PT-MA", QrRegionTotals>>;
  /** L — não sujeito/não tributado */
  nonTaxableCents?: number;
  /** M — imposto do selo */
  stampDutyCents?: number;
  /** N — total de impostos (TaxPayable) */
  totalTaxesCents: number;
  /** O — total do documento com impostos (GrossTotal) */
  grossTotalCents: number;
  /** P — retenções na fonte */
  withholdingCents?: number;
  /** Q — assinatura Base-64 do documento (serão usados os 4 primeiros caracteres) */
  hashB64: string;
  /** R — número de certificado AT (null = software não certificado) */
  certificateNumber?: string | number | null;
  /** S — outras informações (pagamentos etc.; nunca conter "*") */
  otherInfo?: string | null;
}

/** Classifica uma taxa (bps) no escalão da região (reduzida/intermédia/normal). */
function rateTier(
  region: string,
  taxRateBps: number,
): "reduced" | "intermediate" | "normal" {
  const rates = REGION_RATES[region] ?? REGION_RATES.PT!;
  if (rates.reduced.includes(taxRateBps)) return "reduced";
  if (rates.intermediate.includes(taxRateBps)) return "intermediate";
  if (rates.normal.includes(taxRateBps)) return "normal";
  // Taxa não mapeada: aproxima pelo escalão mais próximo (defensivo).
  const nearest = (arr: number[]) =>
    arr.reduce((best, r) => (Math.abs(r - taxRateBps) < Math.abs(best - taxRateBps) ? r : best), arr[0]!);
  const candidates: [ "reduced" | "intermediate" | "normal", number ][] = [
    ["reduced", Math.abs(nearest(rates.reduced) - taxRateBps)],
    ["intermediate", Math.abs(nearest(rates.intermediate) - taxRateBps)],
    ["normal", Math.abs(nearest(rates.normal) - taxRateBps)],
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0]![0];
}

/**
 * Converte o taxBreakdown interno ({ "<taxaBps>": { taxableCents, taxCents } })
 * em totais regionais do QR. As taxas 0 vão para a base isenta.
 */
export function qrRegionTotals(
  region: "PT" | "PT-AC" | "PT-MA",
  taxBreakdown: Record<string, { taxableCents: number; taxCents: number }>,
): QrRegionTotals {
  const totals: QrRegionTotals = {
    exemptBaseCents: 0,
    reducedBaseCents: 0, reducedTaxCents: 0,
    intermediateBaseCents: 0, intermediateTaxCents: 0,
    normalBaseCents: 0, normalTaxCents: 0,
  };
  for (const [rateKey, v] of Object.entries(taxBreakdown)) {
    const bps = Number(rateKey);
    if (!Number.isFinite(bps) || bps <= 0 || (v.taxCents ?? 0) === 0) {
      totals.exemptBaseCents += v.taxableCents ?? 0;
      continue;
    }
    const tier = rateTier(region, bps);
    if (tier === "reduced") {
      totals.reducedBaseCents += v.taxableCents ?? 0;
      totals.reducedTaxCents += v.taxCents ?? 0;
    } else if (tier === "intermediate") {
      totals.intermediateBaseCents += v.taxableCents ?? 0;
      totals.intermediateTaxCents += v.taxCents ?? 0;
    } else {
      totals.normalBaseCents += v.taxableCents ?? 0;
      totals.normalTaxCents += v.taxCents ?? 0;
    }
  }
  return totals;
}

const money = (cents: number) => (cents / 100).toFixed(2);

/**
 * Mensagem do QR Code segundo a Portaria 195/2020 (especificações técnicas
 * AT v1.1): campos "CÓDIGO:valor" concatenados por "*", na ordem da tabela,
 * opcionais omitidos quando não há dados.
 */
export function buildQrString(d: QrDocument): string {
  const tz = d.timeZone ?? "Europe/Lisbon";
  const parts: string[] = [];
  const dp = atDateParts(d.documentTs, tz);
  const yyyymmdd = `${dp.y}${dp.m}${dp.d}`;

  parts.push(`A:${d.issuerTin}`);
  parts.push(`B:${d.customerTin?.trim() || "999999990"}`);
  parts.push(`C:${d.customerCountry}`);
  parts.push(`D:${d.invoiceType}`);
  parts.push(`E:${d.invoiceStatus}`);
  parts.push(`F:${yyyymmdd}`);
  parts.push(`G:${d.invoiceNo}`);
  if (d.atcud) parts.push(`H:${d.atcud}`);

  // Blocos regionais I (PT), J (PT-AC), K (PT-MA)
  const blockCodes: [keyof QrDocument["regions"], string][] = [
    ["PT", "I"], ["PT-AC", "J"], ["PT-MA", "K"],
  ];
  let emittedAnyRegion = false;
  for (const [region, code] of blockCodes) {
    const t = d.regions[region];
    if (!t) continue;
    emittedAnyRegion = true;
    parts.push(`${code}1:${region}`);
    if (t.exemptBaseCents) parts.push(`${code}2:${money(t.exemptBaseCents)}`);
    if (t.reducedBaseCents) parts.push(`${code}3:${money(t.reducedBaseCents)}`);
    if (t.reducedTaxCents) parts.push(`${code}4:${money(t.reducedTaxCents)}`);
    if (t.intermediateBaseCents) parts.push(`${code}5:${money(t.intermediateBaseCents)}`);
    if (t.intermediateTaxCents) parts.push(`${code}6:${money(t.intermediateTaxCents)}`);
    if (t.normalBaseCents) parts.push(`${code}7:${money(t.normalBaseCents)}`);
    if (t.normalTaxCents) parts.push(`${code}8:${money(t.normalTaxCents)}`);
  }
  if (!emittedAnyRegion) parts.push("I1:PT"); // mínimo legal: uma região

  if (d.nonTaxableCents) parts.push(`L:${money(d.nonTaxableCents)}`);
  if (d.stampDutyCents) parts.push(`M:${money(d.stampDutyCents)}`);
  parts.push(`N:${money(d.totalTaxesCents)}`);
  parts.push(`O:${money(d.grossTotalCents)}`);
  if (d.withholdingCents) parts.push(`P:${money(d.withholdingCents)}`);
  parts.push(`Q:${atHashPrintable(d.hashB64)}`);
  if (d.certificateNumber != null && String(d.certificateNumber).trim() !== "") {
    parts.push(`R:${String(d.certificateNumber).trim()}`);
  }
  if (d.otherInfo && !d.otherInfo.includes("*")) parts.push(`S:${d.otherInfo}`);

  return parts.join("*");
}
