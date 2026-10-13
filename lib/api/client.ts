"use client";

/** Typed fetch client for the VANTYX API envelope {ok, data | error}. */

export interface ApiErrorBody {
  message: string;
  code: string;
  details?: unknown;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = "ApiClientError";
  }
  get code(): string {
    return this.body.code;
  }
  get details(): unknown {
    return this.body.details;
  }
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  let url = path;
  if (init.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const res = await fetch(url, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: init.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; data?: T; error?: ApiErrorBody }
    | null;
  if (!res.ok || !json || json.ok !== true) {
    throw new ApiClientError(
      res.status,
      json?.error ?? { message: `Erro HTTP ${res.status}`, code: "http_error" },
    );
  }
  return json.data as T;
}

/** True when the browser is offline — used by the POS outbox. */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
