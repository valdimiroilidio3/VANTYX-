import { cookies } from "next/headers";
import { getDb } from "@/lib/db/client";
import { sha256 } from "./password";
import type { Permission } from "@/lib/domain/permissions";
import type { IndustryKey } from "@/lib/modules/industries";

export const SESSION_COOKIE = "vantyx_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export interface AuthContext {
  userId: string;
  orgId: string;
  orgName: string;
  demo: boolean;
  email: string;
  userName: string;
  roleKey: string;
  roleName: string;
  permissions: Set<Permission>;
  branchIds: string[] | null; // null = all branches
  industry: IndustryKey;
  sessionId: string;
}

interface SessionRow {
  id: string;
  org_id: string;
  user_id: string;
  expires_at: number;
  revoked_at: number | null;
}

interface UserRow {
  id: string;
  org_id: string;
  email: string;
  name: string;
  status: string;
  role_id: string | null;
}

/** Reads + validates the session cookie and assembles the auth context. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getAuthContextFromToken(token);
}

export function getAuthContextFromToken(token: string): AuthContext | null {
  const db = getDb();
  const session = db
    .prepare(
      `SELECT s.id, s.org_id, s.user_id, s.expires_at, s.revoked_at
       FROM sessions s WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as SessionRow | undefined;
  if (!session) return null;
  const now = Date.now();
  if (session.revoked_at || session.expires_at < now) return null;

  const user = db
    .prepare(
      `SELECT id, org_id, email, name, status, role_id FROM users WHERE id = ?`,
    )
    .get(session.user_id) as UserRow | undefined;
  if (!user || user.status !== "active") return null;

  const org = db
    .prepare(`SELECT name, demo FROM organizations WHERE id = ? AND status = 'active'`)
    .get(user.org_id) as { name: string; demo: number } | undefined;
  if (!org) return null;

  const profile = db
    .prepare(`SELECT industry FROM org_profiles WHERE org_id = ?`)
    .get(user.org_id) as { industry: IndustryKey } | undefined;

  const role = user.role_id
    ? (db
        .prepare(`SELECT key, name FROM roles WHERE id = ?`)
        .get(user.role_id) as { key: string; name: string } | undefined)
    : undefined;

  const perms = user.role_id
    ? (db
        .prepare(`SELECT permission FROM role_permissions WHERE role_id = ?`)
        .all(user.role_id) as { permission: Permission }[])
    : [];

  const branches = db
    .prepare(`SELECT branch_id FROM user_branches WHERE user_id = ?`)
    .all(user.id) as { branch_id: string }[];

  // Touch last_seen (cheap, keeps session activity auditable)
  db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).run(
    now,
    session.id,
  );

  return {
    userId: user.id,
    orgId: user.org_id,
    orgName: org.name,
    demo: org.demo === 1,
    email: user.email,
    userName: user.name,
    roleKey: role?.key ?? "viewer",
    roleName: role?.name ?? "Observador",
    permissions: new Set(perms.map((p) => p.permission)),
    branchIds: branches.length ? branches.map((b) => b.branch_id) : null,
    industry: profile?.industry ?? "services",
    sessionId: session.id,
  };
}

export function hasPermission(ctx: AuthContext, permission: Permission): boolean {
  return ctx.permissions.has(permission);
}

export function hasAnyPermission(
  ctx: AuthContext,
  permissions: Permission[],
): boolean {
  return permissions.some((p) => ctx.permissions.has(p));
}

/** Branch scope check: users may be restricted to specific branches. */
export function canAccessBranch(ctx: AuthContext, branchId: string): boolean {
  return ctx.branchIds === null || ctx.branchIds.includes(branchId);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = "error",
    public details?: unknown,
  ) {
    super(message);
  }
}

export function unauthorized(): never {
  throw new ApiError(401, "Sessão inválida ou expirada. Inicie sessão.", "unauthorized");
}

export function forbidden(message = "Sem permissão para esta operação."): never {
  throw new ApiError(403, message, "forbidden");
}

export function notFound(resource = "Recurso"): never {
  throw new ApiError(404, `${resource} não encontrado.`, "not_found");
}

export function badRequest(message: string, details?: unknown): never {
  throw new ApiError(400, message, "bad_request", details);
}

export function conflict(message: string): never {
  throw new ApiError(409, message, "conflict");
}

/** Context + permission guard in one call (for API route handlers). */
export async function requirePermission(
  permission: Permission,
): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) unauthorized();
  if (!hasPermission(ctx, permission)) forbidden();
  return ctx;
}

export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) unauthorized();
  return ctx;
}

/** Verifies the user's branch scope; throws otherwise. */
export function assertBranchAccess(ctx: AuthContext, branchId: string): void {
  if (!canAccessBranch(ctx, branchId)) {
    forbidden("Sem acesso à filial selecionada.");
  }
}
