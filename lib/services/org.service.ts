import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { hashSecret } from "@/lib/auth/password";
import {
  ROLE_TEMPLATES,
  type Permission,
} from "@/lib/domain/permissions";
import {
  getIndustry,
  isIndustryKey,
  type IndustryDefinition,
  type IndustryKey,
} from "@/lib/modules/industries";
import {
  dependencyClosure,
  getModule,
} from "@/lib/modules/registry";
import { ApiError, badRequest } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";

/* ---------------------------- Types ---------------------------- */

export interface OrgSettings {
  stockPolicy?: "block_negative" | "allow_negative" | "warn_negative";
  barcodeEmbeddedPrefixes?: string[];
  barcodeEmbeddedMode?: "price" | "weight";
  weighingEnabled?: boolean;
  cycleCounting?: boolean;
  expiryAlertDays?: number;
  fastCheckout?: boolean;
  kitchenStations?: string[];
  tableService?: boolean;
  modifiersEnabled?: boolean;
  splitBill?: boolean;
  theoreticalConsumption?: boolean;
  shiftTracking?: boolean;
  returnWindowDays?: number;
  loyalty?: { enabled: boolean; pointsPerEuro: number; pointValueCents: number };
  receiptFooter?: string;
  receiptHeader?: string;
  [key: string]: unknown;
}

export interface OrgProfileView {
  orgId: string;
  orgName: string;
  legalName: string | null;
  taxId: string | null;
  demo: boolean;
  industry: IndustryKey;
  industryLabel: string;
  subIndustry: string | null;
  country: string;
  currency: string;
  locale: string;
  timezone: string;
  taxRegime: string;
  pricesIncludeTax: boolean;
  defaultTaxBps: number;
  settings: OrgSettings;
  onboardedAt: number | null;
  posMode: "retail" | "hospitality";
}

/* ------------------------- Bootstrap --------------------------- */

export interface CreateOrganizationInput {
  name: string;
  legalName?: string;
  taxId?: string;
  industry: string;
  subIndustry?: string;
  country?: string;
  currency?: string;
  locale?: string;
  timezone?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
  branchName?: string;
  demo?: boolean;
}

export interface CreateOrganizationResult {
  orgId: string;
  ownerUserId: string;
  branchId: string;
  warehouseId: string;
  terminalId: string;
  enabledModules: string[];
}

/**
 * Creates the organization and generates its initial configuration from
 * the chosen industry: roles, owner, default branch/warehouse/terminal,
 * modules, payment methods, document series and business rules.
 * Everything happens in ONE transaction (all-or-nothing bootstrap).
 */
export function createOrganization(
  input: CreateOrganizationInput,
  actor?: { userId: string; label: string },
): CreateOrganizationResult {
  if (!input.name?.trim()) badRequest("Nome da organização é obrigatório.");
  if (!input.ownerEmail?.includes("@")) badRequest("Email do proprietário inválido.");
  if (!isIndustryKey(input.industry)) badRequest(`Setor desconhecido: ${input.industry}`);
  const industry: IndustryDefinition = getIndustry(input.industry)!;

  const db = getDb();
  const now = Date.now();
  const orgId = newId("org");
  const branchId = newId("br");
  const warehouseId = newId("wh");
  const terminalId = newId("trm");
  const ownerUserId = newId("usr");

  const duplicate = db
    .prepare(`SELECT id FROM organizations WHERE lower(name) = lower(?)`)
    .get(input.name.trim());
  if (duplicate) throw new ApiError(409, "Já existe uma organização com este nome.", "duplicate_org");

  tx(db, () => {
    db.prepare(
      `INSERT INTO organizations (id, name, legal_name, tax_id, status, demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).run(
      orgId,
      input.name.trim(),
      input.legalName ?? null,
      input.taxId ?? null,
      input.demo ? 1 : 0,
      now,
      now,
    );

    db.prepare(
      `INSERT INTO org_profiles
        (org_id, industry, sub_industry, country, currency, locale, timezone,
         tax_regime, prices_include_tax, default_tax_bps, settings, onboarded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'standard', 1, 2300, ?, NULL, ?)`,
    ).run(
      orgId,
      industry.key,
      input.subIndustry ?? industry.subtypes[0]?.key ?? null,
      input.country ?? "PT",
      input.currency ?? "EUR",
      input.locale ?? "pt-PT",
      input.timezone ?? "Europe/Lisbon",
      JSON.stringify(industry.defaultSettings),
      now,
    );

    // System roles for this org
    const ownerRoleId = newId("role");
    for (const template of ROLE_TEMPLATES) {
      const roleId = template.key === "owner" ? ownerRoleId : newId("role");
      db.prepare(
        `INSERT INTO roles (id, org_id, key, name, description, is_system, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
      ).run(roleId, orgId, template.key, template.name, template.description, now);
      const stmt = db.prepare(
        `INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)`,
      );
      for (const p of template.permissions as Permission[]) {
        stmt.run(roleId, p);
      }
    }

    db.prepare(
      `INSERT INTO users (id, org_id, email, name, password_hash, role_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      ownerUserId,
      orgId,
      input.ownerEmail.trim().toLowerCase(),
      input.ownerName.trim(),
      hashSecret(input.ownerPassword),
      ownerRoleId,
      now,
      now,
    );

    db.prepare(
      `INSERT INTO branches (id, org_id, name, code, is_default, status, created_at)
       VALUES (?, ?, ?, '01', 1, 'active', ?)`,
    ).run(branchId, orgId, input.branchName?.trim() || "Loja Principal", now);

    db.prepare(
      `INSERT INTO warehouses (id, org_id, branch_id, name, code, is_default, created_at)
       VALUES (?, ?, ?, 'Armazém Principal', 'WH01', 1, ?)`,
    ).run(warehouseId, orgId, branchId, now);

    db.prepare(
      `INSERT INTO terminals (id, org_id, branch_id, name, code, kind, status, created_at)
       VALUES (?, ?, ?, 'Terminal 1', 'T01', 'pos', 'active', ?)`,
    ).run(terminalId, orgId, branchId, now);

    // Modules: industry defaults + dependency closure
    const modules = dependencyClosure(industry.defaultModules);
    const insertModule = db.prepare(
      `INSERT INTO org_modules (org_id, module_id, enabled, version, config, enabled_at, updated_at)
       VALUES (?, ?, 1, ?, '{}', ?, ?)`,
    );
    for (const moduleId of modules) {
      insertModule.run(orgId, moduleId, getModule(moduleId)?.version ?? "1.0.0", now, now);
    }

    // Payment methods
    const methodNames: Record<string, { name: string; kind: string; isCash: number }> = {
      cash: { name: "Dinheiro", kind: "cash", isCash: 1 },
      card: { name: "Cartão (TPA)", kind: "card", isCash: 0 },
      mbway: { name: "MB WAY", kind: "digital_wallet", isCash: 0 },
      transfer: { name: "Transferência", kind: "transfer", isCash: 0 },
      store_credit: { name: "Crédito de loja", kind: "store_credit", isCash: 0 },
      gift_card: { name: "Cartão-presente", kind: "gift_card", isCash: 0 },
      customer_credit: { name: "Conta corrente (cliente)", kind: "customer_credit", isCash: 0 },
    };
    let order = 1;
    const insertPm = db.prepare(
      `INSERT INTO payment_methods (id, org_id, key, name, kind, enabled, is_cash, requires_terminal, sort_order, config)
       VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, '{}')`,
    );
    for (const key of industry.defaultPaymentMethods) {
      const m = methodNames[key];
      if (!m) continue;
      insertPm.run(newId("pm"), orgId, key, m.name, m.kind, m.isCash, order++);
    }

    // Document series (fiscal year 2026 onward; created lazily per year too)
    const year = new Date(now).getFullYear();
    const insertSeries = db.prepare(
      `INSERT INTO document_series (id, org_id, doc_type, prefix, fiscal_year, next_number)
       VALUES (?, ?, ?, ?, ?, 1)`,
    );
    for (const docType of ["FT", "FR", "NC", "GT", "RC"]) {
      insertSeries.run(newId("dser"), orgId, docType, "VD", year);
    }

    // Seed business rules for the industry
    const insertRule = db.prepare(
      `INSERT INTO business_rules (id, org_id, key, name, description, scope, condition, action, priority, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, 1, ?, ?)`,
    );
    for (const rule of industry.seedRules) {
      insertRule.run(
        newId("rule"),
        orgId,
        rule.key,
        rule.name,
        rule.description,
        JSON.stringify(rule.condition),
        JSON.stringify(rule.action),
        rule.priority,
        now,
        now,
      );
    }

    writeAudit(
      {
        orgId,
        actorUserId: actor?.userId ?? null,
        actorLabel: actor?.label ?? input.ownerEmail,
        action: "org.create",
        resourceType: "organization",
        resourceId: orgId,
        after: {
          name: input.name,
          industry: industry.key,
          modules,
          demo: Boolean(input.demo),
        },
      },
      db,
    );
  });

  return {
    orgId,
    ownerUserId,
    branchId,
    warehouseId,
    terminalId,
    enabledModules: dependencyClosure(industry.defaultModules),
  };
}

/* --------------------------- Profile --------------------------- */

export function getOrgProfile(orgId: string): OrgProfileView {
  const db = getDb();
  const org = db
    .prepare(`SELECT id, name, legal_name, tax_id, demo FROM organizations WHERE id = ?`)
    .get(orgId) as
    | { id: string; name: string; legal_name: string | null; tax_id: string | null; demo: number }
    | undefined;
  if (!org) throw new ApiError(404, "Organização não encontrada.");
  const profile = db
    .prepare(`SELECT * FROM org_profiles WHERE org_id = ?`)
    .get(orgId) as {
    industry: IndustryKey;
    sub_industry: string | null;
    country: string;
    currency: string;
    locale: string;
    timezone: string;
    tax_regime: string;
    prices_include_tax: number;
    default_tax_bps: number;
    settings: string;
    onboarded_at: number | null;
  };
  const industry = getIndustry(profile.industry);
  return {
    orgId: org.id,
    orgName: org.name,
    legalName: org.legal_name,
    taxId: org.tax_id,
    demo: org.demo === 1,
    industry: profile.industry,
    industryLabel: industry?.label ?? profile.industry,
    subIndustry: profile.sub_industry,
    country: profile.country,
    currency: profile.currency,
    locale: profile.locale,
    timezone: profile.timezone,
    taxRegime: profile.tax_regime,
    pricesIncludeTax: profile.prices_include_tax === 1,
    defaultTaxBps: profile.default_tax_bps,
    settings: JSON.parse(profile.settings) as OrgSettings,
    onboardedAt: profile.onboarded_at,
    posMode: industry?.posMode ?? "retail",
  };
}

export function completeOnboarding(orgId: string, actor?: { userId: string; label: string }): void {
  const db = getDb();
  tx(db, () => {
    db.prepare(`UPDATE org_profiles SET onboarded_at = ?, updated_at = ? WHERE org_id = ?`)
      .run(Date.now(), Date.now(), orgId);
    writeAudit(
      {
        orgId,
        actorUserId: actor?.userId ?? null,
        actorLabel: actor?.label ?? "system",
        action: "org.onboarding_complete",
        resourceType: "organization",
        resourceId: orgId,
      },
      db,
    );
  });
}

export function updateOrgIdentity(
  orgId: string,
  patch: { name?: string; legalName?: string; taxId?: string },
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  const before = db.prepare(`SELECT name, legal_name, tax_id FROM organizations WHERE id = ?`).get(orgId);
  tx(db, () => {
    db.prepare(
      `UPDATE organizations SET
         name = COALESCE(?, name),
         legal_name = COALESCE(?, legal_name),
         tax_id = COALESCE(?, tax_id),
         updated_at = ?
       WHERE id = ?`,
    ).run(patch.name ?? null, patch.legalName ?? null, patch.taxId ?? null, Date.now(), orgId);
    writeAudit(
      {
        orgId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: "org.update",
        resourceType: "organization",
        resourceId: orgId,
        before,
        after: patch,
      },
      db,
    );
  });
}

export function updateProfileLocale(
  orgId: string,
  patch: {
    country?: string;
    currency?: string;
    locale?: string;
    timezone?: string;
    subIndustry?: string;
    taxRegime?: string;
    pricesIncludeTax?: boolean;
    defaultTaxBps?: number;
  },
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  const before = db.prepare(`SELECT * FROM org_profiles WHERE org_id = ?`).get(orgId);
  tx(db, () => {
    db.prepare(
      `UPDATE org_profiles SET
         country = COALESCE(?, country),
         currency = COALESCE(?, currency),
         locale = COALESCE(?, locale),
         timezone = COALESCE(?, timezone),
         sub_industry = COALESCE(?, sub_industry),
         tax_regime = COALESCE(?, tax_regime),
         prices_include_tax = COALESCE(?, prices_include_tax),
         default_tax_bps = COALESCE(?, default_tax_bps),
         updated_at = ?
       WHERE org_id = ?`,
    ).run(
      patch.country ?? null,
      patch.currency ?? null,
      patch.locale ?? null,
      patch.timezone ?? null,
      patch.subIndustry ?? null,
      patch.taxRegime ?? null,
      patch.pricesIncludeTax === undefined ? null : patch.pricesIncludeTax ? 1 : 0,
      patch.defaultTaxBps ?? null,
      Date.now(),
      orgId,
    );
    writeAudit(
      {
        orgId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: "profile.update_locale",
        resourceType: "org_profile",
        resourceId: orgId,
        before,
        after: patch,
      },
      db,
    );
  });
}

export function mergeProfileSettings(
  orgId: string,
  patch: OrgSettings,
  actor?: { userId: string; label: string },
): OrgSettings {
  const db = getDb();
  const profile = getOrgProfile(orgId);
  const merged = { ...profile.settings, ...patch };
  tx(db, () => {
    db.prepare(`UPDATE org_profiles SET settings = ?, updated_at = ? WHERE org_id = ?`)
      .run(JSON.stringify(merged), Date.now(), orgId);
    if (actor) {
      writeAudit(
        {
          orgId,
          actorUserId: actor.userId,
          actorLabel: actor.label,
          action: "profile.update_settings",
          resourceType: "org_profile",
          resourceId: orgId,
          before: profile.settings,
          after: patch,
        },
        db,
      );
    }
  });
  return merged;
}

/* ------------------- Guarded industry change ------------------- */

export interface IndustryChangePreview {
  fromIndustry: IndustryKey;
  toIndustry: IndustryKey;
  modulesToEnable: string[];
  modulesThatStayEnabled: { id: string; name: string; dataRows: number }[];
  dataUntouched: string[];
  posModeChange: { from: string; to: string } | null;
  warnings: string[];
}

/**
 * CRITICAL RULE: changing industry NEVER transforms existing data.
 * The preview shows exactly what changes; applying it requires explicit
 * confirmation. Historical sales/products/customers are preserved as-is.
 */
export function previewIndustryChange(
  orgId: string,
  toIndustry: string,
): IndustryChangePreview {
  if (!isIndustryKey(toIndustry)) badRequest(`Setor desconhecido: ${toIndustry}`);
  const profile = getOrgProfile(orgId);
  const target = getIndustry(toIndustry)!;
  const db = getDb();

  const currentEnabled = (
    db
      .prepare(`SELECT module_id FROM org_modules WHERE org_id = ? AND enabled = 1`)
      .all(orgId) as { module_id: string }[]
  ).map((r) => r.module_id);
  const targetModules = dependencyClosure(target.defaultModules);
  const modulesToEnable = targetModules.filter((m) => !currentEnabled.includes(m));

  const stays: { id: string; name: string; dataRows: number }[] = [];
  for (const moduleId of currentEnabled) {
    if (targetModules.includes(moduleId)) continue;
    const def = getModule(moduleId);
    if (!def) continue;
    let rows = 0;
    for (const table of def.dataTables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) c FROM ${table} WHERE org_id = ?`).get(orgId) as { c: number };
        rows += row.c;
      } catch {
        /* table missing — ignore */
      }
    }
    stays.push({ id: moduleId, name: def.name, dataRows: rows });
  }

  const warnings: string[] = [];
  if (profile.posMode !== target.posMode) {
    warnings.push(
      `O modo de checkout muda de "${profile.posMode}" para "${target.posMode}". Pedidos e mesas existentes permanecem no histórico.`,
    );
  }
  const withData = stays.filter((s) => s.dataRows > 0);
  if (withData.length) {
    warnings.push(
      `Módulos fora do novo setor permanecem ATIVOS porque possuem dados: ${withData
        .map((m) => `${m.name} (${m.dataRows})`)
        .join(", ")}. Pode desativá-los manualmente em Definições → Módulos (os dados são sempre preservados).`,
    );
  }

  return {
    fromIndustry: profile.industry,
    toIndustry: target.key,
    modulesToEnable,
    modulesThatStayEnabled: stays,
    dataUntouched: [
      "sales", "sale_lines", "sale_payments", "returns", "products",
      "product_variants", "customers", "stock_levels", "stock_movements",
      "purchase_orders", "cash_sessions", "audit_logs",
    ],
    posModeChange:
      profile.posMode !== target.posMode
        ? { from: profile.posMode, to: target.posMode }
        : null,
    warnings,
  };
}

export function applyIndustryChange(
  orgId: string,
  toIndustry: string,
  confirmation: string,
  actor: { userId: string; label: string },
): IndustryChangePreview {
  const preview = previewIndustryChange(orgId, toIndustry);
  const expected = `MUDAR-${preview.toIndustry.toUpperCase()}`;
  if (confirmation !== expected) {
    throw new ApiError(
      400,
      `Confirmação inválida. Escreva "${expected}" para aplicar a mudança de setor.`,
      "confirmation_required",
    );
  }
  const db = getDb();
  const now = Date.now();
  tx(db, () => {
    // 1. Update profile industry (settings are merged, not replaced)
    const target = getIndustry(toIndustry)!;
    const profile = getOrgProfile(orgId);
    const mergedSettings = { ...profile.settings, ...target.defaultSettings };
    db.prepare(
      `UPDATE org_profiles SET industry = ?, settings = ?, updated_at = ? WHERE org_id = ?`,
    ).run(target.key, JSON.stringify(mergedSettings), now, orgId);

    // 2. Enable recommended modules (never disable anything automatically)
    const insertModule = db.prepare(
      `INSERT INTO org_modules (org_id, module_id, enabled, version, config, enabled_at, updated_at)
       VALUES (?, ?, 1, ?, '{}', ?, ?)
       ON CONFLICT(org_id, module_id) DO UPDATE SET
         enabled = 1, enabled_at = excluded.enabled_at, updated_at = excluded.updated_at`,
    );
    for (const moduleId of preview.modulesToEnable) {
      insertModule.run(orgId, moduleId, getModule(moduleId)?.version ?? "1.0.0", now, now);
    }

    // 3. Seed new industry rules that don't exist yet
    const insertRule = db.prepare(
      `INSERT INTO business_rules (id, org_id, key, name, description, scope, condition, action, priority, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, 1, ?, ?)
       ON CONFLICT(org_id, key) DO NOTHING`,
    );
    for (const rule of target.seedRules) {
      insertRule.run(
        newId("rule"), orgId, rule.key, rule.name, rule.description,
        JSON.stringify(rule.condition), JSON.stringify(rule.action),
        rule.priority, now, now,
      );
    }

    writeAudit(
      {
        orgId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: "profile.change_industry",
        resourceType: "org_profile",
        resourceId: orgId,
        before: { industry: preview.fromIndustry },
        after: {
          industry: preview.toIndustry,
          modulesEnabled: preview.modulesToEnable,
          modulesKept: preview.modulesThatStayEnabled.map((m) => m.id),
        },
        detail: "Mudança de setor com confirmação explícita; dados históricos preservados.",
      },
      db,
    );
  });
  return preview;
}

/* -------------------- Structure management --------------------- */

export function listBranches(orgId: string) {
  return getDb()
    .prepare(`SELECT * FROM branches WHERE org_id = ? ORDER BY code`)
    .all(orgId) as BranchRow[];
}

export interface BranchRow {
  id: string;
  org_id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  timezone: string | null;
  is_default: number;
  status: string;
  settings: string;
  created_at: number;
}

export function createBranch(
  orgId: string,
  data: { name: string; code: string; address?: string; city?: string; phone?: string; withWarehouse?: boolean; withTerminal?: boolean },
  actor: { userId: string; label: string },
): string {
  const db = getDb();
  const branchId = newId("br");
  tx(db, () => {
    db.prepare(
      `INSERT INTO branches (id, org_id, name, code, address, city, phone, is_default, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?)`,
    ).run(branchId, orgId, data.name.trim(), data.code.trim().toUpperCase(), data.address ?? null, data.city ?? null, data.phone ?? null, Date.now());
    if (data.withWarehouse !== false) {
      db.prepare(
        `INSERT INTO warehouses (id, org_id, branch_id, name, code, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      ).run(newId("wh"), orgId, branchId, `Armazém ${data.name.trim()}`, `WH-${data.code.trim().toUpperCase()}`, Date.now());
    }
    if (data.withTerminal !== false) {
      db.prepare(
        `INSERT INTO terminals (id, org_id, branch_id, name, code, kind, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pos', 'active', ?)`,
      ).run(newId("trm"), orgId, branchId, `Terminal ${data.code.trim().toUpperCase()}`, `T-${data.code.trim().toUpperCase()}`, Date.now());
    }
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "branch.create", resourceType: "branch", resourceId: branchId, after: data },
      db,
    );
  });
  return branchId;
}

export function listWarehouses(orgId: string) {
  return getDb()
    .prepare(
      `SELECT w.*, b.name as branch_name FROM warehouses w
       LEFT JOIN branches b ON b.id = w.branch_id
       WHERE w.org_id = ? ORDER BY w.code`,
    )
    .all(orgId) as WarehouseRow[];
}

export interface WarehouseRow {
  id: string;
  org_id: string;
  branch_id: string | null;
  name: string;
  code: string;
  is_default: number;
  branch_name?: string | null;
  created_at: number;
}

export function listTerminals(orgId: string) {
  return getDb()
    .prepare(
      `SELECT t.*, b.name as branch_name FROM terminals t
       JOIN branches b ON b.id = t.branch_id
       WHERE t.org_id = ? ORDER BY t.code`,
    )
    .all(orgId) as TerminalRow[];
}

export interface TerminalRow {
  id: string;
  org_id: string;
  branch_id: string;
  name: string;
  code: string;
  kind: string;
  status: string;
  branch_name?: string;
  created_at: number;
}

export function createTerminal(
  orgId: string,
  data: { branchId: string; name: string; code: string; kind: string },
  actor: { userId: string; label: string },
): string {
  const db = getDb();
  const id = newId("trm");
  tx(db, () => {
    db.prepare(
      `INSERT INTO terminals (id, org_id, branch_id, name, code, kind, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).run(id, orgId, data.branchId, data.name.trim(), data.code.trim().toUpperCase(), data.kind, Date.now());
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "terminal.create", resourceType: "terminal", resourceId: id, after: data },
      db,
    );
  });
  return id;
}
