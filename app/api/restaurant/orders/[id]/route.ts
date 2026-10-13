import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  cancelOrder,
  cancelOrderItem,
  getOrderDetail,
  moveOrderToTable,
} from "@/lib/services/restaurant.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("restaurant.floor");
  const { id } = await context.params;
  return getOrderDetail(ctx.orgId, id);
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("cancel_item"),
    itemId: z.string().min(1),
    reason: z.string().min(2).max(300),
  }),
  z.object({
    action: z.literal("move_table"),
    toTableId: z.string().min(1),
  }),
  z.object({
    action: z.literal("cancel_order"),
    reason: z.string().min(2).max(300),
  }),
]);

export const POST = routeHandler(async (body, _request, context) => {
  const ctx = await requirePermission("restaurant.floor");
  const { id } = await context.params;
  const actor = { userId: ctx.userId, label: ctx.userName };
  switch (body.action) {
    case "cancel_item":
      cancelOrderItem(ctx.orgId, body.itemId, body.reason, actor);
      return getOrderDetail(ctx.orgId, id);
    case "move_table":
      moveOrderToTable(ctx.orgId, id, body.toTableId, actor);
      return getOrderDetail(ctx.orgId, id);
    case "cancel_order":
      cancelOrder(ctx.orgId, id, body.reason, actor);
      return { cancelled: id };
  }
}, schema);
