"use client";

/** Contagens cíclicas — cria folha por armazém, regista contagens e conclui (ajusta stock automaticamente com auditoria). */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardCheck, ClipboardList, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/system/toast";
import { useConfirm, Badge, Button, EmptyState, Field, Input, Modal, Select } from "@/components/ui";
import { api } from "@/lib/api/client";
import { fmtDateTime, fmtQty } from "@/lib/format";

interface WarehouseRow {
  id: string;
  name: string;
}

interface SheetRow {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  status: string;
  created_at: number;
  completed_at: number | null;
  line_count: number;
  counted_count: number;
  created_by_label?: string | null;
}

interface SheetLine {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  unit: string;
  variant_label: string | null;
  expected_milli: number;
  counted_milli: number | null;
}

export default function CountsPage() {
  const toast = useToast();
  const confirm = useConfirm();

  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createWh, setCreateWh] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  const [openSheet, setOpenSheet] = useState<(SheetRow & { lines: SheetLine[] }) | null>(null);
  const [countInputs, setCountInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<SheetRow[]>("/api/inventory/counts");
      setSheets(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar contagens");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
    api<WarehouseRow[]>("/api/inventory/warehouses").then(setWarehouses).catch(() => setWarehouses([]));
  }, [load]);

  async function openDetail(row: SheetRow) {
    try {
      const d = await api<{ sheet: SheetRow; lines: SheetLine[] }>(`/api/inventory/counts/${row.id}`);
      setOpenSheet({ ...d.sheet, lines: d.lines });
      const inputs: Record<string, string> = {};
      for (const l of d.lines) {
        if (l.counted_milli != null) inputs[l.id] = (l.counted_milli / 1000).toString();
      }
      setCountInputs(inputs);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao abrir folha");
    }
  }

  async function recordCount(line: SheetLine) {
    if (!openSheet) return;
    const raw = countInputs[line.id];
    if (raw == null || raw === "") return;
    const value = parseFloat(raw.replace(",", "."));
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Valor de contagem inválido.");
      return;
    }
    try {
      await api(`/api/inventory/counts/${openSheet.id}`, {
        method: "POST",
        body: { action: "count", lineId: line.id, countedMilli: Math.round(value * 1000) },
      });
      setOpenSheet((s) =>
        s ? { ...s, lines: s.lines.map((l) => (l.id === line.id ? { ...l, counted_milli: Math.round(value * 1000) } : l)) } : s,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao registar contagem");
    }
  }

  async function completeSheet() {
    if (!openSheet) return;
    const missing = openSheet.lines.filter((l) => l.counted_milli == null).length;
    const ok = await confirm({
      title: "Concluir contagem",
      message: missing
        ? `${missing} linha(s) sem contagem registada. Ao concluir, o stock será ajustado para as contagens registadas (linhas sem contagem mantêm o valor do sistema). Esta operação gera movimentos auditados e não pode ser desfeita.`
        : "Ao concluir, o stock será ajustado para os valores contados. Esta operação gera movimentos auditados e não pode ser desfeita.",
      confirmLabel: "Concluir e ajustar",
      danger: missing > 0,
    });
    if (!ok) return;
    try {
      await api(`/api/inventory/counts/${openSheet.id}`, { method: "POST", body: { action: "complete" } });
      toast.success("Contagem concluída", "Stock ajustado com base nos valores contados.");
      setOpenSheet(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao concluir");
    }
  }

  return (
    <>
      <PageHeader
        title="Contagens de stock"
        subtitle="Folhas de contagem cíclica com ajuste auditado"
        actions={
          <Button variant="accent" size="sm" onClick={() => { setCreateOpen(true); setCreateWh(warehouses[0]?.id ?? ""); }} icon={<Plus className="h-3.5 w-3.5" />}>
            Nova contagem
          </Button>
        }
      />

      <div className="p-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : sheets.length === 0 ? (
          <EmptyState
            title="Nenhuma contagem"
            message="Crie uma folha de contagem por armazém (total ou para produtos selecionados) e registe os valores físicos."
            icon={<ClipboardList className="h-8 w-8" />}
          />
        ) : (
          <ul className="space-y-2">
            {sheets.map((s) => (
              <li key={s.id}>
                <button onClick={() => openDetail(s)} className="card flex w-full items-center gap-3 px-4 py-3 text-left hover:border-lime-brand/50">
                  <ClipboardCheck className="h-5 w-5 shrink-0 text-graphite-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{s.warehouse_name}</span>
                    <span className="block text-[11px] text-graphite-400">
                      criada {fmtDateTime(s.created_at)}
                      {s.completed_at ? ` · concluída ${fmtDateTime(s.completed_at)}` : ""}
                      {s.created_by_label ? ` · ${s.created_by_label}` : ""}
                    </span>
                  </span>
                  <span className="hidden text-[11px] text-graphite-400 sm:block">
                    {s.counted_count}/{s.line_count} linhas contadas
                  </span>
                  <Badge tone={s.status === "completed" ? "success" : s.status === "counting" ? "info" : "warning"}>
                    {s.status === "completed" ? "concluída" : s.status === "counting" ? "em contagem" : s.status}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* create */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova folha de contagem">
        <div className="space-y-4">
          <Field label="Armazém" required>
            <Select value={createWh} onChange={(e) => setCreateWh(e.target.value)}>
              <option value="">Selecionar…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </Select>
          </Field>
          <p className="text-[11px] text-graphite-400">
            A folha copia o stock esperado de todos os produtos do armazém. Durante a contagem o stock continua a mover-se (vendas/compras) — ao concluir, o sistema usa o valor contado com movimentos auditados.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              variant="accent"
              loading={createBusy}
              disabled={!createWh}
              onClick={async () => {
                setCreateBusy(true);
                try {
                  await api("/api/inventory/counts", { method: "POST", body: { warehouseId: createWh } });
                  setCreateOpen(false);
                  toast.success("Folha de contagem criada");
                  load();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha ao criar");
                } finally {
                  setCreateBusy(false);
                }
              }}
            >
              Criar folha
            </Button>
          </div>
        </div>
      </Modal>

      {/* detail */}
      <Modal open={openSheet !== null} onClose={() => setOpenSheet(null)} title={`Contagem — ${openSheet?.warehouse_name ?? ""}`} wide>
        {openSheet && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-graphite-400">
              <Badge tone={openSheet.status === "completed" ? "success" : "info"}>{openSheet.status}</Badge>
              {openSheet.lines.filter((l) => l.counted_milli != null).length}/{openSheet.lines.length} linhas contadas
            </div>
            <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-mist-200 dark:border-graphite-600">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-mist-100 dark:bg-graphite-800">
                  <tr className="text-[10px] uppercase tracking-wider text-graphite-400">
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2 text-right">Esperado</th>
                    <th className="px-3 py-2 text-right">Contado</th>
                    <th className="px-3 py-2 text-right">Diferença</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mist-100 dark:divide-graphite-700/60">
                  {openSheet.lines.map((l) => {
                    const counted = l.counted_milli;
                    const diff = counted != null ? counted - l.expected_milli : null;
                    return (
                      <tr key={l.id}>
                        <td className="px-3 py-1.5">
                          <p className="font-semibold">
                            {l.product_name}
                            {l.variant_label ? <span className="font-normal text-graphite-400"> · {l.variant_label}</span> : null}
                          </p>
                          <p className="font-mono text-[10px] text-graphite-400">{l.sku}</p>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtQty(l.expected_milli, l.unit)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {openSheet.status === "completed" ? (
                            <span className="font-mono tabular-nums">{counted != null ? fmtQty(counted, l.unit) : "—"}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Input
                                className="h-7 w-24 text-right font-mono text-xs"
                                type="number"
                                step="0.001"
                                min={0}
                                value={countInputs[l.id] ?? ""}
                                onChange={(e) => setCountInputs((m) => ({ ...m, [l.id]: e.target.value }))}
                                onBlur={() => recordCount(l)}
                                onKeyDown={(e) => e.key === "Enter" && recordCount(l)}
                                aria-label={`Contagem de ${l.product_name}`}
                              />
                            </span>
                          )}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${diff == null ? "text-graphite-400" : diff === 0 ? "text-success" : diff > 0 ? "text-info" : "text-danger"}`}>
                          {diff == null ? "—" : `${diff > 0 ? "+" : ""}${fmtQty(diff, l.unit)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {openSheet.status !== "completed" && (
              <div className="flex justify-end">
                <Button variant="accent" onClick={completeSheet} icon={<CheckCircle2 className="h-4 w-4" />}>
                  Concluir contagem
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
