import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/auth/context";

/** Uniform JSON envelope for all API routes. */

export function okJson<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function errorJson(
  message: string,
  status: number,
  code = "error",
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { message, code, details } },
    { status },
  );
}

export interface RouteContext {
  /** All dynamic segments in this app are `[id]`. */
  params: Promise<{ id: string } & Record<string, string>>;
}

/**
 * Wraps a route handler: validates/parses with zod schemas, converts
 * ApiError/ZodError into structured JSON, logs unexpected errors and
 * returns a generic 500 (no stack traces leak to clients).
 * Dynamic route params are passed as the third argument.
 */
export function routeHandler<Body>(
  handler: (
    body: Body,
    request: Request,
    context: RouteContext,
  ) => Promise<unknown> | unknown,
  schema?: z.ZodType<Body>,
) {
  // NOTE: the wrapper declares the loosest context type Next accepts for ANY
  // route (static routes get `params: Promise<{}>`, dynamic ones concrete
  // params). Declaring RouteContext here would fail Next's build-time route
  // type check for static routes (parameter contravariance).
  return async (
    request: Request,
    context: { params: Promise<object> },
  ): Promise<NextResponse> => {
    try {
      let body = undefined as Body;
      if (schema) {
        let raw: unknown = {};
        try {
          raw = await request.json();
        } catch {
          raw = {};
        }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          const issues = parsed.error.issues.map(
            (i) => `${i.path.join(".") || "body"}: ${i.message}`,
          );
          return errorJson(
            `Dados inválidos: ${issues.join("; ")}`,
            400,
            "validation_error",
            parsed.error.issues,
          );
        }
        body = parsed.data;
      }
      const result = await handler(body, request, context as unknown as RouteContext);
      if (result instanceof NextResponse) return result;
      return okJson(result);
    } catch (err) {
      if (err instanceof ApiError) {
        return errorJson(err.message, err.status, err.code, err.details);
      }
      if (err instanceof z.ZodError) {
        return errorJson("Dados inválidos.", 400, "validation_error", err.issues);
      }
      console.error("[api] unexpected error:", err);
      return errorJson(
        "Erro interno. A operação não foi concluída — verifique os logs do servidor.",
        500,
        "internal_error",
      );
    }
  };
}

/* --------------------------- Rate limiting --------------------------- */

/**
 * In-memory sliding-window rate limiter (single-node deployments).
 * For multi-node production, swap with a Redis-backed limiter — the
 * interface stays the same.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const bucket = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (bucket.length >= limit) {
    const retryAfterMs = windowMs - (now - (bucket[0] ?? now));
    buckets.set(key, bucket);
    return { allowed: false, retryAfterMs };
  }
  bucket.push(now);
  buckets.set(key, bucket);
  // Opportunistic cleanup to bound memory
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      const fresh = v.filter((t) => now - t < windowMs);
      if (fresh.length === 0) buckets.delete(k);
      else buckets.set(k, fresh);
    }
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
