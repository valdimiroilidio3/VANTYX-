import type { Db } from "@/lib/db/client";
import { getOrgProfile } from "@/lib/services/org.service";
import { atInvoiceDate, atSystemEntryDate } from "@/lib/domain/fiscal";

/**
 * Exportador SAF-T (PT) — Portaria n.º 32/2019, schema 1.04_01.
 *
 * Âmbito desta versão: SalesInvoices (FT + NC) com MasterFiles mínimos
 * (Customer, Product, TaxTable) e Header completo. É um ficheiro
 * estruturalmente válido para o validador da AT, mas:
 *  - o NIF/ morada do emitente e os dados do produtor vêm da configuração
 *    (Definições → Fiscal); campos não configurados saem como "Desconhecido"
 *    e devem ser preenchidos antes de submissão legal;
 *  - movimentos de recebimento (Payments) e outras tabelas (4.2/4.4) não
 *    estão incluídos nesta versão;
 *  - o ficheiro deve ser validado no validador oficial da AT antes de
 *    qualquer submissão (ver docs/CERTIFICACAO-AT.md).
 */

const SCHEMA_NS = "urn:OECD:StandardAuditFile-Tax:PT_1.04_01";

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const money = (cents: number): string => (cents / 100).toFixed(2);

/** TaxCode SAF-T por taxa (bps) e região. 0 → isento (ISE). */
function taxCodeFor(region: string, bps: number): "RED" | "INT" | "NOR" | "ISE" {
  if (bps <= 0) return "ISE";
  const tables: Record<string, { red: number[]; int: number[] }> = {
    PT: { red: [600], int: [1300] },
    "PT-AC": { red: [400], int: [900] },
    "PT-MA": { red: [500], int: [1125, 1200] },
  };
  const t = tables[region] ?? tables.PT!;
  if (t.red.includes(bps)) return "RED";
  if (t.int.includes(bps)) return "INT";
  return "NOR";
}

interface SaftOptions {
  /** Início do período (YYYY-MM-DD) */
  from: string;
  /** Fim do período (YYYY-MM-DD) */
  to: string;
}

export interface SaftResult {
  xml: string;
  fileName: string;
  warnings: string[];
}

export function buildSaftPt(db: Db, orgId: string, opts: SaftOptions): SaftResult {
  const profile = getOrgProfile(orgId);
  const settings = profile.settings as Record<string, unknown>;
  const region =
    settings.taxRegion === "PT-AC" || settings.taxRegion === "PT-MA" ? settings.taxRegion : "PT";
  const tz = profile.timezone || "Europe/Lisbon";
  const warnings: string[] = [];

  const org = db
    .prepare(`SELECT name, legal_name, tax_id FROM organizations WHERE id = ?`)
    .get(orgId) as { name: string; legal_name: string | null; tax_id: string | null };

  const issuerTin = org.tax_id?.trim() || "";
  if (!issuerTin) warnings.push("NIF do emitente não configurado — preencha em Definições → Fiscal.");
  const producerTin = String(settings.producerTaxId ?? "").trim() || "999999990";
  const softwareCertificate = settings.certificateNumber
    ? String(settings.certificateNumber)
    : "0"; // 0 = não certificado (SoftwareCertificate SAF-T)

  const fromTs = new Date(`${opts.from}T00:00:00`).getTime();
  const toTs = new Date(`${opts.to}T23:59:59.999`).getTime();

  /* ------------------------------ Documentos ------------------------------ */

  const sales = db
    .prepare(
      `SELECT s.*, c.name AS customer_name, c.tax_id AS customer_tax_id
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.org_id = ? AND s.document_number IS NOT NULL AND s.created_at BETWEEN ? AND ?
       ORDER BY s.document_type, s.sequence_number`,
    )
    .all(orgId, fromTs, toTs) as Record<string, unknown>[];

  const salesLines = db
    .prepare(
      `SELECT sale_id, product_id, name_snapshot, sku_snapshot, qty_milli, unit,
              unit_price_cents, tax_rate_bps, discount_cents, total_cents, tax_cents
       FROM sale_lines WHERE org_id = ? ORDER BY sale_id, sequence`,
    )
    .all(orgId) as Record<string, unknown>[];
  const linesBySale = new Map<string, Record<string, unknown>[]>();
  for (const l of salesLines) {
    const arr = linesBySale.get(String(l.sale_id)) ?? [];
    arr.push(l);
    linesBySale.set(String(l.sale_id), arr);
  }

  const returns = db
    .prepare(
      `SELECT r.*, s.document_number AS origin_document_number, s.created_at AS origin_created_at
       FROM returns r JOIN sales s ON s.id = r.sale_id
       WHERE r.org_id = ? AND r.document_number IS NOT NULL AND r.created_at BETWEEN ? AND ?
       ORDER BY r.sequence_number`,
    )
    .all(orgId, fromTs, toTs) as Record<string, unknown>[];

  const returnLines = db
    .prepare(
      `SELECT return_id, product_id, name_snapshot, qty_milli, unit_price_cents,
              tax_rate_bps, total_cents, tax_cents
       FROM return_lines WHERE org_id = ? ORDER BY return_id`,
    )
    .all(orgId) as Record<string, unknown>[];
  const linesByReturn = new Map<string, Record<string, unknown>[]>();
  for (const l of returnLines) {
    const arr = linesByReturn.get(String(l.return_id)) ?? [];
    arr.push(l);
    linesByReturn.set(String(l.return_id), arr);
  }

  /* ------------------------------ MasterFiles ------------------------------ */

  const UNKNOWN_CUSTOMER = "Desconhecido";
  const usedCustomers = new Map<string, { id: string; name: string; taxId: string }>();
  for (const s of sales) {
    const cid = s.customer_id ? String(s.customer_id) : null;
    if (cid && !usedCustomers.has(cid)) {
      usedCustomers.set(cid, {
        id: cid,
        name: String(s.customer_name ?? "Cliente"),
        taxId: String(s.customer_tax_id ?? "").trim() || "999999990",
      });
    }
  }

  const usedProductIds = new Set<string>();
  for (const l of [...salesLines, ...returnLines]) usedProductIds.add(String(l.product_id));
  const products = usedProductIds.size
    ? (db
        .prepare(
          `SELECT p.id, p.sku, p.name, p.unit, p.base_price_cents, p.tax_rate_bps, p.type,
                  cat.name AS category_name,
                  (SELECT b.code FROM barcodes b WHERE b.product_id = p.id AND b.variant_id IS NULL LIMIT 1) AS barcode
           FROM products p LEFT JOIN categories cat ON cat.id = p.category_id
           WHERE p.org_id = ? AND p.id IN (${[...usedProductIds].map(() => "?").join(",")})`,
        )
        .all(orgId, [...usedProductIds]) as Record<string, unknown>[])
    : [];

  const taxRates = new Map<number, { bps: number; taxable: number; tax: number }>();
  for (const l of [...salesLines, ...returnLines]) {
    const bps = Number(l.tax_rate_bps ?? 0);
    const e = taxRates.get(bps) ?? { bps, taxable: 0, tax: 0 };
    e.taxable += Number(l.total_cents) - Number(l.tax_cents);
    e.tax += Number(l.tax_cents);
    taxRates.set(bps, e);
  }

  /* --------------------------------- XML --------------------------------- */

  const now = Date.now();
  const xml: string[] = [];
  xml.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  xml.push(`<AuditFile xmlns="${SCHEMA_NS}">`);

  // Header
  xml.push(`  <Header>`);
  xml.push(`    <AuditFileVersion>1.04_01</AuditFileVersion>`);
  xml.push(`    <CompanyID>${esc(issuerTin || "Desconhecido")}</CompanyID>`);
  xml.push(`    <TaxRegistrationNumber>${esc(issuerTin || "0")}</TaxRegistrationNumber>`);
  xml.push(`    <AccountNumber>Desconhecido</AccountNumber>`);
  xml.push(`    <CompanyName>${esc(org.name)}</CompanyName>`);
  xml.push(`    <BusinessName>${esc(org.legal_name ?? org.name)}</BusinessName>`);
  xml.push(`    <CompanyAddress>`);
  xml.push(`      <AddressDetail>${esc(String(settings.addressDetail ?? "Desconhecido"))}</AddressDetail>`);
  xml.push(`      <City>${esc(String(settings.addressCity ?? "Desconhecido"))}</City>`);
  xml.push(`      <PostalCode>${esc(String(settings.addressPostalCode ?? "0000-000"))}</PostalCode>`);
  xml.push(`      <Country>${esc(profile.country || "PT")}</Country>`);
  xml.push(`    </CompanyAddress>`);
  xml.push(`    <FiscalYear>${new Date(fromTs).getFullYear()}</FiscalYear>`);
  xml.push(`    <StartDate>${esc(opts.from)}</StartDate>`);
  xml.push(`    <EndDate>${esc(opts.to)}</EndDate>`);
  xml.push(`    <CurrencyCode>${esc(profile.currency)}</CurrencyCode>`);
  xml.push(`    <DateCreated>${esc(atSystemEntryDate(now, tz))}</DateCreated>`);
  xml.push(`    <TaxEntity>Global</TaxEntity>`);
  xml.push(`    <ProductCompanyTaxID>${esc(producerTin)}</ProductCompanyTaxID>`);
  xml.push(`    <SoftwareCertificate>${esc(softwareCertificate)}</SoftwareCertificate>`);
  xml.push(`    <ProductID>VANTYX/${esc(String(settings.producerName ?? "VANTYX"))}</ProductID>`);
  xml.push(`    <ProductVersion>${esc(String(settings.productVersion ?? "0.1.0"))}</ProductVersion>`);
  xml.push(`  </Header>`);

  // MasterFiles
  xml.push(`  <MasterFiles>`);
  // Customer — "Desconhecido" obrigatório quando há vendas sem cliente
  xml.push(`    <Customer>`);
  xml.push(`      <CustomerID>${UNKNOWN_CUSTOMER}</CustomerID>`);
  xml.push(`      <AccountID>${UNKNOWN_CUSTOMER}</AccountID>`);
  xml.push(`      <CustomerTaxID>999999990</CustomerTaxID>`);
  xml.push(`      <CompanyName>Consumidor Final</CompanyName>`);
  xml.push(`      <BillingAddress><AddressDetail>Desconhecido</AddressDetail><City>Desconhecido</City><PostalCode>Desconhecido</PostalCode><Country>PT</Country></BillingAddress>`);
  xml.push(`      <SelfBillingIndicator>0</SelfBillingIndicator>`);
  xml.push(`    </Customer>`);
  for (const c of usedCustomers.values()) {
    xml.push(`    <Customer>`);
    xml.push(`      <CustomerID>${esc(c.id)}</CustomerID>`);
    xml.push(`      <AccountID>${esc(c.id)}</AccountID>`);
    xml.push(`      <CustomerTaxID>${esc(c.taxId)}</CustomerTaxID>`);
    xml.push(`      <CompanyName>${esc(c.name)}</CompanyName>`);
    xml.push(`      <BillingAddress><AddressDetail>Desconhecido</AddressDetail><City>Desconhecido</City><PostalCode>Desconhecido</PostalCode><Country>PT</Country></BillingAddress>`);
    xml.push(`      <SelfBillingIndicator>0</SelfBillingIndicator>`);
    xml.push(`    </Customer>`);
  }
  // Product
  for (const p of products) {
    const unitPriceGross = Number(p.base_price_cents ?? 0);
    const bps = Number(p.tax_rate_bps ?? 0);
    const unitPriceNet = bps > 0 ? Math.round((unitPriceGross * 10000) / (10000 + bps)) : unitPriceGross;
    xml.push(`    <Product>`);
    xml.push(`      <ProductType>${p.type === "service" ? "S" : "P"}</ProductType>`);
    xml.push(`      <ProductCode>${esc(p.sku)}</ProductCode>`);
    xml.push(`      <ProductGroup>${esc(p.category_name ?? "Genérico")}</ProductGroup>`);
    xml.push(`      <ProductDescription>${esc(p.name)}</ProductDescription>`);
    xml.push(`      <ProductNumberCode>${esc(p.barcode ?? p.sku)}</ProductNumberCode>`);
    xml.push(`      <UnitOfMeasure>${esc(p.unit)}</UnitOfMeasure>`);
    xml.push(`      <UnitPrice>${money(unitPriceNet)}</UnitPrice>`);
    xml.push(`      <TaxPayable>0.00</TaxPayable>`);
    xml.push(`      <ProductPrice>${money(unitPriceGross)}</ProductPrice>`);
    xml.push(`    </Product>`);
  }
  // TaxTable
  xml.push(`    <TaxTable>`);
  const sortedRates = [...taxRates.values()].sort((a, b) => a.bps - b.bps);
  for (const r of sortedRates) {
    const code = taxCodeFor(region, r.bps);
    xml.push(`      <TaxTableEntry>`);
    xml.push(`        <TaxType>IVA</TaxType>`);
    xml.push(`        <TaxCountryRegion>${esc(region)}</TaxCountryRegion>`);
    xml.push(`        <TaxCode>${code}</TaxCode>`);
    xml.push(`        <Description>${code === "ISE" ? "Isento" : `IVA ${region} ${(r.bps / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`}</Description>`);
    xml.push(`        <TaxPercentage>${(r.bps / 100).toFixed(2)}</TaxPercentage>`);
    if (code === "ISE") xml.push(`        <TaxExemptionReason>M99 - Outros motivos de isenção (configurar por produto)</TaxExemptionReason>`);
    xml.push(`      </TaxTableEntry>`);
  }
  xml.push(`    </TaxTable>`);
  xml.push(`  </MasterFiles>`);

  // SourceDocuments / SalesInvoices
  const allDocs = [
    ...sales.map((s) => ({ kind: "FT" as const, row: s })),
    ...returns.map((r) => ({ kind: "NC" as const, row: r })),
  ];
  let totalCredit = 0;
  for (const d of allDocs) totalCredit += Number(d.row.total_cents ?? 0);

  xml.push(`  <SourceDocuments>`);
  xml.push(`    <SalesInvoices>`);
  xml.push(`      <NumberOfEntries>${allDocs.length}</NumberOfEntries>`);
  xml.push(`      <TotalDebit>0.00</TotalDebit>`);
  xml.push(`      <TotalCredit>${money(totalCredit)}</TotalCredit>`);

  for (const d of allDocs) {
    const row = d.row;
    const ts = Number(row.created_at);
    const gross = Number(row.total_cents ?? 0);
    const tax = Number(row.tax_cents ?? 0);
    const status = String(row.status ?? "completed");
    const invoiceStatus = d.kind === "NC" ? "N" : status === "void" ? "A" : "N";
    const lines = d.kind === "NC"
      ? linesByReturn.get(String(row.id)) ?? []
      : linesBySale.get(String(row.id)) ?? [];

    xml.push(`      <Invoice>`);
    xml.push(`        <InvoiceNo>${esc(row.document_number)}</InvoiceNo>`);
    if (row.atcud) xml.push(`        <ATCUD>${esc(row.atcud)}</ATCUD>`);
    xml.push(`        <DocumentStatus>`);
    xml.push(`          <InvoiceStatus>${invoiceStatus}</InvoiceStatus>`);
    xml.push(`          <InvoiceStatusDate>${esc(atSystemEntryDate(Number(row.voided_at ?? ts), tz))}</InvoiceStatusDate>`);
    if (invoiceStatus === "A") xml.push(`          <Reason>${esc(row.void_reason ?? "Anulação")}</Reason>`);
    xml.push(`          <SourceBilling>P</SourceBilling>`);
    xml.push(`        </DocumentStatus>`);
    xml.push(`        <Hash>${esc(row.hash ?? "")}</Hash>`);
    const hashControl = row.hash_control
      ? String(row.hash_control)
      : softwareCertificate !== "0"
        ? `${softwareCertificate}.1`
        : "0";
    xml.push(`        <HashControl>${esc(hashControl)}</HashControl>`);
    xml.push(`        <Period><Month>${new Date(ts).getMonth() + 1}</Month><Year>${new Date(ts).getFullYear()}</Year></Period>`);
    xml.push(`        <InvoiceDate>${esc(atInvoiceDate(ts, tz))}</InvoiceDate>`);
    xml.push(`        <InvoiceType>${d.kind === "NC" ? "NC" : "FT"}</InvoiceType>`);
    if (d.kind === "NC" && row.origin_document_number) {
      xml.push(`        <References>`);
      xml.push(`          <Reference>`);
      xml.push(`            <OriginatingON>${esc(row.origin_document_number)}</OriginatingON>`);
      xml.push(`            <InvoiceDate>${esc(atInvoiceDate(Number(row.origin_created_at), tz))}</InvoiceDate>`);
      xml.push(`          </Reference>`);
      xml.push(`        </References>`);
    }
    xml.push(`        <CustomerID>${row.customer_id ? esc(row.customer_id) : UNKNOWN_CUSTOMER}</CustomerID>`);

    for (const l of lines) {
      const lineTotal = Number(l.total_cents ?? 0);
      const lineTax = Number(l.tax_cents ?? 0);
      const net = lineTotal - lineTax;
      const bps = Number(l.tax_rate_bps ?? 0);
      const code = taxCodeFor(region, bps);
      xml.push(`        <Line>`);
      xml.push(`          <ProductCode>${esc(l.sku_snapshot ?? String(l.product_id ?? ""))}</ProductCode>`);
      xml.push(`          <ProductDescription>${esc(l.name_snapshot ?? "Serviço")}</ProductDescription>`);
      xml.push(`          <Quantity>${(Number(l.qty_milli ?? 0) / 1000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}</Quantity>`);
      xml.push(`          <UnitOfMeasure>${esc(l.unit ?? "un")}</UnitOfMeasure>`);
      xml.push(`          <UnitPrice>${money(lineTotal ? Math.round((net * 1000000) / Math.max(1, Number(l.qty_milli ?? 1000)) ) / 1000 : 0)}</UnitPrice>`);
      xml.push(`          <TaxPointDate>${esc(atInvoiceDate(ts, tz))}</TaxPointDate>`);
      xml.push(`          <Description>${esc(l.name_snapshot ?? "")}</Description>`);
      xml.push(`          <DebitAmount>${d.kind === "NC" ? "0.00" : money(net)}</DebitAmount>`);
      xml.push(`          <CreditAmount>${d.kind === "NC" ? money(net) : "0.00"}</CreditAmount>`);
      xml.push(`          <Tax>`);
      xml.push(`            <TaxType>IVA</TaxType>`);
      xml.push(`            <TaxCountryRegion>${esc(region)}</TaxCountryRegion>`);
      xml.push(`            <TaxCode>${code}</TaxCode>`);
      xml.push(`            <TaxPercentage>${(bps / 100).toFixed(2)}</TaxPercentage>`);
      xml.push(`          </Tax>`);
      xml.push(`        </Line>`);
    }

    xml.push(`        <DocumentTotals>`);
    xml.push(`          <TaxPayable>${money(tax)}</TaxPayable>`);
    xml.push(`          <NetTotal>${money(gross - tax)}</NetTotal>`);
    xml.push(`          <GrossTotal>${money(gross)}</GrossTotal>`);
    xml.push(`        </DocumentTotals>`);
    xml.push(`      </Invoice>`);
  }

  xml.push(`    </SalesInvoices>`);
  xml.push(`  </SourceDocuments>`);
  xml.push(`</AuditFile>`);

  const nifFile = issuerTin || "SEM-NIF";
  return {
    xml: xml.join("\n"),
    fileName: `saft-PT_${nifFile}_${opts.from}_${opts.to}.xml`,
    warnings,
  };
}
