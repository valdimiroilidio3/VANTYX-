import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { listTables, upsertTable } from "@/lib/services/restaurant.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("restaurant.floor");
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId");
  if (!branchId) return { tables: [] };
  return { tables: await listTables(ctx.orgId, branchId) };
});

const schema = z.object({
  branchId: z.string().min(1),
  id: z.string().optional(),
  name: z.string().min(1).max(40),
  zone: z.string().max(40).optional(),
  seats: z.number().int().min(1).max(50).optional(),
  positionX: z.number().int().optional(),
  positionY: z.number().int().optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("restaurant.floor");
  const tableId = await upsertTable(ctx.orgId, body.branchId, body);
  return { tableId, tables: await listTables(ctx.orgId, body.branchId) };
}, schema);
