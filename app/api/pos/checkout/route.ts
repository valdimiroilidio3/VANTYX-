import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import {
  getAuthContext,
  hasPermission,
  ApiError,
  assertBranchAccess,
} from "@/lib/auth/context";
import { checkout } from "@/lib/services/sales.service";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullable().optional(),
  qtyMilli: z.number().int().positive(),
  unitPriceCents: z.number().int().min(0).optional(),
  priceOverride: z.boolean().optional(),
  discountCents: z.number().int().min(0).optional(),
  discountReason: z.string().max(200).optional(),
  modifiers: z
    .array(z.object({ name: z.string().max(80), priceCents: z.number().int().min(0) }))
    .optional(),
  notes: z.string().max(300).optional(),
  serialNumbers: z.array(z.string().max(80)).optional(),
  orderItemId: z.string().nullable().optional(),
});

const checkoutSchema = z.object({
  branchId: z.string().min(1),
  terminalId: z.string().nullable().optional(),
  cashSessionId: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  channel: z.enum(["in_store", "takeaway", "delivery", "counter", "online"]).optional(),
  orderId: z.string().nullable().optional(),
  closeOrder: z.boolean().optional(),
  clientRef: z.string().min(8).max(80).nullable().optional(),
  idempotencyKey: z.string().min(8).max(120).nullable().optional(),
  lines: z.array(lineSchema).min(1),
  orderDiscountCents: z.number().int().min(0).optional(),
  payments: z
    .array(
      z.object({
        methodKey: z.string().min(1),
        amountCents: z.number().int().min(0),
        tenderedCents: z.number().int().min(0).optional(),
        status: z.enum(["pending", "confirmed"]).optional(),
        terminalRef: z.string().max(120).optional(),
      }),
    )
    .min(1),
  loyaltyRedeemPoints: z.number().int().min(0).optional(),
  loyaltyEarn: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  guestCount: z.number().int().min(1).max(999).optional(),
  supervisor: z
    .object({ userId: z.string(), pin: z.string().regex(/^\d{4,8}$/) })
    .nullable()
    .optional(),
});

export const POST = routeHandler(async (body) => {
  const ctx = await getAuthContext();
  if (!ctx) throw new ApiError(401, "Sessão inválida.", "unauthorized");
  if (!hasPermission(ctx, "pos.sell")) {
    throw new ApiError(403, "Sem permissão para vender.", "forbidden");
  }
  assertBranchAccess(ctx, body.branchId);

  // Permission checks for privileged line operations (server-side)
  const hasLineDiscount = body.lines.some((l) => (l.discountCents ?? 0) > 0);
  if (hasLineDiscount && !hasPermission(ctx, "pos.line_discount")) {
    throw new ApiError(403, "Sem permissão para descontos de linha.", "forbidden");
  }
  if ((body.orderDiscountCents ?? 0) > 0 && !hasPermission(ctx, "pos.order_discount")) {
    throw new ApiError(403, "Sem permissão para descontos globais.", "forbidden");
  }
  if (body.lines.some((l) => l.priceOverride) && !hasPermission(ctx, "pos.price_override")) {
    throw new ApiError(403, "Sem permissão para alterar preços.", "forbidden");
  }

  return checkout({
    ...body,
    actor: { userId: ctx.userId, label: ctx.userName, roleKey: ctx.roleKey },
  });
}, checkoutSchema);
