import { z } from "zod";
import { NextResponse } from "next/server";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  createPurchaseOrder,
  listPurchaseOrders,
  purchaseSuggestions,
} from "@/lib/services/purchasing.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("purchasing.view");
  const url = new URL(request.url);
  if (url.searchParams.get("view") === "suggestions") {
    return purchaseSuggestions(
      ctx.orgId,
      Number(url.searchParams.get("days") ?? 30) || 30,
      50,
    );
  }
  return listPurchaseOrders(ctx.orgId, {
    status: url.searchParams.get("status") ?? undefined,
    supplierId: url.searchParams.get("supplierId") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 25) || 25,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
  });
});

const schema = z.object({
  supplierId: z.string().min(1),
  warehouseId: z.string().min(1),
  expectedAt: z.number().int().nullable().optional(),
  note: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        variantId: z.string().nullable().optional(),
        qtyMilli: z.number().int().positive(),
        unitCostCents: z.number().int().min(0),
        taxRateBps: z.number().int().min(0).max(10000).optional(),
        note: z.string().max(300).optional(),
      }),
    )
    .min(1),
  supervisor: z
    .object({ userId: z.string(), pin: z.string().regex(/^\d{4,8}$/) })
    .nullable()
    .optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("purchasing.manage");
  const result = await createPurchaseOrder(ctx.orgId, {
    ...body,
    actor: { userId: ctx.userId, label: ctx.userName, roleKey: ctx.roleKey },
  });
  return NextResponse.json({ ok: true, data: result }, { status: 201 });
}, schema);
