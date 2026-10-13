import { z } from "zod";
import { NextResponse } from "next/server";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { createCustomer, listCustomers } from "@/lib/services/crm.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("customers.view");
  const url = new URL(request.url);
  return listCustomers(ctx.orgId, {
    search: url.searchParams.get("search") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 25) || 25,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
  });
});

const schema = z.object({
  name: z.string().min(1).max(200),
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
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("customers.manage");
  const customerId = createCustomer(ctx.orgId, body, {
    userId: ctx.userId,
    label: ctx.userName,
  });
  return NextResponse.json({ ok: true, data: { customerId } }, { status: 201 });
}, schema);
