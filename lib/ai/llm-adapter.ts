/**
 * Optional LLM adapter — the platform NEVER requires an AI provider.
 * Without credentials (env-based, never client-side), the assistant runs
 * on the deterministic engine and the UI states exactly that.
 *
 * Security: secrets live only in server environment variables; tenant
 * data passed to a provider must be pre-filtered by the caller using the
 * requesting user's permissions (see nlSearch). No card data, tokens or
 * passwords may ever be included in prompts.
 */

export interface LlmAdapterConfig {
  provider: "openai_compatible";
  baseUrl: string;
  apiKeyEnv: string; // NAME of the env var, never the value
  model: string;
}

export interface LlmAvailability {
  available: boolean;
  reason?: string;
  provider?: string;
  model?: string;
}

export function getLlmAvailability(): LlmAvailability {
  const apiKey = process.env.VANTYX_LLM_API_KEY;
  if (!apiKey) {
    return {
      available: false,
      reason:
        "Fornecedor LLM não configurado (VANTYX_LLM_API_KEY ausente). O assistente opera em modo determinístico completo.",
    };
  }
  return {
    available: true,
    provider: "openai_compatible",
    model: process.env.VANTYX_LLM_MODEL ?? "gpt-4o-mini",
  };
}

export interface LlmRequest {
  systemPrompt: string;
  userMessage: string;
  /** Authorized data context (already permission-filtered). */
  contextJson?: string;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * Calls the configured OpenAI-compatible endpoint. Returns null when no
 * credentials exist — callers must degrade to the deterministic engine
 * and label the output accordingly. Timeouts are enforced (10s).
 */
export async function callLlm(request: LlmRequest): Promise<LlmResponse | null> {
  const availability = getLlmAvailability();
  if (!availability.available) return null;
  const apiKey = process.env.VANTYX_LLM_API_KEY!;
  const baseUrl = process.env.VANTYX_LLM_BASE_URL ?? "https://api.openai.com/v1";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: availability.model,
        max_tokens: request.maxTokens ?? 700,
        messages: [
          { role: "system", content: request.systemPrompt },
          {
            role: "user",
            content: request.contextJson
              ? `${request.userMessage}\n\nDADOS AUTORIZADOS (JSON):\n${request.contextJson}`
              : request.userMessage,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[llm] provider error ${res.status}`);
      return null;
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      model: String(availability.model),
      usage: json.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  } catch (err) {
    console.error("[llm] request failed:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
