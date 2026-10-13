import { z } from "zod";
import { NextResponse } from "next/server";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { createProduct, listProducts } from "@/lib/services/catalog.service";

export const dynamic = "force-dynamic";

export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("products.view");
  const url = new URL(request.url);
  return listProducts(ctx.orgId, {
    search: url.searchParams.get("search") ?? undefined,
    categoryId: url.searchParams.get("categoryId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 25) || 25,
    offset: Number(url.searchParams.get("offset") ?? 0) || 0,
    sort: url.searchParams.get("sort") ?? undefined,
  });
});

const variantSchema = z.object({
  sku: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  priceCents: z.number().int().min(0).nullable().optional(),
  costCents: z.number().int().min(0).nullable().optional(),
  taxRateBps: z.number().int().min(0).max(10000).nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(["simple", "variant", "composite", "service"]).optional(),
  description: z.string().max(2000).optional(),
  categoryId: z.string().nullable().optional(),
  sku: z.string().min(1).max(60),
  basePriceCents: z.number().int().min(0),
  costCents: z.number().int().min(0).optional(),
  taxRateBps: z.number().int().min(0).max(10000).optional(),
  unit: z.string().max(10).optional(),
  saleMode: z.enum(["units", "weight"]).optional(),
  trackStock: z.boolean().optional(),
  allowNegative: z.boolean().nullable().optional(),
  status: z.enum(["active", "discontinued", "archived"]).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  supplierId: z.string().nullable().optional(),
  reorderPointMilli: z.number().int().nullable().optional(),
  reorderQtyMilli: z.number().int().nullable().optional(),
  shelfLifeDays: z.number().int().nullable().optional(),
  trackBatches: z.boolean().optional(),
  trackSerials: z.boolean().optional(),
  barcodes: z
    .array(
      z.object({
        code: z.string().min(3).max(30),
        variantId: z.string().nullable().optional(),
        embeddedKind: z.enum(["price", "weight"]).nullable().optional(),
      }),
    )
    .optional(),
  variants: z.array(variantSchema).optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("products.manage");
  const productId = createProduct(
    ctx.orgId,
    body,
    { userId: ctx.userId, label: ctx.userName },
  );
  return NextResponse.json({ ok: true, data: { productId } }, { status: 201 });
}, createSchema);
