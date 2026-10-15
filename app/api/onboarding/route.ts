import { cookies } from "next/headers";
import { z } from "zod";
import { routeHandler } from "@/lib/api/respond";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/context";
import { createOrganization, completeOnboarding } from "@/lib/services/org.service";
import { loginWithPassword } from "@/lib/services/session.service";
import { INDUSTRIES } from "@/lib/modules/industries";
import { passwordPolicyErrors } from "@/lib/auth/password";

export const dynamic = "force-dynamic";

const schema = z.object({
  orgName: z.string().min(2).max(120),
  legalName: z.string().max(200).optional(),
  taxId: z.string().max(40).optional(),
  industry: z.enum(INDUSTRIES),
  subIndustry: z.string().max(80).optional(),
  country: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(60).optional(),
  branchName: z.string().max(120).optional(),
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email().max(200),
  ownerPassword: z.string().min(8).max(200),
});

/** Step 1-4 combined: creates the org with industry-driven defaults and
 * logs the owner in immediately. */
export const POST = routeHandler(async (body, request) => {
  const policyErrors = passwordPolicyErrors(body.ownerPassword);
  if (policyErrors.length) {
    return Response.json(
      { ok: false, error: { message: policyErrors.join(" "), code: "weak_password" } },
      { status: 400 },
    );
  }
  const result = await createOrganization({
    name: body.orgName,
    legalName: body.legalName,
    taxId: body.taxId,
    industry: body.industry,
    subIndustry: body.subIndustry,
    country: body.country,
    currency: body.currency,
    timezone: body.timezone,
    branchName: body.branchName,
    ownerName: body.ownerName,
    ownerEmail: body.ownerEmail,
    ownerPassword: body.ownerPassword,
  });

  const login = await loginWithPassword(body.ownerEmail, body.ownerPassword, {
    userAgent: request.headers.get("user-agent") ?? undefined,
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, login.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });

  return { ...result, authenticated: true };
}, schema);

/** Finishes the wizard (marks onboarding complete). */
export const PATCH = routeHandler(async (_body, request) => {
  const { getAuthContext } = await import("@/lib/auth/context");
  const ctx = await getAuthContext();
  if (!ctx) {
    return Response.json({ ok: false, error: { message: "Não autenticado.", code: "unauthorized" } }, { status: 401 });
  }
  void request;
  await completeOnboarding(ctx.orgId, { userId: ctx.userId, label: ctx.userName });
  return { completed: true };
});
