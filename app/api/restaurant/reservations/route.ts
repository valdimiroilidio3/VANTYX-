import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  createReservation,
  listReservations,
  setReservationStatus,
} from "@/lib/services/restaurant.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("restaurant.reservations");
  const url = new URL(request.url);
  const branchId = url.searchParams.get("branchId");
  const day = url.searchParams.get("day") ? Number(url.searchParams.get("day")) : Date.now();
  if (!branchId) return { reservations: [] };
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = start.getTime() + 86_400_000;
  return { reservations: listReservations(ctx.orgId, branchId, start.getTime(), end) };
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    branchId: z.string().min(1),
    tableId: z.string().nullable().optional(),
    customerId: z.string().nullable().optional(),
    customerName: z.string().min(1).max(120),
    phone: z.string().max(40).nullable().optional(),
    partySize: z.number().int().min(1).max(99),
    reservedFor: z.number().int().positive(),
    note: z.string().max(300).nullable().optional(),
  }),
  z.object({
    action: z.literal("status"),
    reservationId: z.string().min(1),
    status: z.enum(["seated", "completed", "cancelled", "no_show"]),
  }),
]);

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("restaurant.reservations");
  if (body.action === "create") {
    const { action: _a, ...data } = body;
    return { reservationId: createReservation(ctx.orgId, data) };
  }
  return setReservationStatus(ctx.orgId, body.reservationId, body.status);
}, schema);
