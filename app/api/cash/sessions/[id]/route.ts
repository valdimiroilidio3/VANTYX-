import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { addMovement, closeSession, getSession } from "@/lib/services/cash.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("cash.view");
  const { id } = await context.params;
  return getSession(ctx.orgId, id);
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("close"),
    countedCashCents: z.number().int().min(0),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("movement"),
    kind: z.enum(["in", "out"]),
    amountCents: z.number().int().positive(),
    reasonCode: z.string().min(2).max(60),
    note: z.string().max(300).optional(),
  }),
]);

export const POST = routeHandler(async (body, _request, context) => {
  const { id } = await context.params;
  if (body.action === "close") {
    const ctx = await requirePermission("cash.close");
    return closeSession(ctx.orgId, id, {
      countedCashCents: body.countedCashCents,
      note: body.note,
      actor: { userId: ctx.userId, label: ctx.userName },
    });
  }
  const ctx = await requirePermission("cash.movement");
  const movementId = await addMovement(ctx.orgId, id, {
    kind: body.kind,
    amountCents: body.amountCents,
    reasonCode: body.reasonCode,
    note: body.note,
    actor: { userId: ctx.userId, label: ctx.userName },
  });
  return { movementId };
}, actionSchema);
