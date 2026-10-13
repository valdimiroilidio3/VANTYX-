import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { requirePermission } from "@/lib/auth/context";
import {
  applyIndustryChange,
  previewIndustryChange,
} from "@/lib/services/org.service";
import { INDUSTRIES } from "@/lib/modules/industries";

export const dynamic = "force-dynamic";

const schema = z.object({
  industry: z.enum(INDUSTRIES),
  /** Explicit confirmation text ("MUDAR-<INDUSTRY>") required to apply. */
  confirmation: z.string().max(80).optional(),
});

/** POST without confirmation → preview. With confirmation → apply. */
export const POST = routeHandler(async (body) => {
  const ctx = await requirePermission("profile.manage");
  if (!body.confirmation) {
    return {
      mode: "preview" as const,
      preview: previewIndustryChange(ctx.orgId, body.industry),
    };
  }
  const preview = applyIndustryChange(ctx.orgId, body.industry, body.confirmation, {
    userId: ctx.userId,
    label: ctx.userName,
  });
  return { mode: "applied" as const, preview };
}, schema);
