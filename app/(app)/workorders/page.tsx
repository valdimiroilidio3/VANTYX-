"use client";

/**
 * /workorders — Oficina / ordens de serviço (auto repair, technical
 * assistance, equipment maintenance). Real persistence via workshop.service;
 * status flow enforced server-side. Parts are priced in cents, quantities in
 * milli-units (consistent with the rest of the platform).
 */

import { useCallback, useEffect, useState } from "react";
import {
  CircuitBoard,
  Loader2,
  Plus,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, Pagination } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/system/toast";
import { useWorkspace } from "@/components/layout/workspace";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime, fmtMoney, fmtQty } from "@/lib/format";

type WoStatus = "quote" | "approved" | "in_progress" | "waiting_parts" | "done" | "delivered" | "cancelled";

const STATUS_LABELS: Record<WoStatus, string> = {
  quote: "Orçamento",
  approved: "Aprovada",
  in_progress: "Em curso",
  waiting_parts: "Aguarda peças",
  done: "Concluída",
  delivered: "Entregue",
  cancelled: "Cancelada",
};

const STATUS_TONES: Record<WoStatus, "neutral" | "info" | "warning" | "success" | "danger" | "accent"> = {
  quote: "neutral",
  approved: "info",
  in_progress: "accent",
  waiting_parts: "warning",
  done: "success",
  delivered: "success",
  cancelled: "danger",
};

const NEXT: Record<WoStatus, WoStatus[]> = {
  quote: ["approved", "cancelled"],
  approved: ["in_progress", "waiting_parts", "cancelled"],
  in_progress: ["waiting_parts", "done", "cancelled"],
  waiting_parts: ["in_progress", "done", "cancelled"],
  done: ["delivered", "in_progress"],
  delivered: [],
  cancelled: [],
};

interface WoRow {
  id: string;
  wo_number: string;
  branch_name?: string;
  customer_name?: string | null;
  vehicle_plate: string | null;
  equipment_serial: string | null;
  status: WoStatus;
  total_cents: number;
  part_count?: number;
  created_at: number;
}

interface WoPart {
  id: string;
  product_name: string;
  sku: string;
  variant_label?: string | null;
  qty_milli: number;
  unit_price_cents: number;
}

interface WoDetail {
  wo: WoRow & {
    vehicle_info: string | null;
    diagnosis: string | null;
    labor_minutes: number;
    labor_rate_cents: number;
    parts_cents: number;
    labor_cents: number;
    warranty_ends_at: number | null;
    customer_phone?: string | null;
  };
  parts: WoPart[];
}

interface ProductHit {
  id: string;
  name: string;
  sku: string;
  price_cents: number;
}

const LIMIT = 25;

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : "Erro inesperado.";
}

export default function WorkOrdersPage() {
  const toast = useToast();
  const { branches } = useWorkspace();
  const [rows, setRows] = useState<WoRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<WoDetail | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ rows: WoRow[]; total: number }>("/api/workorders", {
        query: { status: status || undefined, search: search || undefined, limit: LIMIT, offset },
      });
      setRows(data.rows);
      setTotal(data.total);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [status, search, offset, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(id: string) {
    try {
      setDetail(await api<WoDetail>(`/api/workorders/${id}`));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  async function advance(id: string, next: WoStatus) {
    setBusy(true);
    try {
      const fresh = await api<WoDetail>(`/api/workorders/${id}`, { body: { action: "status", status: next } });
      setDetail(fresh);
      toast.success(`Estado atualizado para ${STATUS_LABELS[next]}.`);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Oficina"
        subtitle="Ordens de serviço: orçamento → execução → entrega, com peças e mão de obra."
        actions={
          <Button size="sm" variant="accent" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Nova OS
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader
            title="Ordens de serviço"
            icon={<Wrench className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-graphite-400" />
                  <input
                    className="input-base h-8 w-44 pl-8 text-sm"
                    placeholder="Nº, matrícula, cliente…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setOffset(0);
                    }}
                  />
                </div>
                <select
                  className="input-base h-8 w-40 text-sm"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">Todos os estados</option>
                  {(Object.keys(STATUS_LABELS) as WoStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            }
          />
          <div className="p-4">
            {!rows ? (
              <div className="flex justify-center py-10 text-graphite-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : !rows.length ? (
              <EmptyState
                icon={<CircuitBoard className="h-8 w-8" />}
                title="Sem ordens de serviço"
                message="Crie a primeira OS para registar diagnóstico, peças e mão de obra."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-mist-200 text-left text-xs text-graphite-400 dark:border-graphite-700">
                      <th className="py-2 pr-3 font-medium">Nº</th>
                      <th className="py-2 pr-3 font-medium">Cliente / Equipamento</th>
                      <th className="py-2 pr-3 font-medium">Filial</th>
                      <th className="py-2 pr-3 font-medium">Estado</th>
                      <th className="py-2 pr-3 text-right font-medium">Total</th>
                      <th className="py-2 text-right font-medium">Criada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((w) => (
                      <tr
                        key={w.id}
                        className="cursor-pointer border-b border-mist-200/60 hover:bg-mist-100 dark:border-graphite-700/60 dark:hover:bg-graphite-800"
                        onClick={() => openDetail(w.id)}
                      >
                        <td className="py-2.5 pr-3 font-mono text-xs font-semibold">{w.wo_number}</td>
                        <td className="py-2.5 pr-3">
                          <p className="font-medium">{w.customer_name ?? "—"}</p>
                          <p className="text-xs text-graphite-400">
                            {w.vehicle_plate ?? w.equipment_serial ?? ""}
                            {w.part_count ? ` · ${w.part_count} peças` : ""}
                          </p>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-graphite-400">{w.branch_name ?? "—"}</td>
                        <td className="py-2.5 pr-3">
                          <Badge tone={STATUS_TONES[w.status]}>{STATUS_LABELS[w.status]}</Badge>
                        </td>
                        <td className="py-2.5 pr-3 text-right font-medium">{fmtMoney(w.total_cents)}</td>
                        <td className="py-2.5 text-right text-xs text-graphite-400">{fmtDateTime(w.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {total > LIMIT && (
              <div className="mt-4">
                <Pagination total={total} limit={LIMIT} offset={offset} onOffset={setOffset} />
              </div>
            )}
          </div>
        </Card>
      </div>

      {detail && (
        <Modal open onClose={() => setDetail(null)} title={`OS ${detail.wo.wo_number}`} wide>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONES[detail.wo.status]}>{STATUS_LABELS[detail.wo.status]}</Badge>
              {detail.wo.vehicle_plate && <span className="text-sm font-mono">{detail.wo.vehicle_plate}</span>}
              {detail.wo.equipment_serial && <span className="text-sm text-graphite-400">S/N {detail.wo.equipment_serial}</span>}
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <div>
                <p className="text-xs text-graphite-400">Cliente</p>
                <p className="font-medium">
                  {detail.wo.customer_name ?? "—"}
                  {detail.wo.customer_phone ? ` · ${detail.wo.customer_phone}` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-graphite-400">Filial</p>
                <p className="font-medium">{detail.wo.branch_name ?? "—"}</p>
              </div>
              {detail.wo.vehicle_info && (
                <div className="md:col-span-2">
                  <p className="text-xs text-graphite-400">Veículo / equipamento</p>
                  <p>{detail.wo.vehicle_info}</p>
                </div>
              )}
              {detail.wo.diagnosis && (
                <div className="md:col-span-2">
                  <p className="text-xs text-graphite-400">Diagnóstico</p>
                  <p className="whitespace-pre-wrap">{detail.wo.diagnosis}</p>
                </div>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-graphite-400">Peças ({detail.parts.length})</p>
              {detail.parts.length ? (
                <ul className="divide-y divide-mist-200 text-sm dark:divide-graphite-700">
                  {detail.parts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2">
                      <span>
                        {p.product_name}
                        {p.variant_label ? ` (${p.variant_label})` : ""}
                        <span className="ml-2 text-xs text-graphite-400">{fmtQty(p.qty_milli)}</span>
                      </span>
                      <span className="font-medium">{fmtMoney(Math.round((p.unit_price_cents * p.qty_milli) / 1000))}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-graphite-400">Sem peças registadas.</p>
              )}
            </div>

            <div className="rounded-lg bg-mist-100 p-3 text-sm dark:bg-graphite-800">
              <div className="flex justify-between">
                <span className="text-graphite-400">Peças</span>
                <span>{fmtMoney(detail.wo.parts_cents)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-graphite-400">
                  Mão de obra ({detail.wo.labor_minutes} min × {fmtMoney(detail.wo.labor_rate_cents)}/h)
                </span>
                <span>{fmtMoney(detail.wo.labor_cents)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t border-mist-300 pt-1 font-semibold dark:border-graphite-600">
                <span>Total</span>
                <span>{fmtMoney(detail.wo.total_cents)}</span>
              </div>
              {detail.wo.warranty_ends_at && (
                <p className="mt-1 text-xs text-graphite-400">Garantia até {fmtDateTime(detail.wo.warranty_ends_at)}</p>
              )}
            </div>

            {NEXT[detail.wo.status].length > 0 && (
              <div className="flex flex-wrap gap-2">
                {NEXT[detail.wo.status].map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={s === "cancelled" ? "danger" : "secondary"}
                    disabled={busy}
                    onClick={() => advance(detail.wo.id, s)}
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    → {STATUS_LABELS[s]}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {showCreate && (
        <CreateWoModal
          branches={branches.map((b) => ({ id: b.id, name: b.name }))}
          onClose={() => setShowCreate(false)}
          onCreated={async (id) => {
            setShowCreate(false);
            await load();
            await openDetail(id);
          }}
        />
      )}
    </div>
  );
}

interface DraftPart {
  productId: string;
  name: string;
  qtyMilli: number;
  unitPriceCents: number;
}

function CreateWoModal({
  branches,
  onClose,
  onCreated,
}: {
  branches: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    branchId: branches[0]?.id ?? "",
    vehiclePlate: "",
    vehicleInfo: "",
    equipmentSerial: "",
    diagnosis: "",
    laborMinutes: 0,
    laborRateCents: 0,
    warrantyDays: 0,
  });
  const [parts, setParts] = useState<DraftPart[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [hits, setHits] = useState<ProductHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);

  async function findProducts() {
    if (!productSearch.trim()) return;
    setSearching(true);
    try {
      const data = await api<{ rows: ProductHit[] }>("/api/products", { query: { search: productSearch, limit: 8 } });
      setHits(data.rows);
    } catch (e) {
      setHits([]);
      toast.error(errMsg(e));
    } finally {
      setSearching(false);
    }
  }

  function addPart(p: ProductHit) {
    if (parts.some((x) => x.productId === p.id)) {
      toast.warning("Peça já adicionada.");
      return;
    }
    setParts([...parts, { productId: p.id, name: p.name, qtyMilli: 1000, unitPriceCents: p.price_cents }]);
    setHits(null);
    setProductSearch("");
  }

  async function submit() {
    if (!form.branchId) {
      toast.error("Selecione a filial.");
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ id: string }>("/api/workorders", {
        body: {
          branchId: form.branchId,
          vehiclePlate: form.vehiclePlate || undefined,
          vehicleInfo: form.vehicleInfo || undefined,
          equipmentSerial: form.equipmentSerial || undefined,
          diagnosis: form.diagnosis || undefined,
          laborMinutes: form.laborMinutes,
          laborRateCents: form.laborRateCents,
          warrantyDays: form.warrantyDays || undefined,
          parts: parts.map((p) => ({ productId: p.productId, qtyMilli: p.qtyMilli, unitPriceCents: p.unitPriceCents })),
        },
      });
      toast.success("Ordem de serviço criada.");
      onCreated(data.id);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nova ordem de serviço" wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Filial" required>
            <select className="input-base" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Matrícula / identificação">
            <input className="input-base" value={form.vehiclePlate} onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })} />
          </Field>
          <Field label="Nº de série do equipamento">
            <input className="input-base" value={form.equipmentSerial} onChange={(e) => setForm({ ...form, equipmentSerial: e.target.value })} />
          </Field>
          <Field label="Garantia (dias)">
            <input
              type="number"
              min={0}
              className="input-base"
              value={form.warrantyDays}
              onChange={(e) => setForm({ ...form, warrantyDays: Number(e.target.value) || 0 })}
            />
          </Field>
          <Field label="Veículo / equipamento (descrição)">
            <input className="input-base md:col-span-2" value={form.vehicleInfo} onChange={(e) => setForm({ ...form, vehicleInfo: e.target.value })} />
          </Field>
          <Field label="Diagnóstico">
            <textarea className="input-base" rows={2} value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mão de obra (min)">
              <input
                type="number"
                min={0}
                className="input-base"
                value={form.laborMinutes}
                onChange={(e) => setForm({ ...form, laborMinutes: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Tarifa (€/h)">
              <input
                type="number"
                min={0}
                step="0.01"
                className="input-base"
                value={(form.laborRateCents / 100).toFixed(2)}
                onChange={(e) => setForm({ ...form, laborRateCents: Math.round((Number(e.target.value) || 0) * 100) })}
              />
            </Field>
          </div>
        </div>

        <div className="rounded-lg border border-mist-200 p-3 dark:border-graphite-700">
          <p className="mb-2 text-sm font-semibold">Peças</p>
          <div className="flex gap-2">
            <input
              className="input-base h-9 flex-1 text-sm"
              placeholder="Procurar produto/peça por nome ou SKU…"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void findProducts();
              }}
            />
            <Button size="sm" variant="secondary" onClick={findProducts} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Procurar
            </Button>
          </div>
          {hits && (
            <ul className="mt-2 divide-y divide-mist-200 rounded-md border border-mist-200 dark:divide-graphite-700 dark:border-graphite-700">
              {hits.length ? (
                hits.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-mist-100 dark:hover:bg-graphite-800" onClick={() => addPart(p)}>
                      <span>
                        {p.name} <span className="text-xs text-graphite-400">{p.sku}</span>
                      </span>
                      <span className="font-medium">{fmtMoney(p.price_cents)}</span>
                    </button>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-sm text-graphite-400">Sem resultados (requer acesso a products.view).</li>
              )}
            </ul>
          )}
          {parts.length > 0 && (
            <ul className="mt-3 space-y-2">
              {parts.map((p) => (
                <li key={p.productId} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <input
                    type="number"
                    min={0.001}
                    step={0.001}
                    className="input-base h-8 w-24 text-sm"
                    value={p.qtyMilli / 1000}
                    onChange={(e) =>
                      setParts(parts.map((x) => (x.productId === p.productId ? { ...x, qtyMilli: Math.round((Number(e.target.value) || 0) * 1000) } : x)))
                    }
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input-base h-8 w-24 text-sm"
                    value={(p.unitPriceCents / 100).toFixed(2)}
                    onChange={(e) =>
                      setParts(parts.map((x) => (x.productId === p.productId ? { ...x, unitPriceCents: Math.round((Number(e.target.value) || 0) * 100) } : x)))
                    }
                  />
                  <span className="w-20 text-right font-medium">{fmtMoney(Math.round((p.unitPriceCents * p.qtyMilli) / 1000))}</span>
                  <Button size="sm" variant="ghost" onClick={() => setParts(parts.filter((x) => x.productId !== p.productId))} aria-label="Remover">
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="accent" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Criar OS
        </Button>
      </div>
    </Modal>
  );
}
