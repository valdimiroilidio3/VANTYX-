import { getDb, tx } from "@/lib/db/client";
import { newId } from "@/lib/domain/ids";
import { generateToken, hashSecret, passwordPolicyErrors, sha256 } from "@/lib/auth/password";
import { ApiError, badRequest, conflict, notFound } from "@/lib/auth/context";
import { writeAudit } from "./audit.service";
import { revokeAllUserSessions } from "./session.service";

/**
 * Staff & access control — users, invites, roles, branch scoping,
 * session registry and revocation.
 */

export interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  status: string;
  mfa_enabled: number;
  last_login_at: number | null;
  created_at: number;
  role_id: string | null;
  role_key: string | null;
  role_name: string | null;
  branch_ids: string[];
}

export function listUsers(orgId: string): UserRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.id, u.org_id, u.email, u.name, u.status, u.mfa_enabled, u.last_login_at,
              u.created_at, u.role_id, r.key as role_key, r.name as role_name
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.org_id = ? ORDER BY u.name`,
    )
    .all(orgId) as Omit<UserRow, "branch_ids">[];
  return rows.map((r) => {
    const branches = db
      .prepare(`SELECT branch_id FROM user_branches WHERE user_id = ?`)
      .all(r.id) as { branch_id: string }[];
    return { ...r, branch_ids: branches.map((b) => b.branch_id) };
  });
}

export function createUser(
  orgId: string,
  data: {
    name: string;
    email: string;
    password: string;
    roleKey: string;
    branchIds?: string[];
    pin?: string;
  },
  actor: { userId: string; label: string },
): string {
  const db = getDb();
  const email = data.email.trim().toLowerCase();
  if (!data.name?.trim()) badRequest("Nome é obrigatório.");
  if (!email.includes("@")) badRequest("Email inválido.");
  const policyErrors = passwordPolicyErrors(data.password);
  if (policyErrors.length) badRequest(policyErrors.join(" "));
  const role = db.prepare(`SELECT id, key FROM roles WHERE org_id = ? AND key = ?`).get(orgId, data.roleKey) as { id: string; key: string } | undefined;
  if (!role) badRequest(`Função desconhecida: ${data.roleKey}`);
  const existing = db.prepare(`SELECT id FROM users WHERE org_id = ? AND lower(email) = ?`).get(orgId, email);
  if (existing) conflict("Já existe um utilizador com este email nesta organização.");

  const userId = newId("usr");
  tx(db, () => {
    db.prepare(
      `INSERT INTO users (id, org_id, email, name, password_hash, pin_hash, role_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(userId, orgId, email, data.name.trim(), hashSecret(data.password), data.pin ? hashSecret(data.pin) : null, role!.id, Date.now(), Date.now());
    for (const branchId of data.branchIds ?? []) {
      db.prepare(`INSERT OR IGNORE INTO user_branches (user_id, branch_id) VALUES (?, ?)`).run(userId, branchId);
    }
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "user.create", resourceType: "user", resourceId: userId, after: { email, roleKey: data.roleKey, branchIds: data.branchIds ?? [] } },
      db,
    );
  });
  return userId;
}

export function updateUser(
  orgId: string,
  userId: string,
  patch: { name?: string; roleKey?: string; status?: "active" | "suspended"; branchIds?: string[] },
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  const before = db.prepare(`SELECT name, role_id, status FROM users WHERE id = ? AND org_id = ?`).get(userId, orgId);
  if (!before) notFound("Utilizador");
  tx(db, () => {
    if (patch.roleKey) {
      const role = db.prepare(`SELECT id FROM roles WHERE org_id = ? AND key = ?`).get(orgId, patch.roleKey) as { id: string } | undefined;
      if (!role) badRequest(`Função desconhecida: ${patch.roleKey}`);
      db.prepare(`UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?`).run(role!.id, Date.now(), userId);
    }
    if (patch.name) db.prepare(`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`).run(patch.name.trim(), Date.now(), userId);
    if (patch.status) {
      db.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`).run(patch.status, Date.now(), userId);
      if (patch.status === "suspended") {
        revokeAllUserSessions(userId);
      }
    }
    if (patch.branchIds) {
      db.prepare(`DELETE FROM user_branches WHERE user_id = ?`).run(userId);
      for (const branchId of patch.branchIds) {
        db.prepare(`INSERT OR IGNORE INTO user_branches (user_id, branch_id) VALUES (?, ?)`).run(userId, branchId);
      }
    }
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "user.update", resourceType: "user", resourceId: userId, before, after: patch },
      db,
    );
  });
}

export function changeUserPassword(
  orgId: string,
  userId: string,
  newPassword: string,
  actor: { userId: string; label: string },
): void {
  const errors = passwordPolicyErrors(newPassword);
  if (errors.length) badRequest(errors.join(" "));
  const db = getDb();
  tx(db, () => {
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ? AND org_id = ?`)
      .run(hashSecret(newPassword), Date.now(), userId, orgId);
    revokeAllUserSessions(userId);
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "user.password_change", resourceType: "user", resourceId: userId, detail: "Sessões revogadas." },
      db,
    );
  });
}

/* ------------------------------- Invites ------------------------------- */

export function createInvite(
  orgId: string,
  data: { email: string; roleKey: string },
  actor: { userId: string; label: string },
): { inviteId: string; token: string } {
  const db = getDb();
  const role = db.prepare(`SELECT key FROM roles WHERE org_id = ? AND key = ?`).get(orgId, data.roleKey);
  if (!role) badRequest(`Função desconhecida: ${data.roleKey}`);
  const { token, tokenHash } = generateToken();
  const id = newId("inv");
  const now = Date.now();
  tx(db, () => {
    db.prepare(
      `INSERT INTO invites (id, org_id, email, role_key, token_hash, status, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).run(id, orgId, data.email.trim().toLowerCase(), data.roleKey, tokenHash, actor.userId, now, now + 7 * 86_400_000);
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "invite.create", resourceType: "invite", resourceId: id, after: { email: data.email, roleKey: data.roleKey } },
      db,
    );
  });
  // The token is shown ONCE to the admin (in production, deliver by email
  // via the email integration adapter — status: not_configured by default).
  return { inviteId: id, token };
}

export function acceptInvite(
  token: string,
  data: { name: string; password: string },
): { userId: string; orgId: string } {
  const db = getDb();
  const invite = db.prepare(
    `SELECT * FROM invites WHERE token_hash = ? AND status = 'pending'`,
  ).get(sha256(token)) as
    | { id: string; org_id: string; email: string; role_key: string; expires_at: number }
    | undefined;
  if (!invite) throw new ApiError(400, "Convite inválido.", "invalid_invite");
  if (invite!.expires_at < Date.now()) throw new ApiError(400, "Convite expirado.", "invite_expired");
  const errors = passwordPolicyErrors(data.password);
  if (errors.length) badRequest(errors.join(" "));

  const userId = newId("usr");
  tx(db, () => {
    const role = db.prepare(`SELECT id FROM roles WHERE org_id = ? AND key = ?`).get(invite!.org_id, invite!.role_key) as { id: string };
    db.prepare(
      `INSERT INTO users (id, org_id, email, name, password_hash, role_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(userId, invite!.org_id, invite!.email, data.name.trim(), hashSecret(data.password), role.id, Date.now(), Date.now());
    db.prepare(`UPDATE invites SET status = 'accepted', accepted_at = ? WHERE id = ?`).run(Date.now(), invite!.id);
    writeAudit(
      { orgId: invite!.org_id, actorUserId: userId, actorLabel: invite!.email, action: "invite.accept", resourceType: "invite", resourceId: invite!.id },
      db,
    );
  });
  return { userId, orgId: invite!.org_id };
}

export function listInvites(orgId: string) {
  return getDb()
    .prepare(`SELECT id, email, role_key, status, created_at, expires_at FROM invites WHERE org_id = ? ORDER BY created_at DESC`)
    .all(orgId);
}

export function revokeInvite(orgId: string, inviteId: string, actor: { userId: string; label: string }): void {
  const db = getDb();
  tx(db, () => {
    db.prepare(`UPDATE invites SET status = 'revoked' WHERE id = ? AND org_id = ?`).run(inviteId, orgId);
    writeAudit(
      { orgId, actorUserId: actor.userId, actorLabel: actor.label, action: "invite.revoke", resourceType: "invite", resourceId: inviteId },
      db,
    );
  });
}

/* -------------------------------- Roles -------------------------------- */

export function listRoles(orgId: string) {
  const db = getDb();
  const roles = db.prepare(`SELECT * FROM roles WHERE org_id = ? ORDER BY is_system DESC, name`).all(orgId) as { id: string; key: string; name: string; description: string | null; is_system: number }[];
  return roles.map((r) => ({
    ...r,
    permissions: (db.prepare(`SELECT permission FROM role_permissions WHERE role_id = ?`).all(r.id) as { permission: string }[]).map((p) => p.permission),
    userCount: (db.prepare(`SELECT COUNT(*) c FROM users WHERE role_id = ?`).get(r.id) as { c: number }).c,
  }));
}

export function listActiveSessions(orgId: string) {
  return getDb()
    .prepare(
      `SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, s.user_agent, s.ip,
              u.name as user_name, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.org_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
       ORDER BY s.last_seen_at DESC LIMIT 100`,
    )
    .all(orgId, Date.now());
}


/**
 * Sets or clears the supervisor PIN (hashed at rest; used for POS/purchase
 * overrides). PIN changes are audited and never logged in clear text.
 */
export function setUserPin(
  orgId: string,
  userId: string,
  pin: string | null,
  actor: { userId: string; label: string },
): void {
  const db = getDb();
  const user = db.prepare(`SELECT id FROM users WHERE id = ? AND org_id = ?`).get(userId, orgId);
  if (!user) notFound("Utilizador");
  if (pin != null && !/^\d{4,8}$/.test(pin)) badRequest("O PIN deve ter 4 a 8 dígitos.");
  tx(db, () => {
    db.prepare(`UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?`)
      .run(pin ? hashSecret(pin) : null, Date.now(), userId);
    writeAudit(
      {
        orgId,
        actorUserId: actor.userId,
        actorLabel: actor.label,
        action: pin ? "user.pin_set" : "user.pin_removed",
        resourceType: "user",
        resourceId: userId,
      },
      db,
    );
  });
}
