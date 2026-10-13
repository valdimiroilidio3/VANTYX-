import { z } from "zod";
import { NextResponse } from "next/server";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { exportProductsCsv, importProductsCsv } from "@/lib/services/catalog.service";

export const dynamic = "force-dynamic";

/** GET = export CSV (products.export → reports.export fallback handled by permission). */
export const GET = routeHandler(async () => {
  const ctx = await requirePermission("products.view");
  const csv = exportProductsCsv(ctx.orgId);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="vantyx-products-${Date.now()}.csv"`,
    },
  });
});

const importSchema = z.object({ csv: z.string().min(10).max(4_000_000) });

/** POST = assisted import (upsert by SKU). */
export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("products.import");
  return importProductsCsv(ctx.orgId, body.csv, {
    userId: ctx.userId,
    label: ctx.userName,
  });
}, importSchema);
