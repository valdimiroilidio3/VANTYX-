/**
 * VANTYX Module Registry — central declaration of every capability.
 *
 * Modules are the only contract between layers: navigation, dashboards,
 * API guards and permissions are all assembled from what is registered
 * here AND enabled for the organization AND allowed for the user.
 *
 * Cross-module imports of internal logic are forbidden; modules interact
 * through domain services, typed contracts and the domain event bus.
 */

import type { Permission } from "@/lib/domain/permissions";
import type { IndustryKey } from "./industries";

export type ModuleCategory = "core" | "industry" | "optional";

export interface ModuleRoute {
  path: string;
  label: string;
  icon: string; // lucide icon name
  permission?: Permission;
  section: "operate" | "manage" | "analyze" | "configure";
  order: number;
  /** Hide from navigation but keep API active (e.g. embedded screens). */
  hidden?: boolean;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  version: string;
  /** Industries where this module is relevant ("*" = all). */
  industries: IndustryKey[] | "*";
  /** Modules that must be enabled first. */
  dependencies: string[];
  /** Permissions this module requires/uses. */
  capabilities: Permission[];
  routes: ModuleRoute[];
  /** Widget ids contributed to the adaptive dashboard. */
  widgets: string[];
  /** Domain events emitted / consumed (documentation + validation). */
  emits: string[];
  consumes: string[];
  /** Default enabled for the industry when onboarding. */
  defaultEnabled?: boolean;
  /** Data tables owned by the module — used to block unsafe deactivation. */
  dataTables: string[];
  licenseTier?: "free" | "standard" | "pro" | "enterprise";
}

const M = (m: ModuleDefinition): ModuleDefinition => m;

/* ============================== CORE ============================== */

export const MODULE_POS = M({
  id: "pos",
  name: "POS & Checkout",
  description:
    "Venda rápida, códigos de barras, pagamentos divididos, suspensões, devoluções e reimpressão.",
  category: "core",
  version: "1.0.0",
  industries: "*",
  dependencies: ["catalog"],
  capabilities: ["pos.sell", "pos.hold", "pos.refund", "pos.reprint", "pos.line_discount", "pos.order_discount"],
  routes: [
    { path: "/pos", label: "Terminal POS", icon: "scan-barcode", section: "operate", order: 10, permission: "pos.sell" },
    { path: "/sales", label: "Vendas", icon: "receipt", section: "operate", order: 30, permission: "sales.view" },
  ],
  widgets: ["sales-today", "transactions-today", "open-terminals"],
  emits: ["sale.completed", "sale.voided", "sale.returned"],
  consumes: ["stock.changed"],
  dataTables: ["sales", "sale_lines", "sale_payments", "held_sales", "returns"],
  licenseTier: "free",
});

export const MODULE_CATALOG = M({
  id: "catalog",
  name: "Produtos & Catálogo",
  description:
    "Produtos simples e variantes, SKU, códigos de barras, categorias, preços, kits e importação CSV.",
  category: "core",
  version: "1.0.0",
  industries: "*",
  dependencies: [],
  capabilities: ["products.view", "products.manage", "products.import", "promotions.manage"],
  routes: [
    { path: "/products", label: "Produtos", icon: "package", section: "manage", order: 40, permission: "products.view" },
  ],
  widgets: ["low-stock", "top-products"],
  emits: [],
  consumes: [],
  dataTables: ["products", "product_variants", "barcodes", "categories", "kit_items", "price_lists", "promotions"],
  licenseTier: "free",
});

export const MODULE_INVENTORY = M({
  id: "inventory",
  name: "Inventário",
  description:
    "Stock por armazém, movimentos rastreáveis, ajustes justificados, transferências, contagens cíclicas e alertas.",
  category: "core",
  version: "1.0.0",
  industries: "*",
  dependencies: ["catalog"],
  capabilities: ["inventory.view", "inventory.adjust", "inventory.transfer", "inventory.count"],
  routes: [
    { path: "/inventory", label: "Inventário", icon: "warehouse", section: "manage", order: 50, permission: "inventory.view" },
  ],
  widgets: ["stock-valuation", "no-movement"],
  emits: ["stock.changed", "stock.below_min", "stock.negative"],
  consumes: ["sale.completed", "purchase.received"],
  dataTables: ["stock_levels", "stock_movements", "stock_transfers", "count_sheets", "batches", "serials"],
  licenseTier: "free",
});

export const MODULE_CRM = M({
  id: "crm",
  name: "Clientes (CRM)",
  description:
    "Fichas de clientes, histórico, segmentação, fidelização, crédito e pedidos de dados (RGPD).",
  category: "core",
  version: "1.0.0",
  industries: "*",
  dependencies: [],
  capabilities: ["customers.view", "customers.manage", "loyalty.manage", "customers.data_requests"],
  routes: [
    { path: "/customers", label: "Clientes", icon: "users", section: "manage", order: 60, permission: "customers.view" },
  ],
  widgets: ["new-customers"],
  emits: [],
  consumes: ["sale.completed"],
  dataTables: ["customers", "loyalty_accounts", "loyalty_transactions", "data_requests"],
  licenseTier: "free",
});

export const MODULE_CASH = M({
  id: "cash",
  name: "Caixa & Pagamentos",
  description:
    "Sessões de caixa, fundo inicial, entradas/saídas, reconciliação, diferenças e histórico auditável.",
  category: "core",
  version: "1.0.0",
  industries: "*",
  dependencies: ["pos"],
  capabilities: ["cash.open", "cash.close", "cash.movement", "cash.view"],
  routes: [
    { path: "/cash", label: "Caixa", icon: "banknote", section: "operate", order: 35, permission: "cash.view" },
  ],
  widgets: ["cash-difference"],
  emits: ["cash.session_opened", "cash.session_closed"],
  consumes: ["sale.completed"],
  dataTables: ["cash_sessions", "cash_movements", "payment_methods"],
  licenseTier: "free",
});

export const MODULE_STAFF = M({
  id: "staff",
  name: "Equipa & Acessos",
  description:
    "Utilizadores, convites, funções, permissões por filial, PIN de operador e registo de sessões.",
  category: "core",
  version: "1.0.0",
  industries: "*",
  dependencies: [],
  capabilities: ["users.manage", "roles.manage"],
  routes: [],
  widgets: [],
  emits: [],
  consumes: [],
  dataTables: ["users", "roles", "role_permissions", "user_branches", "invites", "shifts"],
  licenseTier: "free",
});

export const MODULE_ANALYTICS = M({
  id: "analytics",
  name: "Analytics & Relatórios",
  description:
    "Vendas, margens estimadas, ticket médio, desempenho por colaborador/filial, rotação de stock e exportação.",
  category: "core",
  version: "1.0.0",
  industries: "*",
  dependencies: ["pos"],
  capabilities: ["reports.view", "reports.export"],
  routes: [
    { path: "/reports", label: "Relatórios", icon: "bar-chart-3", section: "analyze", order: 80, permission: "reports.view" },
  ],
  widgets: ["revenue-period", "margin-estimate", "avg-ticket", "sales-by-hour"],
  emits: [],
  consumes: ["sale.completed"],
  dataTables: [],
  licenseTier: "free",
});

export const MODULE_MULTIBRANCH = M({
  id: "multibranch",
  name: "Multi-Filial",
  description:
    "Filiais, armazéns, terminais, âmbito de acesso por utilizador e consolidação de relatórios.",
  category: "core",
  version: "1.0.0",
  industries: "*",
  dependencies: [],
  capabilities: ["branches.manage"],
  routes: [],
  widgets: ["sales-by-branch"],
  emits: [],
  consumes: [],
  dataTables: ["branches", "warehouses", "terminals"],
  licenseTier: "standard",
});

/* ============================ INDUSTRY ============================ */

export const MODULE_SUPERMARKET = M({
  id: "industry.supermarket",
  name: "Pack Supermercado",
  description:
    "Checkout de alta velocidade, peso/embalagens, códigos de barras embutidos de balança, lotes e validades, reposição e etiquetas de preço.",
  category: "industry",
  version: "1.0.0",
  industries: ["supermarket"],
  dependencies: ["pos", "inventory", "catalog"],
  capabilities: ["inventory.count", "inventory.waste"],
  routes: [
    { path: "/inventory/counts", label: "Contagens", icon: "clipboard-check", section: "manage", order: 55, permission: "inventory.count" },
    { path: "/products/labels", label: "Etiquetas", icon: "tag", section: "manage", order: 45, permission: "products.view" },
  ],
  widgets: ["expiring-batches", "critical-stock", "high-rotation", "replenishment-queue"],
  emits: ["batch.expiring"],
  consumes: ["stock.below_min"],
  dataTables: ["batches"],
  licenseTier: "standard",
});

export const MODULE_RESTAURANT = M({
  id: "industry.restaurant",
  name: "Pack Restaurante",
  description:
    "Mesas, comandas, cozinha (KDS), modificadores, divisão de contas, reservas, listas de espera, fichas técnicas e turnos.",
  category: "industry",
  version: "1.0.0",
  industries: ["restaurant"],
  dependencies: ["pos", "catalog"],
  capabilities: ["restaurant.floor", "restaurant.kitchen", "restaurant.reservations", "restaurant.recipes"],
  routes: [
    { path: "/restaurant/floor", label: "Mesas", icon: "utensils-crossed", section: "operate", order: 15, permission: "restaurant.floor" },
    { path: "/restaurant/kitchen", label: "Cozinha (KDS)", icon: "chef-hat", section: "operate", order: 16, permission: "restaurant.kitchen" },
    { path: "/restaurant/reservations", label: "Reservas", icon: "calendar-clock", section: "operate", order: 17, permission: "restaurant.reservations" },
  ],
  widgets: ["active-orders", "table-occupancy", "avg-prep-time", "top-dishes", "sales-by-shift"],
  emits: ["kitchen.ticket_sent", "kitchen.ticket_ready"],
  consumes: ["sale.completed"],
  dataTables: ["r_tables", "r_orders", "r_order_items", "kitchen_tickets", "kitchen_ticket_lines", "modifier_groups", "modifier_options", "reservations", "recipes", "recipe_items", "waste_records"],
  licenseTier: "standard",
});

export const MODULE_FASHION = M({
  id: "industry.fashion",
  name: "Pack Moda & Calçado",
  description:
    "Matrizes de tamanhos/cores, coleções, estações, trocas com diferença de preço e análise por variante.",
  category: "industry",
  version: "1.0.0",
  industries: ["fashion"],
  dependencies: ["pos", "catalog", "inventory"],
  capabilities: ["products.manage"],
  routes: [],
  widgets: ["sales-by-size", "sales-by-color", "variant-stock", "return-rate"],
  emits: [],
  consumes: [],
  dataTables: [],
  licenseTier: "standard",
});

export const MODULE_AUTO_PARTS = M({
  id: "industry.auto_parts",
  name: "Pack Peças & Oficina",
  description:
    "Referências OEM/equivalências, compatibilidade por veículo (catálogo importado e validado), orçamentos e ordens de reparação.",
  category: "industry",
  version: "1.0.0",
  industries: ["auto_parts"],
  dependencies: ["pos", "catalog", "inventory"],
  capabilities: ["workorders.view", "workorders.manage"],
  routes: [
    { path: "/workorders", label: "Oficina", icon: "wrench", section: "operate", order: 18, permission: "workorders.view" },
  ],
  widgets: ["active-work-orders", "dead-stock-refs"],
  emits: [],
  consumes: [],
  dataTables: ["work_orders", "work_order_parts", "vehicle_catalog", "part_compatibility"],
  licenseTier: "pro",
});

export const MODULE_SALON = M({
  id: "industry.salon",
  name: "Pack Barbearia & Salão",
  description:
    "Agenda por profissional, marcações, walk-ins, comissões, pacotes e histórico de preferências.",
  category: "industry",
  version: "1.0.0",
  industries: ["salon"],
  dependencies: ["pos", "crm"],
  capabilities: ["scheduling.view", "scheduling.manage"],
  routes: [
    { path: "/schedule", label: "Agenda", icon: "calendar-days", section: "operate", order: 12, permission: "scheduling.view" },
  ],
  widgets: ["today-agenda", "occupancy-by-staff", "revenue-by-staff", "no-shows"],
  emits: [],
  consumes: ["sale.completed"],
  dataTables: ["service_resources", "appointments"],
  licenseTier: "standard",
});

export const MODULE_ELECTRONICS = M({
  id: "industry.electronics",
  name: "Pack Eletrónica & Informática",
  description:
    "Números de série, IMEI, garantias, RMA, ordens de serviço e histórico de equipamento.",
  category: "industry",
  version: "1.0.0",
  industries: ["electronics"],
  dependencies: ["pos", "inventory"],
  capabilities: ["workorders.view", "workorders.manage"],
  routes: [
    { path: "/workorders", label: "Reparações", icon: "circuit-board", section: "operate", order: 18, permission: "workorders.view" },
  ],
  widgets: ["rma-open", "warranty-expiring"],
  emits: [],
  consumes: [],
  dataTables: ["serials", "work_orders"],
  licenseTier: "pro",
});

export const MODULE_WHOLESALE = M({
  id: "industry.wholesale",
  name: "Pack Grossista",
  description:
    "Clientes empresariais, preços por cliente e escalões, encomendas recorrentes, picking, crédito comercial.",
  category: "industry",
  version: "1.0.0",
  industries: ["wholesale"],
  dependencies: ["pos", "crm", "catalog"],
  capabilities: ["customers.manage"],
  routes: [],
  widgets: ["credit-exposure", "top-b2b-customers"],
  emits: [],
  consumes: [],
  dataTables: ["price_list_items"],
  licenseTier: "pro",
});

export const MODULE_CONSTRUCTION = M({
  id: "industry.construction",
  name: "Pack Materiais de Construção",
  description:
    "Venda por unidade/metro/área/volume/peso, conversões, entregas a obra, orçamentos e preços para profissionais.",
  category: "industry",
  version: "1.0.0",
  industries: ["construction"],
  dependencies: ["pos", "catalog", "inventory"],
  capabilities: [],
  routes: [],
  widgets: ["deliveries-pending"],
  emits: [],
  consumes: [],
  dataTables: [],
  licenseTier: "pro",
});

export const MODULE_PHARMACY = M({
  id: "industry.pharmacy",
  name: "Pack Farmácia (limitado)",
  description:
    "Catálogo, lotes e validades, rastreabilidade e encomendas a fornecedores autorizados. NÃO inclui dispensa de medicamentos, receitas eletrónicas nem substâncias regulamentadas — exige validação legal e integrações autorizadas.",
  category: "industry",
  version: "1.0.0",
  industries: ["pharmacy"],
  dependencies: ["pos", "inventory", "catalog"],
  capabilities: [],
  routes: [],
  widgets: ["expiring-batches"],
  emits: ["batch.expiring"],
  consumes: [],
  dataTables: ["batches"],
  licenseTier: "enterprise",
});

export const MODULE_BOOKSTORE = M({
  id: "industry.bookstore",
  name: "Pack Livraria & Papelaria",
  description:
    "ISBN, autores/editoras, edições, listas escolares, sazonalidade e campanhas de regresso às aulas.",
  category: "industry",
  version: "1.0.0",
  industries: ["bookstore"],
  dependencies: ["pos", "catalog"],
  capabilities: [],
  routes: [],
  widgets: ["top-authors"],
  emits: [],
  consumes: [],
  dataTables: [],
  licenseTier: "standard",
});

export const MODULE_FURNITURE = M({
  id: "industry.furniture",
  name: "Pack Móveis & Decoração",
  description:
    "Produtos configuráveis, encomendas a fornecedor, adiantamentos, entregas e montagem.",
  category: "industry",
  version: "1.0.0",
  industries: ["furniture"],
  dependencies: ["pos", "catalog", "purchasing"],
  capabilities: [],
  routes: [],
  widgets: ["backorder-status"],
  emits: [],
  consumes: [],
  dataTables: [],
  licenseTier: "standard",
});

export const MODULE_PET = M({
  id: "industry.pet",
  name: "Pack Pet Shop",
  description:
    "Catálogo por espécie, lotes e validades, packs, produtos recorrentes e alertas de validade.",
  category: "industry",
  version: "1.0.0",
  industries: ["pet"],
  dependencies: ["pos", "catalog", "inventory"],
  capabilities: [],
  routes: [],
  widgets: ["expiring-batches"],
  emits: ["batch.expiring"],
  consumes: [],
  dataTables: ["batches"],
  licenseTier: "standard",
});

/* ============================ OPTIONAL ============================ */

export const MODULE_PURCHASING = M({
  id: "purchasing",
  name: "Compras & Fornecedores",
  description:
    "Fornecedores, encomendas de compra, receções parciais/totais, discrepâncias, histórico de preços e aprovações.",
  category: "optional",
  version: "1.0.0",
  industries: "*",
  dependencies: ["catalog", "inventory"],
  capabilities: ["suppliers.manage", "purchasing.manage", "purchasing.approve", "purchasing.receive"],
  routes: [
    { path: "/purchasing", label: "Compras", icon: "truck", section: "manage", order: 65, permission: "purchasing.view" },
    { path: "/suppliers", label: "Fornecedores", icon: "factory", section: "manage", order: 66, permission: "suppliers.view" },
  ],
  widgets: ["pending-orders", "purchase-suggestions"],
  emits: ["purchase.approval_required", "purchase.received"],
  consumes: ["stock.below_min"],
  dataTables: ["suppliers", "purchase_orders", "purchase_order_lines", "goods_receipts", "goods_receipt_lines", "supplier_price_history"],
  licenseTier: "standard",
});

export const MODULE_LOYALTY = M({
  id: "loyalty",
  name: "Fidelização",
  description: "Pontos por compra, recompensas, níveis e histórico de transações de pontos.",
  category: "optional",
  version: "1.0.0",
  industries: "*",
  dependencies: ["crm", "pos"],
  capabilities: ["loyalty.manage"],
  routes: [],
  widgets: ["loyalty-summary"],
  emits: [],
  consumes: ["sale.completed"],
  dataTables: ["loyalty_accounts", "loyalty_transactions"],
  licenseTier: "standard",
});

export const MODULE_GIFT_CARDS = M({
  id: "gift_cards",
  name: "Cartões-Presente",
  description: "Emissão, carregamento e pagamento com cartões-presente.",
  category: "optional",
  version: "1.0.0",
  industries: "*",
  dependencies: ["pos"],
  capabilities: ["pos.sell"],
  routes: [],
  widgets: [],
  emits: [],
  consumes: [],
  dataTables: ["gift_cards", "gift_card_transactions"],
  licenseTier: "standard",
});

export const MODULE_RULES = M({
  id: "rules",
  name: "Motor de Regras",
  description:
    "Regras declarativas de desconto, aprovação, stock e alertas — com âmbito, prioridade e registo de execuções.",
  category: "optional",
  version: "1.0.0",
  industries: "*",
  dependencies: [],
  capabilities: ["rules.manage"],
  routes: [
    { path: "/settings/rules", label: "Regras de Negócio", icon: "scale", section: "configure", order: 95, permission: "rules.manage" },
  ],
  widgets: [],
  emits: ["rule.blocked"],
  consumes: [],
  dataTables: ["business_rules", "rule_executions", "approvals"],
  licenseTier: "standard",
});

export const MODULE_AUTOMATION = M({
  id: "automation",
  name: "Notificações & Automação",
  description:
    "Centro de notificações, alertas de stock/caixa/aprovações, tarefas recorrentes com idempotência e retentativas.",
  category: "optional",
  version: "1.0.0",
  industries: "*",
  dependencies: [],
  capabilities: ["notifications.view"],
  routes: [
    { path: "/notifications", label: "Notificações", icon: "bell", section: "analyze", order: 85, permission: "notifications.view" },
  ],
  widgets: ["alerts-feed"],
  emits: [],
  consumes: ["stock.below_min", "cash.session_closed", "purchase.approval_required", "batch.expiring", "sale.voided", "rule.blocked"],
  dataTables: ["notifications", "automation_runs"],
  licenseTier: "standard",
});

export const MODULE_INTEGRATIONS = M({
  id: "integrations",
  name: "Integrações & Hardware",
  description:
    "Adaptadores para terminais de pagamento, impressoras, balanças, e-mail e APIs — com estado explícito de configuração.",
  category: "optional",
  version: "1.0.0",
  industries: "*",
  dependencies: [],
  capabilities: ["integrations.manage"],
  routes: [
    { path: "/settings/integrations", label: "Integrações", icon: "plug-zap", section: "configure", order: 96, permission: "integrations.manage" },
  ],
  widgets: [],
  emits: [],
  consumes: [],
  dataTables: ["integrations"],
  licenseTier: "standard",
});

export const MODULE_INSIGHTS = M({
  id: "insights",
  name: "Assistente de Negócio",
  description:
    "Resumos operacionais, anomalias, sugestões de reposição e pesquisa — motor determinístico incluído; fornecedor LLM opcional (requer credenciais).",
  category: "optional",
  version: "1.0.0",
  industries: "*",
  dependencies: ["analytics"],
  capabilities: ["insights.view"],
  routes: [],
  widgets: ["ai-daily-brief", "anomalies"],
  emits: [],
  consumes: ["sale.completed", "stock.below_min"],
  dataTables: [],
  licenseTier: "pro",
});

export const MODULE_FISCAL = M({
  id: "fiscal",
  name: "Documentos & Fiscalidade",
  description:
    "Séries documentais, numeração controlada, cadeia de hash, notas de crédito e fecho de períodos. Adaptadores fiscais por jurisdição (configuração pendente até validação legal).",
  category: "optional",
  version: "1.0.0",
  industries: "*",
  dependencies: ["pos"],
  capabilities: ["fiscal.manage"],
  routes: [
    { path: "/settings/fiscal", label: "Fiscalidade", icon: "landmark", section: "configure", order: 97, permission: "fiscal.manage" },
  ],
  widgets: [],
  emits: [],
  consumes: ["sale.completed"],
  dataTables: ["document_series"],
  licenseTier: "enterprise",
});

export const MODULE_REGISTRY: ModuleDefinition[] = [
  MODULE_CATALOG,
  MODULE_POS,
  MODULE_INVENTORY,
  MODULE_CRM,
  MODULE_CASH,
  MODULE_STAFF,
  MODULE_ANALYTICS,
  MODULE_MULTIBRANCH,
  MODULE_PURCHASING,
  MODULE_LOYALTY,
  MODULE_GIFT_CARDS,
  MODULE_RULES,
  MODULE_AUTOMATION,
  MODULE_INTEGRATIONS,
  MODULE_INSIGHTS,
  MODULE_FISCAL,
  MODULE_SUPERMARKET,
  MODULE_RESTAURANT,
  MODULE_FASHION,
  MODULE_AUTO_PARTS,
  MODULE_SALON,
  MODULE_ELECTRONICS,
  MODULE_WHOLESALE,
  MODULE_CONSTRUCTION,
  MODULE_PHARMACY,
  MODULE_BOOKSTORE,
  MODULE_FURNITURE,
  MODULE_PET,
];

export function getModule(id: string): ModuleDefinition | undefined {
  return MODULE_REGISTRY.find((m) => m.id === id);
}

export function modulesByIds(ids: string[]): ModuleDefinition[] {
  return ids
    .map(getModule)
    .filter((m): m is ModuleDefinition => Boolean(m));
}

/** Dependency closure (modules required, transitively, by the given set). */
export function dependencyClosure(ids: string[]): string[] {
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    const mod = getModule(id);
    mod?.dependencies.forEach(visit);
  };
  ids.forEach(visit);
  return [...result];
}

/** Modules that depend on the given module (direct dependents). */
export function dependentsOf(id: string, enabledIds: string[]): string[] {
  return enabledIds.filter((other) =>
    getModule(other)?.dependencies.includes(id),
  );
}
