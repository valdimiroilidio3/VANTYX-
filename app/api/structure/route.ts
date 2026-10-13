import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  createBranch,
  createTerminal,
  listBranches,
  listTerminals,
  listWarehouses,
} from "@/lib/services/org.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("settings.view");
  return {
    branches: listBranches(ctx.orgId),
    warehouses: listWarehouses(ctx.orgId),
    terminals: listTerminals(ctx.orgId),
  };
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_branch"),
    name: z.string().min(1).max(120),
    code: z.string().min(1).max(10),
    address: z.string().max(300).optional(),
    city: z.string().max(120).optional(),
    phone: z.string().max(40).optional(),
    withWarehouse: z.boolean().optional(),
    withTerminal: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("create_terminal"),
    branchId: z.string().min(1),
    name: z.string().min(1).max(80),
    code: z.string().min(1).max(10),
    kind: z.enum(["pos", "kds", "tablet", "backoffice"]),
  }),
]);

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("branches.manage");
  const actor = { userId: ctx.userId, label: ctx.userName };
  if (body.action === "create_branch") {
    const { action: _a, ...data } = body;
    return { branchId: createBranch(ctx.orgId, data, actor) };
  }
  const { action: _a, ...data } = body;
  return { terminalId: createTerminal(ctx.orgId, data, actor) };
}, schema);
