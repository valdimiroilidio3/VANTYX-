import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import { searchForPos } from "@/lib/services/catalog.service";
import { getOrgProfile } from "@/lib/services/org.service";
import { parseEmbeddedBarcode, eanChecksumValid } from "@/lib/domain/barcode";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().min(1).max(80),
  branchId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * POS instant search. When the query is a 13-digit code that is NOT a
 * known barcode but matches the configured embedded prefix (scale/label
 * barcodes), it is parsed and the embedded price/weight is returned so
 * the checkout can honor the printed label value.
 */
export const GET = routeHandler(async (_body, request) => {
  const ctx = await requirePermission("pos.sell");
  const url = new URL(request.url);
  const parsedQuery = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    branchId: url.searchParams.get("branchId") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    return { results: [], embedded: null };
  }
  const { q, branchId, limit } = parsedQuery.data;

  let warehouseId: string | undefined;
  if (branchId) {
    const wh = (await getDb()
      .prepare(`SELECT id FROM warehouses WHERE org_id = ? AND branch_id = ? AND is_default = 1 LIMIT 1`)
      .get(ctx.orgId, branchId)) as { id: string } | undefined;
    warehouseId = wh?.id;
  }

  const results = await searchForPos(ctx.orgId, q, { branchWarehouseId: warehouseId, limit });

  // Embedded scale/label barcode handling
  let embedded: { kind: "price" | "weight"; productCode: string; value: number; productId?: string; productName?: string } | null = null;
  if (/^\d{13}$/.test(q) && results.length === 0) {
    const profile = await getOrgProfile(ctx.orgId);
    const settings = profile.settings;
    const prefixes = (settings.barcodeEmbeddedPrefixes as string[] | undefined) ?? [];
    const mode = (settings.barcodeEmbeddedMode as "price" | "weight" | undefined) ?? "price";
    if (prefixes.length && eanChecksumValid(q)) {
      const parsedEmbedded = parseEmbeddedBarcode(q, { prefixes, mode });
      if (parsedEmbedded) {
        embedded = { ...parsedEmbedded };
        // Resolve internal product code (SKU or internal 5-digit code)
        const product = (await getDb()
          .prepare(
            `SELECT id, name FROM products WHERE org_id = ? AND (sku = ? OR substr(replace(sku,'-',''), -5) = ?) LIMIT 1`,
          )
          .get(ctx.orgId, parsedEmbedded.productCode, parsedEmbedded.productCode)) as
          | { id: string; name: string }
          | undefined;
        if (product) {
          embedded.productId = product.id;
          embedded.productName = product.name;
          results.push(
            ...await searchForPos(ctx.orgId, product.name, {
              branchWarehouseId: warehouseId,
              limit: 3,
            }),
          );
        }
      }
    }
  }

  return { results, embedded };
});
