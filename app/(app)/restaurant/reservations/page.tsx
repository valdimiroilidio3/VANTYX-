"use client";

/** Reservas — lista por dia, criação e gestão de estado (sentar/falta/cancelar). */

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Plus, User, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/layout/workspace";
import { useToast } from "@/components/system/toast";
import { Badge, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api/client";
import { fmtTime } from "@/lib/format";

interface ReservationRow {
  id: string;
  customer_name: string | null;
  customer_record_name: string | null;
  phone: string | null;
  party_size: number;
  reserved_for: number;
  status: string;
  table_name: string | null;
  table_id: string | null;
  note: string | null;
}

interface TableOption {
  id: string;
  name: string;
  zone: string | null;
  seats: number;
  status: string;
}

const STATUS_TONES: Record<string, "neutral" | "info" | "success" | "accent" | "danger" | "warning"> = {
  booked: "info",
  seated: "accent",
  completed: "success",
  no_show: "danger",
  cancelled: "neutral",
};

const STATUS_LABELS: Record<string, string> = {
  booked: "reservada",
  seated: "sentada",
  completed: "concluída",
  no_show: "falta",
  cancelled: "cancelada",
};

export default function ReservationsPage() {
  const workspace = useWorkspace();
  const toast = useToast();
  const branchId = workspace.branchId;
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [tables, setTables] = useState<TableOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", guests: "2", when: "", tableId: "", notes: "" });

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const [res, tab] = await Promise.all([
        api<{ reservations: ReservationRow[] }>("/api/restaurant/reservations", {
          query: { branchId, day: new Date(day + "T12:00:00").getTime() },
        }),
        api<{ tables: TableOption[] }>("/api/restaurant/tables", { query: { branchId } }),
      ]);
      setRows(res.reservations);
      setTables(tab.tables);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar reservas");
    } finally {
      setLoading(false);
    }
  }, [branchId, day, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: string, status: string) {
    try {
      await api("/api/restaurant/reservations", { method: "POST", body: { action: "status", reservationId: id, status } });
      setRows((list) => list.map((r) => (r.id === id ? { ...r, status } : r)));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha");
    }
  }

  function shiftDay(delta: number) {
    const d = new Date(day + "T12:00:00");
    d.setDate(d.getDate() + delta);
    setDay(d.toISOString().slice(0, 10));
  }

  const dayLabel = new Date(day + "T12:00:00").toLocaleDateString("pt-PT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <>
      <PageHeader
        title="Reservas"
        subtitle={`${rows.length} reserva(s) · ${rows.filter((r) => r.status === "booked").length} por sentar`}
        actions={
          <Button variant="accent" size="sm" onClick={() => setCreateOpen(true)} icon={<Plus className="h-3.5 w-3.5" />}>
            Nova reserva
          </Button>
        }
      />

      <div className="flex items-center justify-center gap-3 py-3">
        <Button variant="ghost" size="sm" onClick={() => shiftDay(-1)} aria-label="Dia anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold capitalize">{dayLabel}</p>
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="mx-auto mt-0.5 block rounded border border-mist-200 bg-transparent px-2 py-0.5 text-xs dark:border-graphite-600"
            aria-label="Escolher dia"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={() => shiftDay(1)} aria-label="Dia seguinte">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="px-4 pb-6">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-mist-200 dark:bg-graphite-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Sem reservas para este dia"
            message="Crie uma reserva com o botão “Nova reserva”."
            icon={<CalendarClock className="h-8 w-8" />}
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li
                key={r.id}
                className="card flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="flex h-10 w-14 shrink-0 flex-col items-center justify-center rounded-md bg-mist-100 font-mono dark:bg-graphite-800">
                  <Clock className="h-3 w-3 text-graphite-400" />
                  <span className="text-xs font-bold">{fmtTime(r.reserved_for)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <User className="h-3.5 w-3.5 shrink-0 text-graphite-400" />
                    <span className="truncate text-sm font-semibold">
                      {r.customer_record_name ?? r.customer_name ?? "Cliente"}
                    </span>
                    <Badge tone={STATUS_TONES[r.status] ?? "neutral"}>{STATUS_LABELS[r.status] ?? r.status}</Badge>
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-graphite-400">
                    {r.party_size} pessoa(s){r.table_name ? ` · mesa ${r.table_name}` : " · sem mesa"}
                    {r.phone ? ` · ${r.phone}` : ""}
                    {r.note ? ` · “${r.note}”` : ""}
                  </span>
                </span>
                {r.status === "booked" && (
                  <span className="flex shrink-0 gap-1.5">
                    <Button variant="accent" size="sm" onClick={() => setStatus(r.id, "seated")}>
                      Sentar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setStatus(r.id, "no_show")}>
                      Falta
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setStatus(r.id, "cancelled")} aria-label="Cancelar reserva">
                      <X className="h-3.5 w-3.5 text-danger" />
                    </Button>
                  </span>
                )}
                {r.status === "seated" && (
                  <Button variant="secondary" size="sm" onClick={() => setStatus(r.id, "completed")}>
                    Concluir
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova reserva">
        <div className="space-y-4">
          <Field label="Nome do cliente" required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Telefone">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Pessoas" required>
              <Input type="number" min={1} max={99} value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} />
            </Field>
          </div>
          <Field label="Data e hora" required>
            <Input type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
          </Field>
          <Field label="Mesa (opcional)">
            <Select value={form.tableId} onChange={(e) => setForm({ ...form, tableId: e.target.value })}>
              <option value="">Sem mesa atribuída</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.zone ? `${t.zone} · ` : ""}{t.name} ({t.seats} lugares)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notas">
            <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Ex.: aniversário, cadeira de bebé…" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              variant="accent"
              disabled={!form.name.trim() || !form.when || !branchId}
              onClick={async () => {
                try {
                  await api("/api/restaurant/reservations", {
                    method: "POST",
                    body: {
                      action: "create",
                      branchId,
                      customerName: form.name.trim(),
                      phone: form.phone || null,
                      partySize: Math.max(1, parseInt(form.guests) || 1),
                      reservedFor: new Date(form.when).getTime(),
                      tableId: form.tableId || null,
                      note: form.notes || null,
                    },
                  });
                  setCreateOpen(false);
                  setForm({ name: "", phone: "", guests: "2", when: "", tableId: "", notes: "" });
                  setDay(new Date(form.when).toISOString().slice(0, 10));
                  toast.success("Reserva criada");
                  load();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Falha ao criar reserva");
                }
              }}
            >
              Criar reserva
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
