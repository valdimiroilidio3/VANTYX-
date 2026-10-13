import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { listPaymentMethods, setPaymentMethodEnabled } from "@/lib/services/cash.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async () => {
  const ctx = await requirePermission("pos.sell");
  return listPaymentMethods(ctx.orgId);
});

const schema = z.object({ methodId: z.string().min(1), enabled: z.boolean() });

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("settings.manage");
  setPaymentMethodEnabled(ctx.orgId, body.methodId, body.enabled);
  return listPaymentMethods(ctx.orgId);
}, schema);
