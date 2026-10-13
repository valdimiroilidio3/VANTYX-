import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import type { Permission } from "@/lib/domain/permissions";
import {
  approvePurchaseOrder,
  getPurchaseOrder,
  receivePurchaseOrder,
  setPurchaseOrderStatus,
} from "@/lib/services/purchasing.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("purchasing.view");
  const { id } = await context.params;
  return getPurchaseOrder(ctx.orgId, id);
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("approve"),
    decision: z.enum(["approved", "rejected"]),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("receive"),
    note: z.string().max(500).optional(),
    lines: z
      .array(
        z.object({
          poLineId: z.string().min(1),
          qtyMilli: z.number().int().positive(),
          unitCostCents: z.number().int().min(0).optional(),
          batchNumber: z.string().max(60).nullable().optional(),
          expiryDate: z.number().int().nullable().optional(),
          serialNumbers: z.array(z.string().max(80)).optional(),
        }),
      )
      .min(1),
  }),
]);

const permissionFor: Record<string, Permission> = {
  send: "purchasing.manage",
  cancel: "purchasing.manage",
  approve: "purchasing.approve",
  receive: "purchasing.receive",
};

export const POST = routeHandler(async (body, _request, context) => {
  const ctx = await requirePermission(permissionFor[body.action]!);
  const { id } = await context.params;
  const actor = { userId: ctx.userId, label: ctx.userName };
  switch (body.action) {
    case "send":
      setPurchaseOrderStatus(ctx.orgId, id, "sent", actor);
      return { status: "sent" };
    case "cancel":
      setPurchaseOrderStatus(ctx.orgId, id, "cancelled", actor);
      return { status: "cancelled" };
    case "approve":
      approvePurchaseOrder(ctx.orgId, id, body.decision, body.reason, actor);
      return { status: body.decision };
    case "receive":
      return receivePurchaseOrder(ctx.orgId, id, body.lines, {
        note: body.note,
        actor,
      });
  }
}, actionSchema);
