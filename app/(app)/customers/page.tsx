"use client";

/**
 * Clientes (CRM) — ficha, histórico real de compras, loyalty, crédito,
 * etiquetas/consentimentos e pedidos RGPD (acesso/retificação/apagamento/
 * portabilidade) com resolução auditada. O apagamento anonimiza o registo
 * e preserva o histórico financeiro (obrigação legal).
 */

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { Mail, Pencil, Phone, Plus, Search, ShieldQuestion, User, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { Badge, Button, EmptyState, Field, Input, Modal, Pagination, Select, Textarea, Toggle } from "@/components/ui";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDate, fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  tags: string | null;
  marketing_consent: number;
  customer_type: string;
  credit_limit_cents: number | null;
  credit_balance_cents: number | null;
  status: string;
  created_at: number;
  sales_count?: number;
  lifetime_cents?: number;
  last_purchase_at?: number | null;
}

interface CustomerSale {
  id: string;
  document_number: string | null;
  total_cents: number;
  status: string;
  channel: string;
  created_at: number;
}

interface LoyaltyAccount {
  id: string;
  points_balance: number;
  lifetime_points?: number;
  tier?: string | null;
}

interface LoyaltyTx {
  id: string;
  delta_points: number;
  ref_type: string | null;
  reason?: string | null;
  created_at: number;
}

interface TopProduct {
  name: string;
  qty_milli: number;
  total_cents: number;
  purchases: number;
}

interface DataRequest {
  id: string;
  kind: string;
  status: string;
  note: string | null;
  requested_at: number;
  resolved_at: number | null;
}

interface CustomerDetail {
  customer: CustomerRow;
  sales: CustomerSale[];
  loyalty: LoyaltyAccount | null;
  loyaltyTx: LoyaltyTx[];
  topProducts: TopProduct[];
  dataRequests: DataRequest[];
}

const PAGE_SIZE = 25;

const parseTags = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

export default function CustomersPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const currency = workspace.org.currency;

  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);

  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"overview" | "sales" | "loyalty" | "gdpr">("overview");

  const [editOpen, setEditOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    id: "",
    name: "",
    email: "",
    phone: "",
    taxId: "",
    address: "",
    city: "",
    notes: "",
    tags: "",
    marketingConsent: false,
    customerType: "individual",
    creditLimit: "",
  });
  const [formBusy, setFormBusy] = useState(false);

  const [reqKind, setReqKind] = useState("access");
  const [reqNote, setReqNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ rows: CustomerRow[]; total: number }>("/api/customers", {
        query: { search: search || undefined, status: statusFilter || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar clientes");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function openDetail(id: string) {
    try {
      const d = await api<CustomerDetail>(`/api/customers/${id}`);
      setDetail(d);
      setDetailOpen(true);
      setDetailTab("overview");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao abrir cliente");
    }
  }

  function openEdit(c: CustomerRow) {
    setForm({
      id: c.id,
      name: c.name,
      email: c.email ?? "",
      phone: c.phone ?? "",
      taxId: c.tax_id ?? "",
      address: c.address ?? "",
      city: c.city ?? "",
      notes: c.notes ?? "",
      tags: parseTags(c.tags).join(", "),
      marketingConsent: c.marketing_consent === 1,
      customerType: c.customer_type ?? "individual",
      creditLimit: c.credit_limit_cents != null ? (c.credit_limit_cents / 100).toFixed(2) : "",
    });
    setEditOpen(true);
  }

  function openCreate() {
    setForm({
      id: "",
      name: "",
      email: "",
      phone: "",
      taxId: "",
      address: "",
      city: "",
      notes: "",
      tags: "",
      marketingConsent: false,
      customerType: "individual",
      creditLimit: "",
    });
    setCreateOpen(true);
  }

  async function submitForm() {
    setFormBusy(true);
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      if (form.id) {
        const d = await api<CustomerDetail>(`/api/customers/${form.id}`, {
          method: "POST",
          body: {
            action: "update",
            name: form.name.trim(),
            email: form.email.trim() || null,
            phone: form.phone.trim() || null,
            taxId: form.taxId.trim() || null,
            address: form.address.trim() || null,
            city: form.city.trim() || null,
            notes: form.notes.trim() || null,
            tags,
            marketingConsent: form.marketingConsent,
            customerType: form.customerType,
            ...(form.creditLimit ? { creditLimitCents: Math.round(parseFloat(form.creditLimit.replace(",", ".")) * 100) } : {}),
          },
        });
        setDetail(d);
        toast.success("Cliente atualizado");
        setEditOpen(false);
        load();
      } else {
        await api("/api/customers", {
          method: "POST",
          body: {
            name: form.name.trim(),
            email: form.email.trim() || undefined,
            phone: form.phone.trim() || undefined,
            taxId: form.taxId.trim() || undefined,
            address: form.address.trim() || undefined,
            city: form.city.trim() || undefined,
            notes: form.notes.trim() || undefined,
            tags,
            marketingConsent: form.marketingConsent,
            customerType: form.customerType,
            ...(form.creditLimit ? { creditLimitCents: Math.round(parseFloat(form.creditLimit.replace(",", ".")) * 100) } : {}),
          },
        });
        toast.success("Cliente criado");
        setCreateOpen(false);
        load();
      }
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha ao guardar");
    } finally {
      setFormBusy(false);
    }
  }

  const formModal = (open: boolean, setOpen: (v: boolean) => void, title: string) => (
    <Modal open={open} onClose={() => setOpen(false)} title={title} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome" required>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Tipo">
          <Select value={form.customerType} onChange={(e) => setForm({ ...form, customerType: e.target.value })}>
            <option value="individual">Particular</option>
            <option value="business">Empresa</option>
          </Select>
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
        <Field label={`Limite de crédito (${currency})`} hint="Vendas a crédito acima do limite são bloqueadas por regra.">
          <Input type="number" min={0} step="0.01" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} />
        </Field>
        <Field label="Morada">
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Cidade">
          <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="Etiquetas (separadas por vírgula)">
          <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="vip, revendedor…" />
        </Field>
        <div className="flex items-center">
          <Toggle checked={form.marketingConsent} onChange={(v) => setForm({ ...form, marketingConsent: v })} label="Consentimento de marketing (RGPD)" />
        </div>
        <div className="md:col-span-2">
          <Field label="Notas internas">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 md:col-span-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="accent" loading={formBusy} disabled={!form.name.trim()} onClick={submitForm}>
            {form.id ? "Guardar alterações" : "Criar cliente"}
          </Button>
        </div>
      </div>
    </Modal>
  );

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle={`${total} cliente(s) · histórico, loyalty, crédito e RGPD`}
        actions={
          workspace.can("customers.manage") && (
            <Button variant="accent" size="sm" onClick={openCreate} icon={<Plus className="h-3.5 w-3.5" />}>
              Novo cliente
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-mist-200 bg-white px-4 py-2.5 dark:border-graphite-700 dark:bg-graphite-850">
        <div className="relative min-w-44 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-graphite-400" />
          <Input className="pl-8" placeholder="Nome, email ou telefone…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <Select className="w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} aria-label="Estado">
          <option value="">Todos</option>
          <option value="active">Ativos</option>
          <option value="blocked">Bloqueados</option>
          <option value="archived">Arquivados</option>
        </Select>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Nenhum cliente" message="Clientes podem ser criados aqui ou no POS (venda associada)." icon={<Users className="h-8 w-8" />} />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-mist-200 text-[10px] uppercase tracking-wider text-graphite-400 dark:border-graphite-700">
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Contacto</th>
                  <th className="px-3 py-2">Etiquetas</th>
                  <th className="px-3 py-2 text-right">Compras</th>
                  <th className="px-3 py-2 text-right">Lifetime</th>
                  <th className="px-3 py-2 text-right">Crédito</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-mist-50 dark:hover:bg-graphite-800/60">
                    <td className="px-3 py-2">
                      <button className="font-semibold text-lime-dim hover:underline dark:text-lime-brand" onClick={() => openDetail(c.id)}>
                        {c.name}
                      </button>
                      <p className="text-[10px] text-graphite-400">
                        {c.customer_type === "business" ? "empresa" : "particular"}
                        {c.tax_id ? ` · NIF ${c.tax_id}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-graphite-400">
                      {c.email && <span className="block truncate">{c.email}</span>}
                      {c.phone && <span className="block">{c.phone}</span>}
                      {!c.email && !c.phone && "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {parseTags(c.tags).slice(0, 3).map((t) => (
                          <Badge key={t} tone="neutral">{t}</Badge>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{c.sales_count ?? 0}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtMoney(c.lifetime_cents ?? 0, currency)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {c.credit_limit_cents != null && c.credit_limit_cents > 0 ? (
                        <span className={clsx((c.credit_balance_cents ?? 0) > c.credit_limit_cents && "font-bold text-danger")}>
                          {fmtMoney(c.credit_balance_cents ?? 0, currency)} / {fmtMoney(c.credit_limit_cents, currency)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={c.status === "active" ? "success" : c.status === "blocked" ? "danger" : "neutral"}>
                        {c.status === "active" ? "ativo" : c.status === "blocked" ? "bloqueado" : c.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="flex justify-end gap-1">
                        <button className="rounded p-1 text-graphite-400 hover:text-lime-dim dark:hover:text-lime-brand" onClick={() => openDetail(c.id)} aria-label="Ver ficha">
                          <User className="h-3.5 w-3.5" />
                        </button>
                        {workspace.can("customers.manage") && (
                          <button className="rounded p-1 text-graphite-400 hover:text-lime-dim dark:hover:text-lime-brand" onClick={() => openEdit(c)} aria-label="Editar">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="mt-3">
            <Pagination total={total} limit={PAGE_SIZE} offset={page * PAGE_SIZE} onOffset={(o) => setPage(Math.floor(o / PAGE_SIZE))} />
          </div>
        )}
      </div>

      {/* detail */}
      <Modal open={detailOpen && detail !== null} onClose={() => setDetailOpen(false)} title={detail?.customer.name ?? ""} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5 border-b border-mist-200 pb-2 dark:border-graphite-700">
              {(
                [
                  { key: "overview", label: "Ficha" },
                  { key: "sales", label: `Compras (${detail.sales.length})` },
                  { key: "loyalty", label: "Loyalty" },
                  { key: "gdpr", label: `RGPD (${detail.dataRequests.filter((r) => r.status === "pending").length})` },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setDetailTab(t.key)}
                  className={clsx(
                    "rounded-full px-3 py-1 text-xs font-semibold",
                    detailTab === t.key
                      ? "bg-graphite-900 text-lime-brand dark:bg-graphite-700"
                      : "text-graphite-500 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700",
                  )}
                >
                  {t.label}
                </button>
              ))}
              {workspace.can("customers.manage") && (
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => openEdit(detail.customer)} icon={<Pencil className="h-3.5 w-3.5" />}>
                  Editar
                </Button>
              )}
            </div>

            {detailTab === "overview" && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5 text-xs">
                  <p className="flex items-center gap-1.5">{detail.customer.email ? <><Mail className="h-3 w-3 text-graphite-400" />{detail.customer.email}</> : <span className="text-graphite-400">sem email</span>}</p>
                  <p className="flex items-center gap-1.5">{detail.customer.phone ? <><Phone className="h-3 w-3 text-graphite-400" />{detail.customer.phone}</> : <span className="text-graphite-400">sem telefone</span>}</p>
                  {detail.customer.tax_id && <p>NIF: <span className="font-mono">{detail.customer.tax_id}</span></p>}
                  {detail.customer.address && <p>{detail.customer.address}{detail.customer.city ? `, ${detail.customer.city}` : ""}</p>}
                  {detail.customer.notes && <p className="rounded-md bg-mist-100 p-2 text-graphite-500 dark:bg-graphite-800 dark:text-graphite-300">{detail.customer.notes}</p>}
                  <p className="flex flex-wrap gap-1 pt-1">
                    {parseTags(detail.customer.tags).map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
                    <Badge tone={detail.customer.marketing_consent === 1 ? "success" : "neutral"}>
                      marketing: {detail.customer.marketing_consent === 1 ? "consentido" : "não consentido"}
                    </Badge>
                  </p>
                  <p className="text-[10px] text-graphite-400">Cliente desde {fmtDate(detail.customer.created_at)}</p>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-mist-200 p-2.5 dark:border-graphite-600">
                      <p className="text-[10px] uppercase tracking-wide text-graphite-400">Lifetime</p>
                      <p className="font-mono text-sm font-bold tabular-nums">{fmtMoney(detail.sales.reduce((a, s) => a + (s.status !== "void" ? s.total_cents : 0), 0), currency)}</p>
                    </div>
                    <div className="rounded-lg border border-mist-200 p-2.5 dark:border-graphite-600">
                      <p className="text-[10px] uppercase tracking-wide text-graphite-400">Crédito</p>
                      <p className="font-mono text-sm font-bold tabular-nums">
                        {fmtMoney(detail.customer.credit_balance_cents ?? 0, currency)}
                        {detail.customer.credit_limit_cents != null && (
                          <span className="text-[10px] font-normal text-graphite-400"> / {fmtMoney(detail.customer.credit_limit_cents, currency)}</span>
                        )}
                      </p>
                    </div>
                  </div>
                  {detail.topProducts.length > 0 && (
                    <div className="rounded-lg border border-mist-200 p-2.5 dark:border-graphite-600">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-graphite-400">Mais compra</p>
                      <ul className="space-y-0.5 text-xs">
                        {detail.topProducts.slice(0, 5).map((p, i) => (
                          <li key={i} className="flex justify-between gap-2">
                            <span className="truncate">{p.name}</span>
                            <span className="shrink-0 font-mono tabular-nums">{fmtQty(p.qty_milli)} · {fmtMoney(p.total_cents, currency)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {detailTab === "sales" && (
              detail.sales.length === 0 ? (
                <EmptyState title="Sem compras" message="As vendas associadas a este cliente aparecem aqui." />
              ) : (
                <ul className="max-h-72 divide-y divide-mist-100 overflow-y-auto dark:divide-graphite-700/60">
                  {detail.sales.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-1.5 text-xs">
                      <span className="font-mono font-semibold">{s.document_number ?? s.id.slice(0, 10)}</span>
                      <Badge tone={s.status === "void" ? "danger" : s.status === "returned" ? "warning" : "success"}>{s.status}</Badge>
                      <span className="text-graphite-400">{fmtDateTime(s.created_at)}</span>
                      <span className="ml-auto font-mono font-semibold tabular-nums">{fmtMoney(s.total_cents, currency)}</span>
                    </li>
                  ))}
                </ul>
              )
            )}

            {detailTab === "loyalty" && (
              <div className="space-y-3">
                {detail.loyalty ? (
                  <>
                    <div className="flex items-center gap-3 rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-graphite-400">Saldo de pontos</p>
                        <p className="font-mono text-2xl font-bold tabular-nums text-lime-dim dark:text-lime-brand">
                          {(detail.loyalty.points_balance ?? 0).toLocaleString("pt-PT")}
                        </p>
                      </div>
                      {detail.loyalty.tier && <Badge tone="accent" className="ml-auto">{detail.loyalty.tier}</Badge>}
                    </div>
                    <ul className="max-h-52 divide-y divide-mist-100 overflow-y-auto text-xs dark:divide-graphite-700/60">
                      {detail.loyaltyTx.map((t) => (
                        <li key={t.id} className="flex items-center gap-2 py-1.5">
                          <span className={clsx("font-mono font-bold tabular-nums", t.delta_points >= 0 ? "text-success" : "text-danger")}>
                            {t.delta_points >= 0 ? "+" : ""}{t.delta_points}
                          </span>
                          <span className="text-graphite-400">{t.reason ?? t.ref_type ?? ""}</span>
                          <span className="ml-auto text-[10px] text-graphite-400">{fmtDateTime(t.created_at)}</span>
                        </li>
                      ))}
                      {detail.loyaltyTx.length === 0 && <li className="py-4 text-center text-graphite-400">Sem movimentos de pontos.</li>}
                    </ul>
                  </>
                ) : (
                  <EmptyState title="Sem conta de loyalty" message="A conta é criada automaticamente na primeira venda com pontos (regras do módulo loyalty)." />
                )}
              </div>
            )}

            {detailTab === "gdpr" && (
              <div className="space-y-3">
                <p className="rounded-md bg-blue-500/10 px-3 py-2 text-[11px] leading-snug text-info">
                  <ShieldQuestion className="mr-1 inline h-3.5 w-3.5" />
                  RGPD: o apagamento (erasure) anonimiza os dados pessoais mas preserva o histórico financeiro
                  (faturação não pode ser eliminada por lei). Todos os pedidos e resoluções ficam auditados.
                </p>
                {workspace.can("customers.data_requests") && (
                  <div className="flex flex-wrap items-end gap-2 rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                    <Field label="Novo pedido">
                      <Select value={reqKind} onChange={(e) => setReqKind(e.target.value)}>
                        <option value="access">Acesso aos dados</option>
                        <option value="rectification">Retificação</option>
                        <option value="erasure">Apagamento</option>
                        <option value="portability">Portabilidade</option>
                      </Select>
                    </Field>
                    <div className="min-w-32 flex-1">
                      <Field label="Nota">
                        <Input value={reqNote} onChange={(e) => setReqNote(e.target.value)} placeholder="Contexto do pedido…" />
                      </Field>
                    </div>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await api(`/api/customers/${detail.customer.id}`, {
                            method: "POST",
                            body: { action: "data_request", kind: reqKind, note: reqNote || undefined },
                          });
                          toast.success("Pedido registado", "Prazo legal de resposta começa agora (auditoria ativa).");
                          setReqNote("");
                          openDetail(detail.customer.id);
                        } catch (err) {
                          toast.error(err instanceof ApiClientError ? err.body.message : "Falha");
                        }
                      }}
                    >
                      Registar pedido
                    </Button>
                  </div>
                )}
                <ul className="space-y-1.5">
                  {detail.dataRequests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-mist-200 px-3 py-2 text-xs dark:border-graphite-600">
                      <Badge tone={r.status === "pending" ? "warning" : r.status === "fulfilled" ? "success" : "danger"}>{r.status}</Badge>
                      <span className="font-semibold">{r.kind}</span>
                      {r.note && <span className="truncate text-graphite-400">· {r.note}</span>}
                      <span className="ml-auto text-[10px] text-graphite-400">
                        {fmtDate(r.requested_at)}
                        {r.resolved_at ? ` → ${fmtDate(r.resolved_at)}` : ""}
                      </span>
                      {r.status === "pending" && workspace.can("customers.data_requests") && (
                        <span className="flex gap-1">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={async () => {
                              try {
                                await api(`/api/data-requests/${r.id}/resolve`, {
                                  method: "POST",
                                  body: { resolution: "fulfilled" },
                                });
                                toast.success("Pedido resolvido", r.kind === "erasure" ? "Cliente anonimizado; histórico financeiro preservado." : "Pedido marcado como cumprido.");
                                openDetail(detail.customer.id);
                              } catch (err) {
                                toast.error(err instanceof ApiClientError ? err.body.message : "Falha");
                              }
                            }}
                          >
                            Cumprir
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              try {
                                await api(`/api/data-requests/${r.id}/resolve`, {
                                  method: "POST",
                                  body: { resolution: "rejected", rejectionReason: "Motivo não especificado — editar na auditoria" },
                                });
                                openDetail(detail.customer.id);
                              } catch (err) {
                                toast.error(err instanceof ApiClientError ? err.body.message : "Falha");
                              }
                            }}
                          >
                            Rejeitar
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                  {detail.dataRequests.length === 0 && (
                    <li className="py-3 text-center text-[11px] text-graphite-400">Sem pedidos RGPD para este cliente.</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      {formModal(editOpen, setEditOpen, "Editar cliente")}
      {formModal(createOpen, setCreateOpen, "Novo cliente")}
    </>
  );
}
