"use client";

/**
 * /settings/rules — Business Rules Engine UI.
 *
 * Rules are fully declarative: whitelisted fields × fixed operators × fixed
 * action types. There is NO arbitrary code execution anywhere in this engine
 * (spec requirement). Every relevant execution is logged and shown below.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2, Pencil, Plus, ShieldCheck, Trash2, Workflow } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, Toggle } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { useToast } from "@/components/system/toast";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format";
import type { BusinessRule, RuleAction, RuleCondition, RuleField, RuleOperator } from "@/lib/domain/rules-engine";

interface ExecutionRow {
  id: string;
  rule_id: string;
  rule_name: string;
  rule_key: string;
  context: string;
  result: string;
  detail: string | null;
  ref_type: string | null;
  ref_id: string | null;
  executed_by: string | null;
  executed_at: number;
}

const FIELD_LABELS: Record<string, string> = {
  "sale.total_cents": "Total da venda (cêntimos)",
  "sale.discount_bps": "Desconto da venda (bps)",
  "sale.line_discount_bps": "Desconto de linha (bps)",
  "sale.channel": "Canal da venda",
  "sale.items_count": "Nº de artigos na venda",
  "line.margin_bps": "Margem da linha (bps)",
  "user.role": "Função do utilizador",
  "user.id": "ID do utilizador",
  "terminal.id": "ID do terminal",
  "branch.id": "ID da filial",
  "purchase.total_cents": "Total da compra (cêntimos)",
  "refund.total_cents": "Total do reembolso (cêntimos)",
  "stock.qty_milli": "Quantidade em stock (mili)",
  "customer.credit_balance_cents": "Saldo do cliente (cêntimos)",
  hour_of_day: "Hora do dia (0–23)",
};

const OP_LABELS: Record<string, string> = {
  eq: "= igual",
  neq: "≠ diferente",
  gt: "> maior",
  gte: "≥ maior ou igual",
  lt: "< menor",
  lte: "≤ menor ou igual",
  in: "∈ pertence a",
  not_in: "∉ não pertence a",
};

const ACTION_LABELS: Record<string, string> = {
  allow: "Permitir",
  block: "Bloquear",
  require_approval: "Exigir aprovação",
  cap_discount_bps: "Limitar desconto",
  notify: "Notificar",
};

const RESULT_TONES: Record<string, "success" | "danger" | "warning" | "info" | "neutral"> = {
  allowed: "success",
  blocked: "danger",
  approval_required: "warning",
  applied: "info",
  skipped: "neutral",
};

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : "Erro inesperado.";
}

export default function RulesPage() {
  const toast = useToast();
  const [tab, setTab] = useState<"rules" | "executions">("rules");
  const [rules, setRules] = useState<BusinessRule[] | null>(null);
  const [fields, setFields] = useState<RuleField[]>([]);
  const [operators, setOperators] = useState<RuleOperator[]>([]);
  const [executions, setExecutions] = useState<ExecutionRow[] | null>(null);
  const [editing, setEditing] = useState<BusinessRule | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    try {
      const data = await api<{ rules: BusinessRule[]; allowedFields: RuleField[]; allowedOperators: RuleOperator[] }>("/api/rules");
      setRules(data.rules);
      setFields(data.allowedFields);
      setOperators(data.allowedOperators);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [toast]);
  const loadExecutions = useCallback(async () => {
    try {
      const data = await api<{ executions: ExecutionRow[] }>("/api/rules", { query: { view: "executions" } });
      setExecutions(data.executions);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [toast]);
  useEffect(() => {
    void loadRules();
    void loadExecutions();
  }, [loadRules, loadExecutions]);

  async function toggleEnabled(rule: BusinessRule) {
    setBusyId(rule.id);
    try {
      await api("/api/rules", { body: { ...rule, enabled: !rule.enabled } });
      toast.success(rule.enabled ? "Regra desativada." : "Regra ativada.");
      await loadRules();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Regras de negócio" subtitle="Motor declarativo e auditável — sem execução de código arbitrário." />
      <div className="p-4">
        <SettingsNav />

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant={tab === "rules" ? "primary" : "secondary"} onClick={() => setTab("rules")}>
            <ShieldCheck className="h-4 w-4" /> Regras ({rules?.length ?? 0})
          </Button>
          <Button
            size="sm"
            variant={tab === "executions" ? "primary" : "secondary"}
            onClick={() => {
              setTab("executions");
              void loadExecutions();
            }}
          >
            <Activity className="h-4 w-4" /> Execuções recentes
          </Button>
          <div className="flex-1" />
          {tab === "rules" && (
            <Button size="sm" variant="accent" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Nova regra
            </Button>
          )}
        </div>

        {tab === "rules" ? (
          <Card>
            <CardHeader
              title="Regras"
              subtitle="Prioridade mais baixa é avaliada primeiro. Regras do setor continuam ativas internamente mesmo sem regras personalizadas."
              icon={<ShieldCheck className="h-4 w-4" />}
            />
            <div className="p-4">
              {!rules ? (
                <div className="flex justify-center py-10 text-graphite-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : !rules.length ? (
                <EmptyState
                  icon={<Workflow className="h-8 w-8" />}
                  title="Sem regras personalizadas"
                  message="Crie regras para exigir aprovações, bloquear operações, limitar descontos ou gerar notificações."
                />
              ) : (
                <ul className="divide-y divide-mist-200 dark:divide-graphite-700">
                  {rules.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{r.name}</p>
                          <code className="rounded bg-mist-100 px-1.5 py-0.5 font-mono text-[11px] text-graphite-500 dark:bg-graphite-800 dark:text-graphite-300">
                            {r.key}
                          </code>
                          <Badge tone={r.enabled ? "success" : "neutral"}>{r.enabled ? "Ativa" : "Inativa"}</Badge>
                          <Badge tone="info">{ACTION_LABELS[r.action.type] ?? r.action.type}</Badge>
                          <span className="text-xs text-graphite-400">prioridade {r.priority}</span>
                        </div>
                        <p className="mt-1 text-xs text-graphite-500 dark:text-graphite-300">
                          {describeCondition(r.condition)} → {describeAction(r.action)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Toggle checked={r.enabled} onChange={() => toggleEnabled(r)} disabled={busyId === r.id} label={`Ativar ${r.name}`} />
                        <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                          <Pencil className="h-3.5 w-3.5" /> Editar
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ) : (
          <Card>
            <CardHeader
              title="Execuções recentes"
              subtitle="Últimas 50 avaliações de regras (permitido / bloqueado / aprovação / aplicado)."
              icon={<Activity className="h-4 w-4" />}
            />
            <div className="p-4">
              {!executions ? (
                <div className="flex justify-center py-10 text-graphite-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : !executions.length ? (
                <EmptyState icon={<Activity className="h-8 w-8" />} title="Sem execuções" message="As execuções aparecem aqui quando operações acionam regras." />
              ) : (
                <ul className="divide-y divide-mist-200 dark:divide-graphite-700">
                  {executions.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {e.rule_name}
                          <Badge tone={RESULT_TONES[e.result] ?? "neutral"}>{e.result}</Badge>
                        </p>
                        <p className="text-xs text-graphite-400">
                          {e.detail ?? "—"}
                          {e.ref_type ? ` · ${e.ref_type}${e.ref_id ? ` ${e.ref_id}` : ""}` : ""}
                          {e.executed_by ? ` · por ${e.executed_by}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-graphite-400">{fmtDateTime(e.executed_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        )}

        {editing && (
          <RuleModal
            rule={editing === "new" ? null : editing}
            fields={fields}
            operators={operators}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await loadRules();
            }}
          />
        )}
      </div>
    </div>
  );
}

function describeCondition(c: BusinessRule["condition"]): string {
  const parts = [...(c.all ?? []), ...(c.any ?? [])].map(
    (x) =>
      `${FIELD_LABELS[x.field] ?? x.field} ${OP_LABELS[x.op] ?? x.op} ${
        Array.isArray(x.value) ? `[${x.value.join(", ")}]` : String(x.value)
      }`,
  );
  if (!parts.length) return "sempre";
  const joiner = c.all && c.any ? " · " : c.any ? " OU " : " E ";
  return parts.join(joiner);
}

function describeAction(a: RuleAction): string {
  switch (a.type) {
    case "allow":
      return "permitir";
    case "block":
      return `bloquear (${a.reason})`;
    case "require_approval":
      return `exigir aprovação "${a.kind}"${a.reason ? ` — ${a.reason}` : ""}`;
    case "cap_discount_bps":
      return `limitar desconto a ${(a.maxBps / 100).toFixed(0)}%`;
    case "notify":
      return `notificar [${a.severity}] ${a.message}`;
  }
}

function RuleModal({
  rule,
  fields,
  operators,
  onClose,
  onSaved,
}: {
  rule: BusinessRule | null;
  fields: RuleField[];
  operators: RuleOperator[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    key: rule?.key ?? "",
    name: rule?.name ?? "",
    description: rule?.description ?? "",
    priority: rule?.priority ?? 100,
    enabled: rule?.enabled ?? true,
    join: rule?.condition.any && !rule?.condition.all ? "any" : "all",
  });
  const [conditions, setConditions] = useState<RuleCondition[]>([...(rule?.condition.all ?? []), ...(rule?.condition.any ?? [])]);
  const [action, setAction] = useState<RuleAction>(rule?.action ?? { type: "notify", severity: "warning", message: "" });
  const [busy, setBusy] = useState(false);

  function updateCondition(i: number, patch: Partial<RuleCondition>) {
    setConditions(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function parseValue(op: RuleOperator, raw: string): RuleCondition["value"] {
    if (op === "in" || op === "not_in") {
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (/^-?\d+$/.test(s) ? Number(s) : s));
    }
    if (/^-?\d+$/.test(raw.trim())) return Number(raw.trim());
    if (raw === "true") return true;
    if (raw === "false") return false;
    return raw;
  }

  async function submit() {
    if (!form.key || !form.name || !conditions.length) {
      toast.error("Chave, nome e pelo menos uma condição são obrigatórios.");
      return;
    }
    if (action.type === "block" && !action.reason.trim()) {
      toast.error("A ação bloquear exige um motivo.");
      return;
    }
    if (action.type === "notify" && !action.message.trim()) {
      toast.error("A ação notificar exige uma mensagem.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/rules", {
        body: {
          ...(rule ? { id: rule.id } : {}),
          key: form.key,
          name: form.name,
          description: form.description || undefined,
          condition: form.join === "any" ? { any: conditions } : { all: conditions },
          action,
          priority: form.priority,
          enabled: form.enabled,
        },
      });
      toast.success(rule ? "Regra atualizada." : "Regra criada.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  function setActionType(type: RuleAction["type"]) {
    switch (type) {
      case "allow":
        setAction({ type: "allow" });
        break;
      case "block":
        setAction({ type: "block", reason: action.type === "block" ? action.reason : "" });
        break;
      case "require_approval":
        setAction({ type: "require_approval", kind: action.type === "require_approval" ? action.kind : "purchase", reason: "" });
        break;
      case "cap_discount_bps":
        setAction({ type: "cap_discount_bps", maxBps: action.type === "cap_discount_bps" ? action.maxBps : 1000 });
        break;
      case "notify":
        setAction({ type: "notify", severity: "warning", message: "" });
        break;
    }
  }

  return (
    <Modal open onClose={onClose} title={rule ? `Editar regra: ${rule.name}` : "Nova regra"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <Field label="Nome" required>
            <input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Chave única" required hint="Ex.: compra_acima_500eur">
            <input
              className="input-base font-mono"
              value={form.key}
              disabled={Boolean(rule)}
              onChange={(e) => setForm({ ...form, key: e.target.value.replace(/\s/g, "_").toLowerCase() })}
            />
          </Field>
          <Field label="Prioridade" hint="Mais baixa avalia primeiro.">
            <input
              type="number"
              min={1}
              max={9999}
              className="input-base"
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 100 })}
            />
          </Field>
          <div className="flex items-end gap-2 pb-2">
            <Toggle checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} label="Ativa" />
            <span className="text-sm">Ativa</span>
          </div>
        </div>
        <Field label="Descrição (opcional)">
          <input className="input-base" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>

        <div className="rounded-lg border border-mist-200 bg-mist-50 p-4 dark:border-graphite-700 dark:bg-graphite-800/40">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Quando (condições)</p>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-graphite-400">Combinar com</span>
              <select className="input-base h-8 w-32 text-xs" value={form.join} onChange={(e) => setForm({ ...form, join: e.target.value })}>
                <option value="all">TODAS (E)</option>
                <option value="any">QUALQUER (OU)</option>
              </select>
            </div>
          </div>
          <div className="space-y-2">
            {conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  className="input-base h-9 w-56 text-sm"
                  value={c.field}
                  onChange={(e) => updateCondition(i, { field: e.target.value as RuleField })}
                >
                  {(fields.length ? fields : [c.field]).map((f) => (
                    <option key={f} value={f}>
                      {FIELD_LABELS[f] ?? f}
                    </option>
                  ))}
                </select>
                <select
                  className="input-base h-9 w-40 text-sm"
                  value={c.op}
                  onChange={(e) => {
                    const op = e.target.value as RuleOperator;
                    updateCondition(i, {
                      op,
                      value: op === "in" || op === "not_in" ? (Array.isArray(c.value) ? c.value : [String(c.value)]) : c.value,
                    });
                  }}
                >
                  {(operators.length ? operators : [c.op]).map((o) => (
                    <option key={o} value={o}>
                      {OP_LABELS[o] ?? o}
                    </option>
                  ))}
                </select>
                <input
                  className="input-base h-9 min-w-32 flex-1 text-sm"
                  placeholder={c.op === "in" || c.op === "not_in" ? "lista separada por vírgulas" : "valor"}
                  value={Array.isArray(c.value) ? c.value.join(", ") : String(c.value ?? "")}
                  onChange={(e) => updateCondition(i, { value: parseValue(c.op, e.target.value) })}
                />
                <Button size="sm" variant="ghost" onClick={() => setConditions(conditions.filter((_, idx) => idx !== i))} aria-label="Remover condição">
                  <Trash2 className="h-3.5 w-3.5 text-danger" />
                </Button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => setConditions([...conditions, { field: (fields[0] ?? "sale.total_cents") as RuleField, op: "gt", value: 0 }])}
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar condição
          </Button>
        </div>

        <div className="rounded-lg border border-mist-200 bg-mist-50 p-4 dark:border-graphite-700 dark:bg-graphite-800/40">
          <p className="mb-3 text-sm font-semibold">Então (ação)</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Tipo de ação">
              <select className="input-base" value={action.type} onChange={(e) => setActionType(e.target.value as RuleAction["type"])}>
                {Object.entries(ACTION_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {action.type === "block" && (
              <Field label="Motivo apresentado ao utilizador" required>
                <input className="input-base" value={action.reason} onChange={(e) => setAction({ ...action, reason: e.target.value })} />
              </Field>
            )}
            {action.type === "require_approval" && (
              <>
                <Field label="Tipo de aprovação" hint="Ex.: purchase">
                  <input className="input-base" value={action.kind} onChange={(e) => setAction({ ...action, kind: e.target.value })} />
                </Field>
                <Field label="Motivo (opcional)">
                  <input className="input-base" value={action.reason ?? ""} onChange={(e) => setAction({ ...action, reason: e.target.value })} />
                </Field>
              </>
            )}
            {action.type === "cap_discount_bps" && (
              <Field label="Desconto máximo (%)" hint="10% = 1000 bps">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  className="input-base"
                  value={action.maxBps / 100}
                  onChange={(e) => setAction({ ...action, maxBps: Math.round((Number(e.target.value) || 0) * 100) })}
                />
              </Field>
            )}
            {action.type === "notify" && (
              <>
                <Field label="Severidade">
                  <select
                    className="input-base"
                    value={action.severity}
                    onChange={(e) => setAction({ ...action, severity: e.target.value as "info" | "warning" | "critical" })}
                  >
                    <option value="info">Informativa</option>
                    <option value="warning">Aviso</option>
                    <option value="critical">Crítica</option>
                  </select>
                </Field>
                <Field label="Mensagem" required>
                  <input className="input-base" value={action.message} onChange={(e) => setAction({ ...action, message: e.target.value })} />
                </Field>
              </>
            )}
          </div>
        </div>

        <p className="text-xs text-graphite-400">
          As regras são avaliadas no servidor em cada operação relevante (vendas, compras, reembolsos…). Nunca executam
          código: comparam apenas campos whitelisted e devolvem decisões fixas, registadas em auditoria.
        </p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {rule ? "Guardar alterações" : "Criar regra"}
        </Button>
      </div>
    </Modal>
  );
}
