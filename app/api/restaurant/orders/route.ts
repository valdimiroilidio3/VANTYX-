import { z } from "zod";
import { NextResponse } from "next/server";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  addOrderItems,
  listOpenOrders,
  openOrder,
} from "@/lib/services/restaurant.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("restaurant.floor");
  const url = new URL(request.url);
  return listOpenOrders(ctx.orgId, url.searchParams.get("branchId") ?? undefined);
});

const openSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    branchId: z.string().min(1),
    tableId: z.string().nullable().optional(),
    channel: z.enum(["dine_in", "takeaway", "counter", "delivery"]),
    guestCount: z.number().int().min(1).max(99).optional(),
    customerId: z.string().nullable().optional(),
    customerName: z.string().max(120).nullable().optional(),
  }),
  z.object({
    action: z.literal("add_items"),
    orderId: z.string().min(1),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          variantId: z.string().nullable().optional(),
          qtyMilli: z.number().int().positive(),
          modifiers: z
            .array(
              z.object({
                groupId: z.string(),
                groupName: z.string().max(80),
                optionId: z.string(),
                name: z.string().max(80),
                priceCents: z.number().int().min(0),
              }),
            )
            .optional(),
          notes: z.string().max(300).optional(),
          sendToKitchen: z.boolean().optional(),
        }),
      )
      .min(1),
  }),
]);

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("restaurant.floor");
  const actor = { userId: ctx.userId, label: ctx.userName };
  if (body.action === "open") {
    const result = openOrder(ctx.orgId, { ...body, actor });
    return NextResponse.json({ ok: true, data: result }, { status: 201 });
  }
  return addOrderItems(ctx.orgId, body.orderId, body.items, actor);
}, openSchema);
