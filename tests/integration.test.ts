/**
 * Nível 2 — testes de integração sobre a BD SQLite real (em memória).
 * Exercitam os SERVIÇOS (não mocks): organização, catálogo, stock, checkout
 * idempotente, regras de negócio com aprovação por PIN, devoluções/anulação
 * com notas de crédito, compras com receção (custo médio ponderado) e
 * isolamento multi-tenant.
 */

process.env.VANTYX_DB_PATH = ":memory:";

import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { ApiError } from "@/lib/auth/context";
import { createOrganization, completeOnboarding } from "@/lib/services/org.service";
import { createCategory, createProduct, listProducts, searchForPos } from "@/lib/services/catalog.service";
import { adjustStock } from "@/lib/services/inventory.service";
import { checkout, createReturn, getSaleDetail, listSales, voidSale } from "@/lib/services/sales.service";
import { createSupplier, createPurchaseOrder, getPurchaseOrder, receivePurchaseOrder } from "@/lib/services/purchasing.service";
import { createUser, setUserPin } from "@/lib/services/user.service";
import { openSession } from "@/lib/services/cash.service";

const db = getDb();
const one = <T>(sql: string, ...params: unknown[]): T => db.prepare(sql).get(...params) as T;
const all = <T>(sql: string, ...params: unknown[]): T[] => db.prepare(sql).all(...params) as T[];
const count = (sql: string, ...params: unknown[]): number => (one<{ c: number }>(`SELECT COUNT(*) c FROM (${sql})`, ...params)).c;

function expectApiError(fn: () => unknown, status: number, code?: string): ApiError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    const err = e as ApiError;
    expect(err.status).toBe(status);
    if (code) expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`Esperava ApiError ${status}${code ? `/${code}` : ""}, mas não foi lançado.`);
}

/* ------------------------- organização & seed ------------------------- */

const orgA = createOrganization({
  name: "Teste Supermercado",
  industry: "supermarket",
  country: "PT",
  currency: "EUR",
  branchName: "Loja Teste",
  ownerName: "Owner Test",
  ownerEmail: "owner@test.local",
  ownerPassword: "Str0ng!Pass",
});
const ownerActor = { userId: orgA.ownerUserId, label: "Owner Test" };
const ownerRoleActor = { ...ownerActor, roleKey: "owner" };

describe("organização (supermarket)", () => {
  it("cria filial, armazém, terminal, owner e módulos do setor", () => {
    expect(count(`SELECT id FROM branches WHERE id = ?`, orgA.branchId)).toBe(1);
    expect(count(`SELECT id FROM warehouses WHERE id = ?`, orgA.warehouseId)).toBe(1);
    expect(count(`SELECT id FROM terminals WHERE id = ?`, orgA.terminalId)).toBe(1);
    expect(orgA.enabledModules).toContain("pos");
    expect(orgA.enabledModules).toContain("industry.supermarket");
    expect(count(`SELECT module_id FROM org_modules WHERE org_id = ? AND enabled = 1`, orgA.orgId)).toBe(orgA.enabledModules.length);
  });

  it("semeia regras do setor e métodos de pagamento por omissão", () => {
    const rules = all<{ key: string }>(`SELECT key FROM business_rules WHERE org_id = ?`, orgA.orgId);
    expect(rules.map((r) => r.key).sort()).toEqual(["discount_cap_cashier", "void_requires_manager"]);
    const methods = all<{ key: string }>(`SELECT key FROM payment_methods WHERE org_id = ?`, orgA.orgId);
    expect(methods.map((m) => m.key)).toEqual(expect.arrayContaining(["cash", "card", "mbway"]));
  });

  it("completeOnboarding marca o perfil como onboarded (não demo)", () => {
    completeOnboarding(orgA.orgId, ownerActor);
    const p = one<{ onboarded_at: number | null; industry: string }>(
      `SELECT onboarded_at, industry FROM org_profiles WHERE org_id = ?`, orgA.orgId,
    );
    expect(p.onboarded_at).not.toBeNull();
    expect(p.industry).toBe("supermarket");
    expect(one<{ demo: number }>(`SELECT demo FROM organizations WHERE id = ?`, orgA.orgId).demo).toBe(0);
  });
});

/* ------------------------------ catálogo ------------------------------ */

const catFrescos = createCategory(orgA.orgId, { name: "Frescos" });
const prodA = createProduct(orgA.orgId, {
  name: "Maçã Teste",
  sku: "TST-0001",
  basePriceCents: 1000,
  costCents: 600,
  taxRateBps: 600,
  unit: "un",
  trackStock: true,
  categoryId: catFrescos,
  reorderPointMilli: 5000,
  barcodes: [{ code: "5600123000014" }], // EAN-13 válido (560012300001 + 4)
}, ownerActor);

describe("catálogo", () => {
  it("cria produto com EAN-13 válido e categoria", () => {
    const p = one<{ name: string; base_price_cents: number; tax_rate_bps: number }>(
      `SELECT name, base_price_cents, tax_rate_bps FROM products WHERE id = ?`, prodA,
    );
    expect(p.base_price_cents).toBe(1000);
    expect(p.tax_rate_bps).toBe(600);
    expect(count(`SELECT code FROM barcodes WHERE code = ? AND product_id = ?`, "5600123000014", prodA)).toBe(1);
  });

  it("rejeita SKU duplicado e código de barras duplicado (409)", () => {
    expectApiError(() => createProduct(orgA.orgId, {
      name: "Cópia", sku: "TST-0001", basePriceCents: 100, taxRateBps: 2300, unit: "un",
    }, ownerActor), 409);
    expectApiError(() => createProduct(orgA.orgId, {
      name: "Outro", sku: "TST-0002", basePriceCents: 100, taxRateBps: 2300, unit: "un",
      barcodes: [{ code: "5600123000014" }],
    }, ownerActor), 409);
  });

  it("searchForPos encontra produto por código de barras exato, SKU e nome (regressão)", () => {
    const byCode = searchForPos(orgA.orgId, "5600123000014", { limit: 5 });
    expect(byCode).toHaveLength(1);
    expect(byCode[0]!.productId).toBe(prodA);
    expect(byCode[0]!.priceCents).toBe(1000);
    const bySku = searchForPos(orgA.orgId, "TST-0001", { limit: 5 });
    expect(bySku.some((r) => r.productId === prodA)).toBe(true);
    const byName = searchForPos(orgA.orgId, "Maçã", { limit: 5 });
    expect(byName.some((r) => r.productId === prodA)).toBe(true);
  });

  it("rejeita EAN-13 com dígito de controlo inválido", () => {
    expectApiError(() => createProduct(orgA.orgId, {
      name: "Ean Mau", sku: "TST-0003", basePriceCents: 100, taxRateBps: 2300, unit: "un",
      barcodes: [{ code: "5600123000015" }], // checksum errado
    }, ownerActor), 400);
  });
});

/* -------------------------------- stock -------------------------------- */

describe("stock", () => {
  it("carga inicial absoluta regista nível e movimento", () => {
    const r = adjustStock({
      orgId: orgA.orgId, warehouseId: orgA.warehouseId, productId: prodA,
      mode: "absolute", qtyMilli: 10_000, reasonCode: "initial_load", actor: ownerActor,
    });
    expect(r.newQtyMilli).toBe(10_000);
    expect(count(`SELECT id FROM stock_movements WHERE product_id = ? AND reason_code = 'adjustment' AND note LIKE 'initial_load%'`, prodA)).toBe(1);
  });

  it("ajuste delta exige nota justificativa (400 sem nota)", () => {
    expectApiError(() => adjustStock({
      orgId: orgA.orgId, warehouseId: orgA.warehouseId, productId: prodA,
      mode: "delta", qtyMilli: -500, reasonCode: "waste", actor: ownerActor,
    }), 400);
    const r = adjustStock({
      orgId: orgA.orgId, warehouseId: orgA.warehouseId, productId: prodA,
      mode: "delta", qtyMilli: -500, reasonCode: "waste", note: "Deteriorado", actor: ownerActor,
    });
    expect(r.newQtyMilli).toBe(9_500);
  });
});

/* ------------------------------- checkout ------------------------------- */

const actorCashierId = createUser(orgA.orgId, {
  name: "Caixa Teste", email: "caixa@test.local", password: "Str0ng!Pass", roleKey: "cashier",
}, ownerActor);
const cashierActor = { userId: actorCashierId, label: "Caixa Teste", roleKey: "cashier" };

function stockOf(productId: string): number {
  return one<{ q: number }>(
    `SELECT COALESCE(SUM(qty_milli),0) q FROM stock_levels WHERE product_id = ?`, productId,
  ).q;
}

// Vendas em dinheiro exigem sessão de caixa aberta no terminal (regra real).
const cashSession = openSession(orgA.orgId, {
  branchId: orgA.branchId,
  terminalId: orgA.terminalId,
  openingFloatCents: 20_000,
  shiftLabel: "Turno Teste",
  actor: ownerActor,
});
expect(cashSession.sessionId).toBeTruthy();

let sale1Id = "";
describe("checkout (POS)", () => {
  it("venda a dinheiro: documento FT, hash, troco e decremento de stock", () => {
    const before = stockOf(prodA);
    const res = checkout({
      branchId: orgA.branchId,
      terminalId: orgA.terminalId,
      channel: "in_store",
      idempotencyKey: "idem-1",
      lines: [{ productId: prodA, qtyMilli: 2000 }],
      payments: [{ methodKey: "cash", amountCents: 2000, tenderedCents: 5000 }],
      actor: ownerRoleActor,
    });
    sale1Id = res.saleId;
    expect(res.totalCents).toBe(2000);
    expect(res.changeCents).toBe(3000);
    expect(res.status).toBe("completed");
    expect(res.documentNumber).toMatch(/^FT /);
    expect(stockOf(prodA)).toBe(before - 2000);
    const sale = one<{ hash: string; prev_hash: string | null; document_number: string }>(
      `SELECT hash, prev_hash, document_number FROM sales WHERE id = ?`, res.saleId,
    );
    expect(sale.hash).toMatch(/^[A-Za-z0-9+/]{27}=$/); // Base-64 do SHA-1 (AT)
    expect(sale.prev_hash).toBeNull(); // primeira venda → génese
    expect(count(`SELECT id FROM sale_payments WHERE sale_id = ? AND method_key = 'cash'`, res.saleId)).toBe(1);
  });

  it("idempotência: repetir a mesma chave NÃO duplica venda nem stock", () => {
    const before = stockOf(prodA);
    const salesBefore = count(`SELECT id FROM sales WHERE org_id = ?`, orgA.orgId);
    const res = checkout({
      branchId: orgA.branchId,
      terminalId: orgA.terminalId,
      channel: "in_store",
      idempotencyKey: "idem-1", // mesma chave
      lines: [{ productId: prodA, qtyMilli: 2000 }],
      payments: [{ methodKey: "cash", amountCents: 2000, tenderedCents: 5000 }],
      actor: ownerRoleActor,
    });
    expect(res.replayed).toBe(true);
    expect(res.saleId).toBe(sale1Id);
    expect(stockOf(prodA)).toBe(before);
    expect(count(`SELECT id FROM sales WHERE org_id = ?`, orgA.orgId)).toBe(salesBefore);
  });

  it("client_ref deduplica reposições offline (sem chave de idempotência)", () => {
    const before = stockOf(prodA);
    const first = checkout({
      branchId: orgA.branchId, channel: "in_store", clientRef: "offline-abc",
      lines: [{ productId: prodA, qtyMilli: 1000 }],
      payments: [{ methodKey: "card", amountCents: 1000, status: "confirmed" }],
      actor: ownerRoleActor,
    });
    const second = checkout({
      branchId: orgA.branchId, channel: "in_store", clientRef: "offline-abc", // replay
      lines: [{ productId: prodA, qtyMilli: 1000 }],
      payments: [{ methodKey: "card", amountCents: 1000, status: "confirmed" }],
      actor: ownerRoleActor,
    });
    expect(second.saleId).toBe(first.saleId);
    expect(second.replayed).toBe(true);
    expect(stockOf(prodA)).toBe(before - 1000); // decremento único
  });

  it("pagamento insuficiente é rejeitado (409) e não cria venda", () => {
    const salesBefore = count(`SELECT id FROM sales WHERE org_id = ?`, orgA.orgId);
    expectApiError(() => checkout({
      branchId: orgA.branchId, channel: "in_store",
      lines: [{ productId: prodA, qtyMilli: 1000 }],
      payments: [{ methodKey: "card", amountCents: 500, status: "confirmed" }], // devido 1000
      actor: ownerRoleActor,
    }), 409);
    expect(count(`SELECT id FROM sales WHERE org_id = ?`, orgA.orgId)).toBe(salesBefore);
  });

  it("encadeia o hash: segunda venda referencia o hash da anterior", () => {
    const res = checkout({
      branchId: orgA.branchId, channel: "in_store",
      lines: [{ productId: prodA, qtyMilli: 1000 }],
      payments: [{ methodKey: "mbway", amountCents: 1000, status: "confirmed" }],
      actor: ownerRoleActor,
    });
    const prevDoc = one<{ hash: string }>(
      `SELECT hash FROM sales WHERE org_id = ? AND id != ? AND hash IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      orgA.orgId, res.saleId,
    );
    const cur = one<{ prev_hash: string | null }>(`SELECT prev_hash FROM sales WHERE id = ?`, res.saleId);
    expect(cur.prev_hash).toBe(prevDoc.hash);
  });
});

/* --------------------- regras de negócio no checkout -------------------- */

describe("regras no checkout (desconto > 10% exige aprovação)", () => {
  it("desconto de linha 20% → 428 approval_required com approvalId", () => {
    const err = expectApiError(() => checkout({
      branchId: orgA.branchId, terminalId: orgA.terminalId, channel: "in_store",
      lines: [{ productId: prodA, qtyMilli: 1000, discountCents: 200, discountReason: "cliente insatisfeito" }],
      payments: [{ methodKey: "cash", amountCents: 800, tenderedCents: 800 }],
      actor: cashierActor,
    }), 428, "approval_required");
    const details = err.details as { approvalId?: string };
    expect(details.approvalId).toBeTruthy();
    expect(count(`SELECT id FROM approvals WHERE org_id = ? AND status = 'pending'`, orgA.orgId)).toBeGreaterThanOrEqual(1);
    expect(count(`SELECT id FROM rule_executions WHERE org_id = ? AND result = 'approval_required'`, orgA.orgId)).toBeGreaterThanOrEqual(1);
  });

  it("PIN de supervisor válido ultrapassa a aprovação e regista a venda", () => {
    setUserPin(orgA.orgId, orgA.ownerUserId, "1234", ownerActor);
    const before = stockOf(prodA);
    const res = checkout({
      branchId: orgA.branchId, terminalId: orgA.terminalId, channel: "in_store",
      lines: [{ productId: prodA, qtyMilli: 1000, discountCents: 200, discountReason: "aprovado" }],
      payments: [{ methodKey: "cash", amountCents: 800, tenderedCents: 1000 }],
      supervisor: { userId: orgA.ownerUserId, pin: "1234" },
      actor: cashierActor,
    });
    expect(res.status).toBe("completed");
    expect(res.totalCents).toBe(800);
    expect(res.changeCents).toBe(200);
    expect(stockOf(prodA)).toBe(before - 1000);
  });

  it("PIN de supervisor inválido é rejeitado (409)", () => {
    expectApiError(() => checkout({
      branchId: orgA.branchId, terminalId: orgA.terminalId, channel: "in_store",
      lines: [{ productId: prodA, qtyMilli: 1000, discountCents: 200 }],
      payments: [{ methodKey: "cash", amountCents: 800, tenderedCents: 800 }],
      supervisor: { userId: orgA.ownerUserId, pin: "9999" },
      actor: cashierActor,
    }), 409);
  });
});

/* ------------------------- devoluções e anulação ------------------------ */

describe("devoluções (nota de crédito) e anulação", () => {
  it("devolução parcial: NC proporcional, stock reposto, linha marcada", () => {
    const sale = checkout({
      branchId: orgA.branchId, terminalId: orgA.terminalId, channel: "in_store",
      lines: [{ productId: prodA, qtyMilli: 3000 }],
      payments: [{ methodKey: "cash", amountCents: 3000, tenderedCents: 3000 }],
      actor: ownerRoleActor,
    });
    const detail = getSaleDetail(orgA.orgId, sale.saleId) as { lines: { id: string; total_cents: number }[] };
    const line = detail.lines[0]!;
    // refund exato = round(total * qtyDev / qty) = round(3000 * 1000/3000) = 1000
    const before = stockOf(prodA);
    const ret = createReturn({
      orgId: orgA.orgId, saleId: sale.saleId,
      lines: [{ saleLineId: line.id, qtyMilli: 1000, restock: true }],
      reasonCode: "defective", note: "Embalo danificado", restock: true,
      warehouseId: orgA.warehouseId,
      payments: [{ methodKey: "cash", amountCents: 1000 }],
      actor: ownerActor,
    });
    expect(ret.documentNumber).toMatch(/^NC /);
    expect(ret.totalCents).toBe(1000);
    expect(stockOf(prodA)).toBe(before + 1000);
    const l = one<{ returned_milli: number }>(`SELECT returned_milli FROM sale_lines WHERE id = ?`, line.id);
    expect(l.returned_milli).toBe(1000);
  });

  it("reembolso que não coincide com o total proporcional do servidor é rejeitado", () => {
    const sale = checkout({
      branchId: orgA.branchId, channel: "in_store",
      lines: [{ productId: prodA, qtyMilli: 2000 }],
      payments: [{ methodKey: "card", amountCents: 2000, status: "confirmed" }],
      actor: ownerRoleActor,
    });
    const detail = getSaleDetail(orgA.orgId, sale.saleId) as { lines: { id: string }[] };
    expectApiError(() => createReturn({
      orgId: orgA.orgId, saleId: sale.saleId,
      lines: [{ saleLineId: detail.lines[0]!.id, qtyMilli: 1000 }],
      reasonCode: "customer_regret", restock: false,
      payments: [{ methodKey: "card", amountCents: 999 }], // devido 1000
      actor: ownerActor,
    }), 400);
  });

  it("anulação sem motivo é rejeitada; com motivo gera NC e repõe stock", () => {
    expectApiError(() => voidSale(orgA.orgId, sale1Id, "  ", ownerActor), 400);
    const before = stockOf(prodA);
    const remaining = one<{ q: number }>(
      `SELECT qty_milli - returned_milli q FROM sale_lines WHERE sale_id = ?`, sale1Id,
    ).q;
    const res = voidSale(orgA.orgId, sale1Id, "Erro de operador", ownerActor);
    expect(res.documentNumber).toMatch(/^NC /);
    expect(one<{ status: string }>(`SELECT status FROM sales WHERE id = ?`, sale1Id).status).toBe("void");
    expect(stockOf(prodA)).toBe(before + remaining);
  });
});

/* ------------------------------ compras ------------------------------ */

describe("compras (fornecedor → encomenda → receção)", () => {
  it("receção aumenta stock, atualiza custo médio e emite GRN", () => {
    const sup = createSupplier(orgA.orgId, { name: "Fornecedor Teste" });
    const po = createPurchaseOrder(orgA.orgId, {
      supplierId: sup,
      warehouseId: orgA.warehouseId,
      lines: [{ productId: prodA, qtyMilli: 5000, unitCostCents: 500, taxRateBps: 600 }],
      actor: ownerRoleActor,
    });
    expect(po.status).toBe("draft");
    expect(po.poNumber).toMatch(/^PC-/);
    const before = stockOf(prodA);
    const poDetail = getPurchaseOrder(orgA.orgId, po.poId) as { lines: { id: string }[] };
    const receipt = receivePurchaseOrder(orgA.orgId, po.poId, [
      { poLineId: poDetail.lines[0]!.id, qtyMilli: 5000 },
    ], { note: "Receção completa", actor: ownerActor });
    expect(receipt.discrepancies).toBe(0);
    expect(stockOf(prodA)).toBe(before + 5000);
    expect(count(`SELECT id FROM goods_receipts WHERE id = ?`, receipt.receiptId)).toBe(1);
    const after = getPurchaseOrder(orgA.orgId, po.poId) as unknown as { po: { status: string } };
    expect(after.po.status).toBe("received");
    const cost = one<{ cost_cents: number }>(`SELECT cost_cents FROM products WHERE id = ?`, prodA);
    expect(cost.cost_cents).toBeGreaterThan(0); // custo médio ponderado atualizado
  });

  it("receção acima do encomendado é rejeitada; parcial com custo diferente regista discrepância", () => {
    const sup = createSupplier(orgA.orgId, { name: "Fornecedor Teste 2" });
    const po = createPurchaseOrder(orgA.orgId, {
      supplierId: sup,
      warehouseId: orgA.warehouseId,
      lines: [{ productId: prodA, qtyMilli: 1000, unitCostCents: 500 }],
      actor: ownerRoleActor,
    });
    const poDetail = getPurchaseOrder(orgA.orgId, po.poId) as { lines: { id: string }[] };
    expectApiError(() => receivePurchaseOrder(orgA.orgId, po.poId, [
      { poLineId: poDetail.lines[0]!.id, qtyMilli: 1200 }, // +200 que o encomendado
    ], { actor: ownerActor }), 400);
    // receção parcial com custo diferente do encomendado → 1 discrepância
    const receipt = receivePurchaseOrder(orgA.orgId, po.poId, [
      { poLineId: poDetail.lines[0]!.id, qtyMilli: 800, unitCostCents: 550 },
    ], { actor: ownerActor });
    expect(receipt.discrepancies).toBe(1);
    const after = getPurchaseOrder(orgA.orgId, po.poId) as unknown as { po: { status: string } };
    expect(after.po.status).toBe("partially_received");
  });
});

/* --------------------------- multi-tenant --------------------------- */

describe("isolamento multi-tenant", () => {
  const orgB = createOrganization({
    name: "Teste Restaurante",
    industry: "restaurant",
    country: "PT",
    branchName: "Sala Teste",
    ownerName: "Owner B",
    ownerEmail: "ownerb@test.local",
    ownerPassword: "Str0ng!Pass",
  });

  it("organização B não vê produtos, vendas nem documentos de A", () => {
    expect(listProducts(orgB.orgId, {}).total).toBe(0);
    expect(listSales(orgB.orgId, {}).total).toBe(0);
    expect(count(`SELECT id FROM sales WHERE org_id = ?`, orgB.orgId)).toBe(0);
  });

  it("aceder a venda de A com o orgId de B → 404", () => {
    expectApiError(() => getSaleDetail(orgB.orgId, sale1Id), 404);
  });

  it("setor B ativa módulos de hospitalidade (não os de supermercado)", () => {
    expect(orgB.enabledModules).toContain("industry.restaurant");
    expect(orgB.enabledModules).not.toContain("industry.supermarket");
  });
});
