"use client";

/**
 * /settings/fiscal — Fiscal layer (PT default, adaptable per country).
 *
 * HONESTY REQUIREMENT: the platform provides sequential per-series numbering
 * and a SHA-256 hash chain over finalized documents, and corrections happen
 * only via credit notes. It is NOT certified by the AT — certification
 * (software nº, ATCUD, QR Code legal layout, SAF-T submission) requires
 * legal validation and is tracked in docs/COMPLIANCE.md. Nothing here may
 * claim "certificado".
 */

import { useCallback, useEffect, useState } from "react";
import { FileCheck2, FileText, Hash, Link2, Loader2, Plus, ReceiptText, ShieldAlert } from "lucide-react";
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
}

interface DocRow {
  document_number: string | null;
  status: string;
  total_cents: number;
  created_at: number;
  hash?: string;
  prev_hash?: string | null;
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
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    docType: "FT",
    prefix: "",
    fiscalYear: new Date().getFullYear() + 1,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<FiscalData>("/api/settings/fiscal"));
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

  return (
    <div>
      <PageHeader
        title="Fiscal"
        subtitle="Séries de numeração sequencial, cadeia de hash e notas de crédito. Certificação AT exige validação legal — nunca é assumida."
      />
      <div className="space-y-5 p-4">
        <SettingsNav />

        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <p className="font-medium">{data?.complianceNotice ?? "A carregar aviso de conformidade…"}</p>
        </div>

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
                          <th className="py-2 font-medium">Próximo nº</th>
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
                            <td className="py-2 font-mono text-graphite-400">
                              {s.prefix}-{s.fiscal_year}/{s.next_number}
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
                  subtitle="Cada documento finalizado encadeia o hash SHA-256 do anterior — adulterações são detetáveis."
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
              <CardHeader title="Estado de conformidade (Portugal)" icon={<ShieldAlert className="h-4 w-4" />} />
              <div className="grid grid-cols-1 gap-3 p-4 text-sm md:grid-cols-2">
                {[
                  { label: "Numeração sequencial por série/ano", done: true },
                  { label: "Cadeia de hash SHA-256 (documento → anterior)", done: true },
                  { label: "Correções apenas por nota de crédito", done: true },
                  { label: "Arquivo de auditoria imutável das operações", done: true },
                  { label: "Certificação de software pela AT (nº de certificado)", done: false },
                  { label: "ATCUD + QR Code em layout legal validado", done: false },
                  { label: "Exportação/submissão SAF-T (PT)", done: false },
                  { label: "Comunicação de guias de transporte à AT", done: false },
                ].map((item) => (
                  <p key={item.label} className="flex items-center gap-2">
                    {item.done ? (
                      <Badge tone="success">
                        <FileCheck2 className="h-3 w-3" /> Implementado
                      </Badge>
                    ) : (
                      <Badge tone="warning">
                        <ShieldAlert className="h-3 w-3" /> Por validar
                      </Badge>
                    )}
                    <span className={item.done ? "" : "text-graphite-500 dark:text-graphite-300"}>{item.label}</span>
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
