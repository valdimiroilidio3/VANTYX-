"use client";

/** Inventário — stock por armazém, ajustes auditados, transferências e movimentos. */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, ClipboardList, History, Search, Warehouse } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { Badge, Button, EmptyState, Field, Input, Modal, Pagination, Select, Textarea, Toggle } from "@/components/ui";
import { api } from "@/lib/api/client";
import { fmtMoney, fmtQty } from "@/lib/format";

interface WarehouseRow {
  id: string;
  name: string;
  code: string;
  branchId: string | null;
  isDefault: boolean;
}

interface StockRow {
  product_id: string;
  variant_id: string | null;
  product_name: string;
  sku: string;
  variant_label: string | null;
  unit: string;
  qty_milli: number;
  reserved_milli: number;
  avg_cost_cents: number;
  reorder_point_milli: number | null;
  warehouse_id: string;
  warehouse_name: string;
}

interface MovementRow {
  id: string;
  product_id: string;
  product_name: string;
  variant_label: string | null;
  warehouse_id: string;
  warehouse_name: string;
  reason_code: string;
  qty_milli: number;
  ref_type: string | null;
  ref_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: number;
}

interface TransferRow {
  id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  from_name: string;
  to_name: string;
  created_by_label: string | null;
  status: "draft" | "in_transit" | "completed" | "cancelled";
  note: string | null;
  created_at: number;
  lines?: { id: string; product_name: string; qty_milli: number; unit: string }[];
}

const ADJUST_REASONS = [
  { key: "count_variance", label: "Divergência de contagem" },
  { key: "damage", label: "Dano / avaria" },
  { key: "spoilage", label: "Deterioração / validade" },
  { key: "theft_loss", label: "Perda / furto" },
  { key: "internal_use", label: "Consumo interno" },
  { key: "correction", label: "Correção de lançamento" },
  { key: "initial_load", label: "Carga inicial" },
  { key: "other", label: "Outro (com nota)" },
] as const;

const PAGE_SIZE = 50;

export default function InventoryPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const currency = workspace.org.currency;

  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [total, setTotal] = useState(0);
  const [valuation, setValuation] = useState<{ valueCents: number; positions: number } | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [belowMin, setBelowMin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"stock" | "movements" | "transfers">("stock");
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);

  // adjust modal
  const [adjustFor, setAdjustFor] = useState<StockRow | null>(null);
  const [adjustMode, setAdjustMode] = useState<"absolute" | "delta">("absolute");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState<string>("count_correction");
  const [adjustNote, setAdjustNote] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);

  // transfer modal
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferProduct, setTransferProduct] = useState("");
  const [transferQty, setTransferQty] = useState("");
  const [transferLines, setTransferLines] = useState<{ productId: string; name: string; qtyMilli: number }[]>([]);
  const [transferNote, setTransferNote] = useState("");
  const [productResults, setProductResults] = useState<StockRow[]>([]);

  useEffect(() => {
    api<WarehouseRow[]>("/api/inventory/warehouses")
      .then((list) => {
        setWarehouses(list);
        const preferred = list.find((w) => w.branchId === workspace.branchId) ?? list.find((w) => w.isDefault) ?? list[0];
        if (preferred) setWarehouseId((cur) => cur || preferred.id);
      })
      .catch(() => setWarehouses([]));
  }, [workspace.branchId]);

  const loadStock = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ rows: StockRow[]; total: number; valuation: { valueCents: number; positions: number } }>(
        "/api/inventory/stock",
        {
          query: {
            warehouseId: warehouseId || undefined,
            search: search || undefined,
            belowMin: belowMin ? "1" : undefined,
            limit: PAGE_SIZE,
            offset: page * PAGE_SIZE,
          },
        },
      );
      setRows(data.rows);
      setTotal(data.total);
      setValuation(data.valuation);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar stock");
    } finally {
      setLoading(false);
    }
  }, [warehouseId, search, belowMin, page, toast]);

  const loadMovements = useCallback(async () => {
    try {
      const data = await api<{ rows?: MovementRow[] } | MovementRow[]>("/api/inventory/movements", {
        query: { warehouseId: warehouseId || undefined, limit: 60 },
      });
      setMovements(Array.isArray(data) ? data : (data.rows ?? []));
    } catch {
      setMovements([]);
    }
  }, [warehouseId]);

  const loadTransfers = useCallback(async () => {
    try {
      const data = await api<{ transfers?: TransferRow[] } | TransferRow[]>("/api/inventory/transfer", {
        query: { limit: 40 },
      });
      setTransfers(Array.isArray(data) ? data : (data.transfers ?? []));
    } catch {
      setTransfers([]);
    }
  }, []);

  useEffect(() => {
    if (tab === "stock") loadStock();
    else if (tab === "movements") loadMovements();
    else loadTransfers();
  }, [tab, loadStock, loadMovements, loadTransfers]);

  // product search for transfers
  useEffect(() => {
    const q = transferProduct.trim();
    if (!q || !transferOpen) {
      setProductResults([]);
      return;
    }
    const h = setTimeout(() => {
      api<{ results: { productId: string; name: string; variantLabel: string | null }[] }>("/api/pos/search", {
        query: { q, branchId: workspace.branchId ?? undefined, limit: 8 },
      })
        .then((d) =>
          setProductResults(
            d.results.map((r) => ({ ...r, product_id: r.productId, product_name: r.name })) as unknown as StockRow[],
          ),
        )
        .catch(() => setProductResults([]));
    }, 250);
    return () => clearTimeout(h);
  }, [transferProduct, transferOpen, workspace.branchId]);

  async function submitAdjust() {
    if (!adjustFor) return;
    const qtyUnits = parseFloat(adjustQty.replace(",", "."));
    if (!Number.isFinite(qtyUnits)) {
      toast.error("Quantidade inválida.");
      return;
    }
    const qtyMilli = Math.round(qtyUnits * 1000);
    if (adjustMode === "delta" && qtyMilli === 0) {
      toast.error("Delta não pode ser zero.");
      return;
    }
    if (adjustMode === "absolute" && qtyMilli < 0) {
      toast.error("Stock absoluto não pode ser negativo.");
      return;
    }
    setAdjustBusy(true);
    try {
      await api("/api/inventory/adjust", {
        method: "POST",
        body: {
          warehouseId: adjustFor.warehouse_id,
          productId: adjustFor.product_id,
          variantId: adjustFor.variant_id,
          mode: adjustMode,
          qtyMilli,
          reasonCode: adjustReason,
          ...(adjustNote.trim() ? { note: adjustNote.trim() } : {}),
        },
      });
      toast.success("Stock ajustado", "Movimento registado com motivo e auditoria.");
      setAdjustFor(null);
      setAdjustQty("");
      setAdjustNote("");
      loadStock();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no ajuste");
    } finally {
      setAdjustBusy(false);
    }
  }

  async function submitTransfer() {
    if (!warehouseId || !transferTo || !transferLines.length) {
      toast.error("Selecione origem, destino e pelo menos um produto.");
      return;
    }
    try {
      await api("/api/inventory/transfer", {
        method: "POST",
        body: {
          action: "create",
          fromWarehouseId: warehouseId,
          toWarehouseId: transferTo,
          note: transferNote || undefined,
          lines: transferLines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli })),
        },
      });
      toast.success("Transferência criada", "Confirme a receção no destino para mover o stock.");
      setTransferOpen(false);
      setTransferLines([]);
      setTransferNote("");
      setTransferTo("");
      loadTransfers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha na transferência");
    }
  }

  return (
    <>
      <PageHeader
        title="Inventário"
        subtitle={
          valuation
            ? `Valor do stock (custo médio): ${fmtMoney(valuation.valueCents, currency)} · ${valuation.positions} posições`
            : "Stock, ajustes auditados e transferências"
        }
        actions={
          <>
            <Link href="/inventory/counts">
              <Button variant="secondary" size="sm" icon={<ClipboardList className="h-3.5 w-3.5" />}>
                Contagens
              </Button>
            </Link>
            {workspace.can("inventory.transfer") && (
              <Button variant="secondary" size="sm" onClick={() => setTransferOpen(true)} icon={<ArrowLeftRight className="h-3.5 w-3.5" />}>
                Transferir
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-mist-200 bg-white px-4 py-2.5 dark:border-graphite-700 dark:bg-graphite-850">
        <div className="flex overflow-hidden rounded-md border border-mist-200 dark:border-graphite-600">
          {(
            [
              { key: "stock", label: "Stock", icon: Warehouse },
              { key: "movements", label: "Movimentos", icon: History },
              { key: "transfers", label: "Transferências", icon: ArrowLeftRight },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${
                tab === t.key
                  ? "bg-graphite-900 text-lime-brand dark:bg-graphite-700"
                  : "text-graphite-500 hover:bg-mist-100 dark:text-graphite-300 dark:hover:bg-graphite-700"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>
        <Select className="w-auto" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(0); }} aria-label="Armazém">
          <option value="">Todos os armazéns</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </Select>
        {tab === "stock" && (
          <>
            <div className="relative min-w-40 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-graphite-400" />
              <Input className="pl-8" placeholder="Pesquisar produto…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </div>
            <Toggle checked={belowMin} onChange={(v) => { setBelowMin(v); setPage(0); }} label="Só abaixo do mínimo" />
          </>
        )}
      </div>

      <div className="p-4">
        {tab === "stock" && (
          <>
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-11 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <EmptyState title="Sem posições de stock" message="O stock aparece aqui após compras, ajustes ou cargas iniciais." icon={<Warehouse className="h-8 w-8" />} />
            ) : (
              <div className="card overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-mist-200 text-[10px] uppercase tracking-wider text-graphite-400 dark:border-graphite-700">
                      <th className="px-3 py-2">Produto</th>
                      <th className="px-3 py-2">Armazém</th>
                      <th className="px-3 py-2 text-right">Disponível</th>
                      <th className="px-3 py-2 text-right">Reservado</th>
                      <th className="px-3 py-2 text-right">Mínimo</th>
                      <th className="px-3 py-2 text-right">Custo médio</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      {workspace.can("inventory.adjust") && <th className="px-3 py-2 text-right">Ajustar</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                    {rows.map((r) => {
                      const key = `${r.warehouse_id}:${r.product_id}:${r.variant_id ?? ""}`;
                      const below = r.reorder_point_milli != null && r.qty_milli <= r.reorder_point_milli;
                      return (
                        <tr key={key} className="hover:bg-mist-50 dark:hover:bg-graphite-800/60">
                          <td className="px-3 py-2">
                            <p className="font-semibold">
                              {r.product_name}
                              {r.variant_label ? <span className="font-normal text-graphite-400"> · {r.variant_label}</span> : null}
                            </p>
                            <p className="font-mono text-[10px] text-graphite-400">{r.sku}</p>
                          </td>
                          <td className="px-3 py-2">{r.warehouse_name}</td>
                          <td className={`px-3 py-2 text-right font-mono font-semibold tabular-nums ${r.qty_milli < 0 ? "text-danger" : below ? "text-warning" : ""}`}>
                            {fmtQty(r.qty_milli, r.unit)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-graphite-400">{r.reserved_milli ? fmtQty(r.reserved_milli, r.unit) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-graphite-400">
                            {r.reorder_point_milli != null ? fmtQty(r.reorder_point_milli, r.unit) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{r.avg_cost_cents ? fmtMoney(r.avg_cost_cents, currency) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {fmtMoney(Math.round((r.qty_milli * r.avg_cost_cents) / 1000), currency)}
                          </td>
                          {workspace.can("inventory.adjust") && (
                            <td className="px-3 py-2 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setAdjustFor(r);
                                  setAdjustMode("absolute");
                                  setAdjustQty((r.qty_milli / 1000).toString());
                                  setAdjustReason("count_variance");
                                }}
                              >
                                Ajustar
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {total > PAGE_SIZE && (
              <div className="mt-3">
                <Pagination total={total} limit={PAGE_SIZE} offset={page * PAGE_SIZE} onOffset={(o) => setPage(Math.floor(o / PAGE_SIZE))} />
              </div>
            )}
          </>
        )}

        {tab === "movements" && (
          movements.length === 0 ? (
            <EmptyState title="Sem movimentos" message="Todos os movimentos de stock (vendas, compras, ajustes, transferências, desperdício) aparecem aqui com rasto completo." icon={<History className="h-8 w-8" />} />
          ) : (
            <ul className="space-y-1.5">
              {movements.map((m) => (
                <li key={m.id} className="card flex items-center gap-3 px-3 py-2">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${m.qty_milli >= 0 ? "bg-green-500/15 text-success" : "bg-red-500/15 text-danger"}`}>
                    {m.qty_milli >= 0 ? "+" : "−"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {m.product_name}
                      {m.variant_label ? ` · ${m.variant_label}` : ""}
                    </span>
                    <span className="block truncate text-[10px] text-graphite-400">
                      {m.reason_code} · {m.warehouse_name} · {new Date(m.created_at).toLocaleString("pt-PT")}
                      {m.ref_type ? ` · ${m.ref_type}` : ""}
                      {m.note ? ` · “${m.note}”` : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 font-mono text-xs font-bold tabular-nums ${m.qty_milli >= 0 ? "text-success" : "text-danger"}`}>
                    {m.qty_milli >= 0 ? "+" : ""}{fmtQty(m.qty_milli)}
                  </span>
                </li>
              ))}
            </ul>
          )
        )}

        {tab === "transfers" && (
          transfers.length === 0 ? (
            <EmptyState title="Sem transferências" message="Crie transferências entre armazéns; o stock só move na receção confirmada no destino." icon={<ArrowLeftRight className="h-8 w-8" />} />
          ) : (
            <ul className="space-y-1.5">
              {transfers.map((t) => (
                <li key={t.id} className="card flex flex-wrap items-center gap-3 px-3 py-2">
                  <Badge tone={t.status === "completed" ? "success" : t.status === "in_transit" ? "info" : t.status === "cancelled" ? "danger" : "warning"}>
                    {t.status === "completed" ? "recebida" : t.status === "in_transit" ? "em trânsito" : t.status === "cancelled" ? "cancelada" : "rascunho"}
                  </Badge>
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="font-semibold">{t.from_name} → {t.to_name}</span>
                    <span className="block truncate text-[10px] text-graphite-400">
                      {new Date(t.created_at).toLocaleString("pt-PT")}
                      {t.created_by_label ? ` · ${t.created_by_label}` : ""}
                      {t.note ? ` · ${t.note}` : ""}
                      {t.lines ? ` · ${t.lines.map((l) => `${l.product_name} (${fmtQty(l.qty_milli, l.unit)})`).join(", ")}` : ""}
                    </span>
                  </span>
                  {workspace.can("inventory.transfer") && (t.status === "draft" || t.status === "in_transit") && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={async () => {
                        try {
                          await api("/api/inventory/transfer", { method: "POST", body: { action: "receive", transferId: t.id } });
                          toast.success("Transferência recebida", "Stock movido para o armazém de destino.");
                          loadTransfers();
                          loadStock();
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Falha na receção");
                        }
                      }}
                    >
                      Confirmar receção
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )
        )}
      </div>

      {/* adjust modal */}
      <Modal open={adjustFor !== null} onClose={() => setAdjustFor(null)} title={`Ajustar stock — ${adjustFor?.product_name ?? ""}`}>
        {adjustFor && (
          <div className="space-y-4">
            <p className="rounded-md bg-mist-100 px-3 py-2 text-[11px] text-graphite-500 dark:bg-graphite-800 dark:text-graphite-300">
              Stock atual: <strong>{fmtQty(adjustFor.qty_milli, adjustFor.unit)}</strong> em {adjustFor.warehouse_name}.
              Ajustes geram movimento auditado com motivo obrigatório — o histórico nunca é editado.
            </p>
            <div className="flex gap-2">
              <Button variant={adjustMode === "absolute" ? "accent" : "secondary"} size="sm" onClick={() => setAdjustMode("absolute")}>
                Valor absoluto
              </Button>
              <Button variant={adjustMode === "delta" ? "accent" : "secondary"} size="sm" onClick={() => setAdjustMode("delta")}>
                Delta (+/−)
              </Button>
            </div>
            <Field label={adjustMode === "absolute" ? `Novo stock (${adjustFor.unit})` : `Delta (${adjustFor.unit}, use negativo para retiradas)`} required>
              <Input type="number" step="0.001" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} autoFocus />
            </Field>
            <Field label="Motivo" required>
              <Select value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}>
                {ADJUST_REASONS.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Nota (recomendado)">
              <Textarea rows={2} value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="Ex.: contagem cíclica 12/10, prato partido…" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdjustFor(null)}>Cancelar</Button>
              <Button variant="accent" loading={adjustBusy} disabled={!adjustQty} onClick={submitAdjust}>
                Aplicar ajuste
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* transfer modal */}
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Nova transferência entre armazéns" wide>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Origem">
              <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Destino" required>
              <Select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                <option value="">Selecionar…</option>
                {warehouses.filter((w) => w.id !== warehouseId).map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Produto">
            <Input value={transferProduct} onChange={(e) => setTransferProduct(e.target.value)} placeholder="Pesquisar por nome ou SKU…" />
          </Field>
          {productResults.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto">
              {productResults.map((r) => (
                <li key={r.product_id}>
                  <button
                    className="w-full rounded-md border border-mist-200 px-2.5 py-1.5 text-left text-xs hover:border-lime-brand dark:border-graphite-600"
                    onClick={() => {
                      const qty = Math.round(parseFloat((transferQty || "1").replace(",", ".")) * 1000);
                      if (!Number.isFinite(qty) || qty <= 0) {
                        toast.error("Indique a quantidade antes de adicionar.");
                        return;
                      }
                      setTransferLines((list) => [...list, { productId: r.product_id, name: r.product_name, qtyMilli: qty }]);
                      setTransferProduct("");
                      setTransferQty("");
                    }}
                  >
                    {r.product_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Quantidade (un/kg)" hint="Defina a quantidade e escolha o produto na pesquisa.">
            <Input type="number" min={0} step="0.001" value={transferQty} onChange={(e) => setTransferQty(e.target.value)} placeholder="1" />
          </Field>
          {transferLines.length > 0 && (
            <ul className="space-y-1">
              {transferLines.map((l, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md border border-mist-200 px-2.5 py-1.5 text-xs dark:border-graphite-600">
                  <span className="flex-1 truncate">{l.name}</span>
                  <span className="font-mono tabular-nums">{fmtQty(l.qtyMilli)}</span>
                  <button className="text-graphite-400 hover:text-danger" onClick={() => setTransferLines((list) => list.filter((_, j) => j !== i))} aria-label="Remover linha">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Nota">
            <Input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="Ex.: reposição loja → armazém central" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTransferOpen(false)}>Cancelar</Button>
            <Button variant="accent" disabled={!transferTo || !transferLines.length} onClick={submitTransfer}>
              Criar transferência
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
