import { z } from "zod";
import { NextResponse } from "next/server";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { createSupplier, listSuppliers } from "@/lib/services/purchasing.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("suppliers.view");
  const url = new URL(request.url);
  return listSuppliers(ctx.orgId, {
    search: url.searchParams.get("search") ?? undefined,
  });
});

const schema = z.object({
  name: z.string().min(1).max(200),
  contactName: z.string().max(120).nullable().optional(),
  email: z.string().email().max(200).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  taxId: z.string().max(40).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  paymentTerms: z.string().max(120).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("suppliers.manage");
  const supplierId = await createSupplier(ctx.orgId, body);
  return NextResponse.json({ ok: true, data: { supplierId } }, { status: 201 });
}, schema);
