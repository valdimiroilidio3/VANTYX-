import { NextResponse } from "next/server";
import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { createWorkOrder, listWorkOrders } from "@/lib/services/workshop.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("workorders.view");
  const url = new URL(request.url);
  return listWorkOrders(ctx.orgId, {
    status: url.searchParams.get("status") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    branchId: url.searchParams.get("branchId") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 50) || 50,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
  });
});

const partSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().min(1).optional(),
  qtyMilli: z.number().int().positive(),
  unitPriceCents: z.number().int().min(0),
});

const createSchema = z.object({
  branchId: z.string().min(1),
  customerId: z.string().min(1).optional(),
  vehiclePlate: z.string().max(20).optional(),
  vehicleInfo: z.string().max(300).optional(),
  equipmentSerial: z.string().max(80).optional(),
  diagnosis: z.string().max(2000).optional(),
  laborMinutes: z.number().int().min(0).max(100000).optional(),
  laborRateCents: z.number().int().min(0).optional(),
  warrantyDays: z.number().int().min(0).max(3650).optional(),
  parts: z.array(partSchema).max(200).optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("workorders.manage");
  const id = createWorkOrder(ctx.orgId, body, { userId: ctx.userId, label: ctx.userName });
  return NextResponse.json({ ok: true, data: { id } }, { status: 201 });
}, createSchema);
