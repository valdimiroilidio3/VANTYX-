import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { createUser, listUsers } from "@/lib/services/user.service";
import { ROLE_TEMPLATES } from "@/lib/domain/permissions";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("users.manage");
  return {
    users: listUsers(ctx.orgId),
    roleTemplates: ROLE_TEMPLATES.map((r) => ({ key: r.key, name: r.name, description: r.description })),
  };
});

const createSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  roleKey: z.string().min(2).max(40),
  branchIds: z.array(z.string()).optional(),
  pin: z.string().regex(/^\d{4,8}$/).optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("users.manage");
  const userId = createUser(ctx.orgId, body, { userId: ctx.userId, label: ctx.userName });
  return { userId };
}, createSchema);
