"use client";

/**
 * /settings/fiscal — Camada fiscal (PT por omissão, adaptável por país).
 *
 * REQUISITO DE HONESTIDADE: a plataforma implementa os formatos legais —
 * numeração sequencial por série/exercício, assinatura SHA-1/Base-64
 * (Portaria 363/2010 + Despacho 8632/2014), ATCUD (Portaria 195/2020) e QR
 * Code — mas o software NÃO é certificado pela AT. A certificação é um
 * processo administrativo da empresa produtora (docs/CERTIFICACAO-AT.md).
 * Nada aqui pode declarar "certificado" sem o número real emitido pela AT.
 */

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, FileCheck2, FileText, Hash, KeyRound, Link2, Loader2, Plus, QrCode as QrIcon, ReceiptText, ShieldAlert } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { useToast } from "@/components/system/toast";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime, fmtMoney } from "@/lib/format";

interface SeriesRow {
  id: string;
  doc_type: string;
  prefix: string;
  fiscal_year: number;
  next_number: number;
  issued_count: number;
  atcud_validation_code: string | null;
}

interface DocRow {
  document_number: string | null;
  status: string;
  total_cents: number;
  created_at: number;
  hash?: string;
  prev_hash?: string | null;
  atcud?: string | null;
}

interface ProfileLite {
  taxId: string | null;
  timezone: string;
  settings: Record<string, unknown>;
}

interface FiscalData {
  series: SeriesRow[];
  lastDocuments: DocRow[];
  creditNotes: DocRow[];
  complianceNotice: string;
}

const DOC_TYPES = [
  { key: "FT", label: "FT — Fatura" },
  { key: "FR", label: "FR — Fatura-Recibo" },
  { key: "NC", label: "NC — Nota de Crédito" },
  { key: "GT", label: "GT — Guia de Transporte" },
  { key: "RC", label: "RC — Recibo" },
];

export default function FiscalPage() {
  const toast = useToast();
  const [data, setData] = useState<FiscalData | null>(null);
  const [profile, setProfile] = useState<ProfileLite | null>(null);
  const [certForm, setCertForm] = useState({ taxId: "", taxRegion: "PT", certificateNumber: "" });
  const [atcudDrafts, setAtcudDrafts] = useState<Record<string, string>>({});
  const [saft, setSaft] = useState(() => {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: first.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
  });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    docType: "FT",
    prefix: "",
    fiscalYear: new Date().getFullYear() + 1,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const fiscal = await api<FiscalData>("/api/settings/fiscal");
      setData(fiscal);
      const prof = await api<ProfileLite>("/api/profile");
      setProfile(prof);
      const st = prof.settings ?? {};
      setCertForm({
        taxId: prof.taxId ?? "",
        taxRegion: String(st.taxRegion ?? "PT"),
        certificateNumber: String(st.certificateNumber ?? ""),
      });
      const drafts: Record<string, string> = {};
      for (const row of fiscal.series) drafts[row.id] = row.atcud_validation_code ?? "";
      setAtcudDrafts(drafts);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro ao carregar dados fiscais.");
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  async function createSeries() {
    if (!form.prefix.trim()) {
      toast.error("Prefixo é obrigatório (ex.: FT-CBR).");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ saved?: true; error?: string }>("/api/settings/fiscal", { body: form });
      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Série registada.");
        setShowCreate(false);
        setForm({ ...form, prefix: "" });
        await load();
      }
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro ao criar série.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCertification() {
    setBusy(true);
    try {
      await api("/api/profile", {
        method: "PATCH",
        body: {
          taxId: certForm.taxId.trim() || undefined,
          settings: {
            taxRegion: certForm.taxRegion,
            certificateNumber: certForm.certificateNumber.trim(),
          },
        },
      });
      toast.success("Dados fiscais guardados.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro ao guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function exportSaft() {
    setBusy(true);
    try {
      const res = await fetch(`/api/fiscal/saft-pt?from=${saft.from}&to=${saft.to}`, { credentials: "same-origin" });
      if (!res.ok) {
        let msg = "Erro ao gerar SAF-T.";
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          msg = j.error?.message ?? msg;
        } catch { /* corpo não-JSON */ }
        toast.error(msg);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match?.[1] ?? `saft-PT_${saft.from}_${saft.to}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      toast.success("SAF-T gerado — valide no validador oficial da AT.");
    } catch {
      toast.error("Falha de rede ao descarregar o SAF-T.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAtcud(seriesId: string) {
    const code = (atcudDrafts[seriesId] ?? "").trim().toUpperCase();
    if (code && code.length < 8) {
      toast.error("O código de validação atribuído pela AT tem pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ saved?: true; error?: string }>("/api/settings/fiscal/atcud", {
        body: { seriesId, code: code || null },
      });
      if (r.error) toast.error(r.error);
      else toast.success(code ? "ATCUD ativo para esta série." : "Código ATCUD removido.");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Erro ao guardar ATCUD.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Fiscal"
        subtitle="Numeração por série/exercício, assinatura SHA-1 (Portaria 363/2010), ATCUD + QR (Portaria 195/2020) e notas de crédito. Certificação AT é um processo administrativo — nunca é assumida."
      />
      <div className="space-y-5 p-4">
        <SettingsNav />

        <div className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/5 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <p className="font-medium">{data?.complianceNotice ?? "A carregar aviso de conformidade…"}</p>
        </div>

        <Card>
          <CardHeader
            title="Certificação AT & dados do emitente"
            icon={<BadgeCheck className="h-4 w-4" />}
            subtitle="Portaria 363/2010 (certificação de software) e Portaria 195/2020 (ATCUD/QR). Preencha apenas com dados reais recebidos da AT."
            action={
              profile?.settings?.certificateNumber ? (
                <Badge tone="success">
                  <BadgeCheck className="h-3 w-3" /> Certificado n.º {String(profile.settings.certificateNumber)}/AT
                </Badge>
              ) : (
                <Badge tone="warning">
                  <ShieldAlert className="h-3 w-3" /> Software não certificado
                </Badge>
              )
            }
          />
          <div className="grid grid-cols-1 items-end gap-3 p-4 md:grid-cols-4">
            <Field label="NIF do emitente" hint="Obrigatório para QR Code e SAF-T (campo A).">
              <input
                className="input-base font-mono"
                maxLength={9}
                value={certForm.taxId}
                onChange={(e) => setCertForm({ ...certForm, taxId: e.target.value.replace(/\D/g, "") })}
                placeholder="9 dígitos"
              />
            </Field>
            <Field label="Região fiscal (IVA)" hint="Taxas: PT 6/13/23 · AC 4/9/16 · MA 5/11,25/22.">
              <select
                className="input-base"
                value={certForm.taxRegion}
                onChange={(e) => setCertForm({ ...certForm, taxRegion: e.target.value })}
              >
                <option value="PT">PT — Continente</option>
                <option value="PT-AC">PT-AC — Açores</option>
                <option value="PT-MA">PT-MA — Madeira</option>
              </select>
            </Field>
            <Field
              label="N.º de certificado AT"
              hint="Emitido pela AT após deferimento da candidatura. Vazio = não certificado."
            >
              <input
                className="input-base font-mono"
                maxLength={10}
                value={certForm.certificateNumber}
                onChange={(e) => setCertForm({ ...certForm, certificateNumber: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="ex.: 9999"
              />
            </Field>
            <Button variant="accent" onClick={saveCertification} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Guardar dados fiscais
            </Button>
          </div>
          <p className="border-t border-mist-200 px-4 py-3 text-xs text-graphite-400 dark:border-graphite-700">
            A certificação é um processo administrativo da empresa produtora junto da AT —
            o software implementa os requisitos técnicos (assinatura SHA-1 por série, ATCUD,
            QR legal), mas só deve indicar aqui um número de certificado real após deferimento.
            Guia passo-a-passo: <code className="font-mono">docs/CERTIFICACAO-AT.md</code>.
          </p>
        </Card>

        {!data ? (
          <div className="flex justify-center py-16 text-graphite-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            <Card>
              <CardHeader
                title="Séries de documentos"
                icon={<ReceiptText className="h-4 w-4" />}
                subtitle="Numeração sequencial por tipo/prefixo/ano. Uma série em uso num ano iniciado não pode ser alterada."
                action={
                  <Button size="sm" variant="primary" onClick={() => setShowCreate(!showCreate)}>
                    <Plus className="h-4 w-4" /> Nova série
                  </Button>
                }
              />
              {showCreate && (
                <div className="border-b border-mist-200 bg-mist-50 p-4 dark:border-graphite-700 dark:bg-graphite-800/40">
                  <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
                    <Field label="Tipo de documento">
                      <select className="input-base" value={form.docType} onChange={(e) => setForm({ ...form, docType: e.target.value })}>
                        {DOC_TYPES.map((d) => (
                          <option key={d.key} value={d.key}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Prefixo" required hint="Ex.: CBR (filial). Documentos: PREFIXO-ANO/Nº">
                      <input
                        className="input-base font-mono"
                        maxLength={8}
                        value={form.prefix}
                        onChange={(e) => setForm({ ...form, prefix: e.target.value.toUpperCase() })}
                      />
                    </Field>
                    <Field label="Ano fiscal">
                      <input
                        type="number"
                        min={2000}
                        max={2100}
                        className="input-base"
                        value={form.fiscalYear}
                        onChange={(e) => setForm({ ...form, fiscalYear: Number(e.target.value) || new Date().getFullYear() + 1 })}
                      />
                    </Field>
                    <Button variant="accent" onClick={createSeries} disabled={busy}>
                      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                      Criar série
                    </Button>
                  </div>
                </div>
              )}
              <div className="p-4">
                {!data.series.length ? (
                  <EmptyState
                    icon={<ReceiptText className="h-8 w-8" />}
                    title="Sem séries registadas"
                    message="As séries por omissão são criadas no arranque do primeiro documento de cada tipo."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-mist-200 text-left text-xs text-graphite-400 dark:border-graphite-700">
                          <th className="py-2 pr-3 font-medium">Tipo</th>
                          <th className="py-2 pr-3 font-medium">Prefixo</th>
                          <th className="py-2 pr-3 font-medium">Ano</th>
                          <th className="py-2 pr-3 font-medium">Emitidos</th>
                          <th className="py-2 pr-3 font-medium">Próximo nº</th>
                          <th className="py-2 font-medium">Código validação ATCUD (atribuído pela AT)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.series.map((s) => (
                          <tr key={s.id} className="border-b border-mist-200/60 dark:border-graphite-700/60">
                            <td className="py-2 pr-3">
                              <Badge tone="info">{s.doc_type}</Badge>
                            </td>
                            <td className="py-2 pr-3 font-mono">{s.prefix}</td>
                            <td className="py-2 pr-3">{s.fiscal_year}</td>
                            <td className="py-2 pr-3">{s.issued_count.toLocaleString("pt-PT")}</td>
                            <td className="py-2 pr-3 font-mono text-graphite-400">
                              {s.prefix}-{s.fiscal_year}/{s.next_number}
                            </td>
                            <td className="py-2">
                              <div className="flex items-center gap-2">
                                <input
                                  className="input-base h-8 w-40 font-mono text-xs"
                                  maxLength={32}
                                  placeholder={s.atcud_validation_code ?? "por comunicar"}
                                  value={atcudDrafts[s.id] ?? ""}
                                  onChange={(e) =>
                                    setAtcudDrafts({ ...atcudDrafts, [s.id]: e.target.value.toUpperCase() })
                                  }
                                />
                                <Button size="sm" variant="secondary" onClick={() => saveAtcud(s.id)} disabled={busy}>
                                  Guardar
                                </Button>
                                {s.atcud_validation_code ? (
                                  <Badge tone="success">
                                    <QrIcon className="h-3 w-3" /> ATCUD ativo
                                  </Badge>
                                ) : (
                                  <Badge tone="warning">sem código AT</Badge>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </Card>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Últimos documentos emitidos"
                  icon={<FileText className="h-4 w-4" />}
                  subtitle="Cada documento encadeia a assinatura SHA-1/Base-64 do anterior da mesma série/exercício — adulterações são detetáveis."
                />
                <div className="p-4">
                  {!data.lastDocuments.length ? (
                    <EmptyState icon={<FileText className="h-8 w-8" />} title="Sem documentos" message="Os documentos emitidos aparecem aqui." />
                  ) : (
                    <ul className="divide-y divide-mist-200 text-sm dark:divide-graphite-700">
                      {data.lastDocuments.map((d, i) => (
                        <li key={`${d.document_number}-${i}`} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-semibold">{d.document_number ?? "—"}</p>
                            <p className="text-xs text-graphite-400">
                              {fmtDateTime(d.created_at)}
                              {d.hash ? (
                                <span className="ml-1 inline-flex items-center gap-0.5">
                                  <Link2 className="h-3 w-3" /> hash {d.hash.slice(0, 8)}…
                                  {d.prev_hash ? ` ← ${d.prev_hash.slice(0, 8)}…` : " (génese)"}
                                  {d.atcud ? ` · ATCUD ${d.atcud}` : ""}
                                </span>
                              ) : null}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge tone={d.status === "completed" ? "success" : d.status === "voided" ? "danger" : "neutral"}>
                              {d.status}
                            </Badge>
                            <span className="font-medium">{fmtMoney(d.total_cents)}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Notas de crédito recentes"
                  icon={<FileCheck2 className="h-4 w-4" />}
                  subtitle="Correções legais: documentos finalizados nunca são editados — apenas anulados por NC com referência ao original."
                />
                <div className="p-4">
                  {!data.creditNotes.length ? (
                    <EmptyState icon={<FileCheck2 className="h-8 w-8" />} title="Sem notas de crédito" message="Devoluções/anulações geram NC automaticamente." />
                  ) : (
                    <ul className="divide-y divide-mist-200 text-sm dark:divide-graphite-700">
                      {data.creditNotes.map((d, i) => (
                        <li key={`${d.document_number}-${i}`} className="flex items-center justify-between gap-3 py-2">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-semibold">{d.document_number ?? "—"}</p>
                            <p className="text-xs text-graphite-400">
                              {fmtDateTime(d.created_at)}
                              {d.hash ? (
                                <span className="ml-1 inline-flex items-center gap-0.5">
                                  <Hash className="h-3 w-3" />
                                  {d.hash.slice(0, 12)}…
                                </span>
                              ) : null}
                            </p>
                          </div>
                          <span className="shrink-0 font-medium text-danger">{fmtMoney(-Math.abs(d.total_cents))}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            </div>

            <Card>
              <CardHeader
                title="Exportação SAF-T (PT)"
                icon={<FileText className="h-4 w-4" />}
                subtitle="Ficheiro de auditoria SalesInvoices (schema 1.04_01) do período selecionado. Valide no validador oficial da AT antes de submeter."
              />
              <div className="flex flex-wrap items-end gap-3 p-4">
                <Field label="De">
                  <input type="date" className="input-base" value={saft.from} onChange={(e) => setSaft({ ...saft, from: e.target.value })} />
                </Field>
                <Field label="Até">
                  <input type="date" className="input-base" value={saft.to} onChange={(e) => setSaft({ ...saft, to: e.target.value })} />
                </Field>
                <Button variant="accent" onClick={exportSaft} disabled={busy || !saft.from || !saft.to}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Descarregar SAF-T
                </Button>
                <p className="text-xs text-graphite-400">
                  Nome do ficheiro: <code className="font-mono">saft-PT_&lt;NIF&gt;_&lt;de&gt;_&lt;até&gt;.xml</code>
                </p>
              </div>
            </Card>

            <Card>
              <CardHeader title="Estado de conformidade (Portugal)" icon={<ShieldAlert className="h-4 w-4" />} />
              <div className="grid grid-cols-1 gap-3 p-4 text-sm md:grid-cols-2">
                {[
                  { label: "Numeração sequencial por série/exercício (InvoiceNo SAF-T)", state: "done" as const },
                  { label: "Assinatura SHA-1/Base-64 encadeada por série (Portaria 363/2010)", state: "done" as const },
                  { label: "4 caracteres da assinatura nos documentos impressos", state: "done" as const },
                  { label: "Correções apenas por nota de crédito + auditoria imutável", state: "done" as const },
                  { label: "ATCUD (código real da AT por série) + QR Code (Portaria 195/2020)", state: "done" as const },
                  { label: "Exportação SAF-T (PT) — validar com o validador oficial da AT", state: "pending" as const },
                  { label: "Certificação de software pela AT (candidatura + nº de certificado)", state: "todo" as const },
                  { label: "Comunicação de guias de transporte à AT (webservice)", state: "todo" as const },
                ].map((item) => (
                  <p key={item.label} className="flex items-center gap-2">
                    {item.state === "done" ? (
                      <Badge tone="success">
                        <FileCheck2 className="h-3 w-3" /> Implementado
                      </Badge>
                    ) : item.state === "pending" ? (
                      <Badge tone="info">
                        <ShieldAlert className="h-3 w-3" /> Por validar
                      </Badge>
                    ) : (
                      <Badge tone="warning">
                        <ShieldAlert className="h-3 w-3" /> Processo AT
                      </Badge>
                    )}
                    <span className={item.state === "done" ? "" : "text-graphite-500 dark:text-graphite-300"}>{item.label}</span>
                  </p>
                ))}
              </div>
              <p className="border-t border-mist-200 px-4 py-3 text-xs text-graphite-400 dark:border-graphite-700">
                Os itens «por validar» exigem adaptador fiscal configurado e validação legal — ver{" "}
                <code className="font-mono">docs/COMPLIANCE.md</code>. O sistema nunca se apresenta como certificado
                pela Autoridade Tributária.
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
