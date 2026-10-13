"use client";

/**
 * /settings/integrations — Integration Registry UI.
 *
 * Honesty rules enforced here and on the server:
 * - Secrets are NEVER accepted through the API/frontend — only a boolean
 *   stating that credentials exist in the SERVER environment.
 * - "Test" never simulates a connection: with no adapter/credentials it
 *   reports exactly what is missing (status stays not_configured).
 * - Built-in adapters (e.g. keyboard-wedge barcode scanner) work with no
 *   configuration and are labelled as such.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, FlaskConical, Loader2, Plug, Plus, Settings2, XCircle } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, Toggle } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { useToast } from "@/components/system/toast";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format";

interface ConfigField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "boolean";
  options?: string[];
}

interface IntegrationState {
  key: string;
  name: string;
  category: string;
  description: string;
  requires: string[];
  configFields: ConfigField[];
  requiresCredentials: boolean;
  builtin: boolean;
  docsNote: string;
  status: string;
  config: Record<string, unknown>;
  credentialsSet: boolean;
  lastTestAt: number | null;
  lastError: string | null;
  missing: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  payments: "Pagamentos",
  printing: "Impressão",
  input: "Entrada de dados",
  messaging: "Mensagens / Email",
  finance: "Finanças / Contabilidade",
  commerce: "Comércio online",
  logistics: "Logística",
  fiscal: "Fiscal",
};

function StatusBadge({ s }: { s: IntegrationState }) {
  if (s.builtin && s.status !== "not_configured") {
    return (
      <Badge tone="success">
        <CheckCircle2 className="h-3 w-3" /> Integrado (nativo)
      </Badge>
    );
  }
  if (s.status === "configured") {
    return (
      <Badge tone="info">
        <CheckCircle2 className="h-3 w-3" /> Configurado
      </Badge>
    );
  }
  return (
    <Badge tone="warning">
      <XCircle className="h-3 w-3" /> Não configurado
    </Badge>
  );
}

export default function IntegrationsPage() {
  const toast = useToast();
  const [rows, setRows] = useState<IntegrationState[] | null>(null);
  const [editing, setEditing] = useState<IntegrationState | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<IntegrationState[]>("/api/settings/integrations"));
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro ao carregar integrações.");
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  async function test(key: string) {
    setTesting(key);
    try {
      const result = await api<{ ok: boolean; message: string }>("/api/settings/integrations", {
        body: { action: "test", key },
      });
      if (result.ok) toast.success(result.message);
      else toast.warning(result.message);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro no teste.");
    } finally {
      setTesting(null);
    }
  }

  const categories = [...new Set((rows ?? []).map((r) => r.category))];

  return (
    <div>
      <PageHeader
        title="Integrações"
        subtitle="Adaptadores por configurar ou ativos. Sem credenciais, o estado é honestamente «não configurado» — nunca simulamos ligações."
      />
      <div className="p-4">
        <SettingsNav />

        {!rows ? (
          <div className="flex justify-center py-16 text-graphite-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !rows.length ? (
          <Card>
            <EmptyState icon={<Plug className="h-8 w-8" />} title="Sem integrações registadas" />
          </Card>
        ) : (
          <div className="space-y-6">
            {categories.map((cat) => (
              <Card key={cat}>
                <CardHeader title={CATEGORY_LABELS[cat] ?? cat} icon={<Plug className="h-4 w-4" />} />
                <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                  {rows
                    .filter((r) => r.category === cat)
                    .map((r) => (
                      <div key={r.key} className="flex flex-col rounded-lg border border-mist-200 bg-white p-4 dark:border-graphite-700 dark:bg-graphite-850">
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold leading-tight">{r.name}</p>
                          <StatusBadge s={r} />
                        </div>
                        <p className="mt-2 line-clamp-3 flex-1 text-xs text-graphite-500 dark:text-graphite-300">{r.description}</p>
                        {r.missing.length > 0 && (
                          <p className="mt-2 text-xs font-medium text-warning">Em falta: {r.missing.join("; ")}</p>
                        )}
                        {r.requiresCredentials && (
                          <p className="mt-1 text-xs text-graphite-400">
                            Credenciais: {r.credentialsSet ? "presentes no ambiente do servidor" : "ausentes (definir no env do servidor — nunca no frontend)"}
                          </p>
                        )}
                        {r.lastTestAt && (
                          <p className="mt-1 text-xs text-graphite-400">
                            Último teste: {fmtDateTime(r.lastTestAt)}
                            {r.lastError ? ` — ${r.lastError}` : ""}
                          </p>
                        )}
                        <div className="mt-3 flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" disabled={testing === r.key} onClick={() => test(r.key)}>
                            {testing === r.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                            Testar
                          </Button>
                          {r.configFields.length > 0 && (
                            <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                              <Settings2 className="h-3.5 w-3.5" /> Configurar
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </Card>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs text-graphite-400">
          <Plus className="mr-1 inline h-3 w-3" />
          Novos adaptadores são adicionados ao registo em <code className="font-mono">lib/integrations/registry.ts</code>{" "}
          (definição + teste honesto). Cada integração declara o que requer; nada é dado como ligado sem verificação.
        </p>

        {editing && (
          <ConfigModal
            integration={editing}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await load();
            }}
          />
        )}
      </div>
    </div>
  );
}

function ConfigModal({
  integration,
  onClose,
  onSaved,
}: {
  integration: IntegrationState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [config, setConfig] = useState<Record<string, unknown>>({ ...integration.config });
  const [credentialsSet, setCredentialsSet] = useState(integration.credentialsSet);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api("/api/settings/integrations", {
        body: { action: "save", key: integration.key, config, credentialsSet },
      });
      toast.success("Configuração guardada (sem segredos — apenas configuração não sensível).");
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro ao guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Configurar ${integration.name}`} wide>
      <div className="space-y-4">
        <p className="text-xs text-graphite-400">{integration.docsNote}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {integration.configFields.map((f) => (
            <Field key={f.key} label={f.label}>
              {f.type === "select" ? (
                <select
                  className="input-base"
                  value={String(config[f.key] ?? "")}
                  onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
                >
                  <option value="">—</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : f.type === "boolean" ? (
                <div className="flex h-9.5 items-center">
                  <Toggle
                    checked={Boolean(config[f.key])}
                    onChange={(v) => setConfig({ ...config, [f.key]: v })}
                    label={f.label}
                  />
                </div>
              ) : (
                <input
                  type={f.type === "number" ? "number" : "text"}
                  className="input-base"
                  value={config[f.key] != null ? String(config[f.key]) : ""}
                  onChange={(e) =>
                    setConfig({ ...config, [f.key]: f.type === "number" ? Number(e.target.value) : e.target.value })
                  }
                />
              )}
            </Field>
          ))}
        </div>
        {integration.requiresCredentials && (
          <div className="rounded-lg border border-warning/40 bg-warning/5 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={credentialsSet}
                onChange={(e) => setCredentialsSet(e.target.checked)}
              />
              <span>
                Confirmo que as credenciais desta integração foram definidas no <strong>ambiente do servidor</strong>{" "}
                (variáveis de ambiente). Segredos nunca são enviados, guardados na BD do cliente ou expostos no frontend.
              </span>
            </label>
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar configuração
        </Button>
      </div>
    </Modal>
  );
}
