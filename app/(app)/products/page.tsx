"use client";

/** Catálogo — listagem, criação/edição, categorias, import/export CSV. */

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import {
  Download,
  FileUp,
  Package,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { useConfirm, Badge, Button, EmptyState, Field, Input, Modal, Pagination, Select, Textarea, Toggle } from "@/components/ui";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtMoney, fmtPct } from "@/lib/format";

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  type: string;
  status: string;
  base_price_cents: number;
  cost_cents: number;
  tax_rate_bps: number;
  unit: string;
  sale_mode: string;
  track_stock: number;
  category_id: string | null;
  reorder_point_milli: number | null;
  image_url: string | null;
  created_at: number;
  updated_at: number;
}

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
}

interface BarcodeRow {
  id: string;
  code: string;
  embedded_kind: string | null;
}

interface VariantRow {
  id: string;
  sku: string;
  label: string;
  price_cents: number | null;
}

interface ProductDetail {
  product: ProductRow;
  variants?: VariantRow[];
  barcodes?: BarcodeRow[];
}

interface FormState {
  id?: string;
  name: string;
  sku: string;
  basePrice: string;
  cost: string;
  taxBps: string;
  unit: string;
  saleMode: "units" | "weight";
  trackStock: boolean;
  categoryId: string;
  status: "active" | "discontinued" | "archived";
  reorderPoint: string;
  shelfLifeDays: string;
  trackBatches: boolean;
  description: string;
  barcode: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  sku: "",
  basePrice: "",
  cost: "",
  taxBps: "2300",
  unit: "un",
  saleMode: "units",
  trackStock: true,
  categoryId: "",
  status: "active",
  reorderPoint: "",
  shelfLifeDays: "",
  trackBatches: false,
  description: "",
  barcode: "",
};

const PAGE_SIZE = 25;

export default function ProductsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const currency = workspace.org.currency;

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("name");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [catName, setCatName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ rows: ProductRow[]; total: number }>("/api/products", {
        query: {
          search: search || undefined,
          categoryId: category || undefined,
          status: status || undefined,
          sort,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar produtos");
    } finally {
      setLoading(false);
    }
  }, [search, category, status, sort, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<CategoryRow[]>("/api/categories")
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  async function openEdit(row: ProductRow) {
    try {
      const d = await api<ProductDetail>(`/api/products/${row.id}`);
      const p = d.product ?? row;
      setForm({
        id: p.id,
        name: p.name,
        sku: p.sku,
        basePrice: (p.base_price_cents / 100).toFixed(2),
        cost: p.cost_cents ? (p.cost_cents / 100).toFixed(2) : "",
        taxBps: String(p.tax_rate_bps),
        unit: p.unit,
        saleMode: p.sale_mode === "weight" ? "weight" : "units",
        trackStock: p.track_stock === 1,
        categoryId: p.category_id ?? "",
        status: p.status as FormState["status"],
        reorderPoint: p.reorder_point_milli ? String(p.reorder_point_milli / 1000) : "",
        shelfLifeDays: "",
        trackBatches: false,
        description: "",
        barcode: d.barcodes?.[0]?.code ?? "",
      });
    } catch {
      toast.error("Falha ao carregar detalhe");
    }
  }

  async function saveForm() {
    if (!form) return;
    setFormBusy(true);
    const cents = (v: string) => Math.round(parseFloat(v.replace(",", ".")) * 100);
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      sku: form.sku.trim().toUpperCase(),
      basePriceCents: Number.isFinite(cents(form.basePrice)) ? Math.max(0, cents(form.basePrice)) : 0,
      costCents: form.cost ? Math.max(0, cents(form.cost)) : 0,
      taxRateBps: parseInt(form.taxBps) || 0,
      unit: form.unit,
      saleMode: form.saleMode,
      trackStock: form.trackStock,
      categoryId: form.categoryId || null,
      status: form.status,
      reorderPointMilli: form.reorderPoint ? Math.round(parseFloat(form.reorderPoint.replace(",", ".")) * 1000) : null,
      ...(form.description ? { description: form.description } : {}),
    };
    if (form.id) {
      if (form.barcode.trim()) payload.barcodes = [{ code: form.barcode.trim() }];
    } else if (form.barcode.trim()) {
      payload.barcodes = [{ code: form.barcode.trim() }];
    }
    try {
      if (form.id) {
        await api(`/api/products/${form.id}`, { method: "PATCH", body: payload });
        toast.success("Produto atualizado");
      } else {
        await api("/api/products", { method: "POST", body: payload });
        toast.success("Produto criado");
      }
      setForm(null);
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha ao guardar");
    } finally {
      setFormBusy(false);
    }
  }

  async function archive(row: ProductRow) {
    const ok = await confirm({
      title: `Arquivar “${row.name}”?`,
      message: "Produtos arquivados deixam de aparecer no POS e nas pesquisas, mas o histórico de vendas é preservado (documentos nunca são alterados).",
      confirmLabel: "Arquivar",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/products/${row.id}`, { method: "PATCH", body: { status: "archived" } });
      toast.info("Produto arquivado");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  async function downloadCsv() {
    try {
      const res = await fetch("/api/products/csv");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vantyx-produtos-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Falha ao exportar CSV");
    }
  }

  async function runImport() {
    setImportBusy(true);
    try {
      const result = await api<{ created: number; updated: number; errors: number; errorRows?: { line: number; error: string }[] }>(
        "/api/products/csv",
        { method: "POST", body: { csv: csvText } },
      );
      setImportResult(
        `${result.created} criados · ${result.updated} atualizados · ${result.errors} erros` +
          (result.errorRows?.length ? `\n${result.errorRows.slice(0, 8).map((e) => `linha ${e.line}: ${e.error}`).join("\n")}` : ""),
      );
      load();
    } catch (err) {
      setImportResult(null);
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha na importação");
    } finally {
      setImportBusy(false);
    }
  }

  const catLabel = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <>
      <PageHeader
        title="Produtos"
        subtitle={`${total} produto(s) no catálogo`}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={downloadCsv} icon={<Download className="h-3.5 w-3.5" />}>
              Exportar CSV
            </Button>
            {workspace.can("products.import") && (
              <Button variant="secondary" size="sm" onClick={() => { setImportOpen(true); setImportResult(null); }} icon={<Upload className="h-3.5 w-3.5" />}>
                Importar CSV
              </Button>
            )}
            {workspace.can("products.manage") && (
              <>
                <Button variant="secondary" size="sm" onClick={() => setCatOpen(true)} icon={<Tag className="h-3.5 w-3.5" />}>
                  Categorias
                </Button>
                <Button variant="accent" size="sm" onClick={() => setForm({ ...EMPTY_FORM })} icon={<Plus className="h-3.5 w-3.5" />}>
                  Novo produto
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-mist-200 bg-white px-4 py-2.5 dark:border-graphite-700 dark:bg-graphite-850">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-graphite-400" />
          <Input
            className="pl-8"
            placeholder="Pesquisar por nome ou SKU…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          />
        </div>
        <Select className="w-auto" value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} aria-label="Estado">
          <option value="">Todos os estados</option>
          <option value="active">Ativos</option>
          <option value="discontinued">Descontinuados</option>
          <option value="archived">Arquivados</option>
        </Select>
        <Select className="w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          <option value="name">Nome A→Z</option>
          <option value="name_desc">Nome Z→A</option>
          <option value="price">Preço ↑</option>
          <option value="price_desc">Preço ↓</option>
          <option value="updated">Atualizados</option>
        </Select>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nenhum produto"
            message={total === 0 ? "Crie o primeiro produto ou importe um CSV." : "Ajuste os filtros."}
            icon={<Package className="h-8 w-8" />}
          />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-mist-200 text-[10px] uppercase tracking-wider text-graphite-400 dark:border-graphite-700">
                  <th className="px-3 py-2">Produto</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Categoria</th>
                  <th className="px-3 py-2 text-right">Preço</th>
                  <th className="px-3 py-2 text-right">Custo</th>
                  <th className="px-3 py-2 text-right">IVA</th>
                  <th className="px-3 py-2">Modo</th>
                  <th className="px-3 py-2">Estado</th>
                  {workspace.can("products.manage") && <th className="px-3 py-2 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-mist-50 dark:hover:bg-graphite-800/60">
                    <td className="px-3 py-2">
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-[10px] text-graphite-400">{p.type !== "simple" ? p.type : ""}</p>
                    </td>
                    <td className="px-3 py-2 font-mono">{p.sku}</td>
                    <td className="px-3 py-2">{catLabel(p.category_id)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{fmtMoney(p.base_price_cents, currency)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-graphite-400">{p.cost_cents ? fmtMoney(p.cost_cents, currency) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(p.tax_rate_bps, 0)}</td>
                    <td className="px-3 py-2">
                      {p.sale_mode === "weight" ? <Badge tone="info">peso</Badge> : <span className="text-graphite-400">{p.unit}</span>}
                      {!p.track_stock && <Badge tone="neutral" className="ml-1">s/ stock</Badge>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={p.status === "active" ? "success" : p.status === "discontinued" ? "warning" : "neutral"}>
                        {p.status === "active" ? "ativo" : p.status === "discontinued" ? "descontinuado" : "arquivado"}
                      </Badge>
                    </td>
                    {workspace.can("products.manage") && (
                      <td className="px-3 py-2">
                        <span className="flex justify-end gap-1">
                          <button className="rounded p-1 text-graphite-400 hover:text-lime-dim dark:hover:text-lime-brand" onClick={() => openEdit(p)} aria-label="Editar">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {p.status !== "archived" && (
                            <button className="rounded p-1 text-graphite-400 hover:text-danger" onClick={() => archive(p)} aria-label="Arquivar">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE_SIZE && (
          <div className="mt-3">
            <Pagination
              total={total}
              limit={PAGE_SIZE}
              offset={page * PAGE_SIZE}
              onOffset={(o) => setPage(Math.floor(o / PAGE_SIZE))}
            />
          </div>
        )}
      </div>

      {/* create/edit modal */}
      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? "Editar produto" : "Novo produto"}
        wide
      >
        {form && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </Field>
            <Field label="SKU" required hint="Identificador único (maiúsculas).">
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className="font-mono" />
            </Field>
            <Field label={`Preço de venda (${currency})`} required hint={workspace.org.pricesIncludeTax ? "Com imposto incluído." : "Sem imposto."}>
              <Input type="number" min={0} step="0.01" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} />
            </Field>
            <Field label={`Custo (${currency})`} hint="Usado para margem estimada e valuation.">
              <Input type="number" min={0} step="0.01" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            </Field>
            <Field label="Taxa de imposto (bps)">
              <Select value={form.taxBps} onChange={(e) => setForm({ ...form, taxBps: e.target.value })}>
                <option value="2300">23% — normal</option>
                <option value="1300">13% — intermédia</option>
                <option value="600">6% — reduzida</option>
                <option value="0">0% — isento</option>
              </Select>
            </Field>
            <Field label="Unidade">
              <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                <option value="un">un — unidade</option>
                <option value="kg">kg — quilograma</option>
                <option value="g">g — grama</option>
                <option value="l">l — litro</option>
                <option value="m">m — metro</option>
                <option value="m2">m² — metro quadrado</option>
                <option value="cx">cx — caixa</option>
              </Select>
            </Field>
            <Field label="Modo de venda">
              <Select value={form.saleMode} onChange={(e) => setForm({ ...form, saleMode: e.target.value as FormState["saleMode"] })}>
                <option value="units">Unidades</option>
                <option value="weight">Peso (balança)</option>
              </Select>
            </Field>
            <Field label="Categoria">
              <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Código de barras (EAN-13)" hint="Validado com dígito de controlo no servidor.">
              <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value.replace(/\D/g, "") })} className="font-mono" maxLength={13} />
            </Field>
            <Field label="Ponto de encomenda" hint="Stock mínimo (un/kg) que dispara reposição.">
              <Input type="number" min={0} value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} />
            </Field>
            <Field label="Estado">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState["status"] })}>
                <option value="active">Ativo</option>
                <option value="discontinued">Descontinuado</option>
                <option value="archived">Arquivado</option>
              </Select>
            </Field>
            <div className="flex items-center gap-4 md:col-span-2">
              <Toggle checked={form.trackStock} onChange={(v) => setForm({ ...form, trackStock: v })} label="Controlar stock" />
              <Toggle checked={form.trackBatches} onChange={(v) => setForm({ ...form, trackBatches: v })} label="Lotes/validades" />
            </div>
            <div className="md:col-span-2">
              <Field label="Descrição">
                <Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
              <Button variant="accent" loading={formBusy} disabled={!form.name.trim() || !form.sku.trim()} onClick={saveForm}>
                {form.id ? "Guardar alterações" : "Criar produto"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* CSV import */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Importar produtos (CSV)" wide>
        <div className="space-y-3">
          <p className="text-xs text-graphite-400">
            Colunas: <code className="font-mono text-[10px]">sku,name,price,cost,tax_bps,unit,sale_mode,category,barcode,stock,reorder_point</code>.
            Preços em euros (ponto ou vírgula decimal). Upsert por SKU — produtos existentes são atualizados, nunca duplicados.
          </p>
          <Textarea
            rows={10}
            className="font-mono text-[11px]"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"sku,name,price,cost,tax_bps,unit,sale_mode,category,barcode,stock,reorder_point\nLEITE-1,Leite meio-gordo 1L,0.89,0.62,600,un,units,Laticínios,5601234567890,48,24"}
          />
          <label className={clsx("flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-mist-300 px-3 py-2 text-xs text-graphite-400 hover:border-lime-brand dark:border-graphite-600")}>
            <FileUp className="h-4 w-4" />
            Carregar ficheiro .csv
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setCsvText(await file.text());
              }}
            />
          </label>
          {importResult && (
            <pre className="whitespace-pre-wrap rounded-md bg-mist-100 p-3 text-[11px] dark:bg-graphite-800">{importResult}</pre>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Fechar</Button>
            <Button variant="accent" loading={importBusy} disabled={csvText.trim().length < 10} onClick={runImport}>
              Importar
            </Button>
          </div>
        </div>
      </Modal>

      {/* categories */}
      <Modal open={catOpen} onClose={() => setCatOpen(false)} title="Categorias">
        <div className="space-y-3">
          <ul className="max-h-52 space-y-1 overflow-y-auto">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-md border border-mist-200 px-3 py-1.5 text-xs dark:border-graphite-600">
                <Tag className="h-3 w-3 text-graphite-400" />
                {c.name}
                {c.parent_id && <span className="text-[10px] text-graphite-400">(subcategoria)</span>}
              </li>
            ))}
            {categories.length === 0 && <li className="py-4 text-center text-xs text-graphite-400">Sem categorias.</li>}
          </ul>
          <div className="flex gap-2">
            <Input value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Nova categoria…" />
            <Button
              variant="accent"
              disabled={!catName.trim()}
              onClick={async () => {
                try {
                  await api("/api/categories", { method: "POST", body: { name: catName.trim() } });
                  setCatName("");
                  const cats = await api<CategoryRow[]>("/api/categories");
                  setCategories(cats);
                  toast.success("Categoria criada");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha");
                }
              }}
            >
              Criar
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
