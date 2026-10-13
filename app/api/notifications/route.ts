import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  listNotifications,
  markAllRead,
  markNotificationRead,
} from "@/lib/services/notification.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("notifications.view");
  const url = new URL(request.url);
  return listNotifications(ctx.orgId, {
    unreadOnly: url.searchParams.get("unread") === "1",
    limit: Number(url.searchParams.get("limit") ?? 30) || 30,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
  });
});

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), notificationId: z.string().min(1) }),
  z.object({ action: z.literal("read_all") }),
]);

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("notifications.view");
  if (body.action === "read") {
    markNotificationRead(ctx.orgId, body.notificationId);
  } else {
    markAllRead(ctx.orgId);
  }
  return listNotifications(ctx.orgId, { limit: 30 });
}, schema);
