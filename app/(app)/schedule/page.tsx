"use client";

/**
 * /schedule — Agenda (salons, clinics, spas, pet care, personal trainers).
 * Resources hold calendars; appointments are booked with server-side overlap
 * rejection (no double-booking) and enforced status transitions. All data is
 * real and tenant-scoped via scheduling.service.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, UserPlus } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal } from "@/components/ui";
import { PageHeader } from "@/components/page-header";
import { useToast } from "@/components/system/toast";
import { useWorkspace } from "@/components/layout/workspace";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtMoney } from "@/lib/format";

type ApptStatus = "booked" | "confirmed" | "in_progress" | "done" | "cancelled" | "no_show";

const STATUS_LABELS: Record<ApptStatus, string> = {
  booked: "Reservada",
  confirmed: "Confirmada",
  in_progress: "Em curso",
  done: "Concluída",
  cancelled: "Cancelada",
  no_show: "Não compareceu",
};

const STATUS_TONES: Record<ApptStatus, "neutral" | "info" | "warning" | "success" | "danger" | "accent"> = {
  booked: "neutral",
  confirmed: "info",
  in_progress: "accent",
  done: "success",
  cancelled: "danger",
  no_show: "warning",
};

const NEXT: Record<ApptStatus, ApptStatus[]> = {
  booked: ["confirmed", "in_progress", "cancelled", "no_show"],
  confirmed: ["in_progress", "cancelled", "no_show"],
  in_progress: ["done", "cancelled"],
  done: [],
  cancelled: [],
  no_show: [],
};

interface ResourceRow {
  id: string;
  name: string;
  kind: string;
  color: string | null;
  active: number;
  branch_name?: string;
}

interface ApptRow {
  id: string;
  resource_id: string;
  resource_name?: string;
  resource_color?: string | null;
  customer_name: string;
  phone: string | null;
  product_name?: string | null;
  starts_at: number;
  duration_min: number;
  status: ApptStatus;
  price_cents: number | null;
  notes: string | null;
}

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : "Erro inesperado.";
}

function dayBounds(d: Date): { from: number; to: number } {
  const from = new Date(d);
  from.setHours(0, 0, 0, 0);
  const to = from.getTime() + 86_400_000;
  return { from: from.getTime(), to };
}

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SchedulePage() {
  const toast = useToast();
  const { branches } = useWorkspace();
  const [day, setDay] = useState(() => new Date());
  const [resources, setResources] = useState<ResourceRow[] | null>(null);
  const [appts, setAppts] = useState<ApptRow[] | null>(null);
  const [resourceFilter, setResourceFilter] = useState("");
  const [showAppt, setShowAppt] = useState(false);
  const [showResource, setShowResource] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { from, to } = useMemo(() => dayBounds(day), [day]);

  const load = useCallback(async () => {
    try {
      const data = await api<{ resources: ResourceRow[]; rows: ApptRow[] }>("/api/schedule", {
        query: { from, to, resourceId: resourceFilter || undefined },
      });
      setResources(data.resources);
      setAppts(data.rows);
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [from, to, resourceFilter, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: ApptStatus) {
    setBusyId(id);
    try {
      await api(`/api/schedule/${id}`, { body: { action: "status", status } });
      toast.success(`Marcação: ${STATUS_LABELS[status]}.`);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  const byResource = useMemo(() => {
    const groups = new Map<string, ApptRow[]>();
    for (const r of resources ?? []) groups.set(r.id, []);
    for (const a of appts ?? []) {
      if (!groups.has(a.resource_id)) groups.set(a.resource_id, []);
      groups.get(a.resource_id)!.push(a);
    }
    for (const list of groups.values()) list.sort((x, y) => x.starts_at - y.starts_at);
    return groups;
  }, [resources, appts]);

  const dayLabel = day.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div>
      <PageHeader
        title="Agenda"
        subtitle="Marcações por recurso (profissional/sala/equipamento). Sobreposições são recusadas no servidor."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowResource(true)}>
              <UserPlus className="h-4 w-4" /> Recurso
            </Button>
            <Button size="sm" variant="accent" onClick={() => setShowAppt(true)} disabled={!resources?.length}>
              <Plus className="h-4 w-4" /> Nova marcação
            </Button>
          </div>
        }
      />
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader
            title={dayLabel}
            icon={<CalendarDays className="h-4 w-4" />}
            action={
              <div className="flex items-center gap-2">
                {branches.length > 1 && (
                  <select className="input-base h-8 w-36 text-sm" value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)}>
                    <option value="">Todos os recursos</option>
                    {(resources ?? []).map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
                <Button size="sm" variant="ghost" onClick={() => setDay(new Date(day.getTime() - 86_400_000))} aria-label="Dia anterior">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setDay(new Date())}>
                  Hoje
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDay(new Date(day.getTime() + 86_400_000))} aria-label="Dia seguinte">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            }
          />
          <div className="space-y-5 p-4">
            {!resources || !appts ? (
              <div className="flex justify-center py-10 text-graphite-400">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : !resources.length ? (
              <EmptyState
                icon={<CalendarDays className="h-8 w-8" />}
                title="Sem recursos"
                message="Crie primeiro um recurso (profissional, sala ou equipamento) para poder agendar."
                action={
                  <Button size="sm" variant="accent" onClick={() => setShowResource(true)}>
                    <UserPlus className="h-4 w-4" /> Criar recurso
                  </Button>
                }
              />
            ) : (
              [...byResource.entries()].map(([resourceId, list]) => {
                const resource = resources.find((r) => r.id === resourceId);
                return (
                  <div key={resourceId}>
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: resource?.color ?? "#b9ff00" }} />
                      {resource?.name ?? "Recurso"}
                      <span className="text-xs font-normal text-graphite-400">
                        {resource?.kind === "staff" ? "profissional" : resource?.kind === "room" ? "sala" : "equipamento"}
                        {resource?.branch_name ? ` · ${resource.branch_name}` : ""} · {list.length} marcações
                      </span>
                    </p>
                    {!list.length ? (
                      <p className="rounded-lg border border-dashed border-mist-300 px-3 py-3 text-xs text-graphite-400 dark:border-graphite-600">
                        Dia livre.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {list.map((a) => (
                          <li
                            key={a.id}
                            className="flex flex-wrap items-center gap-3 rounded-lg border border-mist-200 bg-white px-3 py-2.5 dark:border-graphite-700 dark:bg-graphite-850"
                          >
                            <div className="w-28 shrink-0">
                              <p className="font-mono text-sm font-semibold">
                                {new Date(a.starts_at).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
                              </p>
                              <p className="text-xs text-graphite-400">{a.duration_min} min</p>
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">
                                {a.customer_name}
                                {a.phone ? <span className="ml-2 text-xs text-graphite-400">{a.phone}</span> : null}
                              </p>
                              <p className="truncate text-xs text-graphite-400">
                                {a.product_name ?? "Serviço"}
                                {a.price_cents != null ? ` · ${fmtMoney(a.price_cents)}` : ""}
                                {a.notes ? ` · ${a.notes}` : ""}
                              </p>
                            </div>
                            <Badge tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Badge>
                            <div className="flex flex-wrap gap-1">
                              {NEXT[a.status].map((s) => (
                                <Button
                                  key={s}
                                  size="sm"
                                  variant={s === "cancelled" ? "ghost" : "secondary"}
                                  className={s === "cancelled" ? "text-danger" : undefined}
                                  disabled={busyId === a.id}
                                  onClick={() => setStatus(a.id, s)}
                                >
                                  {busyId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : STATUS_LABELS[s]}
                                </Button>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {showAppt && resources && (
        <AppointmentModal
          resources={resources}
          onClose={() => setShowAppt(false)}
          onCreated={async () => {
            setShowAppt(false);
            await load();
          }}
          defaultStart={from}
        />
      )}
      {showResource && branches.length > 0 && (
        <ResourceModal
          branches={branches.map((b) => ({ id: b.id, name: b.name }))}
          onClose={() => setShowResource(false)}
          onCreated={async () => {
            setShowResource(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function AppointmentModal({
  resources,
  onClose,
  onCreated,
  defaultStart,
}: {
  resources: ResourceRow[];
  onClose: () => void;
  onCreated: () => void;
  defaultStart: number;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    resourceId: resources[0]?.id ?? "",
    customerName: "",
    phone: "",
    startsAt: toLocalInput(defaultStart + 9 * 3_600_000),
    durationMin: 30,
    price: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.customerName.trim() || !form.resourceId) {
      toast.error("Recurso e nome do cliente são obrigatórios.");
      return;
    }
    const startsAt = new Date(form.startsAt).getTime();
    if (!Number.isFinite(startsAt)) {
      toast.error("Data/hora inválida.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/schedule", {
        body: {
          action: "create_appointment",
          resourceId: form.resourceId,
          customerName: form.customerName,
          phone: form.phone || undefined,
          startsAt,
          durationMin: form.durationMin,
          priceCents: form.price ? Math.round(Number(form.price) * 100) : undefined,
          notes: form.notes || undefined,
        },
      });
      toast.success("Marcação criada.");
      onCreated();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nova marcação" wide>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Recurso" required>
          <select className="input-base" value={form.resourceId} onChange={(e) => setForm({ ...form, resourceId: e.target.value })}>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.kind})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cliente" required>
          <input className="input-base" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
        </Field>
        <Field label="Telefone">
          <input className="input-base" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="Início" required>
          <input type="datetime-local" className="input-base" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        </Field>
        <Field label="Duração (min)">
          <input
            type="number"
            min={5}
            max={720}
            step={5}
            className="input-base"
            value={form.durationMin}
            onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) || 30 })}
          />
        </Field>
        <Field label="Preço (€)">
          <input
            type="number"
            min={0}
            step="0.01"
            className="input-base"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value })}
            placeholder="opcional"
          />
        </Field>
        <Field label="Notas">
          <input className="input-base md:col-span-2" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-graphite-400">
        Sobreposições no mesmo recurso são recusadas no servidor (marcações canceladas/no-show não bloqueiam o horário).
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="accent" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Criar marcação
        </Button>
      </div>
    </Modal>
  );
}

function ResourceModal({
  branches,
  onClose,
  onCreated,
}: {
  branches: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ branchId: branches[0]?.id ?? "", name: "", kind: "staff", commission: "", color: "#b9ff00" });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.name.trim() || !form.branchId) {
      toast.error("Nome e filial são obrigatórios.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/schedule", {
        body: {
          action: "create_resource",
          branchId: form.branchId,
          name: form.name,
          kind: form.kind,
          commissionBps: form.commission ? Math.round(Number(form.commission) * 100) : undefined,
          color: form.color || undefined,
        },
      });
      toast.success("Recurso criado.");
      onCreated();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Novo recurso">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nome" required>
          <input className="input-base" value={form.name} placeholder="Ex.: Ana — cabeleireira" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Filial" required>
          <select className="input-base" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo">
          <select className="input-base" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="staff">Profissional</option>
            <option value="room">Sala</option>
            <option value="equipment">Equipamento</option>
          </select>
        </Field>
        <Field label="Comissão (%)" hint="Para profissionais; 0–100.">
          <input
            type="number"
            min={0}
            max={100}
            step="0.5"
            className="input-base"
            value={form.commission}
            onChange={(e) => setForm({ ...form, commission: e.target.value })}
            placeholder="opcional"
          />
        </Field>
        <Field label="Cor na agenda">
          <input type="color" className="h-9.5 w-full cursor-pointer rounded-md border border-mist-300 dark:border-graphite-600" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="accent" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Criar recurso
        </Button>
      </div>
    </Modal>
  );
}
