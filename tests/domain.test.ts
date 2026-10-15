/**
 * Nível 1 — testes unitários do domínio puro (sem BD):
 * dinheiro/arredondamentos, códigos de barras (EAN-13 + embutidos),
 * integridade fiscal (cadeia de hash), pricing (IVA incluído/excluído),
 * motor de regras e permissões.
 */

import { describe, expect, it } from "vitest";
import {
  applyBps,
  centsFromDecimal,
  decimalFromMilli,
  distributeProportional,
  formatMoney,
  formatQty,
  milliFromDecimal,
  qtyTimesPrice,
  roundHalfAway,
} from "@/lib/domain/money";
import {
  computeEanCheckDigit,
  eanChecksumValid,
  normalizeScanInput,
  parseEmbeddedBarcode,
} from "@/lib/domain/barcode";
import { ean13CheckDigit, isValidEan13 } from "@/lib/domain/ean13";
import {
  atGrossTotal,
  atHash,
  atHashControl,
  atHashPayload,
  atHashPrintable,
  atInvoiceDate,
  atSystemEntryDate,
  buildAtcud,
  buildQrString,
  formatDocumentNumber,
  qrRegionTotals,
} from "@/lib/domain/fiscal";
import { calculateSale, computeChange } from "@/lib/domain/pricing";
import { evaluateRules, type BusinessRule } from "@/lib/domain/rules-engine";
import { permissionsForRoleKey, isValidPermission, ROLE_TEMPLATES } from "@/lib/domain/permissions";

/* -------------------------------- money -------------------------------- */

describe("money", () => {
  it("roundHalfAway arredonda para longe do zero (half-up em módulo)", () => {
    expect(roundHalfAway(25, 10)).toBe(3); // 2.5 → 3
    expect(roundHalfAway(-25, 10)).toBe(-3);
    expect(roundHalfAway(24, 10)).toBe(2);
    expect(roundHalfAway(1500, 1000)).toBe(2); // 1.5 → 2
  });

  it("qtyTimesPrice: qty mili × preço cêntimos → cêntimos arredondados", () => {
    expect(qtyTimesPrice(2000, 199)).toBe(398); // 2 × 1.99
    expect(qtyTimesPrice(1500, 199)).toBe(299); // 1.5 × 199 = 298.5 → 299
    expect(qtyTimesPrice(750, 279)).toBe(209); // 209.25 → 209
    expect(qtyTimesPrice(0, 999)).toBe(0);
  });

  it("applyBps aplica pontos base com arredondamento half-away", () => {
    expect(applyBps(1000, 2300)).toBe(230);
    expect(applyBps(100, 600)).toBe(6);
    expect(applyBps(1050, 500)).toBe(53); // 52.5 → 53
  });

  it("distributeProportional distribui sem perder nem criar cêntimos", () => {
    const shares = distributeProportional(100, [1, 1, 1]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(shares).toEqual([34, 33, 33]);
    const shares2 = distributeProportional(10, [3, 1]);
    expect(shares2.reduce((a, b) => a + b, 0)).toBe(10);
    expect(distributeProportional(50, [])).toEqual([]);
    // Sem pesos: determinístico — tudo na última posição
    expect(distributeProportional(50, [0, 0])).toEqual([0, 50]);
  });

  it("conversões decimal ↔ cêntimos ↔ mili são estáveis", () => {
    expect(centsFromDecimal(1.99)).toBe(199);
    expect(centsFromDecimal(19.99)).toBe(1999);
    expect(milliFromDecimal(1.5)).toBe(1500);
    expect(decimalFromMilli(1500)).toBe(1.5);
  });

  it("formatMoney e formatQty usam formato pt-PT", () => {
    expect(formatMoney(123456, "EUR")).toMatch(/234[,.]56/);
    expect(formatQty(1500)).toMatch(/1[,.]5/);
  });
});

/* ------------------------------- barcodes ------------------------------- */

describe("barcode / EAN-13", () => {
  it("computeEanCheckDigit produz dígitos de controlo GS1 corretos", () => {
    // Exemplo canónico GS1: 590123412345 → 7
    expect(computeEanCheckDigit("590123412345")).toBe(7);
    // 560012300001 → dígito calculado e validado em ciclo
    const d = computeEanCheckDigit("560012300001");
    expect(eanChecksumValid(`560012300001${d}`)).toBe(true);
  });

  it("eanChecksumValid aceita códigos válidos e rejeita inválidos", () => {
    expect(eanChecksumValid("5901234123457")).toBe(true);
    expect(eanChecksumValid("5901234123456")).toBe(false); // dígito errado
    expect(eanChecksumValid("590123412345")).toBe(false); // 12 dígitos
    expect(eanChecksumValid("59012341234a7")).toBe(false); // não numérico
  });

  it("ean13CheckDigit/isValidEan13 coerentes para códigos gerados", () => {
    for (const body of ["560012300001", "560987600017", "220000101234", "200001012345"]) {
      expect(body).toHaveLength(12);
      const code = body + String(ean13CheckDigit(body));
      expect(isValidEan13(code)).toBe(true);
      // implementação independente (barcode.ts) concorda
      expect(computeEanCheckDigit(body)).toBe(ean13CheckDigit(body));
    }
    expect(isValidEan13("5600123000010")).toBe(false);
    expect(isValidEan13("123")).toBe(false);
  });

  it("parseEmbeddedBarcode: prefixo 2 dígitos → valor de 5 dígitos (preço)", () => {
    // 22 | 00001 | 01234 | C  → artigo 00001, 12,34 €
    const body = "22" + "00001" + "01234";
    const code = body + String(computeEanCheckDigit(body));
    expect(code).toHaveLength(13);
    const parsed = parseEmbeddedBarcode(code, { prefixes: ["20", "21", "22"], mode: "price" });
    expect(parsed).toEqual({ kind: "price", productCode: "00001", value: 1234 });
  });

  it("parseEmbeddedBarcode: prefixo 1 dígito → valor de 6 dígitos (layout documentado)", () => {
    // 2 | 00001 | 012345 | C
    const body = "2" + "00001" + "012345";
    const code = body + String(computeEanCheckDigit(body));
    const parsed = parseEmbeddedBarcode(code, { prefixes: ["2"], mode: "price" });
    expect(parsed).toEqual({ kind: "price", productCode: "00001", value: 12345 });
  });

  it("parseEmbeddedBarcode descodifica etiquetas de peso (gramas)", () => {
    // 21 | 00042 | 00750 | C → 750 g
    const body = "21" + "00042" + "00750";
    const code = body + String(computeEanCheckDigit(body));
    const parsed = parseEmbeddedBarcode(code, { prefixes: ["21"], mode: "weight" });
    expect(parsed).toEqual({ kind: "weight", productCode: "00042", value: 750 });
  });

  it("parseEmbeddedBarcode rejeita prefixo errado e checksum inválido", () => {
    const body = "22" + "00001" + "01234";
    const code = body + String(computeEanCheckDigit(body));
    expect(parseEmbeddedBarcode(code, { prefixes: ["99"], mode: "price" })).toBeNull();
    // corrompe o dígito de controlo
    const bad = body + String((Number(code[12]) + 1) % 10);
    expect(parseEmbeddedBarcode(bad, { prefixes: ["22"], mode: "price" })).toBeNull();
    // comprimento inválido
    expect(parseEmbeddedBarcode("220000101234", { prefixes: ["22"], mode: "price" })).toBeNull();
  });

  it("normalizeScanInput remove espaços e fins de linha (scanner HID)", () => {
    expect(normalizeScanInput(" 5901234123457\r\n")).toBe("5901234123457");
    expect(normalizeScanInput("590 123\t4123457")).toBe("5901234123457");
  });
});

/* -------------------------------- fiscal -------------------------------- */

describe("fiscal AT (Portaria 363/2010 + 195/2020)", () => {
  it("payload SHA-1: 5 elementos concatenados por \";\" (Despacho 8632/2014)", () => {
    expect(
      atHashPayload({
        invoiceDate: "2019-08-12",
        systemEntryDate: "2019-08-12T10:30:00",
        invoiceNo: "FT VD/1",
        grossTotal: "0.80",
        prevHash: null,
      }),
    ).toBe("2019-08-12;2019-08-12T10:30:00;FT VD/1;0.80;");
  });

  it("atHash = Base-64 do SHA-1 (vetor de referência), 28 chars, determinístico", () => {
    const first = {
      invoiceDate: "2019-08-12",
      systemEntryDate: "2019-08-12T10:30:00",
      invoiceNo: "FT VD/1",
      grossTotal: "0.80",
      prevHash: null,
    };
    // vetor calculado independentemente: sha1("2019-08-12;2019-08-12T10:30:00;FT VD/1;0.80;")
    expect(atHash(first)).toBe("3qFd73AKNvOno9JS+EH5zDSmBWA=");
    expect(atHash(first)).toBe(atHash({ ...first }));
    // elo seguinte referencia o hash anterior (vetor: sha1 do payload com prev)
    const second = {
      invoiceDate: "2019-08-12",
      systemEntryDate: "2019-08-12T10:31:00",
      invoiceNo: "FT VD/2",
      grossTotal: "1.23",
      prevHash: "3qFd73AKNvOno9JS+EH5zDSmBWA=",
    };
    expect(atHash(second)).toMatch(/^[A-Za-z0-9+/]{27}=$/);
    expect(atHash(second)).not.toBe(atHash(first));
  });

  it("sensível a qualquer alteração dos campos assinados", () => {
    const base = {
      invoiceDate: "2019-08-12",
      systemEntryDate: "2019-08-12T10:30:00",
      invoiceNo: "FT VD/1",
      grossTotal: "0.80",
      prevHash: null,
    };
    const h = atHash(base);
    expect(atHash({ ...base, grossTotal: "0.81" })).not.toBe(h);
    expect(atHash({ ...base, invoiceNo: "FT VD/2" })).not.toBe(h);
    expect(atHash({ ...base, systemEntryDate: "2019-08-12T10:30:01" })).not.toBe(h);
    expect(atHash({ ...base, prevHash: "2jmj7l5rSw0yVb/vlWAYkK/YBwk=" })).not.toBe(h);
  });

  it("formatos AT: datas, montantes e 4 chars da assinatura", () => {
    expect(atGrossTotal(12345)).toBe("123.45");
    expect(atGrossTotal(5)).toBe("0.05");
    // 2019-08-12T12:00:00+01:00 (Lisboa, WEST) → 11:00 UTC
    const ts = Date.parse("2019-08-12T12:00:00+01:00");
    expect(atInvoiceDate(ts, "Europe/Lisbon")).toBe("2019-08-12");
    expect(atSystemEntryDate(ts, "Europe/Lisbon")).toBe("2019-08-12T12:00:00");
    expect(atSystemEntryDate(ts, "UTC")).toBe("2019-08-12T11:00:00");
    expect(atHashPrintable("3qFd73AKNvOno9JS+EH5zDSmBWA=")).toBe("3qFd");
  });

  it("HashControl: null sem certificado; '<número>.<versão>' com certificado", () => {
    expect(atHashControl(null)).toBeNull();
    expect(atHashControl("")).toBeNull();
    expect(atHashControl("9999")).toBe("9999.1");
    expect(atHashControl(1234, 2)).toBe("1234.2");
  });

  it("ATCUD: null sem código de validação AT; '<código>-<seq>' com código ≥8 chars", () => {
    expect(buildAtcud(null, 35)).toBeNull();
    expect(buildAtcud("ABC123", 35)).toBeNull(); // < 8 chars → nunca inventar
    expect(buildAtcud("CSDF7T5H", 35)).toBe("CSDF7T5H-35");
  });

  it("formatDocumentNumber segue o formato SAF-T '<tipo> <série>/<seq>'", () => {
    expect(formatDocumentNumber("FT", "VD", 143)).toBe("FT VD/143");
    expect(formatDocumentNumber("NC", "CBR", 7)).toBe("NC CBR/7");
  });

  it("qrRegionTotals classifica taxas PT (isenta/reduzida/intermédia/normal)", () => {
    const t = qrRegionTotals("PT", {
      "0": { taxableCents: 500, taxCents: 0 },
      "600": { taxableCents: 1000, taxCents: 60 },
      "1300": { taxableCents: 2000, taxCents: 260 },
      "2300": { taxableCents: 3000, taxCents: 690 },
    });
    expect(t).toEqual({
      exemptBaseCents: 500,
      reducedBaseCents: 1000, reducedTaxCents: 60,
      intermediateBaseCents: 2000, intermediateTaxCents: 260,
      normalBaseCents: 3000, normalTaxCents: 690,
    });
  });

  it("buildQrString reproduz o exemplo oficial 2 das especificações AT (fatura simplificada)", () => {
    // Especificações técnicas QR Code, Portaria 195/2020, v1.1 — Example 2
    const qr = buildQrString({
      issuerTin: "123456789",
      customerTin: null, // consumidor final → 999999990
      customerCountry: "PT",
      invoiceType: "FS",
      invoiceStatus: "N",
      documentTs: Date.parse("2019-08-12T12:00:00+01:00"),
      timeZone: "Europe/Lisbon",
      invoiceNo: "FS CDVF/12345",
      atcud: "CDF7T5HD-12345",
      regions: {
        PT: {
          exemptBaseCents: 0,
          reducedBaseCents: 0, reducedTaxCents: 0,
          intermediateBaseCents: 0, intermediateTaxCents: 0,
          normalBaseCents: 65, normalTaxCents: 15,
        },
      },
      totalTaxesCents: 15,
      grossTotalCents: 80,
      hashB64: "YhGVabcdEfg1234567890abcdefgh=",
      certificateNumber: "9999",
      otherInfo: "NU;0.80",
    });
    expect(qr).toBe(
      "A:123456789*B:999999990*C:PT*D:FS*E:N*F:20190812*G:FS CDVF/12345*H:CDF7T5HD-12345*I1:PT*I7:0.65*I8:0.15*N:0.15*O:0.80*Q:YhGV*R:9999*S:NU;0.80",
    );
  });

  it("QR omite opcionais sem dados e nunca inventa H/R (pré-certificação)", () => {
    const qr = buildQrString({
      issuerTin: "500000000",
      customerTin: "123456789",
      customerCountry: "PT",
      invoiceType: "FT",
      invoiceStatus: "N",
      documentTs: Date.parse("2026-01-02T09:00:00Z"),
      timeZone: "UTC",
      invoiceNo: "FT VD/1",
      atcud: null,
      regions: { PT: qrRegionTotals("PT", { "2300": { taxableCents: 100, taxCents: 23 } }) },
      totalTaxesCents: 23,
      grossTotalCents: 123,
      hashB64: "r/fYzzzzzzzzzzzzzzzzzzzzzzz=",
      certificateNumber: null,
    });
    expect(qr).toBe(
      "A:500000000*B:123456789*C:PT*D:FT*E:N*F:20260102*G:FT VD/1*I1:PT*I7:1.00*I8:0.23*N:0.23*O:1.23*Q:r/fY",
    );
    expect(qr).not.toContain("*H:");
    expect(qr).not.toContain("*R:");
  });
});

/* -------------------------------- pricing -------------------------------- */

describe("pricing (calculateSale)", () => {
  const ctxInc = { pricesIncludeTax: true };
  const ctxExc = { pricesIncludeTax: false };

  it("preços COM imposto: total = bruto; líquido + IVA = total", () => {
    const t = calculateSale(
      [{ id: "l1", qtyMilli: 2000, unitPriceCents: 1230, taxRateBps: 2300 }],
      ctxInc,
    );
    expect(t.totalCents).toBe(2460);
    // net = 2460 / 1.23 = 2000 ; tax = 460
    expect(t.netCents).toBe(2000);
    expect(t.taxCents).toBe(460);
    expect(t.taxBreakdown["2300"]).toEqual({ taxableCents: 2000, taxCents: 460 });
  });

  it("preços SEM imposto: IVA acresce ao total", () => {
    const t = calculateSale(
      [{ id: "l1", qtyMilli: 1000, unitPriceCents: 1000, taxRateBps: 2300 }],
      ctxExc,
    );
    expect(t.netCents).toBe(1000);
    expect(t.taxCents).toBe(230);
    expect(t.totalCents).toBe(1230);
  });

  it("desconto de linha reduz o bruto e o imposto proporcionalmente", () => {
    const t = calculateSale(
      [{ id: "l1", qtyMilli: 1000, unitPriceCents: 1000, taxRateBps: 2300, discountCents: 100 }],
      ctxInc,
    );
    expect(t.discountCents).toBe(100);
    expect(t.totalCents).toBe(900);
  });

  it("desconto de linha nunca excede o valor da linha", () => {
    const t = calculateSale(
      [{ id: "l1", qtyMilli: 1000, unitPriceCents: 500, taxRateBps: 0, discountCents: 9999 }],
      ctxInc,
    );
    expect(t.totalCents).toBe(0);
  });

  it("desconto de ordem distribui-se proporcionalmente sem perder cêntimos", () => {
    const t = calculateSale(
      [
        { id: "l1", qtyMilli: 1000, unitPriceCents: 1000, taxRateBps: 0 },
        { id: "l2", qtyMilli: 1000, unitPriceCents: 2000, taxRateBps: 0 },
        { id: "l3", qtyMilli: 1000, unitPriceCents: 3000, taxRateBps: 0 },
      ],
      ctxInc,
      100,
    );
    expect(t.orderDiscountCents).toBe(100);
    expect(t.totalCents).toBe(5900);
    const perLine = t.lines.map((l) => l.orderDiscountCents);
    expect(perLine.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("breakdown agrupado por taxa (IVA incluído nos preços)", () => {
    const t = calculateSale(
      [
        { id: "l1", qtyMilli: 1000, unitPriceCents: 1060, taxRateBps: 600 },
        { id: "l2", qtyMilli: 1000, unitPriceCents: 2300, taxRateBps: 2300 },
      ],
      ctxInc,
    );
    // 1060 bruto @6% → net 1000, tax 60 ; 2300 bruto @23% → net 1870, tax 430
    expect(t.taxBreakdown["600"]).toEqual({ taxableCents: 1000, taxCents: 60 });
    expect(t.taxBreakdown["2300"]).toEqual({ taxableCents: 1870, taxCents: 430 });
    expect(t.taxCents).toBe(490);
    expect(t.totalCents).toBe(3360);
  });

  it("computeChange nunca devolve troco negativo", () => {
    expect(computeChange(5000, 4300)).toBe(700);
    expect(computeChange(4000, 4300)).toBe(0);
  });
});

/* ------------------------------ rules engine ----------------------------- */

function rule(partial: Partial<BusinessRule> & { condition: BusinessRule["condition"]; action: BusinessRule["action"] }): BusinessRule {
  return {
    id: "rule_1",
    key: "test_rule",
    name: "Test rule",
    scope: {},
    priority: 100,
    enabled: true,
    ...partial,
  };
}

describe("rules engine (declarativo)", () => {
  it("bloqueia quando a condição all corresponde", () => {
    const r = rule({
      condition: { all: [{ field: "sale.total_cents", op: "gt", value: 100000 }] },
      action: { type: "block", reason: "Venda acima do limite manual" },
    });
    const d = evaluateRules([r], { "sale.total_cents": 150000 }, {});
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ type: "block", reason: "Venda acima do limite manual" });
  });

  it("não dispara quando a condição falha", () => {
    const r = rule({
      condition: { all: [{ field: "sale.total_cents", op: "gt", value: 100000 }] },
      action: { type: "block", reason: "x" },
    });
    expect(evaluateRules([r], { "sale.total_cents": 5000 }, {})).toHaveLength(0);
  });

  it("grupo any dispara com qualquer condição verdadeira", () => {
    const r = rule({
      condition: {
        any: [
          { field: "user.role", op: "eq", value: "cashier" },
          { field: "sale.discount_bps", op: "gt", value: 1000 },
        ],
      },
      action: { type: "cap_discount_bps", maxBps: 1000 },
    });
    const d = evaluateRules([r], { "sale.discount_bps": 1500, "user.role": "owner" }, {});
    expect(d[0]).toMatchObject({ type: "cap_discount_bps", maxBps: 1000 });
  });

  it("operadores in / not_in com listas", () => {
    const r = rule({
      condition: { all: [{ field: "sale.channel", op: "in", value: ["online", "delivery"] }] },
      action: { type: "require_approval", kind: "manual_review" },
    });
    expect(evaluateRules([r], { "sale.channel": "delivery" }, {})).toHaveLength(1);
    expect(evaluateRules([r], { "sale.channel": "in_store" }, {})).toHaveLength(0);
    const rn = rule({
      key: "not_in_rule",
      condition: { all: [{ field: "user.role", op: "not_in", value: ["owner", "manager"] }] },
      action: { type: "notify", severity: "info", message: "operação de caixa" },
    });
    expect(evaluateRules([rn], { "user.role": "cashier" }, {})).toHaveLength(1);
    expect(evaluateRules([rn], { "user.role": "owner" }, {})).toHaveLength(0);
  });

  it("regras desativadas nunca disparam", () => {
    const r = rule({
      enabled: false,
      condition: { all: [{ field: "sale.total_cents", op: "gte", value: 0 }] },
      action: { type: "block", reason: "x" },
    });
    expect(evaluateRules([r], { "sale.total_cents": 1 }, {})).toHaveLength(0);
  });

  it("scope restringe por função/filial/canal", () => {
    const r = rule({
      scope: { roles: ["cashier"] },
      condition: { all: [{ field: "sale.discount_bps", op: "gt", value: 0 }] },
      action: { type: "cap_discount_bps", maxBps: 500 },
    });
    expect(evaluateRules([r], { "sale.discount_bps": 900 }, { roleKey: "cashier" })).toHaveLength(1);
    expect(evaluateRules([r], { "sale.discount_bps": 900 }, { roleKey: "owner" })).toHaveLength(0);
    const rb = rule({
      key: "branch_rule",
      scope: { branches: ["br_1"] },
      condition: { all: [{ field: "hour_of_day", op: "gte", value: 0 }] },
      action: { type: "allow" },
    });
    expect(evaluateRules([rb], { hour_of_day: 10 }, { branchId: "br_2" })).toHaveLength(0);
    expect(evaluateRules([rb], { hour_of_day: 10 }, { branchId: "br_1" })).toHaveLength(1);
  });

  it("ordena por prioridade (mais baixa primeiro)", () => {
    const r1 = rule({
      id: "a",
      key: "a",
      priority: 200,
      condition: { all: [{ field: "sale.total_cents", op: "gte", value: 0 }] },
      action: { type: "notify", severity: "info", message: "segunda" },
    });
    const r2 = rule({
      id: "b",
      key: "b",
      priority: 10,
      condition: { all: [{ field: "sale.total_cents", op: "gte", value: 0 }] },
      action: { type: "notify", severity: "info", message: "primeira" },
    });
    const d = evaluateRules([r1, r2], { "sale.total_cents": 1 }, {});
    expect(d.map((x) => (x.type === "notify" ? x.message : ""))).toEqual(["primeira", "segunda"]);
  });

  it("campo fora do contexto nunca corresponde (sem falsos positivos)", () => {
    const r = rule({
      condition: { all: [{ field: "customer.credit_balance_cents", op: "gt", value: 0 }] },
      action: { type: "block", reason: "x" },
    });
    expect(evaluateRules([r], { "sale.total_cents": 100 }, {})).toHaveLength(0);
  });
});

/* ------------------------------ permissions ----------------------------- */

describe("permissions", () => {
  it("owner tem todas as permissões; manager quase todas", () => {
    const owner = permissionsForRoleKey("owner");
    const manager = permissionsForRoleKey("manager");
    expect(owner).toContain("modules.manage");
    expect(owner).toContain("profile.manage");
    expect(manager).not.toContain("modules.manage");
    expect(manager).not.toContain("profile.manage");
    expect(manager).toContain("reports.view");
  });

  it("cashier não acede a relatórios nem a definições", () => {
    const cashier = permissionsForRoleKey("cashier");
    expect(cashier).toContain("pos.sell");
    expect(cashier).not.toContain("reports.view");
    expect(cashier).not.toContain("settings.view");
  });

  it("todas as permissões dos templates são válidas", () => {
    for (const t of ROLE_TEMPLATES) {
      for (const p of t.permissions) expect(isValidPermission(p)).toBe(true);
    }
    expect(isValidPermission("nao.existe")).toBe(false);
  });
});
