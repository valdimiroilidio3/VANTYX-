import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import {
  acceptInvite,
  createInvite,
  listInvites,
  revokeInvite,
} from "@/lib/services/user.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("users.manage");
  return listInvites(ctx.orgId);
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    email: z.string().email().max(200),
    roleKey: z.string().min(2).max(40),
  }),
  z.object({ action: z.literal("revoke"), inviteId: z.string().min(1) }),
  z.object({
    action: z.literal("accept"),
    token: z.string().min(20).max(200),
    name: z.string().min(2).max(120),
    password: z.string().min(8).max(200),
  }),
]);

export const POST = routeHandler(async (body) => {
  if (body.action === "accept") {
    // Accepting an invite requires no session (new user flow)
    void getAuthContext;
    return acceptInvite(body.token, { name: body.name, password: body.password });
  }
  const ctx = await requirePermission("users.manage");
  const actor = { userId: ctx.userId, label: ctx.userName };
  if (body.action === "create") {
    return createInvite(ctx.orgId, { email: body.email, roleKey: body.roleKey }, actor);
  }
  revokeInvite(ctx.orgId, body.inviteId, actor);
  return listInvites(ctx.orgId);
}, schema);
