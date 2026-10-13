import { getDb } from "@/lib/db/client";

/**
 * Integration Registry — decoupled adapters for hardware and services.
 *
 * Honesty rule: an integration is NEVER reported as connected unless it
 * genuinely is. Adapters without credentials/hardware report
 * `not_configured` with an explicit list of what is missing. Two adapters
 * work with zero configuration because they use the browser platform:
 *   - barcode_scanner (keyboard-wedge HID)
 *   - receipt_printer (browser print pipeline)
 */

export type IntegrationStatus =
  | "not_configured"
  | "configured"
  | "error"
  | "disabled"
  | "ready_builtin";

export interface IntegrationDefinition {
  key: string;
  name: string;
  category: "payments" | "printing" | "input" | "messaging" | "finance" | "commerce" | "logistics" | "fiscal";
  description: string;
  /** What must exist for this integration to work. */
  requires: string[];
  /** Config fields (non-secret) stored per org. */
  configFields: { key: string; label: string; type: "text" | "number" | "select" | "boolean"; options?: string[] }[];
  /** Whether secrets are needed (stored ONLY server-side/env, never in repo or frontend). */
  requiresCredentials: boolean;
  /** Built-in adapters work without any configuration. */
  builtin?: boolean;
  docsNote: string;
}

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    key: "barcode_scanner",
    name: "Leitor de códigos de barras",
    category: "input",
    description:
      "Leitores USB keyboard-wedge (HID): o scanner escreve o código no campo ativo e termina com Enter. Suporta EAN-13/EAN-8/UPC e códigos embutidos de balança (prefixo configurável).",
    requires: ["Leitor HID USB/Bluetooth", "Foco no campo de scan do POS"],
    configFields: [
      { key: "embeddedPrefixes", label: "Prefixos de balança (CSV)", type: "text" },
      { key: "embeddedMode", label: "Modo embutido", type: "select", options: ["price", "weight"] },
    ],
    requiresCredentials: false,
    builtin: true,
    docsNote: "Sem driver: qualquer leitor keyboard-wedge funciona. Validação de checksum EAN no servidor.",
  },
  {
    key: "receipt_printer",
    name: "Impressora de recibos (browser)",
    category: "printing",
    description:
      "Impressão de talões 80mm através da pipeline de impressão do browser/OS (qualquer impressora térmica instalada no sistema). Layout de talão com totais, impostos e hash do documento.",
    requires: ["Impressora térmica instalada no OS do terminal"],
    configFields: [
      { key: "paperWidth", label: "Largura papel (mm)", type: "select", options: ["58", "80"] },
      { key: "autoPrint", label: "Imprimir automaticamente após venda", type: "boolean" },
    ],
    requiresCredentials: false,
    builtin: true,
    docsNote: "Adaptador nativo do browser. Para impressão direta sem diálogo (ESC/POS raw) é necessário um serviço local — contrato preparado, estado: não configurado.",
  },
  {
    key: "escpos_direct",
    name: "Impressão ESC/POS direta",
    category: "printing",
    description:
      "Contrato para serviço local de impressão raw ESC/POS (fila de impressão dedicada, gaveta de dinheiro via pulse). Requer agente local instalado no terminal.",
    requires: ["Agente local VANTYX Print Agent", "Impressora ESC/POS na rede/USB"],
    configFields: [
      { key: "endpoint", label: "Endpoint do agente (http://localhost:PORT)", type: "text" },
      { key: "kickDrawer", label: "Abrir gaveta após venda", type: "boolean" },
    ],
    requiresCredentials: false,
    docsNote: "Adapter contract definido; sem agente instalado o estado permanece not_configured.",
  },
  {
    key: "payment_terminal",
    name: "Terminal de pagamento (TPA)",
    category: "payments",
    description:
      "Integração com terminais TPA via fornecedor certificado. O VANTYX NÃO armazena dados de cartões: o fluxo é sempre iniciado no terminal do fornecedor (valor enviado, confirmação recebida).",
    requires: ["Contrato com fornecedor de pagamentos", "Credenciais de API (env)", "Terminal físico"],
    configFields: [
      { key: "provider", label: "Fornecedor", type: "select", options: ["", "stripe_terminal", "sumup", "mb_net", "outro"] },
      { key: "merchantId", label: "Merchant ID", type: "text" },
    ],
    requiresCredentials: true,
    docsNote:
      "Estados de pagamento suportados: pending → confirmed/declined, refunded. Sem credenciais, pagamentos por cartão são registados manualmente pelo operador (confirmação humana explícita).",
  },
  {
    key: "scale",
    name: "Balança",
    category: "input",
    description:
      "Balanças com impressão de etiquetas EAN-13 embutidas (preço ou peso) já funcionam via leitor de códigos de barras. Integração serial direta (protocolo do fabricante) é contrato separado.",
    requires: ["Balança etiquetadora", "Configuração de prefixos EAN embutidos"],
    configFields: [
      { key: "embeddedPrefixes", label: "Prefixos (CSV)", type: "text" },
      { key: "embeddedMode", label: "Payload", type: "select", options: ["price", "weight"] },
    ],
    requiresCredentials: false,
    builtin: true,
    docsNote: "Modo etiquetas: pronto a usar. Modo serial direto: contrato preparado, requer driver do fabricante.",
  },
  {
    key: "label_printer",
    name: "Impressora de etiquetas",
    category: "printing",
    description:
      "Etiquetas de preço/produto (EAN-13) via impressão do browser (folhas A4 de etiquetas) — pronto a usar. ZPL direto requer agente local.",
    requires: ["Impressora de etiquetas ou folhas A4"],
    configFields: [{ key: "template", label: "Template", type: "select", options: ["a4_sheet", "zpl_agent"] }],
    requiresCredentials: false,
    builtin: true,
    docsNote: "Template A4 gera PDF imprimível no browser. ZPL requer agente (not_configured).",
  },
  {
    key: "email",
    name: "Email transacional",
    category: "messaging",
    description: "Envio de recibos, convites de utilizador e alertas por email via SMTP/API (Resend, SendGrid, etc.).",
    requires: ["Fornecedor de email", "Credenciais SMTP/API (env)"],
    configFields: [
      { key: "fromAddress", label: "Remetente", type: "text" },
      { key: "provider", label: "Fornecedor", type: "select", options: ["", "smtp", "resend", "sendgrid"] },
    ],
    requiresCredentials: true,
    docsNote: "Sem credenciais: convites mostram o link em ecrã (entrega manual), relatórios exportam-se por download.",
  },
  {
    key: "whatsapp",
    name: "WhatsApp Business",
    category: "messaging",
    description: "Lembretes de marcação e notificações via WhatsApp Business API (fornecedor autorizado: Twilio/Meta Cloud API).",
    requires: ["Conta WhatsApp Business API", "Token de API (env)", "Templates aprovados"],
    configFields: [{ key: "provider", label: "Fornecedor", type: "select", options: ["", "twilio", "meta_cloud"] }],
    requiresCredentials: true,
    docsNote: "Webhooks: endpoint /api/integrations/webhook/whatsapp preparado com verificação de assinatura e dedupe de eventos.",
  },
  {
    key: "accounting",
    name: "Contabilidade (export)",
    category: "finance",
    description: "Exportação contabilística (CSV normalizado de vendas, impostos e movimentos) e contrato para APIs de contabilidade.",
    requires: ["Formato exigido pelo contabilista"],
    configFields: [{ key: "format", label: "Formato", type: "select", options: ["csv_pt", "csv_generic", "api"] }],
    requiresCredentials: false,
    builtin: true,
    docsNote: "CSV pronto a usar em Relatórios → Exportação. Integração API: contrato preparado.",
  },
  {
    key: "ecommerce",
    name: "E-commerce / Marketplaces",
    category: "commerce",
    description: "Sincronização de catálogo e stock com loja online/marketplaces (Shopify, WooCommerce…).",
    requires: ["Credenciais da loja", "Mapeamento de produtos"],
    configFields: [{ key: "platform", label: "Plataforma", type: "select", options: ["", "shopify", "woocommerce", "outro"] }],
    requiresCredentials: true,
    docsNote: "Contrato de sincronização definido (idempotente, com fila). Sem credenciais: estado not_configured.",
  },
  {
    key: "shipping",
    name: "Transportadoras",
    category: "logistics",
    description: "Geração de guias de transporte e tracking (CTT Expresso, DPD, GLS…).",
    requires: ["Conta na transportadora", "Credenciais API (env)"],
    configFields: [{ key: "carrier", label: "Transportadora", type: "select", options: ["", "ctt", "dpd", "gls"] }],
    requiresCredentials: true,
    docsNote: "Guias internas (GT) funcionam sem integração; etiquetas de transportadora requerem API.",
  },
  {
    key: "fiscal_pt",
    name: "Fiscalidade Portugal (AT)",
    category: "fiscal",
    description:
      "Comunicação de documentos à AT, ATCUD e SAF-T (PT). Requer certificação do software e credenciais da AT — NÃO ativo por omissão. A plataforma mantém cadeia de hash e numeração controlada desde já.",
    requires: [
      "Certificação de software pela AT (processo legal)",
      "Credenciais webservice AT (env)",
      "Código ATCUD atribuído",
    ],
    configFields: [{ key: "atcudPrefix", label: "Prefixo ATCUD (quando emitido)", type: "text" }],
    requiresCredentials: true,
    docsNote:
      "Estado honesto: pendente de validação legal. Não declaramos conformidade fiscal sem certificação. Ver docs/COMPLIANCE.md.",
  },
];

export function getIntegrationDefinition(key: string): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((i) => i.key === key);
}

export interface OrgIntegrationState {
  definition: IntegrationDefinition;
  status: IntegrationStatus;
  config: Record<string, unknown>;
  credentialsSet: boolean;
  lastTestAt: number | null;
  lastError: string | null;
  missing: string[];
}

export function listIntegrationStates(orgId: string): OrgIntegrationState[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM integrations WHERE org_id = ?`)
    .all(orgId) as {
    key: string;
    status: string;
    config: string;
    credentials_set: number;
    last_test_at: number | null;
    last_error: string | null;
  }[];
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return INTEGRATIONS.map((definition) => {
    const row = byKey.get(definition.key);
    const config = row ? (JSON.parse(row.config) as Record<string, unknown>) : {};
    const credentialsSet = row?.credentials_set === 1;
    let status: IntegrationStatus = (row?.status as IntegrationStatus) ?? "not_configured";
    const missing: string[] = [];
    if (definition.builtin && !row) status = "ready_builtin";
    if (definition.requiresCredentials && !credentialsSet) {
      if (status !== "disabled") status = "not_configured";
      missing.push(...definition.requires);
    }
    return {
      definition,
      status,
      config,
      credentialsSet,
      lastTestAt: row?.last_test_at ?? null,
      lastError: row?.last_error ?? null,
      missing,
    };
  });
}

export function saveIntegrationConfig(
  orgId: string,
  key: string,
  config: Record<string, unknown>,
  credentialsSet: boolean,
): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT INTO integrations (org_id, key, status, config, credentials_set, updated_at)
     VALUES (?, ?, 'configured', ?, ?, ?)
     ON CONFLICT(org_id, key) DO UPDATE SET
       config = excluded.config, credentials_set = excluded.credentials_set,
       status = 'configured', updated_at = excluded.updated_at`,
  ).run(orgId, key, JSON.stringify(config), credentialsSet ? 1 : 0, now);
}

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
}

/** Connection test — honest results only. */
export function testIntegration(orgId: string, key: string): IntegrationTestResult {
  const definition = getIntegrationDefinition(key);
  if (!definition) return { ok: false, message: "Integração desconhecida." };
  const db = getDb();
  let result: IntegrationTestResult;
  if (definition.builtin) {
    result = {
      ok: true,
      message:
        definition.key === "barcode_scanner"
          ? "Pronto: leitores keyboard-wedge funcionam sem configuração. Teste digitalizando um código no campo de scan do POS."
          : "Pronto: usa a pipeline de impressão do browser. Teste imprimindo um talão de venda.",
    };
  } else {
    const row = db.prepare(`SELECT credentials_set, config FROM integrations WHERE org_id = ? AND key = ?`).get(orgId, key) as { credentials_set: number; config: string } | undefined;
    if (!row || row.credentials_set !== 1) {
      result = {
        ok: false,
        message: `Não configurado. Em falta: ${definition.requires.join("; ")}. Credenciais devem ser definidas no ambiente do servidor (env), nunca no frontend.`,
      };
    } else {
      result = {
        ok: false,
        message: `Configuração guardada, mas o teste de ligação real requer o adaptador do fornecedor ativo (${definition.docsNote}). Estado mantido como não verificado — não simulamos ligação.`,
      };
    }
  }
  db.prepare(
    `INSERT INTO integrations (org_id, key, status, config, credentials_set, last_test_at, last_error, updated_at)
     VALUES (?, ?, ?, '{}', 0, ?, ?, ?)
     ON CONFLICT(org_id, key) DO UPDATE SET last_test_at = excluded.last_test_at, last_error = excluded.last_error, updated_at = excluded.updated_at`,
  ).run(orgId, key, result.ok ? "configured" : "not_configured", Date.now(), result.ok ? null : result.message, Date.now());
  return result;
}
