import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { receiptViewModel } from "@/lib/services/sales.service";

export const dynamic = "force-dynamic";

/** Reprint is permission-gated (pos.reprint); data-only endpoint. */
export const GET = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("pos.reprint");
  const { id } = await context.params;
  return receiptViewModel(ctx.orgId, id);
});
