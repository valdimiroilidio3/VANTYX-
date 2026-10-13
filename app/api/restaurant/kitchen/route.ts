import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  listKitchenTickets,
  updateTicketStatus,
} from "@/lib/services/restaurant.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("restaurant.kitchen");
  const url = new URL(request.url);
  return listKitchenTickets(ctx.orgId, {
    station: url.searchParams.get("station") ?? undefined,
    includeDelivered: url.searchParams.get("includeDelivered") === "1",
  });
});

const schema = z.object({
  ticketId: z.string().min(1),
  status: z.enum(["preparing", "ready", "delivered"]),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("restaurant.kitchen");
  updateTicketStatus(ctx.orgId, body.ticketId, body.status);
  return { updated: body.ticketId };
}, schema);
