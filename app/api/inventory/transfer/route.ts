import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  createTransfer,
  listTransfers,
  receiveTransfer,
} from "@/lib/services/inventory.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("inventory.view");
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 40) || 40;
  return { transfers: listTransfers(ctx.orgId, limit) };
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    fromWarehouseId: z.string().min(1),
    toWarehouseId: z.string().min(1),
    note: z.string().max(300).optional(),
    lines: z
      .array(
        z.object({
          productId: z.string().min(1),
          variantId: z.string().nullable().optional(),
          qtyMilli: z.number().int().positive(),
        }),
      )
      .min(1),
  }),
  z.object({
    action: z.literal("receive"),
    transferId: z.string().min(1),
  }),
]);

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("inventory.transfer");
  const actor = { userId: ctx.userId, label: ctx.userName };
  if (body.action === "create") {
    return createTransfer({
      orgId: ctx.orgId,
      fromWarehouseId: body.fromWarehouseId,
      toWarehouseId: body.toWarehouseId,
      lines: body.lines,
      note: body.note,
      actor,
    });
  }
  receiveTransfer(ctx.orgId, body.transferId, actor);
  return { received: body.transferId };
}, schema);
