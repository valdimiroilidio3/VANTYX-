import { getDb } from "@/lib/db/client";
import { generateToken, hashSecret, verifySecret } from "@/lib/auth/password";
import { SESSION_TTL_MS } from "@/lib/auth/context";
import { newId } from "@/lib/domain/ids";
import { ApiError } from "@/lib/auth/context";

interface LoginResult {
  token: string;
  userId: string;
  orgId: string;
  expiresAt: number;
}

/**
 * Authenticates by email (scoped to the organization the user belongs to)
 * or by email+org. Rate limiting is enforced at the API layer.
 */
export async function loginWithPassword(
  email: string,
  password: string,
  meta: { userAgent?: string; ip?: string } = {},
): Promise<LoginResult> {
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const user = (await db
    .prepare(
      `SELECT u.id, u.org_id, u.password_hash, u.status, o.status as org_status
       FROM users u JOIN organizations o ON o.id = u.org_id
       WHERE lower(u.email) = ?`,
    )
    .get(normalized)) as
    | {
        id: string;
        org_id: string;
        password_hash: string;
        status: string;
        org_status: string;
      }
    | undefined;

  // Constant-ish failure path: same error for unknown user / bad password
  if (!user || !verifySecret(password, user.password_hash)) {
    throw new ApiError(401, "Credenciais inválidas.", "invalid_credentials");
  }
  if (user.status !== "active") {
    throw new ApiError(403, "Utilizador suspenso ou convite pendente.", "user_inactive");
  }
  if (user.org_status !== "active") {
    throw new ApiError(403, "Organização suspensa.", "org_inactive");
  }

  const { token, tokenHash } = generateToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db.prepare(
    `INSERT INTO sessions (id, org_id, user_id, token_hash, created_at, expires_at, last_seen_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(newId("ses"), user.org_id, user.id, tokenHash, now, expiresAt, now, meta.userAgent ?? null, meta.ip ?? null);
  await db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(now, user.id);

  return { token, userId: user.id, orgId: user.org_id, expiresAt };
}

/** Operator PIN switch (POS terminals): validates PIN on active session. */
export async function loginWithPin(
  userId: string,
  pin: string,
): Promise<boolean> {
  const db = getDb();
  const row = (await db
    .prepare(`SELECT pin_hash, status FROM users WHERE id = ?`)
    .get(userId)) as { pin_hash: string | null; status: string } | undefined;
  if (!row || row.status !== "active" || !row.pin_hash) return false;
  return verifySecret(pin, row.pin_hash);
}

export async function logout(token: string): Promise<void> {
  const db = getDb();
  await db.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
  ).run(Date.now(), generateTokenHash(token));
}

export async function revokeSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`,
  ).run(Date.now(), sessionId);
}

export async function revokeAllUserSessions(userId: string): Promise<number> {
  const db = getDb();
  const info = await db
    .prepare(
      `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .run(Date.now(), userId);
  return info.changes;
}

export async function setUserPin(userId: string, pin: string): Promise<void> {
  const db = getDb();
  await db.prepare(`UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?`).run(
    hashSecret(pin),
    Date.now(),
    userId,
  );
}

import { sha256 } from "@/lib/auth/password";
function generateTokenHash(token: string): string {
  return sha256(token);
}
