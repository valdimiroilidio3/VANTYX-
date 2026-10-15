/**
 * VANTYX — seed de DEMONSTRAÇÃO (modo demo explícito).
 *
 * Cria duas organizações marcadas demo=1, completamente separadas de dados
 * reais:
 *   1. "Mercado Lumena (DEMO)"  — pacote Supermercado (prioridade 1)
 *      login: demo.super@vantyx.demo / Demo!23456
 *   2. "Tasca Digital (DEMO)"   — pacote Restaurante (prioridade 2)
 *      login: demo.rest@vantyx.demo / Demo!23456
 *
 * Todos os dados passam pelos SERVIÇOS REAIS (checkout com cadeia de hash e
 * numeração de documentos, movimentos de stock, auditoria, regras), pelo que
 * o espaço demo se comporta exatamente como um real.
 *
 * As vendas são distribuídas pelos últimos 14 dias congelando Date.now()
 * durante cada checkout: o documento é criado tal como seria se um terminal
 * real o tivesse emitido naquele instante (hash, nº de documento e séries
 * coerentes com a data gravada).
 *
 * Uso: npm run seed:demo            (cria as duas; ignora as que já existam)
 *      VANTYX_DB_PATH=... npm run seed:demo
 * O script é idempotente: organizações demo existentes são ignoradas.
 */

import process from "node:process";
import { getDb } from "../lib/db/client";
import { qtyTimesPrice } from "../lib/domain/money";
import { ean13CheckDigit } from "../lib/domain/ean13";
import { createOrganization, completeOnboarding } from "../lib/services/org.service";
import { createCategory, createProduct } from "../lib/services/catalog.service";
import { adjustStock } from "../lib/services/inventory.service";
import { createCustomer } from "../lib/services/crm.service";
import { createSupplier, createPurchaseOrder } from "../lib/services/purchasing.service";
import { createUser } from "../lib/services/user.service";
import { openSession } from "../lib/services/cash.service";
import { checkout } from "../lib/services/sales.service";
import {
  upsertTable,
  createModifierGroup,
  openOrder,
  addOrderItems,
  getOrderDetail,
  createReservation,
} from "../lib/services/restaurant.service";

const DEMO_PASSWORD = "Demo!23456";
const DAY = 86_400_000;

/* ----------------------------- utilities ----------------------------- */

/** Deterministic PRNG (mulberry32) → demo data reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Runs fn with Date.now() frozen at `ms` (restores afterwards). */
function withFrozenNow<T>(ms: number, fn: () => T): T {
  const real = Date.now;
  Date.now = () => ms;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

async function orgExists(name: string): Promise<boolean> {
  const row = await getDb().prepare(`SELECT id FROM organizations WHERE lower(name) = lower(?)`).get(name);
  return Boolean(row);
}

function ean12To13(first12: string): string {
  return first12 + String(ean13CheckDigit(first12));
}

function ts(daysAgo: number, hour: number, minute: number): number {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime() - daysAgo * DAY;
}

interface DemoProduct {
  name: string;
  price: number; // cents
  cost: number; // cents
  taxBps: number;
  unit: string;
  weight?: boolean;
  stockQty: number; // units or kg
  reorder?: number;
  shelfLifeDays?: number;
  category: string;
}

type Cash = { methodKey: "cash"; amountCents: number; tenderedCents: number };
type Elec = { methodKey: "card" | "mbway"; amountCents: number; status: "confirmed" };

function paymentFor(method: "cash" | "card" | "mbway", total: number): Cash[] | Elec[] {
  return method === "cash"
    ? [{ methodKey: "cash", amountCents: total, tenderedCents: Math.ceil((total + 50) / 500) * 500 }]
    : [{ methodKey: method, amountCents: total, status: "confirmed" }];
}

/* --------------------------- supermarket org -------------------------- */

const SUPER_NAME = "Mercado Lumena (DEMO)";

const SUPER_CATEGORIES = ["Mercearia", "Frescos", "Padaria", "Bebidas", "Laticínios", "Charcutaria", "Limpeza & Higiene"];

const SUPER_PRODUCTS: DemoProduct[] = [
  { name: "Pão de Forma Integral 500g", price: 189, cost: 95, taxBps: 600, unit: "un", stockQty: 40, reorder: 12, shelfLifeDays: 5, category: "Padaria" },
  { name: "Croissants Artesanais 4un", price: 250, cost: 120, taxBps: 600, unit: "un", stockQty: 24, reorder: 8, shelfLifeDays: 2, category: "Padaria" },
  { name: "Leite Meio-Gordo 1L", price: 99, cost: 72, taxBps: 600, unit: "un", stockQty: 120, reorder: 48, shelfLifeDays: 90, category: "Laticínios" },
  { name: "Iogurte Natural Pack 8", price: 219, cost: 140, taxBps: 600, unit: "un", stockQty: 65, reorder: 20, shelfLifeDays: 21, category: "Laticínios" },
  { name: "Queijo Flamengo Fatiado 200g", price: 289, cost: 195, taxBps: 600, unit: "un", stockQty: 30, reorder: 10, shelfLifeDays: 45, category: "Laticínios" },
  { name: "Fiambre de Perú 150g", price: 229, cost: 150, taxBps: 2300, unit: "un", stockQty: 25, reorder: 10, shelfLifeDays: 30, category: "Charcutaria" },
  { name: "Arroz Carolino 1kg", price: 175, cost: 120, taxBps: 600, unit: "un", stockQty: 60, reorder: 24, category: "Mercearia" },
  { name: "Massa Esparguete 500g", price: 115, cost: 70, taxBps: 600, unit: "un", stockQty: 80, reorder: 30, category: "Mercearia" },
  { name: "Azeite Virgem Extra 750ml", price: 649, cost: 480, taxBps: 600, unit: "un", stockQty: 35, reorder: 12, category: "Mercearia" },
  { name: "Atum em Posta 3x120g", price: 329, cost: 240, taxBps: 600, unit: "un", stockQty: 50, reorder: 20, category: "Mercearia" },
  { name: "Café Moído Torra Clássica 250g", price: 399, cost: 275, taxBps: 2300, unit: "un", stockQty: 45, reorder: 15, category: "Mercearia" },
  { name: "Açúcar Branco 1kg", price: 129, cost: 85, taxBps: 600, unit: "un", stockQty: 70, reorder: 24, category: "Mercearia" },
  { name: "Coca-Cola Pack 6x33cl", price: 399, cost: 290, taxBps: 2300, unit: "un", stockQty: 40, reorder: 16, category: "Bebidas" },
  { name: "Água Mineral Natural 1,5L", price: 45, cost: 22, taxBps: 600, unit: "un", stockQty: 150, reorder: 60, category: "Bebidas" },
  { name: "Cerveja Imperial Pack 6x33cl", price: 349, cost: 240, taxBps: 2300, unit: "un", stockQty: 60, reorder: 24, category: "Bebidas" },
  { name: "Bananas da Madeira", price: 199, cost: 110, taxBps: 600, unit: "kg", weight: true, stockQty: 80, reorder: 20, shelfLifeDays: 6, category: "Frescos" },
  { name: "Maçã Royal Gala", price: 229, cost: 135, taxBps: 600, unit: "kg", weight: true, stockQty: 90, reorder: 25, shelfLifeDays: 14, category: "Frescos" },
  { name: "Tomate Chucha", price: 279, cost: 160, taxBps: 600, unit: "kg", weight: true, stockQty: 40, reorder: 12, shelfLifeDays: 7, category: "Frescos" },
  { name: "Detergente Roupa 30 doses", price: 899, cost: 590, taxBps: 2300, unit: "un", stockQty: 28, reorder: 8, category: "Limpeza & Higiene" },
  { name: "Papel Higiénico 12 rolos", price: 379, cost: 230, taxBps: 2300, unit: "un", stockQty: 55, reorder: 20, category: "Limpeza & Higiene" },
  { name: "Sabonete Líquido 500ml", price: 249, cost: 130, taxBps: 2300, unit: "un", stockQty: 42, reorder: 14, category: "Limpeza & Higiene" },
];

async function seedSupermarket(): Promise<void> {
  const random = rng(20260101);
  const result = await createOrganization({
    name: SUPER_NAME,
    legalName: "Mercado Lumena, Lda. (demonstração)",
    taxId: "500000001",
    industry: "supermarket",
    subIndustry: "supermarket",
    country: "PT",
    currency: "EUR",
    timezone: "Europe/Lisbon",
    branchName: "Loja Coimbra",
    ownerName: "Ana Nunes",
    ownerEmail: "demo.super@vantyx.demo",
    ownerPassword: DEMO_PASSWORD,
    demo: true,
  });
  const { orgId, branchId, warehouseId, terminalId, ownerUserId } = result;
  const owner = { userId: ownerUserId, label: "Ana Nunes", roleKey: "owner" };
  await completeOnboarding(orgId, { userId: ownerUserId, label: "Ana Nunes" });
  console.log(`  organização ${orgId} criada (supermarket)`);

  // Second user: cashier with supervisor PIN (demo override flows)
  await createUser(
    orgId,
    { name: "Rui Operador", email: "demo.caixa@vantyx.demo", password: DEMO_PASSWORD, roleKey: "cashier", pin: "2468" },
    { userId: ownerUserId, label: "Ana Nunes" },
  );

  // Categories
  const catIds = new Map<string, string>();
  for (const name of SUPER_CATEGORIES) catIds.set(name, await createCategory(orgId, { name }));

  // Products + valid EAN-13 barcodes + initial stock
  const products: { id: string; price: number; weight: boolean }[] = [];
  SUPER_PRODUCTS.forEach(async (p, i) => {
    const seq = String(i + 1).padStart(4, "0");
    const ean = ean12To13(`56001230${seq}`);
    const barcodes: { code: string; embeddedKind?: "price" | "weight" | null }[] = [{ code: ean }];
    if (p.weight) {
      // Embedded scale barcode (prefix 22 + item code + price) — supermarket pack
      barcodes.push({ code: ean12To13(`22${String(i + 1).padStart(5, "0")}${String(p.price).padStart(5, "0")}`), embeddedKind: "price" });
    }
    const id = await createProduct(
      orgId,
      {
        name: p.name,
        sku: `LM-${String(i + 1).padStart(5, "0")}`,
        basePriceCents: p.price,
        costCents: p.cost,
        taxRateBps: p.taxBps,
        unit: p.unit,
        saleMode: p.weight ? "weight" : "units",
        trackStock: true,
        categoryId: catIds.get(p.category) ?? null,
        reorderPointMilli: (p.reorder ?? 10) * 1000,
        reorderQtyMilli: (p.reorder ?? 10) * 3000,
        shelfLifeDays: p.shelfLifeDays ?? null,
        trackBatches: Boolean(p.shelfLifeDays),
        barcodes,
      },
      { userId: ownerUserId, label: "Ana Nunes" },
    );
    products.push({ id, price: p.price, weight: Boolean(p.weight) });
    await adjustStock({
      orgId,
      warehouseId,
      productId: id,
      mode: "absolute",
      qtyMilli: Math.round(p.stockQty * 1000),
      reasonCode: "initial_load",
      actor: { userId: ownerUserId, label: "Ana Nunes" },
    });
  });
  console.log(`  ${products.length} produtos com EAN-13 válido + stock inicial`);

  // Suppliers + a draft purchase order (replenishment flow)
  const sup1 = await createSupplier(orgId, {
    name: "Recheio Distribuição (DEMO)",
    contactName: "Carlos Fonseca",
    email: "encomendas@recheiodemo.pt",
    phone: "+351 239 000 111",
    taxId: "501123456",
    paymentTerms: "30 dias",
    leadTimeDays: 3,
  });
  await createSupplier(orgId, {
    name: "Quinta dos Frescos (DEMO)",
    contactName: "Maria João",
    phone: "+351 239 000 222",
    taxId: "502234567",
    paymentTerms: "Pronto pagamento",
    leadTimeDays: 1,
  });
  const fresh = products.slice(15, 18);
  await createPurchaseOrder(orgId, {
    supplierId: sup1,
    warehouseId,
    expectedAt: Date.now() + 3 * DAY,
    note: "Reposição semanal (demonstração)",
    lines: fresh.map((p) => ({ productId: p.id, qtyMilli: 20_000, unitCostCents: 120, taxRateBps: 600 })),
    actor: owner,
  });
  console.log("  2 fornecedores + 1 encomenda de compra (rascunho)");

  // Customers
  const actor = { userId: ownerUserId, label: "Ana Nunes" };
  const custIds = [
    await createCustomer(orgId, { name: "João Pereira", email: "joao.pereira@demo.pt", phone: "+351 911 111 111", taxId: "222333444", city: "Coimbra", marketingConsent: true }, actor),
    await createCustomer(orgId, { name: "Sofia Martins", email: "sofia.martins@demo.pt", phone: "+351 922 222 222", city: "Condeixa", marketingConsent: false }, actor),
    await createCustomer(orgId, { name: "Cantinas da Universidade (DEMO)", email: "compras@uni-demo.pt", phone: "+351 239 333 333", taxId: "503345678", customerType: "business", creditLimitCents: 150_000 }, actor),
  ];

  // Open cash session for TODAY first (today's sales attach to it)
  const todaySession = await openSession(orgId, {
    branchId,
    terminalId,
    openingFloatCents: 20_000,
    shiftLabel: "Turno da manhã (demo)",
    actor,
  });

  // 14 days of sales (frozen clock per sale → coherent hash chain & docs).
  // Timestamps advance via a strictly-increasing cursor so the SHA-256 chain
  // links linearly in created_at order exactly as real-time inserts would.
  const methods = ["cash", "card", "mbway"] as const;
  let salesCount = 0;
  let cursor = ts(13, 9, 0);
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    cursor = ts(daysAgo, 9, 0); // reset to 09:00 of this day (still monotonic)
    const nSales = 2 + Math.floor(random() * 4);
    for (let s = 0; s < nSales; s++) {
      cursor += (2 + Math.floor(random() * 26)) * 60_000; // +2–27 min
      const when = cursor;
      const nLines = 1 + Math.floor(random() * 5);
      const picked = new Set<number>();
      const lines: { productId: string; qtyMilli: number }[] = [];
      let total = 0;
      for (let l = 0; l < nLines; l++) {
        const idx = Math.floor(random() * products.length);
        if (picked.has(idx)) continue;
        picked.add(idx);
        const p = products[idx]!;
        const qtyMilli = p.weight ? 300 + Math.floor(random() * 1200) : (1 + Math.floor(random() * 3)) * 1000;
        lines.push({ productId: p.id, qtyMilli });
        total += qtyTimesPrice(qtyMilli, p.price);
      }
      if (!lines.length) continue;
      const method = methods[Math.floor(random() * methods.length)]!;
      const customerId = random() < 0.3 ? custIds[Math.floor(random() * custIds.length)]! : null;
      const isToday = daysAgo === 0;
      await withFrozenNow(when, async () => {
        await checkout({
          branchId,
          terminalId,
          cashSessionId: isToday ? todaySession.sessionId : null,
          customerId,
          channel: "in_store",
          idempotencyKey: `demo-super-${daysAgo}-${s}`,
          lines,
          payments: paymentFor(method, total),
          loyaltyEarn: Boolean(customerId),
          actor: owner,
        });
      });
      salesCount++;
    }
  }
  console.log(`  ${salesCount} vendas em 14 dias (documentos + cadeia de hash reais)`);
  console.log(`  sessão de caixa aberta hoje (${todaySession.sessionId}) com fundo de 200,00 €`);
}

/* --------------------------- restaurant org --------------------------- */

const REST_NAME = "Tasca Digital (DEMO)";

const REST_CATEGORIES = ["Entradas", "Pratos do Dia", "Grelhados", "Sobremesas", "Bebidas", "Cafetaria"];

const REST_PRODUCTS: DemoProduct[] = [
  { name: "Pão da Casa com Manteiga", price: 150, cost: 40, taxBps: 1300, unit: "un", stockQty: 0, category: "Entradas" },
  { name: "Pastel de Bacalhau (un)", price: 220, cost: 80, taxBps: 1300, unit: "un", stockQty: 0, category: "Entradas" },
  { name: "Sopa do Dia", price: 250, cost: 70, taxBps: 1300, unit: "un", stockQty: 0, category: "Entradas" },
  { name: "Bacalhau à Brás", price: 1250, cost: 480, taxBps: 1300, unit: "un", stockQty: 0, category: "Pratos do Dia" },
  { name: "Francesinha da Casa", price: 1150, cost: 420, taxBps: 1300, unit: "un", stockQty: 0, category: "Pratos do Dia" },
  { name: "Arroz de Marisco (2 pessoas)", price: 2600, cost: 1100, taxBps: 1300, unit: "un", stockQty: 0, category: "Pratos do Dia" },
  { name: "Bife da Vazia Grelhado", price: 1450, cost: 640, taxBps: 1300, unit: "un", stockQty: 0, category: "Grelhados" },
  { name: "Secretos de Porco Preto", price: 1350, cost: 560, taxBps: 1300, unit: "un", stockQty: 0, category: "Grelhados" },
  { name: "Dourada Grelhada", price: 1550, cost: 700, taxBps: 1300, unit: "un", stockQty: 0, category: "Grelhados" },
  { name: "Pudim Abade de Priscos", price: 450, cost: 130, taxBps: 1300, unit: "un", stockQty: 0, category: "Sobremesas" },
  { name: "Mousse de Chocolate", price: 400, cost: 110, taxBps: 1300, unit: "un", stockQty: 0, category: "Sobremesas" },
  { name: "Água Mineral 75cl", price: 180, cost: 50, taxBps: 1300, unit: "un", stockQty: 0, category: "Bebidas" },
  { name: "Vinho Verde Branco (copo)", price: 350, cost: 110, taxBps: 2300, unit: "un", stockQty: 0, category: "Bebidas" },
  { name: "Imperial 25cl", price: 220, cost: 70, taxBps: 2300, unit: "un", stockQty: 0, category: "Bebidas" },
  { name: "Refrigerante (lata)", price: 180, cost: 60, taxBps: 2300, unit: "un", stockQty: 0, category: "Bebidas" },
  { name: "Espresso", price: 90, cost: 25, taxBps: 2300, unit: "un", stockQty: 0, category: "Cafetaria" },
  { name: "Galão", price: 120, cost: 35, taxBps: 2300, unit: "un", stockQty: 0, category: "Cafetaria" },
];

async function seedRestaurant(): Promise<void> {
  const random = rng(777001);
  const result = await createOrganization({
    name: REST_NAME,
    legalName: "Tasca Digital, Unipessoal Lda. (demonstração)",
    taxId: "500000002",
    industry: "restaurant",
    subIndustry: "restaurant",
    country: "PT",
    currency: "EUR",
    timezone: "Europe/Lisbon",
    branchName: "Sala Baixa",
    ownerName: "Miguel Santos",
    ownerEmail: "demo.rest@vantyx.demo",
    ownerPassword: DEMO_PASSWORD,
    demo: true,
  });
  const { orgId, branchId, terminalId, ownerUserId } = result;
  const owner = { userId: ownerUserId, label: "Miguel Santos", roleKey: "owner" };
  const actor = { userId: ownerUserId, label: "Miguel Santos" };
  await completeOnboarding(orgId, actor);
  console.log(`  organização ${orgId} criada (restaurant)`);

  await createUser(orgId, { name: "Chef Luís", email: "demo.chef@vantyx.demo", password: DEMO_PASSWORD, roleKey: "kitchen" }, actor);
  await createUser(orgId, { name: "Inês da Sala", email: "demo.sala@vantyx.demo", password: DEMO_PASSWORD, roleKey: "floor" }, actor);

  const catIds = new Map<string, string>();
  for (const name of REST_CATEGORIES) catIds.set(name, await createCategory(orgId, { name }));

  const products: { id: string; price: number; name: string }[] = [];
  REST_PRODUCTS.forEach(async (p, i) => {
    const seq = String(i + 1).padStart(4, "0");
    const id = await createProduct(
      orgId,
      {
        name: p.name,
        sku: `TD-${String(i + 1).padStart(5, "0")}`,
        basePriceCents: p.price,
        costCents: p.cost,
        taxRateBps: p.taxBps,
        unit: p.unit,
        trackStock: false, // hospitality: recipes/waste manage consumption
        allowNegative: true,
        categoryId: catIds.get(p.category) ?? null,
        barcodes: [{ code: ean12To13(`56098760${seq}`) }],
      },
      actor,
    );
    products.push({ id, price: p.price, name: p.name });
  });

  // Modifier groups (restaurant pack); keep real ids for the live order
  const grill = products.find((p) => p.name === "Bife da Vazia Grelhado");
  const francesinha = products.find((p) => p.name === "Francesinha da Casa");
  await createModifierGroup(orgId, {
    name: "Ponto da carne",
    minSelect: 1,
    maxSelect: 1,
    options: [{ name: "Mal passado" }, { name: "Médio", isDefault: true }, { name: "Bem passado" }],
    productIds: grill ? [grill.id] : [],
  });
  const extrasGroupId = await createModifierGroup(orgId, {
    name: "Extras",
    minSelect: 0,
    maxSelect: 4,
    options: [
      { name: "Batata frita extra", priceDeltaCents: 150 },
      { name: "Queijo extra", priceDeltaCents: 100 },
      { name: "Ovo estrelado", priceDeltaCents: 80 },
      { name: "Molho picante" },
    ],
    productIds: francesinha ? [francesinha.id] : [],
  });
  const db = getDb();
  const batataOption = (await db
    .prepare(`SELECT id, name, price_delta_cents FROM modifier_options WHERE group_id = ? AND name = ?`)
    .get(extrasGroupId, "Batata frita extra")) as { id: string; name: string; price_delta_cents: number };
  console.log(`  ${products.length} itens de menu + 2 grupos de modificadores`);

  // Floor: two zones
  const tableIds: string[] = [];
  for (let i = 1; i <= 6; i++) {
    tableIds.push(await upsertTable(orgId, branchId, { name: `Mesa ${i}`, zone: "Sala", seats: i <= 2 ? 2 : 4, positionX: ((i - 1) % 3) * 160, positionY: Math.floor((i - 1) / 3) * 140 }));
  }
  for (let i = 7; i <= 10; i++) {
    tableIds.push(await upsertTable(orgId, branchId, { name: `Esplanada ${i - 6}`, zone: "Esplanada", seats: 4, positionX: ((i - 7) % 4) * 160, positionY: 300 }));
  }

  // One LIVE open order with a kitchen ticket (floor + KDS pages)
  const soup = products[2]!;
  const francesinhaP = products[4]!;
  const imperial = products[13]!;
  const liveOrder = await withFrozenNow(Date.now() - 25 * 60_000, async () =>
    await openOrder(orgId, { branchId, tableId: tableIds[1]!, channel: "dine_in", guestCount: 2, actor }),
  );
  await withFrozenNow(Date.now() - 20 * 60_000, async () =>
    await addOrderItems(
      orgId,
      liveOrder.orderId,
      [
        { productId: soup.id, qtyMilli: 2000 },
        {
          productId: francesinhaP.id,
          qtyMilli: 1000,
          modifiers: [
            {
              groupId: extrasGroupId,
              groupName: "Extras",
              optionId: batataOption.id,
              name: batataOption.name,
              priceCents: batataOption.price_delta_cents,
            },
          ],
        },
        { productId: imperial.id, qtyMilli: 2000 },
      ],
      actor,
    ),
  );
  console.log("  10 mesas (2 zonas) + 1 pedido aberto com ticket de cozinha");

  // Reservations: one later today, one tomorrow
  await createReservation(orgId, {
    branchId,
    tableId: tableIds[5]!,
    customerName: "Família Antunes",
    phone: "+351 933 333 333",
    partySize: 6,
    reservedFor: ts(0, 20, 0),
    note: "Aniversário — trazer sobremesa com vela",
  });
  await createReservation(orgId, {
    branchId,
    customerName: "Almoço de empresa (DEMO)",
    partySize: 12,
    reservedFor: ts(-1, 12, 30),
  });

  // Cash session open today
  await openSession(orgId, { branchId, terminalId, openingFloatCents: 15_000, shiftLabel: "Turno almoço (demo)", actor });

  // 14 days of counter/takeaway sales + billed dine-in orders (monotonic
  // cursor keeps the SHA-256 chain linear in created_at order).
  const restMethods = ["cash", "card", "mbway"] as const;
  let salesCount = 0;
  let cursor = ts(13, 12, 0);
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    cursor = ts(daysAgo, 12, 0); // reset to 12:00 of this day
    const nSales = 3 + Math.floor(random() * 5);
    for (let s = 0; s < nSales; s++) {
      cursor += (10 + Math.floor(random() * 80)) * 60_000; // +10–89 min → covers lunch & dinner
      const when = cursor;
      const dineIn = random() < 0.5;
      const nLines = 1 + Math.floor(random() * 4);
      const picked = new Set<number>();
      const lines: { productId: string; qtyMilli: number; price: number }[] = [];
      for (let l = 0; l < nLines; l++) {
        const idx = Math.floor(random() * products.length);
        if (picked.has(idx)) continue;
        picked.add(idx);
        const p = products[idx]!;
        lines.push({ productId: p.id, qtyMilli: (1 + Math.floor(random() * 2)) * 1000, price: p.price });
      }
      if (!lines.length) continue;
      const method = restMethods[Math.floor(random() * restMethods.length)]!;
      const guests = 1 + Math.floor(random() * 3);
      const total = lines.reduce((acc, ln) => acc + qtyTimesPrice(ln.qtyMilli, ln.price), 0);

      if (dineIn) {
        // Open order → add items → bill through checkout (closeOrder).
        // No modifiers here: checkout recomputes line totals from the catalog.
        // Avoid tableIds[1] (LIVE open order, never billed here) and
        // tableIds[5] (held as 'reserved' for the reservations demo).
        const freeTables = tableIds.filter((_, idx) => idx !== 1 && idx !== 5);
        const tableId = freeTables[Math.floor(random() * freeTables.length)]!;
        await withFrozenNow(when, async () => {
          const opened = await openOrder(orgId, { branchId, tableId, channel: "dine_in", guestCount: guests, actor });
          await addOrderItems(
            orgId,
            opened.orderId,
            lines.map((ln) => ({ productId: ln.productId, qtyMilli: ln.qtyMilli })),
            actor,
          );
          const detail = await getOrderDetail(orgId, opened.orderId) as {
            items: { id: string; product_id: string; qty_milli: number; status: string }[];
          };
          const billLines = detail.items
            .filter((it) => it.status !== "cancelled")
            .map((it) => ({
              productId: it.product_id,
              qtyMilli: it.qty_milli,
              orderItemId: it.id,
            }));
          await checkout({
            branchId,
            terminalId,
            orderId: opened.orderId,
            closeOrder: true,
            channel: "in_store",
            guestCount: guests,
            idempotencyKey: `demo-rest-${daysAgo}-${s}`,
            lines: billLines,
            payments: paymentFor(method, total),
            actor: owner,
          });
        });
      } else {
        await withFrozenNow(when, async () => {
          await checkout({
            branchId,
            terminalId,
            channel: random() < 0.5 ? "takeaway" : "counter",
            idempotencyKey: `demo-rest-${daysAgo}-${s}`,
            lines: lines.map((ln) => ({ productId: ln.productId, qtyMilli: ln.qtyMilli })),
            payments: paymentFor(method, total),
            actor: owner,
          });
        });
      }
      salesCount++;
    }
  }
  console.log(`  ${salesCount} vendas (balcão/takeaway + dine-in faturados via pedido) em 14 dias`);
}

/* -------------------------------- main -------------------------------- */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const onlySuper = args.includes("--super-only");
  const onlyRest = args.includes("--rest-only");

  console.log("VANTYX seed:demo — dados de demonstração (demo=1), separados de dados reais.");
  const db = getDb(); // opens + migrates
  const t0 = Date.now();

  if (!onlyRest) {
    if (await orgExists(SUPER_NAME)) {
      console.log(`  "${SUPER_NAME}" já existe — ignorada (script idempotente).`);
    } else {
      await seedSupermarket();
    }
  }
  if (!onlySuper) {
    if (await orgExists(REST_NAME)) {
      console.log(`  "${REST_NAME}" já existe — ignorada (script idempotente).`);
    } else {
      await seedRestaurant();
    }
  }

  const orgs = ((await db.prepare(`SELECT COUNT(*) c FROM organizations WHERE demo = 1`).get()) as { c: number }).c;
  console.log(`Concluído em ${((Date.now() - t0) / 1000).toFixed(1)}s — ${orgs} organização(ões) demo na base de dados.`);
  console.log("Logins demo:");
  console.log(`  Supermercado → demo.super@vantyx.demo / ${DEMO_PASSWORD}  (caixa: demo.caixa@vantyx.demo, PIN supervisor 2468)`);
  console.log(`  Restaurante  → demo.rest@vantyx.demo / ${DEMO_PASSWORD}   (cozinha: demo.chef@…, sala: demo.sala@…)`);
}

try {
  await main();
} catch (err) {
  console.error("Falha no seed demo:", err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
}
