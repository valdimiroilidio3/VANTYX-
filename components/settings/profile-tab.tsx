"use client";

/**
 * Settings — Perfil: organization identity, locale/tax defaults and the SAFE
 * industry change flow (preview → typed confirmation → apply). Industry
 * changes never mutate or reclassify historical data (spec requirement).
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Loader2, Save } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field } from "@/components/ui";
import { useToast } from "@/components/system/toast";
import { api, ApiClientError } from "@/lib/api/client";
import { getIndustry, INDUSTRIES } from "@/lib/modules/industries";

interface Profile {
  orgId: string;
  orgName: string;
  legalName: string | null;
  taxId: string | null;
  demo: boolean;
  industry: string;
  industryLabel: string;
  subIndustry: string | null;
  country: string;
  currency: string;
  locale: string;
  timezone: string;
  taxRegime: string;
  pricesIncludeTax: boolean;
  defaultTaxBps: number;
  posMode: string;
}

interface IndustryPreview {
  fromIndustry: string;
  toIndustry: string;
  modulesToEnable: string[];
  modulesThatStayEnabled: { id: string; name: string; dataRows: number }[];
  dataUntouched: string[];
  posModeChange: { from: string; to: string } | null;
  warnings: string[];
}

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : "Erro inesperado.";
}

export function ProfileTab() {
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    legalName: "",
    taxId: "",
    subIndustry: "",
    currency: "EUR",
    locale: "pt-PT",
    timezone: "Europe/Lisbon",
    taxRegime: "",
    pricesIncludeTax: true,
    defaultTaxBps: 2300,
  });

  // industry change state
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<IndustryPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Profile>("/api/profile");
      setProfile(data);
      setForm({
        name: data.orgName ?? "",
        legalName: data.legalName ?? "",
        taxId: data.taxId ?? "",
        subIndustry: data.subIndustry ?? "",
        currency: data.currency,
        locale: data.locale,
        timezone: data.timezone,
        taxRegime: data.taxRegime ?? "",
        pricesIncludeTax: data.pricesIncludeTax,
        defaultTaxBps: data.defaultTaxBps,
      });
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const data = await api<Profile>("/api/profile", {
        method: "PATCH",
        body: {
          name: form.name,
          legalName: form.legalName || undefined,
          taxId: form.taxId || undefined,
          subIndustry: form.subIndustry || undefined,
          currency: form.currency,
          locale: form.locale,
          timezone: form.timezone,
          taxRegime: form.taxRegime || undefined,
          pricesIncludeTax: form.pricesIncludeTax,
          defaultTaxBps: form.defaultTaxBps,
        },
      });
      setProfile(data);
      toast.success("Perfil atualizado.");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function requestPreview() {
    if (!target) return;
    setPreviewing(true);
    try {
      const data = await api<{ mode: "preview"; preview: IndustryPreview }>("/api/profile/industry", {
        body: { industry: target },
      });
      setPreview(data.preview);
      setConfirmation("");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setPreviewing(false);
    }
  }

  async function applyIndustry() {
    if (!target) return;
    setApplying(true);
    try {
      await api<{ mode: "applied" }>("/api/profile/industry", {
        body: { industry: target, confirmation },
      });
      toast.success("Setor alterado. A recarregar o espaço de trabalho…");
      window.location.href = "/settings";
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setApplying(false);
    }
  }

  if (!profile) {
    return (
      <div className="flex justify-center py-16 text-graphite-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const currentIndustry = getIndustry(profile.industry);
  const confirmPhrase = `MUDAR-${target.toUpperCase()}`;
  const confirmOk = confirmation.trim().toUpperCase() === confirmPhrase;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Identificação"
          icon={<Building2 className="h-4 w-4" />}
          subtitle={profile.demo ? "Espaço em MODO DEMONSTRAÇÃO — dados separados de produção." : undefined}
          action={
            <Button size="sm" variant="primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2">
          <Field label="Nome comercial" required>
            <input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Nome legal">
            <input className="input-base" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} />
          </Field>
          <Field label="NIF / Identificação fiscal">
            <input className="input-base" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
          </Field>
          <Field label="Sub-setor / descrição da atividade">
            <input
              className="input-base"
              value={form.subIndustry}
              placeholder="Ex.: supermercado de bairro"
              onChange={(e) => setForm({ ...form, subIndustry: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Localização, moeda e impostos" icon={<Building2 className="h-4 w-4" />} />
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-3">
          <Field label="País (ISO-2)" hint="Alterar país exige reconfiguração fiscal.">
            <input className="input-base" value={profile.country} disabled />
          </Field>
          <Field label="Moeda">
            <input
              className="input-base"
              value={form.currency}
              maxLength={3}
              onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="Idioma / região">
            <input className="input-base" value={form.locale} onChange={(e) => setForm({ ...form, locale: e.target.value })} />
          </Field>
          <Field label="Fuso horário">
            <input className="input-base" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
          </Field>
          <Field label="Regime fiscal">
            <input className="input-base" value={form.taxRegime} placeholder="Ex.: normal" onChange={(e) => setForm({ ...form, taxRegime: e.target.value })} />
          </Field>
          <Field label="IVA por defeito (bps)">
            <input
              type="number"
              className="input-base"
              value={form.defaultTaxBps}
              min={0}
              max={10000}
              step={100}
              onChange={(e) => setForm({ ...form, defaultTaxBps: Number(e.target.value) || 0 })}
            />
            <p className="mt-1 text-xs text-graphite-400">
              {(form.defaultTaxBps / 100).toFixed(0)}% — aplicado a produtos sem taxa definida.
            </p>
          </Field>
          <label className="flex items-center gap-2 text-sm md:col-span-3">
            <input
              type="checkbox"
              checked={form.pricesIncludeTax}
              onChange={(e) => setForm({ ...form, pricesIncludeTax: e.target.checked })}
            />
            Preços de venda incluem IVA (regime típico de retalho em Portugal)
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Setor de atividade"
          icon={<Building2 className="h-4 w-4" />}
          subtitle="Alterar o setor ativa módulos do novo perfil; NUNCA apaga, transforma ou reclassifica dados históricos."
        />
        <div className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Setor atual">
              <div className="flex h-9.5 items-center gap-2 rounded-md border border-mist-300 bg-mist-100 px-3 text-sm font-medium dark:border-graphite-600 dark:bg-graphite-800">
                {currentIndustry?.label ?? profile.industry}
                <Badge tone="accent">{profile.posMode}</Badge>
              </div>
            </Field>
            <Field label="Mudar para">
              <select
                className="input-base"
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setPreview(null);
                }}
              >
                <option value="">— selecionar —</option>
                {INDUSTRIES.filter((k) => k !== profile.industry).map((k) => (
                  <option key={k} value={k}>
                    {getIndustry(k)?.label ?? k}
                  </option>
                ))}
              </select>
            </Field>
            <Button variant="secondary" onClick={requestPreview} disabled={!target || previewing}>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              Pré-visualizar impacto
            </Button>
          </div>

          {preview && (
            <div className="mt-4 space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
              <div>
                <p className="font-semibold">Módulos a ativar ({preview.modulesToEnable.length})</p>
                <p className="text-graphite-500 dark:text-graphite-300">
                  {preview.modulesToEnable.length ? preview.modulesToEnable.join(", ") : "nenhum"}
                </p>
              </div>
              <div>
                <p className="font-semibold">Permanecem ativos</p>
                <p className="text-graphite-500 dark:text-graphite-300">
                  {preview.modulesThatStayEnabled.length
                    ? preview.modulesThatStayEnabled
                        .map((m) => `${m.name}${m.dataRows ? ` (${m.dataRows} registos)` : ""}`)
                        .join(", ")
                    : "apenas os módulos do novo setor"}
                </p>
              </div>
              {preview.posModeChange && (
                <p className="font-medium">
                  Modo de checkout:{" "}
                  <Badge tone="warning">
                    {preview.posModeChange.from} → {preview.posModeChange.to}
                  </Badge>
                </p>
              )}
              <div>
                <p className="font-semibold text-success">Dados intocados (histórico preservado)</p>
                <p className="text-graphite-500 dark:text-graphite-300">{preview.dataUntouched.join(", ")}</p>
              </div>
              {preview.warnings.map((w, i) => (
                <p key={i} className="flex gap-2 font-medium text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
                </p>
              ))}
              <div className="rounded-md bg-mist-100 p-3 dark:bg-graphite-800">
                <Field
                  label={`Escreva "${confirmPhrase}" para confirmar`}
                  hint="Confirmação explícita exigida — sem o texto exato, nada é alterado."
                >
                  <input
                    className="input-base font-mono"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    placeholder={confirmPhrase}
                  />
                </Field>
                <div className="mt-3 flex items-center gap-3">
                  <Button variant="danger" onClick={applyIndustry} disabled={!confirmOk || applying}>
                    {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Aplicar mudança de setor
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPreview(null);
                      setTarget("");
                    }}
                    disabled={applying}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
