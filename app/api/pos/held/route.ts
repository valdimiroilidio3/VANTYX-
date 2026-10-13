import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { holdSale, listHeldSales } from "@/lib/services/sales.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("pos.hold");
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? undefined;
  return listHeldSales(ctx.orgId, branchId);
});

const holdSchema = z.object({
  branchId: z.string().min(1),
  terminalId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  label: z.string().max(120).optional(),
  cart: z.unknown(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("pos.hold");
  const id = holdSale(ctx.orgId, {
    branchId: body.branchId,
    terminalId: body.terminalId ?? null,
    userId: ctx.userId,
    customerId: body.customerId ?? null,
    label: body.label,
    cart: body.cart,
  });
  return { id };
}, holdSchema);
