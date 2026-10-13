"use client";

/**
 * Settings — Estrutura: multi-branch topology (branches, warehouses, POS/KDS
 * terminals). Creation only; deactivating structure that already has history
 * is intentionally not offered from the UI (data integrity).
 */

import { useCallback, useEffect, useState } from "react";
import { Building, Loader2, MapPin, MonitorSmartphone, Plus, Warehouse } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal } from "@/components/ui";
import { useToast } from "@/components/system/toast";
import { api, ApiClientError } from "@/lib/api/client";

interface BranchRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  is_default: number;
  status: string;
}

interface WarehouseRow {
  id: string;
  branch_id: string | null;
  name: string;
  code: string;
  is_default: number;
  branch_name?: string | null;
}

interface TerminalRow {
  id: string;
  branch_id: string;
  name: string;
  code: string;
  kind: string;
  status: string;
  branch_name?: string;
}

const TERMINAL_KINDS = [
  { key: "pos", label: "POS / Caixa" },
  { key: "kds", label: "KDS / Cozinha" },
  { key: "tablet", label: "Tablet" },
  { key: "backoffice", label: "Backoffice" },
];

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : "Erro inesperado.";
}

export function StructureTab() {
  const toast = useToast();
  const [data, setData] = useState<{ branches: BranchRow[]; warehouses: WarehouseRow[]; terminals: TerminalRow[] } | null>(null);
  const [showBranch, setShowBranch] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<{ branches: BranchRow[]; warehouses: WarehouseRow[]; terminals: TerminalRow[] }>("/api/structure"));
    } catch (e) {
      toast.error(errMsg(e));
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!data) {
    return (
      <div className="flex justify-center py-16 text-graphite-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Filiais"
          icon={<Building className="h-4 w-4" />}
          subtitle="Cada filial pode ter armazéns e terminais próprios. Vendas, stock e caixa são reportados por filial."
          action={
            <Button size="sm" variant="primary" onClick={() => setShowBranch(true)}>
              <Plus className="h-4 w-4" /> Nova filial
            </Button>
          }
        />
        <div className="p-4">
          {!data.branches.length ? (
            <EmptyState icon={<Building className="h-8 w-8" />} title="Sem filiais" message="Crie a primeira filial." />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.branches.map((b) => (
                <div key={b.id} className="rounded-lg border border-mist-200 bg-white p-4 dark:border-graphite-700 dark:bg-graphite-850">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <MapPin className="h-4 w-4 shrink-0 text-lime-dim dark:text-lime-brand" />
                      <p className="truncate font-semibold">{b.name}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {b.is_default === 1 && <Badge tone="accent">Principal</Badge>}
                      <Badge tone={b.status === "active" ? "success" : "neutral"}>{b.status === "active" ? "Ativa" : b.status}</Badge>
                    </div>
                  </div>
                  <p className="mt-1 font-mono text-xs text-graphite-400">{b.code}</p>
                  {b.address && (
                    <p className="mt-1 text-xs text-graphite-500 dark:text-graphite-300">
                      {b.address}
                      {b.city ? `, ${b.city}` : ""}
                    </p>
                  )}
                  {b.phone && <p className="text-xs text-graphite-400">{b.phone}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                    {data.warehouses.filter((w) => w.branch_id === b.id).map((w) => (
                      <Badge key={w.id} tone="info">
                        <Warehouse className="h-3 w-3" />
                        {w.name}
                      </Badge>
                    ))}
                    {data.terminals.filter((t) => t.branch_id === b.id).map((t) => (
                      <Badge key={t.id} tone="neutral">
                        <MonitorSmartphone className="h-3 w-3" />
                        {t.name}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Armazéns" icon={<Warehouse className="h-4 w-4" />} subtitle="Criados automaticamente com cada filial (opção na criação)." />
          <div className="p-4">
            {!data.warehouses.length ? (
              <EmptyState icon={<Warehouse className="h-8 w-8" />} title="Sem armazéns" message="Crie uma filial com armazém." />
            ) : (
              <ul className="divide-y divide-mist-200 text-sm dark:divide-graphite-700">
                {data.warehouses.map((w) => (
                  <li key={w.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="font-medium">
                        {w.name}
                        {w.is_default === 1 && (
                          <Badge tone="accent" className="ml-1">
                            Principal
                          </Badge>
                        )}
                      </p>
                      <p className="text-xs text-graphite-400">{w.code}{w.branch_name ? ` · ${w.branch_name}` : " · global"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Terminais"
            icon={<MonitorSmartphone className="h-4 w-4" />}
            subtitle="POS, KDS e tablets. Cada terminal identifica-se nas vendas e sessões de caixa."
            action={
              <Button size="sm" variant="secondary" onClick={() => setShowTerminal(true)} disabled={!data.branches.length}>
                <Plus className="h-4 w-4" /> Novo terminal
              </Button>
            }
          />
          <div className="p-4">
            {!data.terminals.length ? (
              <EmptyState icon={<MonitorSmartphone className="h-8 w-8" />} title="Sem terminais" message="Registe o primeiro terminal POS/KDS." />
            ) : (
              <ul className="divide-y divide-mist-200 text-sm dark:divide-graphite-700">
                {data.terminals.map((t) => (
                  <li key={t.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="font-medium">{t.name}</p>
                      <p className="text-xs text-graphite-400">
                        {t.code} · {t.branch_name} · {TERMINAL_KINDS.find((k) => k.key === t.kind)?.label ?? t.kind}
                      </p>
                    </div>
                    <Badge tone={t.status === "active" ? "success" : "neutral"}>{t.status === "active" ? "Ativo" : t.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {showBranch && (
        <BranchModal
          onClose={() => setShowBranch(false)}
          onCreated={() => {
            setShowBranch(false);
            void load();
          }}
        />
      )}
      {showTerminal && (
        <TerminalModal
          branches={data.branches}
          onClose={() => setShowTerminal(false)}
          onCreated={() => {
            setShowTerminal(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function BranchModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", code: "", address: "", city: "", phone: "", withWarehouse: true, withTerminal: true });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.name || !form.code) {
      toast.error("Nome e código são obrigatórios.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/structure", { body: { action: "create_branch", ...form } });
      toast.success("Filial criada.");
      onCreated();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Nova filial" wide>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nome" required>
          <input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Código curto" required hint="Ex.: CBR — usado em documentos.">
          <input
            className="input-base"
            maxLength={10}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Morada">
          <input className="input-base" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <Field label="Cidade">
          <input className="input-base" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </Field>
        <Field label="Telefone">
          <input className="input-base" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <div className="flex flex-col justify-end gap-2 pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.withWarehouse} onChange={(e) => setForm({ ...form, withWarehouse: e.target.checked })} />
            Criar armazém principal
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.withTerminal} onChange={(e) => setForm({ ...form, withTerminal: e.target.checked })} />
            Criar terminal POS
          </label>
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Criar filial
        </Button>
      </div>
    </Modal>
  );
}

function TerminalModal({ branches, onClose, onCreated }: { branches: BranchRow[]; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ branchId: branches[0]?.id ?? "", name: "", code: "", kind: "pos" });
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.branchId || !form.name || !form.code) {
      toast.error("Filial, nome e código são obrigatórios.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/structure", { body: { action: "create_terminal", ...form } });
      toast.success("Terminal registado.");
      onCreated();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Novo terminal">
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
        <Field label="Tipo">
          <select className="input-base" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {TERMINAL_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nome" required>
          <input className="input-base" value={form.name} placeholder="Ex.: Caixa 1" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Código" required hint="Identifica o terminal nas vendas e sessões de caixa.">
          <input
            className="input-base"
            maxLength={10}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Criar terminal
        </Button>
      </div>
    </Modal>
  );
}
