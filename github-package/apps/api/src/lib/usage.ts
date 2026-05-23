import type { Usage } from "../types.js";

type UsageLike = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  input_tokens_details?: {
    cached_tokens?: number;
  };
};

export function normalizeUsage(raw: unknown): Usage {
  const usage = (raw ?? {}) as UsageLike;
  const totalInputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const cachedInputTokens =
    totalInputTokens > 0
      ? Math.min(
          usage.prompt_tokens_details?.cached_tokens ??
            usage.input_tokens_details?.cached_tokens ??
            0,
          totalInputTokens,
        )
      : 0;
  const inputTokens = Math.max(totalInputTokens - cachedInputTokens, 0);
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  const totalTokens =
    usage.total_tokens && usage.total_tokens > 0
      ? usage.total_tokens
      : inputTokens + cachedInputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    raw,
  };
}

export function usageFromOpenAIResponse(responseBody: unknown): Usage {
  const body = responseBody as {
    usage?: unknown;
    response?: { usage?: unknown; input_tokens?: number };
    input_tokens?: number;
  };
  return normalizeUsage(
    body.usage ??
      body.response?.usage ??
      (typeof body.input_tokens === "number"
        ? { input_tokens: body.input_tokens, output_tokens: 0, total_tokens: body.input_tokens }
        : undefined) ??
      (typeof body.response?.input_tokens === "number"
        ? {
            input_tokens: body.response.input_tokens,
            output_tokens: 0,
            total_tokens: body.response.input_tokens,
          }
        : undefined),
  );
}

export function usageFromStreamChunk(chunk: unknown): Usage | null {
  const body = chunk as { usage?: unknown; response?: { usage?: unknown } };
  const rawUsage = body.usage ?? body.response?.usage;

  if (!rawUsage) {
    return null;
  }

  return normalizeUsage(rawUsage);
}
