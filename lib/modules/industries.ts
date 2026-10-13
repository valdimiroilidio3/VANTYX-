/**
 * Industry Experience Engine — declarative definition of every supported
 * business profile. The platform adapts navigation, POS mode, dashboards,
 * default modules and business rules from these definitions.
 *
 * Changing an organization's industry NEVER mutates existing data; it
 * changes which modules are *suggested/default-enabled* and how the UI is
 * assembled (see lib/services/profile.service.ts for guarded migration).
 */

export const INDUSTRIES = [
  "supermarket",
  "restaurant",
  "fashion",
  "auto_parts",
  "salon",
  "electronics",
  "wholesale",
  "construction",
  "pharmacy",
  "bookstore",
  "furniture",
  "pet",
  "services",
] as const;

export type IndustryKey = (typeof INDUSTRIES)[number];

export type PosMode = "retail" | "hospitality";

export interface IndustrySubtype {
  key: string;
  label: string;
}

export interface IndustryDefinition {
  key: IndustryKey;
  label: string;
  description: string;
  icon: string;
  subtypes: IndustrySubtype[];
  /** POS checkout experience. */
  posMode: PosMode;
  /** Modules enabled by default after onboarding. */
  defaultModules: string[];
  /** Default dashboard widget layout (industry default). */
  defaultDashboard: string[];
  /** Default org settings merged into org_profiles.settings. */
  defaultSettings: Record<string, unknown>;
  /** Business rules seeded at onboarding. */
  seedRules: SeedRule[];
  /** Payment methods enabled by default. */
  defaultPaymentMethods: string[];
}

export interface SeedRule {
  key: string;
  name: string;
  description: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
  priority: number;
}

const CASH = "cash";
const CARD = "card";
const MBWAY = "mbway";
const TRANSFER = "transfer";

export const INDUSTRY_DEFINITIONS: Record<IndustryKey, IndustryDefinition> = {
  supermarket: {
    key: "supermarket",
    label: "Supermercado / Minimercado",
    description:
      "Checkout de alta velocidade, balanças, validades, lotes e reposição.",
    icon: "shopping-cart",
    subtypes: [
      { key: "supermarket", label: "Supermercado" },
      { key: "minimarket", label: "Minimercado" },
      { key: "convenience", label: "Loja de conveniência" },
      { key: "greengrocer", label: "Frutaria / Mercearia" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog",
      "pos",
      "inventory",
      "crm",
      "cash",
      "staff",
      "analytics",
      "purchasing",
      "automation",
      "rules",
      "loyalty",
      "industry.supermarket",
    ],
    defaultDashboard: [
      "sales-today",
      "transactions-today",
      "open-terminals",
      "critical-stock",
      "expiring-batches",
      "high-rotation",
      "replenishment-queue",
      "margin-estimate",
      "cash-difference",
      "avg-ticket",
    ],
    defaultSettings: {
      stockPolicy: "warn_negative",
      barcodeEmbeddedPrefixes: ["20", "21", "22"],
      barcodeEmbeddedMode: "price",
      weighingEnabled: true,
      cycleCounting: true,
      expiryAlertDays: 14,
      fastCheckout: true,
    },
    seedRules: [
      {
        key: "discount_cap_cashier",
        name: "Limite de desconto — caixa",
        description: "Descontos acima de 10% exigem aprovação de gerente.",
        condition: { all: [{ field: "sale.line_discount_bps", op: "gt", value: 1000 }] },
        action: { type: "require_approval", kind: "discount", reason: "Desconto acima de 10%" },
        priority: 10,
      },
      {
        key: "void_requires_manager",
        name: "Anulação exige aprovação",
        description: "Anular venda exige aprovação de gerente.",
        condition: { all: [{ field: "user.role", op: "in", value: ["cashier"] }] },
        action: { type: "require_approval", kind: "void" },
        priority: 20,
      },
    ],
    defaultPaymentMethods: [CASH, CARD, MBWAY],
  },

  restaurant: {
    key: "restaurant",
    label: "Restaurante / Café / Takeaway",
    description: "Mesas, comandas, cozinha, modificadores, turnos e reservas.",
    icon: "utensils-crossed",
    subtypes: [
      { key: "restaurant", label: "Restaurante" },
      { key: "cafe", label: "Café / Pastelaria" },
      { key: "bar", label: "Bar" },
      { key: "takeaway", label: "Takeaway" },
      { key: "fastfood", label: "Fast-food" },
    ],
    posMode: "hospitality",
    defaultModules: [
      "catalog",
      "pos",
      "inventory",
      "crm",
      "cash",
      "staff",
      "analytics",
      "automation",
      "rules",
      "industry.restaurant",
    ],
    defaultDashboard: [
      "active-orders",
      "table-occupancy",
      "sales-today",
      "avg-prep-time",
      "top-dishes",
      "sales-by-shift",
      "transactions-today",
      "low-stock",
      "cash-difference",
    ],
    defaultSettings: {
      stockPolicy: "allow_negative",
      kitchenStations: ["kitchen", "bar"],
      tableService: true,
      modifiersEnabled: true,
      splitBill: true,
      theoreticalConsumption: true,
      shiftTracking: true,
    },
    seedRules: [
      {
        key: "courtesy_discount_cap",
        name: "Limite de cortesia",
        description: "Descontos de cortesia acima de 20% exigem gerente.",
        condition: { all: [{ field: "sale.line_discount_bps", op: "gt", value: 2000 }] },
        action: { type: "require_approval", kind: "discount", reason: "Cortesia acima de 20%" },
        priority: 10,
      },
    ],
    defaultPaymentMethods: [CASH, CARD, MBWAY],
  },

  fashion: {
    key: "fashion",
    label: "Roupa, Calçado & Acessórios",
    description: "Variantes por tamanho/cor, coleções, trocas e devoluções.",
    icon: "shirt",
    subtypes: [
      { key: "clothing", label: "Loja de roupa" },
      { key: "shoes", label: "Sapataria" },
      { key: "accessories", label: "Acessórios" },
      { key: "sportswear", label: "Desporto" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "inventory", "crm", "cash", "staff", "analytics",
      "purchasing", "loyalty", "industry.fashion",
    ],
    defaultDashboard: [
      "sales-today", "sales-by-size", "sales-by-color", "variant-stock",
      "top-products", "return-rate", "no-movement", "margin-estimate",
    ],
    defaultSettings: { stockPolicy: "block_negative", sizeColorMatrix: true, returnWindowDays: 30 },
    seedRules: [
      {
        key: "return_window",
        name: "Janela de devolução 30 dias",
        description: "Bloqueia devoluções fora da janela configurada (verificado no serviço).",
        condition: { all: [{ field: "refund.total_cents", op: "gt", value: 0 }] },
        action: { type: "notify", severity: "info", message: "Devolução registada" },
        priority: 10,
      },
    ],
    defaultPaymentMethods: [CASH, CARD, MBWAY],
  },

  auto_parts: {
    key: "auto_parts",
    label: "Peças Automóveis & Oficina",
    description:
      "Referências OEM, compatibilidade por veículo e ordens de reparação.",
    icon: "car",
    subtypes: [
      { key: "parts_retail", label: "Loja de peças" },
      { key: "workshop", label: "Oficina" },
      { key: "parts_and_workshop", label: "Peças + Oficina" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "inventory", "crm", "cash", "staff", "analytics",
      "purchasing", "industry.auto_parts",
    ],
    defaultDashboard: [
      "sales-today", "active-work-orders", "critical-stock", "pending-orders",
      "dead-stock-refs", "margin-estimate",
    ],
    defaultSettings: {
      stockPolicy: "block_negative",
      oemReferences: true,
      compatibilityCatalogRequired: true,
    },
    seedRules: [],
    defaultPaymentMethods: [CASH, CARD, TRANSFER],
  },

  salon: {
    key: "salon",
    label: "Barbearia, Salão & Spa",
    description: "Agenda, marcações, comissões e histórico de clientes.",
    icon: "scissors",
    subtypes: [
      { key: "barbershop", label: "Barbearia" },
      { key: "hair_salon", label: "Salão de cabeleireiro" },
      { key: "beauty_spa", label: "Estética / Spa" },
      { key: "nails", label: "Nail studio" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "crm", "cash", "staff", "analytics", "loyalty",
      "industry.salon", "automation",
    ],
    defaultDashboard: [
      "today-agenda", "sales-today", "occupancy-by-staff", "revenue-by-staff",
      "no-shows", "new-customers",
    ],
    defaultSettings: { stockPolicy: "warn_negative", commissionsEnabled: true, onlineBooking: false },
    seedRules: [],
    defaultPaymentMethods: [CASH, CARD, MBWAY],
  },

  electronics: {
    key: "electronics",
    label: "Eletrónica & Informática",
    description: "Séries, IMEI, garantias, RMA e ordens de serviço.",
    icon: "cpu",
    subtypes: [
      { key: "electronics", label: "Eletrónica" },
      { key: "computer_store", label: "Informática" },
      { key: "mobile", label: "Telemóveis" },
      { key: "repair", label: "Reparações" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "inventory", "crm", "cash", "staff", "analytics",
      "purchasing", "industry.electronics",
    ],
    defaultDashboard: [
      "sales-today", "rma-open", "warranty-expiring", "critical-stock",
      "top-products", "margin-estimate",
    ],
    defaultSettings: { stockPolicy: "block_negative", serialTracking: true },
    seedRules: [],
    defaultPaymentMethods: [CASH, CARD, MBWAY, TRANSFER],
  },

  wholesale: {
    key: "wholesale",
    label: "Armazém, Distribuidor & Grossista",
    description: "Preços por cliente, escalões, crédito comercial e picking.",
    icon: "container",
    subtypes: [
      { key: "distributor", label: "Distribuidor" },
      { key: "cash_carry", label: "Cash & Carry" },
      { key: "warehouse", label: "Armazém" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "inventory", "crm", "cash", "staff", "analytics",
      "purchasing", "multibranch", "industry.wholesale", "rules",
    ],
    defaultDashboard: [
      "credit-exposure", "sales-today", "top-b2b-customers", "pending-orders",
      "critical-stock", "stock-valuation",
    ],
    defaultSettings: { stockPolicy: "block_negative", pricesIncludeTax: false, creditApproval: true },
    seedRules: [
      {
        key: "po_approval_limit",
        name: "Aprovação de compras > 2.500 €",
        description: "Encomendas acima do limite exigem aprovação.",
        condition: { all: [{ field: "purchase.total_cents", op: "gt", value: 250000 }] },
        action: { type: "require_approval", kind: "purchase" },
        priority: 10,
      },
    ],
    defaultPaymentMethods: [TRANSFER, CARD, CASH],
  },

  construction: {
    key: "construction",
    label: "Materiais de Construção",
    description: "Venda por medida, entregas a obra e preços profissionais.",
    icon: "hard-hat",
    subtypes: [
      { key: "building_materials", label: "Materiais de construção" },
      { key: "hardware", label: "Ferragens / Bricolage" },
      { key: "tiles_sanitary", label: "Cerâmica e sanitários" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "inventory", "crm", "cash", "staff", "analytics",
      "purchasing", "industry.construction",
    ],
    defaultDashboard: [
      "sales-today", "deliveries-pending", "critical-stock", "stock-valuation",
      "top-products",
    ],
    defaultSettings: { stockPolicy: "block_negative", unitConversions: true, deliveries: true },
    seedRules: [],
    defaultPaymentMethods: [CASH, CARD, TRANSFER],
  },

  pharmacy: {
    key: "pharmacy",
    label: "Farmácia (âmbito limitado)",
    description:
      "Apenas funcionalidades legalmente permitidas no país configurado. Não inclui dispensa, receitas eletrónicas nem substâncias regulamentadas.",
    icon: "pill",
    subtypes: [
      { key: "pharmacy_retail", label: "Farmácia (retalho não medicamentoso)" },
      { key: "parapharmacy", label: "Parafarmácia" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "inventory", "crm", "cash", "staff", "analytics",
      "purchasing", "industry.pharmacy", "automation",
    ],
    defaultDashboard: [
      "sales-today", "expiring-batches", "critical-stock", "transactions-today",
      "margin-estimate",
    ],
    defaultSettings: {
      stockPolicy: "block_negative",
      batchTracking: true,
      expiryAlertDays: 60,
      legalNotice:
        "Dispensa de medicamentos e receitas eletrónicas fora do âmbito sem validação legal.",
    },
    seedRules: [],
    defaultPaymentMethods: [CASH, CARD, MBWAY],
  },

  bookstore: {
    key: "bookstore",
    label: "Livraria & Papelaria",
    description: "ISBN, editoras, listas escolares e sazonalidade.",
    icon: "book-open",
    subtypes: [
      { key: "bookstore", label: "Livraria" },
      { key: "stationery", label: "Papelaria" },
      { key: "both", label: "Livraria + Papelaria" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "inventory", "crm", "cash", "staff", "analytics",
      "purchasing", "industry.bookstore",
    ],
    defaultDashboard: [
      "sales-today", "top-products", "critical-stock", "no-movement",
      "margin-estimate",
    ],
    defaultSettings: { stockPolicy: "warn_negative", isbnSupport: true, schoolLists: true },
    seedRules: [],
    defaultPaymentMethods: [CASH, CARD, MBWAY],
  },

  furniture: {
    key: "furniture",
    label: "Móveis & Decoração",
    description: "Configuráveis, encomendas, adiantamentos e entregas.",
    icon: "armchair",
    subtypes: [
      { key: "furniture", label: "Mobiliário" },
      { key: "decor", label: "Decoração" },
      { key: "kitchens", label: "Cozinhas" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "inventory", "crm", "cash", "staff", "analytics",
      "purchasing", "industry.furniture",
    ],
    defaultDashboard: [
      "sales-today", "backorder-status", "deliveries-pending", "top-products",
    ],
    defaultSettings: { stockPolicy: "block_negative", depositsEnabled: true, madeToOrder: true },
    seedRules: [],
    defaultPaymentMethods: [CASH, CARD, TRANSFER],
  },

  pet: {
    key: "pet",
    label: "Pet Shop",
    description: "Catálogo por espécie, lotes/validades e packs.",
    icon: "paw-print",
    subtypes: [
      { key: "pet_shop", label: "Pet shop" },
      { key: "pet_food", label: "Alimentação animal" },
      { key: "grooming", label: "Pet shop + Grooming" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "inventory", "crm", "cash", "staff", "analytics",
      "purchasing", "loyalty", "industry.pet",
    ],
    defaultDashboard: [
      "sales-today", "expiring-batches", "critical-stock", "top-products",
      "new-customers",
    ],
    defaultSettings: { stockPolicy: "warn_negative", speciesCatalog: true, expiryAlertDays: 30 },
    seedRules: [],
    defaultPaymentMethods: [CASH, CARD, MBWAY],
  },

  services: {
    key: "services",
    label: "Serviços & Multi-Filial",
    description: "Empresas de serviços e organizações com várias filiais.",
    icon: "briefcase",
    subtypes: [
      { key: "services", label: "Serviços" },
      { key: "multi_branch_retail", label: "Retalho multi-filial" },
      { key: "agency", label: "Agência" },
    ],
    posMode: "retail",
    defaultModules: [
      "catalog", "pos", "crm", "cash", "staff", "analytics", "multibranch",
      "purchasing", "automation",
    ],
    defaultDashboard: [
      "sales-today", "sales-by-branch", "transactions-today",
      "new-customers", "margin-estimate",
    ],
    defaultSettings: { stockPolicy: "allow_negative", multiBranch: true },
    seedRules: [],
    defaultPaymentMethods: [TRANSFER, CARD, CASH],
  },
};

export function getIndustry(key: string): IndustryDefinition | null {
  return (INDUSTRY_DEFINITIONS as Record<string, IndustryDefinition>)[key] ?? null;
}

export function isIndustryKey(key: string): key is IndustryKey {
  return INDUSTRIES.includes(key as IndustryKey);
}

/** POS mode determines the checkout experience (retail grid vs floor/tables). */
export function posModeFor(industry: IndustryKey): PosMode {
  return INDUSTRY_DEFINITIONS[industry].posMode;
}
