import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/**
 * Users able to approve POS operations via PIN (supervisor override).
 * Only exposes id/name/role — never hashes. Visible to any operator
 * with pos.sell so the checkout can request an override.
 */
export const GET = routeHandler(async () => {
  const ctx = await requirePermission("pos.sell");
  const rows = (await getDb()
    .prepare(
      `SELECT u.id, u.name, r.key as role_key, r.name as role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.org_id = ? AND u.status = 'active' AND u.pin_hash IS NOT NULL AND u.id != ?
       ORDER BY CASE r.key WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name`,
    )
    .all(ctx.orgId, ctx.userId)) as { id: string; name: string; role_key: string; role_name: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, roleKey: r.role_key, roleName: r.role_name }));
});
