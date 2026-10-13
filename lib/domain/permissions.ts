/**
 * Permission catalog and system role templates.
 * Permissions are ALWAYS enforced server-side (API guards); the UI only
 * reflects them. Format: "<area>.<capability>".
 */

export const PERMISSIONS = [
  // POS
  "pos.sell",
  "pos.hold",
  "pos.line_discount",
  "pos.order_discount",
  "pos.void_line",
  "pos.void_sale",
  "pos.refund",
  "pos.reprint",
  "pos.price_override",
  // Cash
  "cash.open",
  "cash.close",
  "cash.movement",
  "cash.view",
  // Catalog
  "products.view",
  "products.manage",
  "products.import",
  "promotions.manage",
  // Inventory
  "inventory.view",
  "inventory.adjust",
  "inventory.transfer",
  "inventory.count",
  "inventory.waste",
  // CRM
  "customers.view",
  "customers.manage",
  "customers.data_requests",
  "loyalty.manage",
  // Purchasing
  "suppliers.view",
  "suppliers.manage",
  "purchasing.view",
  "purchasing.manage",
  "purchasing.approve",
  "purchasing.receive",
  // Sales documents
  "sales.view",
  "sales.export",
  // Restaurant vertical
  "restaurant.floor",
  "restaurant.kitchen",
  "restaurant.reservations",
  "restaurant.recipes",
  // Service verticals
  "scheduling.view",
  "scheduling.manage",
  "workorders.view",
  "workorders.manage",
  // Analytics
  "reports.view",
  "reports.export",
  "insights.view",
  // Governance
  "settings.view",
  "settings.manage",
  "modules.manage",
  "users.manage",
  "roles.manage",
  "rules.manage",
  "integrations.manage",
  "profile.manage",
  "audit.view",
  "branches.manage",
  "fiscal.manage",
  "notifications.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
}

const ALL = [...PERMISSIONS];

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "owner",
    name: "Proprietário",
    description: "Acesso total, incluindo perfil de negócio e módulos.",
    permissions: ALL,
  },
  {
    key: "manager",
    name: "Gerente",
    description:
      "Gestão operacional completa: equipa, compras, caixa, relatórios e configurações da loja.",
    permissions: ALL.filter(
      (p) => p !== "modules.manage" && p !== "profile.manage",
    ),
  },
  {
    key: "cashier",
    name: "Caixa",
    description: "Venda, pagamentos, abertura/fecho de caixa e clientes.",
    permissions: [
      "pos.sell",
      "pos.hold",
      "pos.reprint",
      "cash.open",
      "cash.close",
      "cash.movement",
      "cash.view",
      "products.view",
      "inventory.view",
      "customers.view",
      "customers.manage",
      "sales.view",
      "restaurant.floor",
      "scheduling.view",
      "notifications.view",
    ],
  },
  {
    key: "kitchen",
    name: "Cozinha",
    description: "Ecrã de cozinha e preparação de pedidos.",
    permissions: ["restaurant.kitchen", "products.view", "notifications.view"],
  },
  {
    key: "floor",
    name: "Sala / Mesa",
    description: "Gestão de mesas, pedidos e serviço.",
    permissions: [
      "restaurant.floor",
      "restaurant.reservations",
      "pos.sell",
      "pos.hold",
      "products.view",
      "customers.view",
      "notifications.view",
    ],
  },
  {
    key: "stockroom",
    name: "Armazém",
    description: "Inventário, receções, transferências e contagens.",
    permissions: [
      "products.view",
      "products.manage",
      "inventory.view",
      "inventory.adjust",
      "inventory.transfer",
      "inventory.count",
      "inventory.waste",
      "suppliers.view",
      "purchasing.view",
      "purchasing.receive",
      "notifications.view",
    ],
  },
  {
    key: "accountant",
    name: "Contabilidade",
    description: "Consulta e exportação de dados financeiros (sem operação).",
    permissions: [
      "sales.view",
      "sales.export",
      "cash.view",
      "reports.view",
      "reports.export",
      "customers.view",
      "suppliers.view",
      "purchasing.view",
      "notifications.view",
    ],
  },
  {
    key: "viewer",
    name: "Observador",
    description: "Apenas leitura de relatórios.",
    permissions: ["reports.view", "sales.view", "notifications.view"],
  },
] as const as RoleTemplate[];

export function permissionsForRoleKey(key: string): Permission[] {
  return ROLE_TEMPLATES.find((r) => r.key === key)?.permissions ?? [];
}

export function isValidPermission(p: string): p is Permission {
  return (PERMISSIONS as readonly string[]).includes(p);
}
