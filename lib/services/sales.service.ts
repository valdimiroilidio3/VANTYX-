import { getDb, tx, type Db } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { sha256 } from "@/lib/auth/password";
import {
  calculateSale,
  computeChange,
  discountBpsOfSale,
  type PriceLineInput,
} from "@/lib/domain/pricing";
import {
  atGrossTotal,
  atHash,
  atHashControl,
  atHashPrintable,
  atInvoiceDate,
  atSystemEntryDate,
  buildAtcud,
  buildQrString,
  formatDocumentNumber,
  qrRegionTotals,
} from "@/lib/domain/fiscal";
import {
  evaluateRules,
  resolveDecisions,
  type BusinessRule,
  type RuleContext,
} from "@/lib/domain/rules-engine";
import { ApiError, badRequest, conflict, notFound } from "@/lib/auth/context";
import { emitDomainEvent } from "@/lib/domain/events";
import { writeAudit } from "./audit.service";
import { getOrgProfile, type OrgSettings } from "./org.service";
import {
  applyStockDelta,
  assertStockAvailable,
  consumeBatchesFEFO,
  type PendingEvent,
} from "./inventory.service";
import { resolveActivePromotion } from "./catalog.service";
import { loginWithPin } from "./session.service";

/**
 * Sales service — checkout, holds, returns, voids and document control.
 *
 * Guarantees:
 *  - ONE transaction per sale; stock can never be deducted twice for the
 *    same request (idempotency key + client-ref unique index).
 *  - Prices are re-read server-side; client-sent prices are ignored unless
 *    an explicit price override (permission-checked) is declared.
 *  - Documents are sequentially numbered per series/fiscal year and hash-
 *    chained (integrity model; certification is jurisdiction-specific).
 *  - Business rules (discount caps, approvals) are enforced server-side.
 */

export interface CheckoutLineInput {
  productId: string;
  variantId?: string | null;
  qtyMilli: number;
  /** Client-sent price; only honored with an explicit override flag. */
  unitPriceCents?: number;
  priceOverride?: boolean;
  discountCents?: number;
  discountReason?: string;
  modifiers?: { name: string; priceCents: number }[];
  notes?: string;
  serialNumbers?: string[];
  /** Restaurant split-bill: links the sale line to an order item. */
  orderItemId?: string | null;
}

export interface CheckoutPaymentInput {
  methodKey: string;
  amountCents: number;
  tenderedCents?: number;
  status?: "pending" | "confirmed";
  terminalRef?: string;
}

export interface CheckoutInput {
  branchId: string;
  terminalId?: string | null;
  cashSessionId?: string | null;
  customerId?: string | null;
  channel?: "in_store" | "takeaway" | "delivery" | "counter" | "online";
  orderId?: string | null; // restaurant order being billed
  /** false = split bill: only referenced order items are billed. */
  closeOrder?: boolean;
  clientRef?: string | null; // client-generated id (offline dedupe)
  idempotencyKey?: string | null;
  lines: CheckoutLineInput[];
  orderDiscountCents?: number;
  payments: CheckoutPaymentInput[];
  loyaltyRedeemPoints?: number;
  loyaltyEarn?: boolean;
  notes?: string;
  guestCount?: number;
  /** Supervisor override for approval-required operations (PIN). */
  supervisor?: { userId: string; pin: string } | null;
  actor: { userId: string; label: string; roleKey: string };
}

export interface CheckoutResult {
  saleId: string;
  documentNumber: string | null;
  totalCents: number;
  changeCents: number;
  status: string;
  loyaltyEarned: number;
  replayed: boolean;
  approvalRequired?: {
    kind: string;
    reason: string;
    approvalId: string;
  };
}

interface ProductSnapshot {
  id: string;
  name: string;
  sku: string;
  unit: string;
  sale_mode: string;
  track_stock: number;
  track_batches: number;
  track_serials: number;
  allow_negative: number | null;
  status: string;
  base_price_cents: number;
  cost_cents: number;
  tax_rate_bps: number;
}

interface VariantSnapshot {
  id: string;
  label: string;
  sku: string;
  price_cents: number | null;
  cost_cents: number | null;
  tax_rate_bps: number | null;
}

/* ------------------------- Idempotency ---------------------------- */

async function findIdempotentResponse(
  db: Db,
  orgId: string,
  endpoint: string,
  key: string | null | undefined,
): Promise<CheckoutResult | null> {
  if (!key) return null;
  const row = (await db
    .prepare(
      `SELECT response FROM idempotency_keys WHERE org_id = ? AND endpoint = ? AND key = ?`,
    )
    .get(orgId, endpoint, key)) as { response: string } | undefined;
  return row ? (JSON.parse(row.response) as CheckoutResult) : null;
}

async function storeIdempotentResponse(
  db: Db,
  orgId: string,
  endpoint: string,
  key: string,
  requestHash: string,
  result: CheckoutResult,
): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO idempotency_keys (org_id, endpoint, key, request_hash, status_code, response, created_at)
     VALUES (?, ?, ?, ?, 200, ?, ?)`,
  ).run(orgId, endpoint, key, requestHash, JSON.stringify(result), Date.now());
}

/* ------------------------ Document control ------------------------- */

async function nextDocumentNumber(
  db: Db,
  orgId: string,
  docType: string,
  fiscalYear: number,
): Promise<{ seriesId: string; sequence: number; documentNumber: string; atcudValidationCode: string | null }> {
  let series = (await db
    .prepare(
      `SELECT * FROM document_series WHERE org_id = ? AND doc_type = ? AND fiscal_year = ?`,
    )
    .get(orgId, docType, fiscalYear)) as
    | { id: string; prefix: string; next_number: number; atcud_validation_code: string | null }
    | undefined;
  if (!series) {
    const id = newId("dser");
    await db.prepare(
      `INSERT INTO document_series (id, org_id, doc_type, prefix, fiscal_year, next_number)
       VALUES (?, ?, ?, 'VD', ?, 1)`,
    ).run(id, orgId, docType, fiscalYear);
    series = { id, prefix: "VD", next_number: 1, atcud_validation_code: null };
  }
  const sequence = series.next_number;
  await db.prepare(`UPDATE document_series SET next_number = ? WHERE id = ?`).run(
    sequence + 1,
    series.id,
  );
  return {
    seriesId: series.id,
    sequence,
    documentNumber: formatDocumentNumber(docType, series.prefix, sequence),
    /** Código de validação ATCUD atribuído pela AT à série (null = por comunicar). */
    atcudValidationCode: series.atcud_validation_code ?? null,
  };
}

/**
 * Hash do documento anterior da MESMA série e exercício (Portaria 363/2010,
 * art. 6.º; Despacho 8632/2014): a cadeia segue a numeração sequencial do
 * documento, não o relógio. Null no primeiro documento da série/exercício.
 */
async function lastChainHash(db: Db, orgId: string, docType: string, fiscalYear: number): Promise<string | null> {
  const row = (await db
    .prepare(
      `SELECT hash FROM sales WHERE org_id = ? AND document_type = ? AND fiscal_year = ? AND hash IS NOT NULL
       ORDER BY sequence_number DESC, rowid DESC LIMIT 1`,
    )
    .get(orgId, docType, fiscalYear)) as { hash: string } | undefined;
  return row?.hash ?? null;
}

/** Cadeia das notas de crédito (tabela returns), por exercício. */
async function lastReturnChainHash(db: Db, orgId: string, fiscalYear: number): Promise<string | null> {
  const row = (await db
    .prepare(
      `SELECT hash FROM returns WHERE org_id = ? AND fiscal_year = ? AND hash IS NOT NULL
       ORDER BY sequence_number DESC, rowid DESC LIMIT 1`,
    )
    .get(orgId, fiscalYear)) as { hash: string } | undefined;
  return row?.hash ?? null;
}

/* --------------------------- Rules -------------------------------- */

export async function loadEnabledRules(db: Db, orgId: string): Promise<BusinessRule[]> {
  const rows = (await db
    .prepare(`SELECT * FROM business_rules WHERE org_id = ? AND enabled = 1`)
    .all(orgId)) as {
    id: string;
    key: string;
    name: string;
    scope: string;
    condition: string;
    action: string;
    priority: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    scope: JSON.parse(r.scope) as BusinessRule["scope"],
    condition: JSON.parse(r.condition) as BusinessRule["condition"],
    action: JSON.parse(r.action) as BusinessRule["action"],
    priority: r.priority,
    enabled: true,
  }));
}

async function logRuleExecution(
  db: Db,
  orgId: string,
  ruleId: string,
  result: string,
  ctx: RuleContext,
  refType: string,
  refId: string | null,
  executedBy: string,
  detail?: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO rule_executions (id, org_id, rule_id, context, result, detail, ref_type, ref_id, executed_by, executed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("rex"), orgId, ruleId, JSON.stringify(ctx), result, detail ?? null,
    refType, refId, executedBy, Date.now(),
  );
}

/* --------------------------- Checkout ------------------------------ */

type RuleAbort =
  | { kind: "blocked"; reason: string; ruleIds: string[]; ctx: RuleContext }
  | {
      kind: "approval";
      approvalId: string;
      ruleId: string;
      approvalKind: string;
      reason: string | undefined;
      ctx: RuleContext;
      params: Record<string, unknown>;
    };

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const db = getDb();
  const orgId = await currentOrgId(input.actor.userId);
  const endpoint = "pos.checkout";

  // 1. Idempotency (replay protection) — before any work.
  const cached = await findIdempotentResponse(db, orgId, endpoint, input.idempotencyKey);
  if (cached) return { ...cached, replayed: true };

  // 2. Offline dedupe by client ref.
  if (input.clientRef) {
    const existing = (await db
      .prepare(`SELECT id FROM sales WHERE org_id = ? AND client_ref = ?`)
      .get(orgId, input.clientRef)) as { id: string } | undefined;
    if (existing) {
      const sale = (await getSaleById(db, orgId, existing.id))!;
      return {
        saleId: sale.id,
        documentNumber: sale.document_number,
        totalCents: sale.total_cents,
        changeCents: sale.change_cents,
        status: sale.status,
        loyaltyEarned: sale.loyalty_earned,
        replayed: true,
      };
    }
  }

  if (!input.lines.length) badRequest("Venda sem linhas.");
  const profile = await getOrgProfile(orgId);
  const settings = profile.settings;

  let result!: CheckoutResult;
  const pendingEvents: PendingEvent[] = [];

  /**
   * Rule rejections must persist their trace (approval request / audit) even
   * though the sale transaction aborts. Throwing inside the tx would roll the
   * inserts back, so we record the abort here and write the trace after the
   * rollback completes.
   */
  let ruleAbort: RuleAbort | null = null as RuleAbort | null;

  await tx(db, async () => {
    const now = Date.now();
    const fiscalYear = new Date(now).getFullYear();

    /* ---- Resolve lines server-side ---- */
    const priceInputs: PriceLineInput[] = [];
    const lineMeta: {
      input: CheckoutLineInput;
      product: ProductSnapshot;
      variant: VariantSnapshot | null;
      unitPriceCents: number;
      costCents: number;
      promotionId?: string;
      modifiersCents: number;
    }[] = [];

    for (const line of input.lines) {
      if (!Number.isInteger(line.qtyMilli) || line.qtyMilli <= 0) {
        badRequest("Quantidade inválida numa linha.");
      }
      const product = (await db
        .prepare(`SELECT * FROM products WHERE id = ? AND org_id = ?`)
        .get(line.productId, orgId)) as ProductSnapshot | undefined;
      if (!product) notFound(`Produto ${line.productId}`);
      if (product!.status === "archived") {
        conflict(`Produto "${product!.name}" está arquivado.`);
      }
      let variant: VariantSnapshot | null = null;
      if (line.variantId) {
        variant =
          ((await db
            .prepare(`SELECT * FROM product_variants WHERE id = ? AND product_id = ? AND org_id = ?`)
            .get(line.variantId, product!.id, orgId)) as VariantSnapshot | undefined) ?? null;
        if (!variant) notFound("Variante");
      }

      // Price: server-side source of truth
      let unitPriceCents = variant?.price_cents ?? product!.base_price_cents;
      const costCents = variant?.cost_cents ?? product!.cost_cents;
      const taxRateBps = variant?.tax_rate_bps ?? product!.tax_rate_bps;

      // Period-price promotions override the unit price
      const promo = await resolveActivePromotion(db, orgId, product!.id, variant?.id ?? null, now);
      if (promo?.periodPriceCents != null) {
        unitPriceCents = promo.periodPriceCents;
      }
      // Explicit price override (permission enforced at API layer)
      if (line.priceOverride && line.unitPriceCents != null) {
        unitPriceCents = Math.max(0, line.unitPriceCents);
      } else if (line.unitPriceCents != null && line.unitPriceCents !== unitPriceCents) {
        // Client price disagreement without override → server price wins.
      }

      const modifiersCents = (line.modifiers ?? []).reduce(
        (acc, m) => acc + Math.max(0, m.priceCents),
        0,
      );

      lineMeta.push({
        input: line,
        product: product!,
        variant,
        unitPriceCents,
        costCents,
        promotionId: promo?.quantity?.id ?? promo?.periodPromotionId,
        modifiersCents,
      });

      priceInputs.push({
        id: `${product!.id}:${variant?.id ?? "-"}:${priceInputs.length}`,
        qtyMilli: line.qtyMilli,
        unitPriceCents,
        taxRateBps,
        discountCents: Math.max(0, line.discountCents ?? 0),
        discountReason: line.discountReason,
        promotion: promo?.quantity
          ? {
              id: promo.quantity.id,
              minQtyMilli: promo.quantity.minQtyMilli,
              discountBps: promo.quantity.discountBps,
            }
          : null,
        modifierCents: modifiersCents,
      });
    }

    /* ---- Loyalty redemption as an order-level discount ---- */
    let loyaltyRedeemed = 0;
    let loyaltyDiscountCents = 0;
    let loyaltyAccount: { id: string; points_balance: number } | null = null;
    if (input.loyaltyRedeemPoints && input.loyaltyRedeemPoints > 0) {
      if (!input.customerId) badRequest("Resgate de pontos exige cliente.");
      loyaltyAccount = (await db
        .prepare(`SELECT id, points_balance FROM loyalty_accounts WHERE org_id = ? AND customer_id = ?`)
        .get(orgId, input.customerId)) as { id: string; points_balance: number } | null;
      if (!loyaltyAccount) badRequest("Cliente sem conta de fidelização.");
      loyaltyRedeemed = Math.min(input.loyaltyRedeemPoints, loyaltyAccount!.points_balance);
      const loyaltyCfg = (settings.loyalty ?? { pointValueCents: 1 }) as { pointValueCents: number };
      loyaltyDiscountCents = loyaltyRedeemed * (loyaltyCfg.pointValueCents ?? 1);
    }

    /* ---- Pricing ---- */
    const pricing = calculateSale(
      priceInputs,
      { pricesIncludeTax: profile.pricesIncludeTax },
      Math.max(0, input.orderDiscountCents ?? 0) + loyaltyDiscountCents,
    );

    /* ---- Business rules (server-side enforcement) ---- */
    const rules = await loadEnabledRules(db, orgId);
    const maxLineDiscountBps = Math.max(
      0,
      ...priceInputs.map((p) =>
        discountBpsOfSale(
          p.qtyMilli * p.unitPriceCents / 1000 + (p.modifierCents ?? 0),
          p.discountCents ?? 0,
        ),
      ),
    );
    const ruleCtx: RuleContext = {
      "sale.total_cents": pricing.totalCents,
      "sale.discount_bps": discountBpsOfSale(pricing.subtotalCents, pricing.discountCents),
      "sale.line_discount_bps": maxLineDiscountBps,
      "sale.channel": input.channel ?? "in_store",
      "sale.items_count": input.lines.length,
      "user.role": input.actor.roleKey,
      "user.id": input.actor.userId,
      "terminal.id": input.terminalId ?? "",
      "branch.id": input.branchId,
      "hour_of_day": new Date(now).getHours(),
    };
    const decisions = evaluateRules(rules, ruleCtx, {
      branchId: input.branchId,
      terminalId: input.terminalId ?? undefined,
      roleKey: input.actor.roleKey,
      channel: input.channel,
    });
    const resolution = resolveDecisions(decisions);

    // Supervisor override clears approval requirements (logged).
    let supervisorId: string | null = null;
    if (resolution.approval && input.supervisor) {
      if (!await loginWithPin(input.supervisor.userId, input.supervisor.pin)) {
        conflict("PIN de supervisor inválido.");
      }
      const supervisor = (await db
        .prepare(`SELECT id, name FROM users WHERE id = ? AND org_id = ? AND status='active'`)
        .get(input.supervisor.userId, orgId)) as { id: string; name: string } | undefined;
      if (!supervisor) notFound("Supervisor");
      supervisorId = supervisor!.id;
    }

    if (resolution.blocked) {
      ruleAbort = {
        kind: "blocked",
        reason: resolution.blocked.reason,
        ruleIds: decisions.filter((x) => x.type === "block").map((x) => (x as { ruleId: string }).ruleId),
        ctx: ruleCtx,
      };
      return; // aborta a transação; o rasto é persistido após o rollback
    }
    if (resolution.approval && !supervisorId) {
      ruleAbort = {
        kind: "approval",
        approvalId: newId("appr"),
        ruleId: resolution.approval.ruleId,
        approvalKind: resolution.approval.kind,
        reason: resolution.approval.reason,
        ctx: ruleCtx,
        params: {
          totalCents: pricing.totalCents,
          discountCents: pricing.discountCents,
          lines: input.lines.length,
          reason: resolution.approval.reason,
        },
      };
      return; // aborta a transação; o pedido de aprovação é persistido a seguir
    }
    if (resolution.approval && supervisorId) {
      await logRuleExecution(db, orgId, resolution.approval.ruleId, "allowed", ruleCtx, "sale", null, supervisorId, "Supervisor override via PIN");
    }
    if (resolution.discountCapBps != null) {
      const actual = discountBpsOfSale(pricing.subtotalCents, pricing.discountCents - loyaltyDiscountCents);
      if (actual > resolution.discountCapBps && !supervisorId) {
        throw new ApiError(
          422,
          `Desconto de ${(actual / 100).toFixed(1)}% excede o limite de ${(resolution.discountCapBps / 100).toFixed(1)}%. Reduza o desconto ou obtenha aprovação de supervisor.`,
          "discount_cap_exceeded",
        );
      }
    }

    /* ---- Payments ---- */
    const methods = (await db
      .prepare(`SELECT * FROM payment_methods WHERE org_id = ? AND enabled = 1`)
      .all(orgId)) as { key: string; kind: string; is_cash: number }[];
    const methodByKey = new Map(methods.map((m) => [m.key, m]));
    let paidConfirmed = 0;
    let changeCents = 0;
    for (const payment of input.payments) {
      const method = methodByKey.get(payment.methodKey);
      if (!method) badRequest(`Método de pagamento desconhecido: ${payment.methodKey}`);
      if (payment.amountCents <= 0 && !(method!.kind === "cash" && payment.tenderedCents)) {
        badRequest("Pagamento com valor inválido.");
      }
      if (payment.status === "pending") {
        conflict(
          `Pagamento ${payment.methodKey} pendente de confirmação do fornecedor — vendas com pagamentos não confirmados não podem ser concluídas (integridade: confirmação local não equivale a confirmação real).`,
        );
      }
      paidConfirmed += payment.amountCents;
      if (method!.kind === "cash" && payment.tenderedCents != null) {
        changeCents += computeChange(payment.tenderedCents, payment.amountCents);
      }
    }
    const dueCents = pricing.totalCents;
    if (paidConfirmed < dueCents) {
      conflict(`Pagamento insuficiente: devido ${dueCents}, recebido ${paidConfirmed}.`);
    }

    /* ---- Cash session requirement ---- */
    const usesCash = input.payments.some((p) => methodByKey.get(p.methodKey)?.is_cash === 1);
    let cashSessionId = input.cashSessionId ?? null;
    if (usesCash) {
      if (!cashSessionId) {
        const open = (await db
          .prepare(
            `SELECT id FROM cash_sessions WHERE org_id = ? AND branch_id = ? AND status = 'open'
             ${input.terminalId ? "AND terminal_id = ?" : ""}
             ORDER BY opened_at DESC LIMIT 1`,
          )
          .get(...(input.terminalId ? [orgId, input.branchId, input.terminalId] : [orgId, input.branchId]))) as { id: string } | undefined;
        cashSessionId = open?.id ?? null;
      }
      if (!cashSessionId) {
        conflict("Nenhuma sessão de caixa aberta neste terminal. Abra a sessão de caixa antes de vender em dinheiro.");
      }
      const session = (await db.prepare(`SELECT status FROM cash_sessions WHERE id = ? AND org_id = ?`).get(cashSessionId!, orgId)) as { status: string } | undefined;
      if (!session || session.status !== "open") conflict("Sessão de caixa inválida ou fechada.");
    }

    /* ---- Stock ---- */
    const warehouse = (await db
      .prepare(`SELECT id FROM warehouses WHERE org_id = ? AND branch_id = ? AND is_default = 1 LIMIT 1`)
      .get(orgId, input.branchId)) as { id: string } | undefined
      ?? ((await db.prepare(`SELECT id FROM warehouses WHERE org_id = ? AND is_default = 1 LIMIT 1`).get(orgId)) as { id: string } | undefined);
    if (!warehouse) conflict("Organização sem armazém configurado.");

    const stockChecks = lineMeta.map((meta) => ({
      meta,
      needsStock: meta.product.track_stock === 1,
    }));
    for (const check of stockChecks) {
      if (!check.needsStock) continue;
      const lineInput = check.meta.input;
      await assertStockAvailable(
        db, orgId, warehouse!.id, check.meta.product.id,
        check.meta.variant?.id ?? null, lineInput.qtyMilli, settings,
        check.meta.product.allow_negative,
      );
    }

    /* ---- Document (numeração + assinatura AT) ---- */
    const doc = await nextDocumentNumber(db, orgId, "FT", fiscalYear);
    const prevHash = await lastChainHash(db, orgId, "FT", fiscalYear);
    const saleId = newId("sale");
    const timeZone = profile.timezone || "Europe/Lisbon";
    const docHash = atHash({
      invoiceDate: atInvoiceDate(now, timeZone),
      systemEntryDate: atSystemEntryDate(now, timeZone),
      invoiceNo: doc.documentNumber,
      grossTotal: atGrossTotal(pricing.totalCents),
      prevHash,
    });
    const hashControl = atHashControl(
      (settings as Record<string, unknown>).certificateNumber as string | undefined,
    );
    const atcud = buildAtcud(doc.atcudValidationCode, doc.sequence);

    /* ---- Persist sale ---- */
    const costCentsTotal = lineMeta.reduce(
      (acc, m, i) => acc + Math.round((m.costCents * priceInputs[i]!.qtyMilli) / 1000),
      0,
    );

    await db.prepare(
      `INSERT INTO sales
        (id, org_id, branch_id, terminal_id, cash_session_id, customer_id, order_id,
         client_ref, idempotency_key, document_type, document_number, sequence_number,
         fiscal_year, status, channel, currency, subtotal_cents, discount_cents, tax_cents,
         net_cents, total_cents, paid_cents, change_cents, cost_cents, tax_breakdown,
         loyalty_earned, loyalty_redeemed, guest_count, notes, hash, prev_hash,
         hash_control, atcud, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'FT', ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      saleId, orgId, input.branchId, input.terminalId ?? null, cashSessionId,
      input.customerId ?? null, input.orderId ?? null, input.clientRef ?? null,
      input.idempotencyKey ?? null, doc.documentNumber, doc.sequence, fiscalYear,
      input.channel ?? "in_store", profile.currency, pricing.subtotalCents,
      pricing.discountCents, pricing.taxCents, pricing.netCents, pricing.totalCents,
      paidConfirmed, changeCents, costCentsTotal, JSON.stringify(pricing.taxBreakdown),
      0, loyaltyRedeemed, input.guestCount ?? null, input.notes ?? null,
      docHash, prevHash, hashControl, atcud, input.actor.userId, now,
    );

    const insertLine = db.prepare(
      `INSERT INTO sale_lines
        (id, org_id, sale_id, sequence, product_id, variant_id, name_snapshot, sku_snapshot,
         qty_milli, unit, sale_mode, unit_price_cents, tax_rate_bps, discount_cents,
         discount_reason, gross_cents, net_cents, tax_cents, total_cents, cost_cents,
         promotion_id, modifiers, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    lineMeta.forEach(async (meta, i) => {
      const priced = pricing.lines[i]!;
      const lineDiscount =
        priced.lineDiscountCents + priced.promoDiscountCents + priced.orderDiscountCents;
      await insertLine.run(
        newId("sl"), orgId, saleId, i + 1, meta.product.id, meta.variant?.id ?? null,
        meta.product.name, meta.variant?.sku ?? meta.product.sku,
        meta.input.qtyMilli, meta.product.unit, meta.product.sale_mode,
        meta.unitPriceCents, priced.taxRateBps, lineDiscount,
        meta.input.discountReason ?? null, priced.grossCents + lineDiscount,
        priced.netCents, priced.taxCents, priced.totalCents,
        Math.round((meta.costCents * meta.input.qtyMilli) / 1000),
        priced.promotionId ?? null, JSON.stringify(meta.input.modifiers ?? []),
        meta.input.notes ?? null,
      );
    });

    const insertPayment = db.prepare(
      `INSERT INTO sale_payments
        (id, org_id, sale_id, method_key, amount_cents, tendered_cents, change_cents,
         status, terminal_ref, created_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)`,
    );
    for (const payment of input.payments) {
      const method = methodByKey.get(payment.methodKey)!;
      const change =
        method.kind === "cash" && payment.tenderedCents != null
          ? computeChange(payment.tenderedCents, payment.amountCents)
          : 0;
      await insertPayment.run(
        newId("sp"), orgId, saleId, payment.methodKey, payment.amountCents,
        payment.tenderedCents ?? null, change, payment.terminalRef ?? null, now, now,
      );
      if (method.kind === "gift_card") {
        // Deduct from card balance (terminalRef carries the card code)
        const card = (await db.prepare(`SELECT * FROM gift_cards WHERE org_id = ? AND code = ?`).get(orgId, payment.terminalRef ?? "")) as { id: string; balance_cents: number; status: string } | undefined;
        if (!card) conflict("Cartão-presente inválido.");
        if (card!.balance_cents < payment.amountCents) conflict("Saldo insuficiente no cartão-presente.");
        await db.prepare(`UPDATE gift_cards SET balance_cents = balance_cents - ?, status = CASE WHEN balance_cents - ? <= 0 THEN 'depleted' ELSE status END WHERE id = ?`)
          .run(payment.amountCents, payment.amountCents, card!.id);
        await db.prepare(`INSERT INTO gift_card_transactions (id, org_id, card_id, delta_cents, ref_type, ref_id, created_at) VALUES (?, ?, ?, ?, 'sale', ?, ?)`)
          .run(newId("gctx"), orgId, card!.id, -payment.amountCents, saleId, now);
      }
      if (method.kind === "customer_credit") {
        if (!input.customerId) badRequest("Conta corrente exige cliente.");
        const customer = (await db.prepare(`SELECT credit_limit_cents, credit_balance_cents FROM customers WHERE id = ? AND org_id = ?`).get(input.customerId, orgId)) as { credit_limit_cents: number; credit_balance_cents: number } | undefined;
        if (!customer) notFound("Cliente");
        if (customer!.credit_balance_cents + payment.amountCents > customer!.credit_limit_cents) {
          conflict("Limite de crédito do cliente excedido.");
        }
        await db.prepare(`UPDATE customers SET credit_balance_cents = credit_balance_cents + ?, updated_at = ? WHERE id = ?`)
          .run(payment.amountCents, now, input.customerId);
      }
    }

    /* ---- Stock deduction (after sale row exists, same tx) ---- */
    if (warehouse) {
      for (const meta of lineMeta) {
        if (meta.product.track_stock !== 1) continue;
        const delta = await applyStockDelta(db, {
          orgId,
          warehouseId: warehouse.id,
          productId: meta.product.id,
          variantId: meta.variant?.id ?? null,
          qtyMilli: -meta.input.qtyMilli,
          reason: "sale",
          refType: "sale",
          refId: saleId,
          unitCostCents: meta.costCents,
          createdBy: input.actor.userId,
        });
        pendingEvents.push(...(delta.events as PendingEvent[]));
        if (meta.product.track_batches === 1) {
          await consumeBatchesFEFO(db, {
            orgId, warehouseId: warehouse.id, productId: meta.product.id,
            variantId: meta.variant?.id ?? null, qtyMilli: meta.input.qtyMilli,
          });
        }
        if (meta.product.track_serials === 1 && meta.input.serialNumbers?.length) {
          for (const serial of meta.input.serialNumbers) {
            await db.prepare(
              `UPDATE serials SET status = 'sold', sale_id = ?, warehouse_id = NULL WHERE org_id = ? AND serial_number = ?`,
            ).run(saleId, orgId, serial);
          }
        }
      }
    }

    /* ---- Loyalty ---- */
    let loyaltyEarned = 0;
    const loyaltyCfg = (settings.loyalty ?? { enabled: false, pointsPerEuro: 1, pointValueCents: 1 }) as {
      enabled: boolean;
      pointsPerEuro: number;
      pointValueCents: number;
    };
    if (input.customerId) {
      if (loyaltyRedeemed > 0 && loyaltyAccount) {
        await db.prepare(`UPDATE loyalty_accounts SET points_balance = points_balance - ? WHERE id = ?`)
          .run(loyaltyRedeemed, loyaltyAccount.id);
        await db.prepare(
          `INSERT INTO loyalty_transactions (id, org_id, account_id, delta_points, reason, ref_type, ref_id, created_at)
           VALUES (?, ?, ?, ?, 'redeem', 'sale', ?, ?)`,
        ).run(newId("loytx"), orgId, loyaltyAccount.id, -loyaltyRedeemed, saleId, now);
      }
      if (loyaltyCfg.enabled && input.loyaltyEarn !== false) {
        loyaltyEarned = Math.floor((pricing.netCents / 100) * (loyaltyCfg.pointsPerEuro ?? 1));
        if (loyaltyEarned > 0) {
          let account = (await db.prepare(`SELECT id FROM loyalty_accounts WHERE org_id = ? AND customer_id = ?`).get(orgId, input.customerId)) as { id: string } | undefined;
          if (!account) {
            const accountId = newId("loy");
            await db.prepare(`INSERT INTO loyalty_accounts (id, org_id, customer_id, points_balance, tier, created_at) VALUES (?, ?, ?, 0, 'base', ?)`)
              .run(accountId, orgId, input.customerId, now);
            account = { id: accountId };
          }
          await db.prepare(`UPDATE loyalty_accounts SET points_balance = points_balance + ? WHERE id = ?`).run(loyaltyEarned, account.id);
          await db.prepare(
            `INSERT INTO loyalty_transactions (id, org_id, account_id, delta_points, reason, ref_type, ref_id, created_at)
             VALUES (?, ?, ?, ?, 'earn', 'sale', ?, ?)`,
          ).run(newId("loytx"), orgId, account.id, loyaltyEarned, saleId, now);
          await db.prepare(`UPDATE sales SET loyalty_earned = ? WHERE id = ?`).run(loyaltyEarned, saleId);
        }
      }
    }

    /* ---- Restaurant order closing / split bill ---- */
    if (input.orderId) {
      if (input.closeOrder === false) {
        // Split bill: mark only the billed order items
        for (const meta of lineMeta) {
          if (meta.input.orderItemId) {
            await db.prepare(
              `UPDATE r_order_items SET status = 'billed' WHERE id = ? AND order_id = ? AND org_id = ?`,
            ).run(meta.input.orderItemId, input.orderId, orgId);
          }
        }
        const remaining = (await db.prepare(
          `SELECT COUNT(*) c FROM r_order_items WHERE order_id = ? AND org_id = ? AND status NOT IN ('cancelled','billed')`,
        ).get(input.orderId, orgId)) as { c: number };
        if (remaining.c === 0) {
          await db.prepare(`UPDATE r_orders SET status = 'closed', closed_at = ?, sale_id = ? WHERE id = ? AND org_id = ?`)
            .run(now, saleId, input.orderId, orgId);
          const table = (await db.prepare(`SELECT table_id FROM r_orders WHERE id = ?`).get(input.orderId)) as { table_id: string | null } | undefined;
          if (table?.table_id) {
            await db.prepare(`UPDATE r_tables SET status = 'free' WHERE id = ?`).run(table.table_id);
          }
        }
      } else {
        await db.prepare(`UPDATE r_orders SET status = 'closed', closed_at = ?, sale_id = ? WHERE id = ? AND org_id = ?`)
          .run(now, saleId, input.orderId, orgId);
        await db.prepare(`UPDATE r_order_items SET status = 'billed' WHERE order_id = ? AND org_id = ? AND status != 'cancelled'`)
          .run(input.orderId, orgId);
        const table = (await db.prepare(`SELECT table_id FROM r_orders WHERE id = ?`).get(input.orderId)) as { table_id: string | null } | undefined;
        if (table?.table_id) {
          await db.prepare(`UPDATE r_tables SET status = 'free' WHERE id = ?`).run(table.table_id);
        }
      }
    }

    /* ---- Audit + idempotency record ---- */
    await writeAudit(
      {
        orgId, actorUserId: input.actor.userId, actorLabel: input.actor.label,
        action: "sale.create", resourceType: "sale", resourceId: saleId,
        branchId: input.branchId,
        after: {
          documentNumber: doc.documentNumber,
          totalCents: pricing.totalCents,
          lines: input.lines.length,
          channel: input.channel ?? "in_store",
          supervisorId,
        },
      },
      db,
    );

    result = {
      saleId,
      documentNumber: doc.documentNumber,
      totalCents: pricing.totalCents,
      changeCents,
      status: "completed",
      loyaltyEarned,
      replayed: false,
    };

    if (input.idempotencyKey) {
      await storeIdempotentResponse(
        db, orgId, endpoint, input.idempotencyKey,
        sha256(JSON.stringify({ lines: input.lines.length, total: pricing.totalCents })),
        result,
      );
    }
  });

  /* ---- Rule rejection: persist the trace AFTER the sale tx rolled back ---- */
  if (ruleAbort) {
    const abort = ruleAbort;
    await tx(db, async () => {
      if (abort.kind === "blocked") {
        for (const ruleId of abort.ruleIds) {
          await logRuleExecution(db, orgId, ruleId, "blocked", abort.ctx, "sale", null, input.actor.userId, abort.reason);
        }
        await writeAudit(
          {
            orgId, actorUserId: input.actor.userId, actorLabel: input.actor.label,
            action: "sale.blocked_by_rule", resourceType: "sale", result: "failure",
            detail: abort.reason,
          },
          db,
        );
      } else {
        await db.prepare(
          `INSERT INTO approvals (id, org_id, kind, ref_type, params, status, requested_by, created_at)
           VALUES (?, ?, ?, 'sale_pending', ?, 'pending', ?, ?)`,
        ).run(abort.approvalId, orgId, abort.approvalKind, JSON.stringify(abort.params), input.actor.userId, Date.now());
        await logRuleExecution(db, orgId, abort.ruleId, "approval_required", abort.ctx, "approval", abort.approvalId, input.actor.userId, abort.reason);
      }
    });
    if (abort.kind === "blocked") {
      throw new ApiError(422, abort.reason, "rule_blocked");
    }
    throw new ApiError(428, abort.reason ?? "Operação exige aprovação.", "approval_required", {
      approvalId: abort.approvalId,
      kind: abort.approvalKind,
    });
  }

  /* ---- Emit events after commit ---- */
  emitAfterCommit(orgId, result.saleId, input.branchId, result.totalCents, input.actor.userId, input.channel ?? "in_store");
  for (const pending of pendingEvents) {
    emitInventoryEvent(pending);
  }
  return result;
}

async function emitAfterCommit(
  orgId: string,
  saleId: string,
  branchId: string,
  totalCents: number,
  createdBy: string,
  channel: string,
): Promise<void> {
  await emitDomainEvent("sale.completed", { orgId, saleId, branchId, totalCents, createdBy, channel });
}

async function emitInventoryEvent(pending: PendingEvent): Promise<void> {
  if (pending.event === "stock.below_min") {
    await emitDomainEvent("stock.below_min", pending.payload as never);
  } else if (pending.event === "stock.negative") {
    await emitDomainEvent("stock.negative", pending.payload as never);
  }
}

async function currentOrgId(userId: string): Promise<string> {
  const row = (await getDb().prepare(`SELECT org_id FROM users WHERE id = ?`).get(userId)) as { org_id: string } | undefined;
  if (!row) notFound("Utilizador");
  return row!.org_id;
}

/* ------------------------- Held sales ------------------------------ */

export async function holdSale(
  orgId: string,
  data: {
    branchId: string;
    terminalId?: string | null;
    userId: string;
    customerId?: string | null;
    label?: string;
    cart: unknown;
  },
): Promise<string> {
  const db = getDb();
  const id = newId("held");
  await db.prepare(
    `INSERT INTO held_sales (id, org_id, branch_id, terminal_id, user_id, customer_id, label, cart, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, orgId, data.branchId, data.terminalId ?? null, data.userId, data.customerId ?? null, data.label ?? null, JSON.stringify(data.cart), Date.now(), Date.now());
  return id;
}

export async function listHeldSales(orgId: string, branchId?: string) {
  const db = getDb();
  return (await db
    .prepare(
      `SELECT h.*, u.name as user_name FROM held_sales h
       LEFT JOIN users u ON u.id = h.user_id
       WHERE h.org_id = ? ${branchId ? "AND h.branch_id = ?" : ""}
       ORDER BY h.updated_at DESC`,
    )
    .all(...(branchId ? [orgId, branchId] : [orgId]))) as HeldSaleRow[];
}

export interface HeldSaleRow {
  id: string;
  org_id: string;
  branch_id: string;
  terminal_id: string | null;
  user_id: string | null;
  user_name?: string | null;
  customer_id: string | null;
  label: string | null;
  cart: string;
  created_at: number;
  updated_at: number;
}

export async function resumeHeldSale(orgId: string, heldId: string): Promise<{ cart: unknown; customerId: string | null }> {
  const db = getDb();
  const row = (await db.prepare(`SELECT * FROM held_sales WHERE id = ? AND org_id = ?`).get(heldId, orgId)) as HeldSaleRow | undefined;
  if (!row) notFound("Venda suspensa");
  // Resume removes the hold (cart goes back to the terminal).
  await db.prepare(`DELETE FROM held_sales WHERE id = ?`).run(heldId);
  return { cart: JSON.parse(row!.cart), customerId: row!.customer_id };
}

export async function deleteHeldSale(orgId: string, heldId: string): Promise<void> {
  await getDb().prepare(`DELETE FROM held_sales WHERE id = ? AND org_id = ?`).run(heldId, orgId);
}

/* --------------------------- Queries ------------------------------- */

interface SaleRow {
  id: string;
  document_number: string | null;
  status: string;
  total_cents: number;
  change_cents: number;
  loyalty_earned: number;
}

async function getSaleById(db: Db, orgId: string, saleId: string): Promise<SaleRow | null> {
  return (
    ((await db.prepare(`SELECT id, document_number, status, total_cents, change_cents, loyalty_earned FROM sales WHERE id = ? AND org_id = ?`).get(saleId, orgId)) as SaleRow | undefined) ?? null
  );
}

export async function listSales(
  orgId: string,
  opts: {
    branchId?: string;
    customerId?: string;
    status?: string;
    from?: number;
    to?: number;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ rows: SaleListRow[]; total: number }> {
  const db = getDb();
  const where: string[] = ["s.org_id = ?"];
  const params: (string | number)[] = [orgId];
  if (opts.branchId) { where.push("s.branch_id = ?"); params.push(opts.branchId); }
  if (opts.customerId) { where.push("s.customer_id = ?"); params.push(opts.customerId); }
  if (opts.status) { where.push("s.status = ?"); params.push(opts.status); }
  if (opts.from) { where.push("s.created_at >= ?"); params.push(opts.from); }
  if (opts.to) { where.push("s.created_at <= ?"); params.push(opts.to); }
  if (opts.search) {
    where.push("(s.document_number LIKE ? OR c.name LIKE ?)");
    params.push(`%${opts.search}%`, `%${opts.search}%`);
  }
  const limit = Math.min(opts.limit ?? 25, 200);
  const offset = opts.offset ?? 0;
  const rows = (await db
    .prepare(
      `SELECT s.*, c.name as customer_name, u.name as cashier_name, b.name as branch_name,
              (SELECT COUNT(*) FROM sale_lines sl WHERE sl.sale_id = s.id) as line_count,
              (SELECT COUNT(*) FROM returns r WHERE r.sale_id = s.id) as return_count
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.created_by
       LEFT JOIN branches b ON b.id = s.branch_id
       WHERE ${where.join(" AND ")}
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)) as SaleListRow[];
  const total = ((await db.prepare(`SELECT COUNT(*) c FROM sales s LEFT JOIN customers c2 ON c2.id = s.customer_id WHERE ${where.join(" AND ").replace(/\bc\.name\b/g, "c2.name")}`).get(...params)) as { c: number }).c;
  return { rows, total };
}

export interface SaleListRow {
  id: string;
  document_number: string | null;
  status: string;
  channel: string;
  branch_id: string;
  branch_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  cashier_name: string | null;
  total_cents: number;
  discount_cents: number;
  tax_cents: number;
  net_cents: number;
  paid_cents: number;
  change_cents: number;
  line_count: number;
  return_count: number;
  created_at: number;
  created_by: string;
}

export async function getSaleDetail(orgId: string, saleId: string) {
  const db = getDb();
  const sale = await db.prepare(
    `SELECT s.*, c.name as customer_name, c.tax_id as customer_tax_id, u.name as cashier_name,
            b.name as branch_name, t.name as terminal_name
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN users u ON u.id = s.created_by
     LEFT JOIN branches b ON b.id = s.branch_id
     LEFT JOIN terminals t ON t.id = s.terminal_id
     WHERE s.id = ? AND s.org_id = ?`,
  ).get(saleId, orgId);
  if (!sale) notFound("Venda");
  const lines = await db.prepare(
    `SELECT sl.*, p.name as product_name, v.label as variant_label
     FROM sale_lines sl
     LEFT JOIN products p ON p.id = sl.product_id
     LEFT JOIN product_variants v ON v.id = sl.variant_id
     WHERE sl.sale_id = ? ORDER BY sl.sequence`,
  ).all(saleId);
  const payments = await db.prepare(`SELECT * FROM sale_payments WHERE sale_id = ?`).all(saleId);
  const returns = await db.prepare(
    `SELECT r.*, rl.qty_milli as returned_qty FROM returns r LEFT JOIN return_lines rl ON rl.return_id = r.id WHERE r.sale_id = ?`,
  ).all(saleId);
  const org = await db.prepare(`SELECT name, legal_name, tax_id FROM organizations WHERE id = ?`).get(orgId);
  return { sale, lines, payments, returns, org };
}

/* ---------------------------- Returns ------------------------------ */

export interface ReturnInput {
  orgId: string;
  saleId: string;
  lines: { saleLineId: string; qtyMilli: number; restock?: boolean }[];
  reasonCode: string;
  note?: string;
  restock: boolean;
  warehouseId?: string | null;
  payments: { methodKey: string; amountCents: number }[];
  actor: { userId: string; label: string };
}

export async function createReturn(input: ReturnInput): Promise<{ returnId: string; documentNumber: string; totalCents: number }> {
  const db = getDb();
  if (!input.lines.length) badRequest("Devolução sem linhas.");
  let out!: { returnId: string; documentNumber: string; totalCents: number };
  await tx(db, async () => {
    const now = Date.now();
    const sale = (await db.prepare(`SELECT * FROM sales WHERE id = ? AND org_id = ?`).get(input.saleId, input.orgId)) as SaleFullRow | undefined;
    if (!sale) notFound("Venda");
    if (sale!.status === "void") conflict("Venda já anulada.");
    if (sale!.status === "returned") conflict("Venda já totalmente devolvida.");

    const fiscalYear = new Date(now).getFullYear();
    const doc = await nextDocumentNumber(db, input.orgId, "NC", fiscalYear);

    let subtotalCents = 0;
    let taxCents = 0;
    const resolvedLines: {
      line: SaleLineRow;
      qtyMilli: number;
      totalCents: number;
      taxCents: number;
      restock: boolean;
    }[] = [];

    for (const rl of input.lines) {
      const line = (await db.prepare(`SELECT * FROM sale_lines WHERE id = ? AND sale_id = ? AND org_id = ?`).get(rl.saleLineId, input.saleId, input.orgId)) as SaleLineRow | undefined;
      if (!line) notFound("Linha de venda");
      const alreadyReturned = line!.returned_milli;
      const returnable = line!.qty_milli - alreadyReturned;
      if (rl.qtyMilli <= 0 || rl.qtyMilli > returnable) {
        badRequest(`Quantidade a devolver inválida para "${line!.name_snapshot}" (máx. ${returnable / 1000}).`);
      }
      // Proportional refund from the recorded line values (integer math)
      const lineTotal = Math.round((line!.total_cents * rl.qtyMilli) / line!.qty_milli);
      const lineTax = Math.round((line!.tax_cents * rl.qtyMilli) / line!.qty_milli);
      subtotalCents += lineTotal - lineTax;
      taxCents += lineTax;
      resolvedLines.push({ line: line!, qtyMilli: rl.qtyMilli, totalCents: lineTotal, taxCents: lineTax, restock: rl.restock ?? input.restock });
    }

    const totalCents = resolvedLines.reduce((a, l) => a + l.totalCents, 0);

    // Refund payments must match the refund total
    const refundTotal = input.payments.reduce((a, p) => a + p.amountCents, 0);
    if (refundTotal !== totalCents) {
      badRequest(`Reembolso (${refundTotal}) não corresponde ao total devolvido (${totalCents}).`);
    }

    const returnId = newId("ret");
    // A NC encadeia com a NC anterior da mesma série/exercício (não com a venda).
    const prevHash = await lastReturnChainHash(db, input.orgId, fiscalYear);
    const profile = await getOrgProfile(input.orgId);
    const timeZone = profile.timezone || "Europe/Lisbon";
    const docHash = atHash({
      invoiceDate: atInvoiceDate(now, timeZone),
      systemEntryDate: atSystemEntryDate(now, timeZone),
      invoiceNo: doc.documentNumber,
      grossTotal: atGrossTotal(totalCents),
      prevHash,
    });
    const hashControl = atHashControl(
      (profile.settings as Record<string, unknown>).certificateNumber as string | undefined,
    );
    const atcud = buildAtcud(doc.atcudValidationCode, doc.sequence);

    await db.prepare(
      `INSERT INTO returns
        (id, org_id, sale_id, document_number, sequence_number, fiscal_year, status,
         reason_code, restock, warehouse_id, note, subtotal_cents, tax_cents, total_cents,
         prev_hash, hash, hash_control, atcud, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      returnId, input.orgId, input.saleId, doc.documentNumber, doc.sequence, fiscalYear,
      input.reasonCode, input.restock ? 1 : 0, input.warehouseId ?? null,
      input.note ?? null, subtotalCents, taxCents, totalCents, prevHash, docHash,
      hashControl, atcud, input.actor.userId, now,
    );

    const insertRl = db.prepare(
      `INSERT INTO return_lines (id, org_id, return_id, sale_line_id, qty_milli, unit_price_cents, tax_rate_bps, total_cents, tax_cents, restock)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertRp = db.prepare(
      `INSERT INTO return_payments (id, org_id, return_id, method_key, amount_cents)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const rl of resolvedLines) {
      await insertRl.run(newId("rl"), input.orgId, returnId, rl.line.id, rl.qtyMilli, rl.line.unit_price_cents, rl.line.tax_rate_bps, rl.totalCents, rl.taxCents, rl.restock ? 1 : 0);
      await db.prepare(`UPDATE sale_lines SET returned_milli = returned_milli + ? WHERE id = ?`).run(rl.qtyMilli, rl.line.id);

      if (rl.restock) {
        const warehouseId =
          input.warehouseId ??
          ((await db.prepare(`SELECT id FROM warehouses WHERE org_id = ? AND is_default = 1 LIMIT 1`).get(input.orgId)) as { id: string } | undefined)?.id;
        if (warehouseId) {
          await applyStockDelta(db, {
            orgId: input.orgId,
            warehouseId,
            productId: rl.line.product_id,
            variantId: rl.line.variant_id,
            qtyMilli: rl.qtyMilli,
            reason: "sale_return",
            refType: "return",
            refId: returnId,
            createdBy: input.actor.userId,
            note: `Devolução ${doc.documentNumber}`,
          });
        }
      }
    }
    for (const payment of input.payments) {
      await insertRp.run(newId("rp"), input.orgId, returnId, payment.methodKey, payment.amountCents);
      if (payment.methodKey === "gift_card") {
        // refund back onto card requires card code — not supported via generic refunds
      }
    }

    // Sale status
    const fullyReturned = (await db.prepare(
      `SELECT COALESCE(SUM(returned_milli),0) returned, (SELECT COALESCE(SUM(qty_milli),0) FROM sale_lines WHERE sale_id = ?) total
       FROM sale_lines WHERE sale_id = ?`,
    ).get(input.saleId, input.saleId)) as { returned: number; total: number };
    const newStatus = fullyReturned.returned >= fullyReturned.total ? "returned" : "partially_returned";
    await db.prepare(`UPDATE sales SET status = ? WHERE id = ?`).run(newStatus, input.saleId);

    // Loyalty clawback (clamp at zero, recorded as adjustment)
    if (sale!.loyalty_earned > 0 && sale!.customer_id) {
      const account = (await db.prepare(`SELECT * FROM loyalty_accounts WHERE org_id = ? AND customer_id = ?`).get(input.orgId, sale!.customer_id)) as { id: string; points_balance: number } | undefined;
      if (account) {
        const claw = Math.min(account.points_balance, sale!.loyalty_earned);
        if (claw > 0) {
          await db.prepare(`UPDATE loyalty_accounts SET points_balance = points_balance - ? WHERE id = ?`).run(claw, account.id);
          await db.prepare(
            `INSERT INTO loyalty_transactions (id, org_id, account_id, delta_points, reason, ref_type, ref_id, note, created_at)
             VALUES (?, ?, ?, ?, 'adjust', 'return', ?, 'Clawback por devolução', ?)`,
          ).run(newId("loytx"), input.orgId, account.id, -claw, returnId, now);
        }
      }
    }

    await writeAudit(
      {
        orgId: input.orgId, actorUserId: input.actor.userId, actorLabel: input.actor.label,
        action: "sale.return", resourceType: "return", resourceId: returnId,
        after: { saleId: input.saleId, documentNumber: doc.documentNumber, totalCents, reasonCode: input.reasonCode },
      },
      db,
    );

    out = { returnId, documentNumber: doc.documentNumber, totalCents };
  });

  await emitDomainEvent("sale.returned", {
    orgId: input.orgId,
    returnId: out.returnId,
    saleId: input.saleId,
    totalCents: out.totalCents,
  });
  return out;
}

interface SaleFullRow {
  id: string;
  status: string;
  hash: string | null;
  customer_id: string | null;
  loyalty_earned: number;
  total_cents: number;
  branch_id: string;
}

interface SaleLineRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  name_snapshot: string;
  qty_milli: number;
  returned_milli: number;
  unit_price_cents: number;
  tax_rate_bps: number;
  total_cents: number;
  tax_cents: number;
}

/**
 * Anulação de venda: fiscal-safe — issues a full credit note (NC) and
 * marks the sale void. Documents are never silently deleted or edited.
 */
export async function voidSale(
  orgId: string,
  saleId: string,
  reason: string,
  actor: { userId: string; label: string },
): Promise<{ documentNumber: string }> {
  if (!reason?.trim()) badRequest("Motivo de anulação é obrigatório.");
  const db = getDb();
  const sale = (await db.prepare(`SELECT * FROM sales WHERE id = ? AND org_id = ?`).get(saleId, orgId)) as SaleFullRow | undefined;
  if (!sale) notFound("Venda");
  if (sale!.status === "void") conflict("Venda já anulada.");
  if (sale!.status === "returned") conflict("Venda já devolvida — não pode ser anulada.");

  const lines = (await db.prepare(`SELECT id, qty_milli, returned_milli FROM sale_lines WHERE sale_id = ?`).all(saleId)) as { id: string; qty_milli: number; returned_milli: number }[];
  const returnLines = lines
    .filter((l) => l.qty_milli - l.returned_milli > 0)
    .map((l) => ({ saleLineId: l.id, qtyMilli: l.qty_milli - l.returned_milli, restock: true }));

  // Mirror the original payments as the refund plan (money goes back
  // through the same methods; cash refunds happen at the terminal).
  // For partially-returned sales, payments are scaled to the remaining
  // refundable total so the credit note always balances exactly.
  const originalPayments = (await db
    .prepare(`SELECT method_key, amount_cents FROM sale_payments WHERE sale_id = ? AND status = 'confirmed'`)
    .all(saleId)) as { method_key: string; amount_cents: number }[];
  const refundableTotal = await (async () => {
    const rows = (await db
      .prepare(`SELECT qty_milli, returned_milli, total_cents FROM sale_lines WHERE sale_id = ?`)
      .all(saleId)) as { qty_milli: number; returned_milli: number; total_cents: number }[];
    return rows.reduce(
      (acc, l) => acc + Math.round((l.total_cents * (l.qty_milli - l.returned_milli)) / l.qty_milli),
      0,
    );
  })();
  const originalPaid = originalPayments.reduce((a, p) => a + p.amount_cents, 0);
  const scaledPayments = originalPayments.map((p, i) => {
    const scaled =
      i === originalPayments.length - 1
        ? refundableTotal -
          originalPayments
            .slice(0, i)
            .reduce((a, q) => a + Math.round((q.amount_cents * refundableTotal) / Math.max(1, originalPaid)), 0)
        : Math.round((p.amount_cents * refundableTotal) / Math.max(1, originalPaid));
    return { methodKey: p.method_key, amountCents: Math.max(0, scaled) };
  }).filter((p) => p.amountCents > 0);

  const result = await createReturn({
    orgId,
    saleId,
    lines: returnLines,
    reasonCode: "void",
    note: `Anulação: ${reason}`,
    restock: true,
    payments: scaledPayments,
    actor,
  });

  await tx(db, async () => {
    await db.prepare(`UPDATE sales SET status = 'void', void_reason = ?, voided_by = ?, voided_at = ? WHERE id = ?`)
      .run(reason, actor.userId, Date.now(), saleId);
    await writeAudit(
      {
        orgId, actorUserId: actor.userId, actorLabel: actor.label,
        action: "sale.void", resourceType: "sale", resourceId: saleId,
        after: { reason, creditNote: result.documentNumber },
      },
      db,
    );
  });

  await emitDomainEvent("sale.voided", { orgId, saleId, reason, by: actor.userId });
  return { documentNumber: result.documentNumber };
}

/** Receipt view-model for (re)printing — reprint is permission-gated. */
export async function receiptViewModel(orgId: string, saleId: string) {
  const detail = await getSaleDetail(orgId, saleId);
  const profile = await getOrgProfile(orgId);
  const sale = detail.sale as Record<string, unknown> & {
    document_number: string | null;
    document_type: string | null;
    created_at: number;
    total_cents: number;
    tax_cents: number;
    status: string;
    hash_control: string | null;
    atcud: string | null;
    customer_tax_id: string | null;
  };
  const settings = profile.settings as OrgSettings & {
    receiptHeader?: string; receiptFooter?: string;
    taxRegion?: string; certificateNumber?: string;
  };

  /* QR Code (Portaria 195/2020) — só emitido com dados reais: NIF do emitente
   * configurado e documento assinado. Nunca inventamos ATCUD nem certificado. */
  const issuerTin = String((detail.org as { tax_id: string | null }).tax_id ?? "").trim();
  const region =
    settings.taxRegion === "PT-AC" || settings.taxRegion === "PT-MA" ? settings.taxRegion : "PT";
  const breakdown = JSON.parse(String(sale.tax_breakdown ?? "{}")) as Record<
    string, { taxableCents: number; taxCents: number }
  >;
  const qrString =
    issuerTin && sale.hash && sale.document_number
      ? buildQrString({
          issuerTin,
          customerTin: sale.customer_tax_id ? String(sale.customer_tax_id).trim() : null,
          customerCountry: "PT",
          invoiceType: String(sale.document_type ?? "FT"),
          invoiceStatus: sale.status === "void" ? "A" : "N",
          documentTs: sale.created_at,
          timeZone: profile.timezone || "Europe/Lisbon",
          invoiceNo: String(sale.document_number),
          atcud: sale.atcud ?? null,
          regions: { [region]: qrRegionTotals(region, breakdown) },
          totalTaxesCents: sale.tax_cents,
          grossTotalCents: sale.total_cents,
          hashB64: String(sale.hash),
          certificateNumber: settings.certificateNumber ?? null,
        })
      : null;

  const fiscalNotice =
    profile.country !== "PT"
      ? undefined
      : settings.certificateNumber
        ? `Processado por programa certificado n.º ${settings.certificateNumber}/AT.`
        : "Documento processado por programa AINDA NÃO certificado pela AT (conformidade técnica Portaria 363/2010 implementada; candidatura pendente — ver docs/CERTIFICACAO-AT.md).";
  return {
    orgName: (detail.org as { name: string }).name,
    orgTaxId: (detail.org as { tax_id: string | null }).tax_id,
    header: settings.receiptHeader ?? null,
    footer: settings.receiptFooter ?? "Obrigado pela sua visita.",
    documentNumber: sale.document_number,
    date: new Date(sale.created_at).toISOString(),
    lines: (detail.lines as Record<string, unknown>[]).map((l) => ({
      name: String(l.product_name ?? l.name_snapshot),
      variant: l.variant_label ? String(l.variant_label) : null,
      qty: Number(l.qty_milli) / 1000,
      unit: String(l.unit),
      unitPrice: Number(l.unit_price_cents),
      total: Number(l.total_cents),
    })),
    totals: {
      subtotal: Number(sale.subtotal_cents),
      discount: Number(sale.discount_cents),
      tax: Number(sale.tax_cents),
      total: Number(sale.total_cents),
      paid: Number(sale.paid_cents),
      change: Number(sale.change_cents),
    },
    taxBreakdown: JSON.parse(String(sale.tax_breakdown ?? "{}")) as Record<string, unknown>,
    payments: (detail.payments as Record<string, unknown>[]).map((p) => ({
      method: String(p.method_key),
      amount: Number(p.amount_cents),
    })),
    hash: String(sale.hash ?? ""),
    hash4: sale.hash ? atHashPrintable(String(sale.hash)) : "",
    hashControl: sale.hash_control ?? null,
    atcud: sale.atcud ?? null,
    qr: qrString,
    certified: Boolean(settings.certificateNumber),
    currency: profile.currency,
    status: sale.status,
    fiscalNotice: fiscalNotice,
  };
}
