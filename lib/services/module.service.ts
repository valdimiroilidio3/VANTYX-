import { getDb, tx } from "@/lib/db/client";
import {
  MODULE_REGISTRY,
  dependencyClosure,
  dependentsOf,
  getModule,
  type ModuleDefinition,
  type ModuleRoute,
} from "@/lib/modules/registry";
import { getIndustry } from "@/lib/modules/industries";
import { ApiError } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";
import type { Permission } from "@/lib/domain/permissions";

export interface OrgModuleState {
  module: ModuleDefinition;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: number;
  /** Rows owned by the module for this org (blocks unsafe deactivation). */
  dataRows: number;
}

export function listOrgModules(orgId: string): OrgModuleState[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT module_id, enabled, config, updated_at FROM org_modules WHERE org_id = ?`,
    )
    .all(orgId) as {
    module_id: string;
    enabled: number;
    config: string;
    updated_at: number;
  }[];
  const byId = new Map(rows.map((r) => [r.module_id, r]));
  return MODULE_REGISTRY.map((module) => {
    const row = byId.get(module.id);
    return {
      module,
      enabled: row ? row.enabled === 1 : false,
      config: row ? (JSON.parse(row.config) as Record<string, unknown>) : {},
      updatedAt: row?.updated_at ?? 0,
      dataRows: countModuleData(orgId, module),
    };
  });
}

export function enabledModuleIds(orgId: string): string[] {
  const db = getDb();
  return (
    db
      .prepare(`SELECT module_id FROM org_modules WHERE org_id = ? AND enabled = 1`)
      .all(orgId) as { module_id: string }[]
  ).map((r) => r.module_id);
}

export function isModuleEnabled(orgId: string, moduleId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT enabled FROM org_modules WHERE org_id = ? AND module_id = ?`,
    )
    .get(orgId, moduleId) as { enabled: number } | undefined;
  return row?.enabled === 1;
}

export function countModuleData(
  orgId: string,
  module: ModuleDefinition,
): number {
  const db = getDb();
  let total = 0;
  for (const table of module.dataTables) {
    try {
      const row = db
        .prepare(`SELECT COUNT(*) c FROM ${table} WHERE org_id = ?`)
        .get(orgId) as { c: number };
      total += row.c;
    } catch {
      // Table may not exist in older schemas — ignore defensively.
    }
  }
  return total;
}

export interface EnableResult {
  moduleId: string;
  autoEnabledDependencies: string[];
}

/**
 * Enables a module for an org. Dependencies are enabled automatically.
 * Industry packs can be enabled outside their industry only with `force`
 * (explicit admin decision, audited).
 */
export function enableModule(
  orgId: string,
  moduleId: string,
  actor: { userId: string; label: string },
  opts: { force?: boolean } = {},
): EnableResult {
  const mod = getModule(moduleId);
  if (!mod) throw new ApiError(404, `Módulo desconhecido: ${moduleId}`);

  const profile = getDb()
    .prepare(`SELECT industry FROM org_profiles WHERE org_id = ?`)
    .get(orgId) as { industry: string } | undefined;
  const industryOk =
    mod.industries === "*" ||
    (profile ? (mod.industries as string[]).includes(profile.industry) : false);
  if (!industryOk && !opts.force) {
    throw new ApiError(
      400,
      `O módulo "${mod.name}" não é compatível com o perfil de negócio atual. Use a ativação forçada para assumir essa decisão.`,
      "industry_incompatible",
    );
  }

  const db = getDb();
  const autoEnabled: string[] = [];
  tx(db, () => {
    const closure = dependencyClosure([moduleId]);
    const now = Date.now();
    for (const id of closure) {
      const existing = db
        .prepare(`SELECT enabled FROM org_modules WHERE org_id = ? AND module_id = ?`)
        .get(orgId, id) as { enabled: number } | undefined;
      if (!existing) {
        db.prepare(
          `INSERT INTO org_modules (org_id, module_id, enabled, version, config, enabled_at, updated_at)
           VALUES (?, ?, 1, ?, '{}', ?, ?)`,
        ).run(orgId, id, getModule(id)?.version ?? "1.0.0", now, now);
        if (id !== moduleId) autoEnabled.push(id);
      } else if (existing.enabled !== 1) {
        db.prepare(
          `UPDATE org_modules SET enabled = 1, enabled_at = ?, disabled_at = NULL, updated_at = ?
           WHERE org_id = ? AND module_id = ?`,
        ).run(now, now, orgId, id);
        if (id !== moduleId) autoEnabled.push(id);
      }
    }
    writeAudit(
      {
        orgId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: "module.enable",
        resourceType: "module",
        resourceId: moduleId,
        after: { moduleId, autoEnabled, forced: Boolean(opts.force) },
      },
      db,
    );
  });
  return { moduleId, autoEnabledDependencies: autoEnabled };
}

export interface DisablePreview {
  moduleId: string;
  dependents: { id: string; name: string }[];
  dataRows: number;
  blocked: boolean;
  reason?: string;
}

/** Preview of consequences BEFORE deactivating (never destroys data). */
export function previewDisable(orgId: string, moduleId: string): DisablePreview {
  const mod = getModule(moduleId);
  if (!mod) throw new ApiError(404, `Módulo desconhecido: ${moduleId}`);
  const enabled = enabledModuleIds(orgId);
  const dependents = dependentsOf(moduleId, enabled)
    .map((id) => getModule(id))
    .filter((m): m is ModuleDefinition => Boolean(m))
    .map((m) => ({ id: m.id, name: m.name }));
  const dataRows = countModuleData(orgId, mod);
  const blocked = dependents.length > 0;
  return {
    moduleId,
    dependents,
    dataRows,
    blocked,
    reason: blocked
      ? `Desative primeiro: ${dependents.map((d) => d.name).join(", ")}`
      : dataRows > 0
        ? `O módulo possui ${dataRows} registos de dados. Desativar oculta a funcionalidade mas PRESERVA todos os dados. Requer confirmação explícita.`
        : undefined,
  };
}

export function disableModule(
  orgId: string,
  moduleId: string,
  actor: { userId: string; label: string },
  opts: { confirmDataLoss?: boolean } = {},
): void {
  const preview = previewDisable(orgId, moduleId);
  if (preview.blocked) {
    throw new ApiError(409, preview.reason ?? "Módulo tem dependentes ativos.", "dependents_active");
  }
  if (preview.dataRows > 0 && !opts.confirmDataLoss) {
    throw new ApiError(
      409,
      preview.reason ?? "Confirmação explícita necessária: o módulo possui dados.",
      "confirmation_required",
    );
  }
  const db = getDb();
  tx(db, () => {
    const now = Date.now();
    const existing = db
      .prepare(`SELECT 1 FROM org_modules WHERE org_id = ? AND module_id = ?`)
      .get(orgId, moduleId);
    if (existing) {
      db.prepare(
        `UPDATE org_modules SET enabled = 0, disabled_at = ?, updated_at = ?
         WHERE org_id = ? AND module_id = ?`,
      ).run(now, now, orgId, moduleId);
    } else {
      db.prepare(
        `INSERT INTO org_modules (org_id, module_id, enabled, version, config, disabled_at, updated_at)
         VALUES (?, ?, 0, '1.0.0', '{}', ?, ?)`,
      ).run(orgId, moduleId, now, now);
    }
    writeAudit(
      {
        orgId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: "module.disable",
        resourceType: "module",
        resourceId: moduleId,
        after: { dataRowsPreserved: preview.dataRows },
      },
      db,
    );
  });
}

export function setModuleConfig(
  orgId: string,
  moduleId: string,
  config: Record<string, unknown>,
): void {
  const db = getDb();
  db.prepare(
    `UPDATE org_modules SET config = ?, updated_at = ? WHERE org_id = ? AND module_id = ?`,
  ).run(JSON.stringify(config), Date.now(), orgId, moduleId);
}

/** Enabled module ids for the org, expanded with dependencies. */
export function effectiveModuleIds(orgId: string): Set<string> {
  return new Set(dependencyClosure(enabledModuleIds(orgId)));
}

/* ---------- Navigation & dashboard assembly (per user) ---------- */

export interface NavItem {
  path: string;
  label: string;
  icon: string;
  section: ModuleRoute["section"];
  order: number;
  moduleId: string;
}

/**
 * Builds the navigation strictly from:
 *   enabled modules ∩ routes visible ∩ user permissions.
 * Server-rendered; the client cannot widen it.
 */
export function navigationFor(
  orgId: string,
  permissions: Set<Permission>,
): NavItem[] {
  const enabled = enabledModuleIds(orgId);
  const items: NavItem[] = [];
  for (const moduleId of enabled) {
    const mod = getModule(moduleId);
    if (!mod) continue;
    for (const route of mod.routes) {
      if (route.hidden) continue;
      if (route.permission && !permissions.has(route.permission)) continue;
      items.push({
        path: route.path,
        label: route.label,
        icon: route.icon,
        section: route.section,
        order: route.order,
        moduleId,
      });
    }
  }
  // Static shell destinations everyone authenticated can see:
  items.push({
    path: "/dashboard",
    label: "Dashboard",
    icon: "layout-dashboard",
    section: "analyze",
    order: 1,
    moduleId: "core",
  });
  if (permissions.has("settings.view")) {
    items.push({
      path: "/settings",
      label: "Definições",
      icon: "settings",
      section: "configure",
      order: 90,
      moduleId: "core",
    });
  }
  items.sort((a, b) => a.order - b.order);
  return items;
}

/** Widgets available for dashboards: enabled modules ∩ permissions. */
export function availableWidgetIds(
  orgId: string,
  permissions: Set<Permission>,
): string[] {
  const enabled = enabledModuleIds(orgId);
  const widgets: string[] = [];
  for (const moduleId of enabled) {
    const mod = getModule(moduleId);
    if (!mod) continue;
    widgets.push(...mod.widgets);
  }
  void permissions; // widget-level permission filters live in the widget registry
  return [...new Set(widgets)];
}

/** Modules recommended (not forced) when the industry profile changes. */
export function recommendedModulesForIndustry(industryKey: string): string[] {
  const industry = getIndustry(industryKey);
  if (!industry) return [];
  return dependencyClosure(industry.defaultModules);
}
