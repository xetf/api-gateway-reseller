import { usageFromStreamChunk } from "../lib/usage.js";
import type { Usage } from "../types.js";
import {
  isPlainObject,
  isResponsesEndpoint,
  type ProxyBody,
} from "./proxy-request-utils.js";

export type EstimatedUsageReason =
  | "missing_stream_usage"
  | "missing_compact_stream_usage"
  | "missing_response_usage"
  | "missing_compact_response_usage";

export function parseUsageFromSseBuffer(buffer: string): Usage | null {
  let found: Usage | null = null;

  for (const parsed of parseSseJsonPayloads(buffer)) {
    found = usageFromStreamChunk(parsed) ?? found;
  }

  return found;
}

export function estimateUsageFromResponse(
  endpoint: string,
  requestBody: ProxyBody,
  responseBody: unknown,
): Usage | null {
  if (!isResponsesEndpoint(endpoint)) {
    return null;
  }

  const outputText = extractResponseOutputTextForTokenEstimate(responseBody);
  const canEstimate =
    outputText.trim() ||
    canEstimateUsageFromCompactResponse(endpoint, responseBody);

  if (!canEstimate) {
    return null;
  }

  return buildEstimatedUsage(
    requestBody,
    outputText,
    endpoint === "/v1/responses/compact"
      ? "missing_compact_response_usage"
      : "missing_response_usage",
  );
}

export function estimateUsageFromStream(
  endpoint: string,
  requestBody: ProxyBody,
  buffer: string,
): Usage | null {
  const outputText = extractOutputTextFromSseBuffer(buffer);

  if (
    !outputText.trim() &&
    !canEstimateUsageFromCompactStream(endpoint, buffer)
  ) {
    return null;
  }

  return buildEstimatedUsage(
    requestBody,
    outputText,
    outputText.trim() ? "missing_stream_usage" : "missing_compact_stream_usage",
  );
}

export function createUnmeteredMissingUsage(reason: string): Usage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    raw: {
      estimated: false,
      unmetered: true,
      reason,
      input_tokens: 0,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens: 0,
      output_tokens_details: {
        reasoning_tokens: 0,
      },
      total_tokens: 0,
    },
  };
}

export function sseBufferHasCompletedResponse(buffer: string) {
  return parseSseJsonPayloads(buffer).some(isCompletedResponsePayload);
}

export function hasEncryptedContent(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasEncryptedContent);
  }

  if (!isPlainObject(value)) {
    return false;
  }

  if (typeof value.encrypted_content === "string" && value.encrypted_content) {
    return true;
  }

  return Object.values(value).some(hasEncryptedContent);
}

export function isCompletedResponsePayload(payload: unknown) {
  if (!isPlainObject(payload)) {
    return false;
  }

  if (payload.type === "response.completed") {
    return true;
  }

  if (
    isPlainObject(payload.response) &&
    payload.response.status === "completed"
  ) {
    return true;
  }

  return payload.object === "response" && payload.status === "completed";
}

export function sseBufferHasOutputToken(buffer: string) {
  return parseSseJsonPayloads(buffer).some(streamChunkHasOutputToken);
}

export function parseSseJsonPayloads(buffer: string) {
  const payloads: unknown[] = [];

  for (const event of buffer.split("\n\n")) {
    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    for (const data of dataLines) {
      if (!data || data === "[DONE]") {
        continue;
      }

      try {
        payloads.push(JSON.parse(data));
      } catch {
        continue;
      }
    }
  }

  return payloads;
}

function buildEstimatedUsage(
  requestBody: ProxyBody,
  outputText: string,
  reason: EstimatedUsageReason,
): Usage | null {
  const inputText = extractTextForTokenEstimate(requestBody);
  const inputTokens = estimateTokenCount(inputText);
  const outputTokens = estimateTokenCount(outputText);
  const totalTokens = inputTokens + outputTokens;

  if (totalTokens <= 0) {
    return null;
  }

  return {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    totalTokens,
    raw: {
      estimated: true,
      reason,
      input_tokens: inputTokens,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens: outputTokens,
      output_tokens_details: {
        reasoning_tokens: 0,
      },
      total_tokens: totalTokens,
    },
  };
}

function canEstimateUsageFromCompactResponse(
  endpoint: string,
  responseBody: unknown,
) {
  return (
    endpoint === "/v1/responses/compact" &&
    (hasEncryptedContent(responseBody) ||
      isCompletedResponsePayload(responseBody) ||
      (isPlainObject(responseBody) && responseBody.status === "completed"))
  );
}

function canEstimateUsageFromCompactStream(endpoint: string, buffer: string) {
  return (
    endpoint === "/v1/responses/compact" &&
    parseSseJsonPayloads(buffer).some(
      (payload) =>
        hasEncryptedContent(payload) || isCompletedResponsePayload(payload),
    )
  );
}

function extractOutputTextFromSseBuffer(buffer: string) {
  return parseSseJsonPayloads(buffer)
    .map(extractStreamOutputText)
    .filter(Boolean)
    .join("");
}

function extractStreamOutputText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  const value = chunk as {
    delta?: unknown;
    output_text?: unknown;
    choices?: Array<{
      delta?: { content?: unknown };
      text?: unknown;
    }>;
  };

  if (typeof value.delta === "string") {
    return value.delta;
  }

  if (typeof value.output_text === "string") {
    return value.output_text;
  }

  if (Array.isArray(value.choices)) {
    return value.choices
      .map((choice) =>
        typeof choice.delta?.content === "string"
          ? choice.delta.content
          : typeof choice.text === "string"
            ? choice.text
            : "",
      )
      .join("");
  }

  return "";
}

function extractResponseOutputTextForTokenEstimate(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map(extractResponseOutputTextForTokenEstimate)
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text;
  }

  const parts: string[] = [];
  for (const key of [
    "response",
    "output",
    "content",
    "message",
    "choices",
    "tool_calls",
    "function_call",
    "arguments",
    "text",
    "delta",
  ]) {
    parts.push(extractResponseOutputTextForTokenEstimate(record[key]));
  }

  return parts.filter(Boolean).join("\n");
}

function extractTextForTokenEstimate(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(extractTextForTokenEstimate).filter(Boolean).join("\n");
  }

  if (typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  const parts: string[] = [];

  for (const key of [
    "content",
    "text",
    "output",
    "output_text",
    "arguments",
    "instructions",
    "prompt",
    "input",
    "input_text",
    "messages",
    "tool_calls",
    "tools",
    "function",
  ]) {
    parts.push(extractTextForTokenEstimate(record[key]));
  }

  return parts.filter(Boolean).join("\n");
}

function estimateTokenCount(text: string) {
  const normalized = text.trim();

  if (!normalized) {
    return 0;
  }

  const cjkChars = normalized.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const nonCjkText = normalized.replace(/[\u3400-\u9fff]/g, " ");
  const wordLikeTokens =
    nonCjkText.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)?.length ?? 0;
  return Math.max(1, Math.ceil(cjkChars * 1.15 + wordLikeTokens * 0.75));
}

function streamChunkHasOutputToken(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== "object") {
    return false;
  }

  const event = chunk as Record<string, unknown>;

  if (typeof event.delta === "string" && event.delta.length > 0) {
    return true;
  }

  if (typeof event.text === "string" && event.text.length > 0) {
    return true;
  }

  if (Array.isArray(event.choices)) {
    return event.choices.some((choice) => {
      if (!choice || typeof choice !== "object") {
        return false;
      }

      const item = choice as Record<string, unknown>;
      return (
        textLikeValueHasContent(item.text) ||
        textLikeValueHasContent(item.delta)
      );
    });
  }

  return textLikeValueHasContent(event.output);
}

function textLikeValueHasContent(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length > 0;
  }

  if (Array.isArray(value)) {
    return value.some(textLikeValueHasContent);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    textLikeValueHasContent(record.content) ||
    textLikeValueHasContent(record.text) ||
    textLikeValueHasContent(record.delta) ||
    textLikeValueHasContent(record.tool_calls) ||
    textLikeValueHasContent(record.function_call) ||
    textLikeValueHasContent(record.function) ||
    textLikeValueHasContent(record.arguments)
  );
}
