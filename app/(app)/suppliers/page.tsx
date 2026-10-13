"use client";

/** Fornecedores — diretório com contactos, condições de pagamento e lead time. */

import { useCallback, useEffect, useState } from "react";
import { Factory, Mail, Phone, Plus, Search, Timer } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { Badge, Button, EmptyState, Field, Input, Modal } from "@/components/ui";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDate } from "@/lib/format";

interface SupplierRow {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  address: string | null;
  payment_terms: string | null;
  lead_time_days: number | null;
  status: string;
  created_at: number;
}

export default function SuppliersPage() {
  const workspace = useWorkspace();
  const toast = useToast();

  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    taxId: "",
    address: "",
    paymentTerms: "",
    leadTimeDays: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<SupplierRow[]>("/api/suppliers", { query: { search: search || undefined } });
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar fornecedores");
    } finally {
      setLoading(false);
    }
  }, [search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit() {
    setBusy(true);
    try {
      await api("/api/suppliers", {
        method: "POST",
        body: {
          name: form.name.trim(),
          contactName: form.contactName.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          taxId: form.taxId.trim() || null,
          address: form.address.trim() || null,
          paymentTerms: form.paymentTerms.trim() || null,
          leadTimeDays: form.leadTimeDays ? parseInt(form.leadTimeDays) : null,
        },
      });
      toast.success("Fornecedor criado");
      setCreateOpen(false);
      setForm({ name: "", contactName: "", email: "", phone: "", taxId: "", address: "", paymentTerms: "", leadTimeDays: "" });
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha ao criar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Fornecedores"
        subtitle={`${rows.length} fornecedor(es)`}
        actions={
          workspace.can("suppliers.manage") && (
            <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)} icon={<Plus className="h-3.5 w-3.5" />}>
              Novo fornecedor
            </Button>
          )
        }
      />

      <div className="border-b border-mist-200 bg-white px-4 py-2.5 dark:border-graphite-700 dark:bg-graphite-850">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-graphite-400" />
          <Input className="pl-8" placeholder="Pesquisar por nome ou email…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nenhum fornecedor" message="Fornecedores alimentam encomendas de compra, histórico de preços e sugestões de reposição." icon={<Factory className="h-8 w-8" />} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((s) => (
              <div key={s.id} className="card p-4">
                <div className="flex items-start gap-2">
                  <Factory className="mt-0.5 h-4 w-4 shrink-0 text-graphite-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.name}</p>
                    {s.contact_name && <p className="truncate text-[11px] text-graphite-400">{s.contact_name}</p>}
                  </div>
                  <Badge tone={s.status === "active" ? "success" : "neutral"}>{s.status === "active" ? "ativo" : "inativo"}</Badge>
                </div>
                <div className="mt-2 space-y-1 text-xs text-graphite-500 dark:text-graphite-300">
                  {s.email && <p className="flex items-center gap-1.5 truncate"><Mail className="h-3 w-3 shrink-0 text-graphite-400" />{s.email}</p>}
                  {s.phone && <p className="flex items-center gap-1.5"><Phone className="h-3 w-3 shrink-0 text-graphite-400" />{s.phone}</p>}
                  {s.lead_time_days != null && (
                    <p className="flex items-center gap-1.5"><Timer className="h-3 w-3 shrink-0 text-graphite-400" />lead time {s.lead_time_days} dia(s)</p>
                  )}
                  {s.payment_terms && <p className="text-[11px] text-graphite-400">Condições: {s.payment_terms}</p>}
                  {s.tax_id && <p className="font-mono text-[10px] text-graphite-400">NIF {s.tax_id}</p>}
                </div>
                <p className="mt-2 text-[10px] text-graphite-400">Desde {fmtDate(s.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Novo fornecedor" wide>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Nome" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Contacto">
            <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="NIF">
            <Input value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} />
          </Field>
          <Field label="Condições de pagamento" hint="Ex.: 30 dias, pronto pagamento…">
            <Input value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
          </Field>
          <Field label="Lead time (dias)">
            <Input type="number" min={0} max={365} value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} />
          </Field>
          <Field label="Morada">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2 md:col-span-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button variant="accent" loading={busy} disabled={!form.name.trim()} onClick={submit}>
              Criar fornecedor
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
