"use client";

/**
 * Settings — Equipa: users, role templates, branch scoping, supervisor PINs
 * (hashed at rest) and invites (single-use token, revocable, 7-day expiry).
 */

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Mail, Plus, ShieldCheck, UserCog, Users } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, Toggle } from "@/components/ui";
import { useToast } from "@/components/system/toast";
import { api, ApiClientError } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/format";

interface UserRow {
  id: string;
  email: string;
  name: string;
  status: string;
  mfa_enabled: number;
  last_login_at: number | null;
  created_at: number;
  role_key: string | null;
  role_name: string | null;
  branch_ids: string[];
}

interface RoleTemplate {
  key: string;
  name: string;
  description: string;
}

interface InviteRow {
  id: string;
  email: string;
  role_key: string;
  status: string;
  created_at: number;
  expires_at: number | null;
}

interface BranchRow {
  id: string;
  name: string;
}

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : "Erro inesperado.";
}

export function TeamTab() {
  const toast = useToast();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [roles, setRoles] = useState<RoleTemplate[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ users: UserRow[]; roleTemplates: RoleTemplate[] }>("/api/users");
      setUsers(data.users);
      setRoles(data.roleTemplates);
    } catch (e) {
      toast.error(errMsg(e));
    }
    try {
      setInvites(await api<InviteRow[]>("/api/invites"));
    } catch {
      /* invites list is secondary */
    }
    try {
      const st = await api<{ branches: BranchRow[] }>("/api/structure");
      setBranches(st.branches);
    } catch {
      /* structure is secondary here */
    }
  }, [toast]);
  useEffect(() => {
    void load();
  }, [load]);

  async function changeStatus(u: UserRow, status: "active" | "suspended") {
    setBusyId(u.id);
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", body: { status } });
      toast.success(status === "suspended" ? `${u.name} suspenso — sessões revogadas.` : `${u.name} reativado.`);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusyId(null);
    }
  }

  async function revokeInvite(inv: InviteRow) {
    try {
      await api("/api/invites", { body: { action: "revoke", inviteId: inv.id } });
      toast.success("Convite revogado.");
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    }
  }

  const pendingInvites = invites.filter((i) => i.status === "pending");

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Utilizadores"
          icon={<Users className="h-4 w-4" />}
          subtitle="Permissões por função, âmbito por filial e PIN de supervisor (armazenado apenas como hash)."
          action={
            <Button size="sm" variant="primary" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" /> Novo utilizador
            </Button>
          }
        />
        <div className="p-4">
          {!users ? (
            <div className="flex justify-center py-10 text-graphite-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !users.length ? (
            <EmptyState icon={<Users className="h-8 w-8" />} title="Sem utilizadores" message="Crie o primeiro utilizador da equipa." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-mist-200 text-left text-xs text-graphite-400 dark:border-graphite-700">
                    <th className="py-2 pr-3 font-medium">Nome</th>
                    <th className="py-2 pr-3 font-medium">Função</th>
                    <th className="py-2 pr-3 font-medium">Filiais</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    <th className="py-2 pr-3 font-medium">Último acesso</th>
                    <th className="py-2 text-right font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-mist-200/60 dark:border-graphite-700/60">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-graphite-400">{u.email}</p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={u.role_key === "owner" ? "accent" : "info"}>
                          <ShieldCheck className="h-3 w-3" />
                          {u.role_name ?? u.role_key ?? "—"}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-graphite-400">
                        {u.branch_ids.length === 0
                          ? "Todas"
                          : u.branch_ids.map((id) => branches.find((b) => b.id === id)?.name ?? "…").join(", ")}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge tone={u.status === "active" ? "success" : "danger"}>
                          {u.status === "active" ? "Ativo" : "Suspenso"}
                        </Badge>
                        {u.mfa_enabled === 1 && (
                          <Badge tone="info" className="ml-1">
                            <KeyRound className="h-3 w-3" />
                            MFA
                          </Badge>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-graphite-400">
                        {u.last_login_at ? fmtDateTime(u.last_login_at) : "nunca"}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>
                            <UserCog className="h-3.5 w-3.5" /> Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === u.id}
                            onClick={() => changeStatus(u, u.status === "active" ? "suspended" : "active")}
                          >
                            {u.status === "active" ? "Suspender" : "Reativar"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Convites pendentes"
          icon={<Mail className="h-4 w-4" />}
          subtitle="Token de uso único, expira em 7 dias, revogável a qualquer momento."
          action={
            <Button size="sm" variant="secondary" onClick={() => setShowInvite(true)}>
              <Plus className="h-4 w-4" /> Convidar
            </Button>
          }
        />
        <div className="p-4">
          {!pendingInvites.length ? (
            <EmptyState icon={<Mail className="h-8 w-8" />} title="Sem convites pendentes" message="Convide membros da equipa por email." />
          ) : (
            <ul className="divide-y divide-mist-200 dark:divide-graphite-700">
              {pendingInvites.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium">{inv.email}</p>
                    <p className="text-xs text-graphite-400">
                      Função {inv.role_key} · criado {fmtDateTime(inv.created_at)}
                      {inv.expires_at ? ` · expira ${fmtDateTime(inv.expires_at)}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => revokeInvite(inv)}>
                    Revogar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {showCreate && (
        <CreateUserModal
          roles={roles}
          branches={branches}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
      {showInvite && (
        <InviteModal
          roles={roles}
          onClose={() => setShowInvite(false)}
          onDone={() => void load()}
        />
      )}
      {editing && (
        <EditUserModal
          user={editing}
          roles={roles}
          branches={branches}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateUserModal({
  roles,
  branches,
  onClose,
  onCreated,
}: {
  roles: RoleTemplate[];
  branches: BranchRow[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", email: "", password: "", roleKey: "cashier", pin: "", allBranches: true });
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!form.name || !form.email || form.password.length < 8) {
      toast.error("Preencha nome, email e palavra-passe (mínimo 8 caracteres).");
      return;
    }
    setBusy(true);
    try {
      await api("/api/users", {
        body: {
          name: form.name,
          email: form.email,
          password: form.password,
          roleKey: form.roleKey,
          pin: form.pin || undefined,
          branchIds: form.allBranches ? undefined : branchIds,
        },
      });
      toast.success("Utilizador criado.");
      onCreated();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Novo utilizador" wide>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nome" required>
          <input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Email" required>
          <input type="email" className="input-base" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Palavra-passe" required hint="Mínimo 8 caracteres.">
          <input type="password" className="input-base" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <Field label="Função" required>
          <select className="input-base" value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name} — {r.description}
              </option>
            ))}
          </select>
        </Field>
        <Field label="PIN de supervisor" hint="4–8 dígitos. Autorizações no POS/compras. Guardado apenas como hash.">
          <input
            className="input-base"
            inputMode="numeric"
            maxLength={8}
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
            placeholder="opcional"
          />
        </Field>
        <div className="flex items-end pb-1 md:col-span-2">
          <div>
            <Toggle checked={form.allBranches} onChange={(v) => setForm({ ...form, allBranches: v })} label="Acesso a todas as filiais" />
            <span className="ml-2 text-sm">Acesso a todas as filiais</span>
          </div>
        </div>
        {!form.allBranches && (
          <div className="flex flex-wrap gap-2 md:col-span-2">
            {branches.map((b) => (
              <label
                key={b.id}
                className="flex items-center gap-1.5 rounded-md border border-mist-300 px-2.5 py-1.5 text-sm dark:border-graphite-600"
              >
                <input
                  type="checkbox"
                  checked={branchIds.includes(b.id)}
                  onChange={(e) => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))}
                />
                {b.name}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Criar utilizador
        </Button>
      </div>
    </Modal>
  );
}

function EditUserModal({
  user,
  roles,
  branches,
  onClose,
  onSaved,
}: {
  user: UserRow;
  roles: RoleTemplate[];
  branches: BranchRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: user.name,
    roleKey: user.role_key ?? "viewer",
    newPassword: "",
    pin: "",
    allBranches: user.branch_ids.length === 0,
  });
  const [branchIds, setBranchIds] = useState<string[]>(user.branch_ids);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        roleKey: form.roleKey,
        branchIds: form.allBranches ? [] : branchIds,
      };
      if (form.newPassword) payload.newPassword = form.newPassword;
      if (form.pin) payload.pin = form.pin;
      await api(`/api/users/${user.id}`, { method: "PATCH", body: payload });
      toast.success("Utilizador atualizado.");
      onSaved();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Editar ${user.name}`} wide>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Nome">
          <input className="input-base" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Função">
          <select className="input-base" value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
            {roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name} — {r.description}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nova palavra-passe" hint="Deixe vazio para manter.">
          <input type="password" className="input-base" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </Field>
        <Field label="Novo PIN de supervisor" hint="4–8 dígitos; inalterado se vazio.">
          <input
            className="input-base"
            inputMode="numeric"
            maxLength={8}
            value={form.pin}
            onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "") })}
          />
        </Field>
        <div className="flex items-end pb-1 md:col-span-2">
          <div>
            <Toggle checked={form.allBranches} onChange={(v) => setForm({ ...form, allBranches: v })} label="Acesso a todas as filiais" />
            <span className="ml-2 text-sm">Acesso a todas as filiais</span>
          </div>
        </div>
        {!form.allBranches && (
          <div className="flex flex-wrap gap-2 md:col-span-2">
            {branches.map((b) => (
              <label
                key={b.id}
                className="flex items-center gap-1.5 rounded-md border border-mist-300 px-2.5 py-1.5 text-sm dark:border-graphite-600"
              >
                <input
                  type="checkbox"
                  checked={branchIds.includes(b.id)}
                  onChange={(e) => setBranchIds(e.target.checked ? [...branchIds, b.id] : branchIds.filter((x) => x !== b.id))}
                />
                {b.name}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="primary" onClick={submit} disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </div>
    </Modal>
  );
}

function InviteModal({ roles, onClose, onDone }: { roles: RoleTemplate[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ email: "", roleKey: "cashier" });
  const [busy, setBusy] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  async function submit() {
    if (!form.email) return;
    setBusy(true);
    try {
      const data = await api<{ inviteId: string; token: string }>("/api/invites", {
        body: { action: "create", email: form.email, roleKey: form.roleKey },
      });
      setCreatedToken(data.token);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Convidar utilizador">
      {createdToken ? (
        <div className="space-y-3">
          <p className="text-sm">
            Convite criado. O token abaixo é mostrado <strong>uma única vez</strong> — envie-o ao convidado por um canal
            interno (o envio automático por email fica disponível quando configurar a integração de email).
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-md bg-mist-100 p-3 font-mono text-xs dark:bg-graphite-800">{createdToken}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(createdToken);
                toast.success("Token copiado.");
              }}
            >
              Copiar
            </Button>
          </div>
          <p className="text-xs text-graphite-400">O convidado aceita com o token, definindo nome e palavra-passe. Expira em 7 dias.</p>
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={() => {
                onDone();
                onClose();
              }}
            >
              Concluir
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            <Field label="Email" required>
              <input type="email" className="input-base" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Função">
              <select className="input-base" value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })}>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-graphite-400">
              O convite é registado com token de uso único (apenas o hash fica na BD) e expira em 7 dias.
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !form.email}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar convite
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
