import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { changeUserPassword, setUserPin, updateUser } from "@/lib/services/user.service";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  roleKey: z.string().max(40).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  branchIds: z.array(z.string()).optional(),
  newPassword: z.string().min(8).max(200).optional(),
  pin: z.string().regex(/^\d{4,8}$/).nullable().optional(),
});

export const PATCH = routeHandler(async (body, _request, context) => {
  const ctx = await requirePermission("users.manage");
  const { id } = await context.params;
  const { newPassword, pin, ...patch } = body;
  if (pin !== undefined) {
    setUserPin(ctx.orgId, id, pin, { userId: ctx.userId, label: ctx.userName });
  }
  if (Object.keys(patch).length) {
    updateUser(ctx.orgId, id, patch, { userId: ctx.userId, label: ctx.userName });
  }
  if (newPassword) {
    changeUserPassword(ctx.orgId, id, newPassword, {
      userId: ctx.userId,
      label: ctx.userName,
    });
  }
  return { updated: id };
}, patchSchema);
