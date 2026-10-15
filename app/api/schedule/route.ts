import { NextResponse } from "next/server";
import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  createAppointment,
  createResource,
  listAppointments,
  listResources,
} from "@/lib/services/scheduling.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("scheduling.view");
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId") ?? undefined;
  return {
    resources: await listResources(ctx.orgId, { branchId }),
    ...await listAppointments(ctx.orgId, {
      branchId,
      resourceId: url.searchParams.get("resourceId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      from: url.searchParams.get("from") ? Number(url.searchParams.get("from")) : undefined,
      to: url.searchParams.get("to") ? Number(url.searchParams.get("to")) : undefined,
      limit: Number(url.searchParams.get("limit") ?? 200) || 200,
      offset: Number(url.searchParams.get("offset") ?? 0) || 0,
    }),
  };
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_resource"),
    branchId: z.string().min(1),
    name: z.string().min(1).max(120),
    kind: z.enum(["staff", "room", "equipment"]).optional(),
    userId: z.string().min(1).optional(),
    commissionBps: z.number().int().min(0).max(10000).optional(),
    color: z.string().max(20).optional(),
  }),
  z.object({
    action: z.literal("create_appointment"),
    resourceId: z.string().min(1),
    customerName: z.string().min(1).max(160),
    customerId: z.string().min(1).optional(),
    phone: z.string().max(40).optional(),
    productId: z.string().min(1).optional(),
    startsAt: z.number().int().positive(),
    durationMin: z.number().int().min(5).max(720).optional(),
    priceCents: z.number().int().min(0).optional(),
    notes: z.string().max(1000).optional(),
  }),
]);

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("scheduling.manage");
  const actor = { userId: ctx.userId, label: ctx.userName };
  if (body.action === "create_resource") {
    const { action: _a, ...data } = body;
    const id = await createResource(ctx.orgId, data, actor);
    return NextResponse.json({ ok: true, data: { id } }, { status: 201 });
  }
  const { action: _a, ...data } = body;
  const id = await createAppointment(ctx.orgId, data, actor);
  return NextResponse.json({ ok: true, data: { id } }, { status: 201 });
}, schema);
