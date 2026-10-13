import { cookies } from "next/headers";
import { z } from "zod";
import { clientIp, errorJson, rateLimit, routeHandler } from "@/lib/api/respond";
import { SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth/context";
import { loginWithPassword } from "@/lib/services/session.service";
import { getOrgProfile } from "@/lib/services/org.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

export const POST = routeHandler(async (body, request) => {
  const ip = clientIp(request);
  const limited = rateLimit(`login:${ip}`, 10, 5 * 60 * 1000);
  if (!limited.allowed) {
    return errorJson(
      `Muitas tentativas. Tente novamente em ${Math.ceil(limited.retryAfterMs / 1000)}s.`,
      429,
      "rate_limited",
    );
  }
  const result = loginWithPassword(body.email, body.password, {
    ip,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  const profile = getOrgProfile(result.orgId);
  return {
    userId: result.userId,
    orgId: result.orgId,
    orgName: profile.orgName,
    industry: profile.industry,
    onboarded: profile.onboardedAt != null,
  };
}, schema);
