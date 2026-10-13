import { z } from "zod";
import { NextResponse } from "next/server";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { listSessions, openSession } from "@/lib/services/cash.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("cash.view");
  const url = new URL(request.url);
  return listSessions(ctx.orgId, {
    branchId: url.searchParams.get("branchId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 25) || 25,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
  });
});

const openSchema = z.object({
  branchId: z.string().min(1),
  terminalId: z.string().min(1),
  openingFloatCents: z.number().int().min(0),
  shiftLabel: z.string().max(80).optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("cash.open");
  const result = openSession(ctx.orgId, {
    ...body,
    actor: { userId: ctx.userId, label: ctx.userName },
  });
  return NextResponse.json({ ok: true, data: result }, { status: 201 });
}, openSchema);
