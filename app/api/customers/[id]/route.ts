import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  createDataRequest,
  getCustomerDetail,
  updateCustomer,
} from "@/lib/services/crm.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, _request, context) => {
  const ctx = await requirePermission("customers.view");
  const { id } = await context.params;
  return getCustomerDetail(ctx.orgId, id);
});

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().max(200).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    taxId: z.string().max(40).nullable().optional(),
    address: z.string().max(300).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    tags: z.array(z.string().max(40)).optional(),
    marketingConsent: z.boolean().optional(),
    customerType: z.enum(["individual", "business"]).optional(),
    priceListId: z.string().nullable().optional(),
    creditLimitCents: z.number().int().min(0).optional(),
    status: z.enum(["active", "blocked", "archived"]).optional(),
  }),
  z.object({
    action: z.literal("data_request"),
    kind: z.enum(["access", "rectification", "erasure", "portability"]),
    note: z.string().max(500).optional(),
  }),
]);

export const POST = routeHandler(async (body, _request, context) => {
  const { id } = await context.params;
  if (body.action === "update") {
    const ctx = await requirePermission("customers.manage");
    const { action: _action, ...patch } = body;
    await updateCustomer(ctx.orgId, id, patch, { userId: ctx.userId, label: ctx.userName });
    return getCustomerDetail(ctx.orgId, id);
  }
  const ctx = await requirePermission("customers.data_requests");
  const requestId = await createDataRequest(
    ctx.orgId,
    id,
    body.kind,
    body.note,
    { userId: ctx.userId, label: ctx.userName },
  );
  return { requestId };
}, schema);
