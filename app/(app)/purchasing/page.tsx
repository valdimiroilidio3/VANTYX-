"use client";

/**
 * Compras — sugestões de reposição (dados reais de rotação/stock),
 * encomendas com aprovação por regras, receção com lotes/validades e
 * atualização de custo médio ponderado. Nunca há receção sem documento.
 */

import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import {
  CheckCircle2,
  Lightbulb,
  PackageCheck,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Truck,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { useConfirm, Badge, Button, EmptyState, Field, Input, Modal, Pagination, Select, Textarea } from "@/components/ui";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";

interface SupplierRow {
  id: string;
  name: string;
  lead_time_days: number | null;
}

interface WarehouseRow {
  id: string;
  name: string;
}

interface PoRow {
  id: string;
  po_number: string;
  supplier_id: string;
  supplier_name: string;
  warehouse_id: string;
  warehouse_name: string;
  status: string;
  expected_at: number | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  requires_approval: number;
  note: string | null;
  created_by_name: string | null;
  created_at: number;
  line_count: number;
}

interface PoLine {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  variant_label: string | null;
  qty_milli: number;
  received_milli: number;
  unit_cost_cents: number;
  tax_rate_bps: number;
  note: string | null;
}

interface GoodsReceiptRow {
  id: string;
  document_number: string | null;
  received_at: number;
  note: string | null;
}

interface PoDetail {
  po: PoRow;
  lines: PoLine[];
  receipts: GoodsReceiptRow[];
}

interface Suggestion {
  id: string;
  name: string;
  sku: string;
  reorder_point_milli: number | null;
  reorder_qty_milli: number | null;
  stock_milli: number;
  avg_daily_milli: number;
  last_cost_cents: number;
  supplier_name: string | null;
}

interface DraftLine {
  productId: string;
  name: string;
  qtyUnits: string;
  costUnits: string;
  supplierId: string;
}

const STATUS: Record<string, { tone: "neutral" | "info" | "warning" | "success" | "danger" | "accent"; label: string }> = {
  draft: { tone: "neutral", label: "rascunho" },
  pending_approval: { tone: "warning", label: "aguarda aprovação" },
  sent: { tone: "info", label: "enviada" },
  partially_received: { tone: "accent", label: "parcialmente recebida" },
  received: { tone: "success", label: "recebida" },
  cancelled: { tone: "danger", label: "cancelada" },
};

const PAGE_SIZE = 25;

export default function PurchasingPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const confirm = useConfirm();
  const currency = workspace.org.currency;

  const [tab, setTab] = useState<"orders" | "suggestions">("orders");
  const [rows, setRows] = useState<PoRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sugLoading, setSugLoading] = useState(false);

  const [detail, setDetail] = useState<PoDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // receive flow
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [receiveBatch, setReceiveBatch] = useState<Record<string, string>>({});
  const [receiveExpiry, setReceiveExpiry] = useState<Record<string, string>>({});
  const [receiveNote, setReceiveNote] = useState("");
  const [receiveBusy, setReceiveBusy] = useState(false);

  // create flow
  const [createOpen, setCreateOpen] = useState(false);
  const [draftSupplier, setDraftSupplier] = useState("");
  const [draftWarehouse, setDraftWarehouse] = useState("");
  const [draftExpected, setDraftExpected] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [draftSearch, setDraftSearch] = useState("");
  const [draftResults, setDraftResults] = useState<{ productId: string; name: string; costCents: number; supplierName?: string }[]>([]);
  const [createBusy, setCreateBusy] = useState(false);

  useEffect(() => {
    api<SupplierRow[]>("/api/suppliers").then((d) => setSuppliers(Array.isArray(d) ? d : [])).catch(() => setSuppliers([]));
    api<WarehouseRow[]>("/api/inventory/warehouses").then(setWarehouses).catch(() => setWarehouses([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ rows: PoRow[]; total: number }>("/api/purchasing/orders", {
        query: { status: statusFilter || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar encomendas");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, toast]);

  const loadSuggestions = useCallback(async () => {
    setSugLoading(true);
    try {
      const data = await api<Suggestion[]>("/api/purchasing/orders", { query: { view: "suggestions", days: 30 } });
      setSuggestions(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao calcular sugestões");
    } finally {
      setSugLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (tab === "orders") load();
    else loadSuggestions();
  }, [tab, load, loadSuggestions]);

  async function openDetail(id: string) {
    try {
      const d = await api<PoDetail>(`/api/purchasing/orders/${id}`);
      setDetail(d);
      setDetailOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao abrir encomenda");
    }
  }

  async function poAction(id: string, body: Record<string, unknown>, successMsg: string) {
    try {
      await api(`/api/purchasing/orders/${id}`, { method: "POST", body });
      toast.success(successMsg);
      await openDetail(id);
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha na operação");
    }
  }

  /* --------- receive --------- */
  function startReceive() {
    if (!detail) return;
    const qty: Record<string, string> = {};
    for (const l of detail.lines) {
      const remaining = l.qty_milli - l.received_milli;
      if (remaining > 0) qty[l.id] = (remaining / 1000).toString();
    }
    setReceiveQty(qty);
    setReceiveBatch({});
    setReceiveExpiry({});
    setReceiveNote("");
    setReceiveOpen(true);
  }

  async function submitReceive() {
    if (!detail) return;
    const lines = detail.lines
      .map((l) => {
        const raw = receiveQty[l.id];
        const qtyMilli = raw ? Math.round(parseFloat(raw.replace(",", ".")) * 1000) : 0;
        const remaining = l.qty_milli - l.received_milli;
        return {
          poLineId: l.id,
          qtyMilli: Math.min(Math.max(0, Number.isFinite(qtyMilli) ? qtyMilli : 0), remaining),
          batchNumber: receiveBatch[l.id]?.trim() || null,
          expiryDate: receiveExpiry[l.id] ? new Date(receiveExpiry[l.id]!).getTime() : null,
        };
      })
      .filter((l) => l.qtyMilli > 0);
    if (!lines.length) {
      toast.error("Indique as quantidades recebidas.");
      return;
    }
    setReceiveBusy(true);
    try {
      await api(`/api/purchasing/orders/${detail.po.id}`, {
        method: "POST",
        body: { action: "receive", lines, note: receiveNote || undefined },
      });
      toast.success("Receção registada", "Stock atualizado (custo médio ponderado) e documento GRN emitido.");
      setReceiveOpen(false);
      await openDetail(detail.po.id);
      load();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.body.message : "Falha na receção");
    } finally {
      setReceiveBusy(false);
    }
  }

  /* --------- create --------- */
  useEffect(() => {
    const q = draftSearch.trim();
    if (!q || !createOpen) {
      setDraftResults([]);
      return;
    }
    const h = setTimeout(() => {
      api<{ results: { productId: string; name: string; costCents: number }[] }>("/api/pos/search", { query: { q, limit: 8 } })
        .then((d) => setDraftResults(d.results.map((r) => ({ productId: r.productId, name: r.name, costCents: r.costCents }))))
        .catch(() => setDraftResults([]));
    }, 250);
    return () => clearTimeout(h);
  }, [draftSearch, createOpen]);

  function draftTotal(): number {
    return draftLines.reduce((a, l) => {
      const qty = Math.round(parseFloat(l.qtyUnits.replace(",", ".")) * 1000);
      const cost = Math.round(parseFloat(l.costUnits.replace(",", ".")) * 100);
      if (!Number.isFinite(qty) || !Number.isFinite(cost)) return a;
      return a + Math.round((qty * cost) / 1000);
    }, 0);
  }

  async function submitCreate() {
    if (!draftSupplier || !draftWarehouse || !draftLines.length) {
      toast.error("Fornecedor, armazém e pelo menos uma linha são obrigatórios.");
      return;
    }
    const lines = draftLines
      .map((l) => ({
        productId: l.productId,
        qtyMilli: Math.round(parseFloat(l.qtyUnits.replace(",", ".")) * 1000),
        unitCostCents: Math.round(parseFloat(l.costUnits.replace(",", ".")) * 100),
      }))
      .filter((l) => Number.isFinite(l.qtyMilli) && l.qtyMilli > 0 && Number.isFinite(l.unitCostCents) && l.unitCostCents >= 0);
    if (!lines.length) {
      toast.error("Revise quantidades e custos das linhas.");
      return;
    }
    setCreateBusy(true);
    try {
      const res = await api<{ poId: string; poNumber: string; requiresApproval?: boolean }>("/api/purchasing/orders", {
        method: "POST",
        body: {
          supplierId: draftSupplier,
          warehouseId: draftWarehouse,
          expectedAt: draftExpected ? new Date(draftExpected).getTime() : null,
          note: draftNote || undefined,
          lines,
        },
      });
      setCreateOpen(false);
      setDraftLines([]);
      toast.success(
        `Encomenda ${res.poNumber ?? ""} criada`,
        res.requiresApproval ? "Aguarda aprovação (regra de negócio)." : undefined,
      );
      load();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 428) {
        toast.warning("Aprovação necessária", err.body.message);
      } else {
        toast.error(err instanceof ApiClientError ? err.body.message : "Falha ao criar encomenda");
      }
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle="Encomendas a fornecedores, aprovações e receções com impacto real no stock"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => (tab === "orders" ? load() : loadSuggestions())} icon={<RefreshCw className={clsx("h-3.5 w-3.5", (loading || sugLoading) && "animate-spin")} />}>
              Atualizar
            </Button>
            {workspace.can("purchasing.manage") && (
              <Button
                variant="accent"
                size="sm"
                onClick={() => {
                  setDraftSupplier(suppliers[0]?.id ?? "");
                  setDraftWarehouse(warehouses.find((w) => (w as { branchId?: string }).branchId === workspace.branchId)?.id ?? warehouses[0]?.id ?? "");
                  setDraftExpected("");
                  setDraftNote("");
                  setCreateOpen(true);
                }}
                icon={<Plus className="h-3.5 w-3.5" />}
              >
                Nova encomenda
              </Button>
            )}
          </>
        }
      />

      <div className="flex items-center gap-2 border-b border-mist-200 bg-white px-4 py-2.5 dark:border-graphite-700 dark:bg-graphite-850">
        <div className="flex overflow-hidden rounded-md border border-mist-200 dark:border-graphite-600">
          <button
            onClick={() => setTab("orders")}
            className={clsx("flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium", tab === "orders" ? "bg-graphite-900 text-lime-brand dark:bg-graphite-700" : "text-graphite-500 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700")}
          >
            <Truck className="h-3.5 w-3.5" /> Encomendas
          </button>
          <button
            onClick={() => setTab("suggestions")}
            className={clsx("flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium", tab === "suggestions" ? "bg-graphite-900 text-lime-brand dark:bg-graphite-700" : "text-graphite-500 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700")}
          >
            <Lightbulb className="h-3.5 w-3.5" /> Sugestões de reposição
          </button>
        </div>
        {tab === "orders" && (
          <Select className="w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} aria-label="Estado">
            <option value="">Todos os estados</option>
            {Object.entries(STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </Select>
        )}
      </div>

      <div className="p-4">
        {tab === "orders" ? (
          <>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState title="Nenhuma encomenda" message="Crie encomendas manualmente ou a partir das sugestões de reposição." icon={<Truck className="h-8 w-8" />} />
            ) : (
              <>
                <div className="card overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-mist-200 text-[10px] uppercase tracking-wider text-graphite-400 dark:border-graphite-700">
                        <th className="px-3 py-2">Nº</th>
                        <th className="px-3 py-2">Fornecedor</th>
                        <th className="px-3 py-2">Armazém</th>
                        <th className="px-3 py-2">Criada</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                      {rows.map((r) => {
                        const st = STATUS[r.status] ?? { tone: "neutral" as const, label: r.status };
                        return (
                          <tr key={r.id} className="cursor-pointer hover:bg-mist-50 dark:hover:bg-graphite-800/60" onClick={() => openDetail(r.id)}>
                            <td className="px-3 py-2 font-mono font-semibold text-lime-dim dark:text-lime-brand">{r.po_number}</td>
                            <td className="px-3 py-2">{r.supplier_name}</td>
                            <td className="px-3 py-2">{r.warehouse_name}</td>
                            <td className="px-3 py-2 whitespace-nowrap text-graphite-400">
                              {fmtDateTime(r.created_at)}
                              {r.created_by_name ? ` · ${r.created_by_name}` : ""}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{fmtMoney(r.total_cents, currency)}</td>
                            <td className="px-3 py-2">
                              <Badge tone={st.tone}>{st.label}</Badge>
                              {r.requires_approval === 1 && r.status === "pending_approval" && <Badge tone="warning" className="ml-1">regra</Badge>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {total > PAGE_SIZE && (
                  <div className="mt-3">
                    <Pagination total={total} limit={PAGE_SIZE} offset={page * PAGE_SIZE} onOffset={(o) => setPage(Math.floor(o / PAGE_SIZE))} />
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p className="mb-3 text-[11px] text-graphite-400">
              Sugestões calculadas com dados reais: stock atual ≤ ponto de encomenda OU cobertura &lt; 7 dias à velocidade média dos últimos 30 dias.
            </p>
            {sugLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
                ))}
              </div>
            ) : suggestions.length === 0 ? (
              <EmptyState title="Nada a repor" message="Nenhum produto abaixo do ponto de encomenda ou com cobertura inferior a 7 dias." icon={<CheckCircle2 className="h-8 w-8" />} />
            ) : (
              <ul className="space-y-1.5">
                {suggestions.map((s) => {
                  const suggested = s.reorder_qty_milli ?? Math.max(1000, Math.round(s.avg_daily_milli * 7));
                  return (
                    <li key={s.id} className="card flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold">{s.name}</span>
                        <span className="block text-[10px] text-graphite-400">
                          {s.sku} · stock {fmtQty(s.stock_milli)}
                          {s.reorder_point_milli != null ? ` · mínimo ${fmtQty(s.reorder_point_milli)}` : ""}
                          {s.avg_daily_milli > 0 ? ` · ~${(s.avg_daily_milli / 1000).toFixed(1)}/dia` : ""}
                          {s.supplier_name ? ` · ${s.supplier_name}` : ""}
                        </span>
                      </span>
                      <span className="font-mono text-xs tabular-nums text-graphite-400">
                        último custo {fmtMoney(s.last_cost_cents, currency)}
                      </span>
                      {workspace.can("purchasing.manage") && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setDraftLines((list) => [
                              ...list,
                              {
                                productId: s.id,
                                name: s.name,
                                qtyUnits: (suggested / 1000).toString(),
                                costUnits: (s.last_cost_cents / 100).toFixed(2),
                                supplierId: "",
                              },
                            ]);
                            setCreateOpen(true);
                            toast.info("Linha adicionada ao rascunho", "Escolha fornecedor e armazém e complete a encomenda.");
                          }}
                          icon={<Plus className="h-3.5 w-3.5" />}
                        >
                          Repor {fmtQty(suggested)}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {/* detail */}
      <Modal open={detailOpen && detail !== null} onClose={() => setDetailOpen(false)} title={`Encomenda ${detail?.po.po_number ?? ""}`} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-graphite-400">
              <Badge tone={(STATUS[detail.po.status] ?? { tone: "neutral" }).tone}>
                {(STATUS[detail.po.status] ?? { label: detail.po.status }).label}
              </Badge>
              <span>{detail.po.supplier_name} → {detail.po.warehouse_name}</span>
              <span>· criada {fmtDateTime(detail.po.created_at)}</span>
              {detail.po.expected_at && <span>· esperada {fmtDateTime(detail.po.expected_at)}</span>}
            </div>

            <div className="overflow-hidden rounded-lg border border-mist-200 dark:border-graphite-600">
              <table className="w-full text-left text-xs">
                <thead className="bg-mist-100 dark:bg-graphite-800">
                  <tr className="text-[10px] uppercase tracking-wider text-graphite-400">
                    <th className="px-3 py-1.5">Produto</th>
                    <th className="px-3 py-1.5 text-right">Qtd.</th>
                    <th className="px-3 py-1.5 text-right">Recebido</th>
                    <th className="px-3 py-1.5 text-right">Custo unit.</th>
                    <th className="px-3 py-1.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                  {detail.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-1.5">
                        <p className="font-medium">{l.product_name}{l.variant_label ? ` · ${l.variant_label}` : ""}</p>
                        <p className="font-mono text-[10px] text-graphite-400">{l.sku}</p>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtQty(l.qty_milli)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-success">
                        {l.received_milli > 0 ? fmtQty(l.received_milli) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtMoney(l.unit_cost_cents, currency)}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                        {fmtMoney(Math.round((l.qty_milli * l.unit_cost_cents) / 1000), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-mist-200 dark:border-graphite-700">
                    <td colSpan={4} className="px-3 py-1.5 text-right text-[10px] uppercase tracking-wide text-graphite-400">
                      Subtotal {fmtMoney(detail.po.subtotal_cents, currency)} + IVA {fmtMoney(detail.po.tax_cents, currency)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-sm font-bold tabular-nums">{fmtMoney(detail.po.total_cents, currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {detail.receipts.length > 0 && (
              <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-graphite-400">Receções (GRN)</p>
                <ul className="space-y-0.5 text-xs">
                  {detail.receipts.map((r) => (
                    <li key={r.id} className="flex justify-between">
                      <span className="font-mono">{r.document_number ?? r.id.slice(0, 10)}</span>
                      <span className="text-graphite-400">{fmtDateTime(r.received_at)}{r.note ? ` · ${r.note}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-mist-200 pt-3 dark:border-graphite-700">
              {detail.po.status === "draft" && workspace.can("purchasing.manage") && (
                <>
                  <Button variant="accent" size="sm" onClick={() => poAction(detail.po.id, { action: "send" }, "Encomenda enviada ao fornecedor.")} icon={<Send className="h-3.5 w-3.5" />}>
                    Enviar ao fornecedor
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={async () => {
                      const ok = await confirm({ title: "Cancelar encomenda", message: "Cancelar esta encomenda em rascunho?", confirmLabel: "Cancelar encomenda", danger: true });
                      if (ok) poAction(detail.po.id, { action: "cancel" }, "Encomenda cancelada.");
                    }}
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                  >
                    Cancelar
                  </Button>
                </>
              )}
              {detail.po.status === "pending_approval" && workspace.can("purchasing.approve") && (
                <>
                  <Button variant="accent" size="sm" onClick={() => poAction(detail.po.id, { action: "approve", decision: "approved" }, "Encomenda aprovada.")} icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
                    Aprovar
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => poAction(detail.po.id, { action: "approve", decision: "rejected", reason: "Rejeitada pelo aprovador" }, "Encomenda rejeitada.")} icon={<XCircle className="h-3.5 w-3.5" />}>
                    Rejeitar
                  </Button>
                </>
              )}
              {(detail.po.status === "sent" || detail.po.status === "partially_received") && workspace.can("purchasing.receive") && (
                <Button variant="accent" size="sm" onClick={startReceive} icon={<PackageCheck className="h-3.5 w-3.5" />}>
                  Registar receção
                </Button>
              )}
              {detail.po.status === "pending_approval" && !workspace.can("purchasing.approve") && (
                <p className="text-[11px] text-warning">Encomenda aguarda aprovação (limite definido em regras de negócio).</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* receive */}
      <Modal open={receiveOpen && detail !== null} onClose={() => setReceiveOpen(false)} title="Registar receção" wide>
        {detail && (
          <div className="space-y-4">
            <p className="text-[11px] text-graphite-400">
              A receção atualiza stock (custo médio ponderado), emite documento GRN e regista histórico de preços do fornecedor.
              Para produtos com lotes/validades ative os campos correspondentes.
            </p>
            <ul className="space-y-2">
              {detail.lines.map((l) => {
                const remaining = l.qty_milli - l.received_milli;
                if (remaining <= 0) return null;
                return (
                  <li key={l.id} className="rounded-lg border border-mist-200 p-3 dark:border-graphite-600">
                    <p className="text-xs font-semibold">
                      {l.product_name}{l.variant_label ? ` · ${l.variant_label}` : ""}
                      <span className="ml-2 font-normal text-graphite-400">
                        encomendado {fmtQty(l.qty_milli)} · recebido {fmtQty(l.received_milli)} · em falta {fmtQty(remaining)}
                      </span>
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                      <Field label="Qtd. recebida">
                        <Input type="number" min={0} step="0.001" value={receiveQty[l.id] ?? ""} onChange={(e) => setReceiveQty((m) => ({ ...m, [l.id]: e.target.value }))} />
                      </Field>
                      <Field label="Lote (opcional)">
                        <Input value={receiveBatch[l.id] ?? ""} onChange={(e) => setReceiveBatch((m) => ({ ...m, [l.id]: e.target.value }))} placeholder="L2025-10-13" />
                      </Field>
                      <Field label="Validade (opcional)">
                        <Input type="date" value={receiveExpiry[l.id] ?? ""} onChange={(e) => setReceiveExpiry((m) => ({ ...m, [l.id]: e.target.value }))} />
                      </Field>
                      <div className="flex items-end text-[10px] text-graphite-400">
                        custo {fmtMoney(l.unit_cost_cents, currency)}/un
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Field label="Nota de receção">
              <Textarea rows={2} value={receiveNote} onChange={(e) => setReceiveNote(e.target.value)} placeholder="Ex.: faltam 2 caixas — fornecedor notificado…" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReceiveOpen(false)}>Fechar</Button>
              <Button variant="accent" loading={receiveBusy} onClick={submitReceive} icon={<PackageCheck className="h-4 w-4" />}>
                Confirmar receção
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* create */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova encomenda" wide>
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Fornecedor" required>
              <Select value={draftSupplier} onChange={(e) => setDraftSupplier(e.target.value)}>
                <option value="">Selecionar…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}{s.lead_time_days ? ` (${s.lead_time_days}d)` : ""}</option>
                ))}
              </Select>
            </Field>
            <Field label="Armazém de destino" required>
              <Select value={draftWarehouse} onChange={(e) => setDraftWarehouse(e.target.value)}>
                <option value="">Selecionar…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Entrega esperada">
              <Input type="datetime-local" value={draftExpected} onChange={(e) => setDraftExpected(e.target.value)} />
            </Field>
          </div>

          <div>
            <Field label="Adicionar produto (pesquisa)">
              <Input value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} placeholder="Nome ou SKU…" />
            </Field>
            {draftResults.length > 0 && (
              <ul className="mt-1 space-y-1">
                {draftResults.map((r) => (
                  <li key={r.productId}>
                    <button
                      className="w-full rounded-md border border-mist-200 px-2.5 py-1.5 text-left text-xs hover:border-lime-brand dark:border-graphite-600"
                      onClick={() => {
                        setDraftLines((list) => [
                          ...list,
                          { productId: r.productId, name: r.name, qtyUnits: "1", costUnits: (r.costCents / 100).toFixed(2), supplierId: draftSupplier },
                        ]);
                        setDraftSearch("");
                      }}
                    >
                      {r.name} <span className="text-graphite-400">· custo {fmtMoney(r.costCents, currency)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {draftLines.length > 0 && (
            <ul className="space-y-1.5">
              {draftLines.map((l, i) => (
                <li key={i} className="flex flex-wrap items-end gap-2 rounded-lg border border-mist-200 p-2 dark:border-graphite-600">
                  <span className="min-w-32 flex-1 truncate text-xs font-semibold">{l.name}</span>
                  <span className="w-24">
                    <Field label="Qtd.">
                      <Input className="h-8 text-xs" type="number" min={0} step="0.001" value={l.qtyUnits} onChange={(e) => setDraftLines((list) => list.map((x, j) => (j === i ? { ...x, qtyUnits: e.target.value } : x)))} />
                    </Field>
                  </span>
                  <span className="w-28">
                    <Field label={`Custo (${currency})`}>
                      <Input className="h-8 text-xs" type="number" min={0} step="0.01" value={l.costUnits} onChange={(e) => setDraftLines((list) => list.map((x, j) => (j === i ? { ...x, costUnits: e.target.value } : x)))} />
                    </Field>
                  </span>
                  <button className="rounded p-1 text-graphite-400 hover:text-danger" onClick={() => setDraftLines((list) => list.filter((_, j) => j !== i))} aria-label="Remover linha">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <Field label="Nota">
            <Input value={draftNote} onChange={(e) => setDraftNote(e.target.value)} placeholder="Condições especiais…" />
          </Field>

          <div className="flex items-center justify-between border-t border-mist-200 pt-3 dark:border-graphite-700">
            <span className="text-xs text-graphite-400">
              Total estimado (custo): <strong className="font-mono text-sm text-mist-100">{fmtMoney(draftTotal(), currency)}</strong>
              <span className="ml-2">regras de aprovação são avaliadas no servidor</span>
            </span>
            <span className="flex gap-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
              <Button variant="accent" loading={createBusy} disabled={!draftSupplier || !draftWarehouse || !draftLines.length} onClick={submitCreate}>
                Criar encomenda
              </Button>
            </span>
          </div>
        </div>
      </Modal>
    </>
  );
}
