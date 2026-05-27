import { sanitizeJsonForPostgres } from "../lib/db-sanitize.js";
import type { FastifyRequest } from "fastify";

export type ProxyBody = {
  model?: string;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  [key: string]: unknown;
};

export const proxiedEndpoints = new Set([
  "/v1/chat/completions",
  "/v1/embeddings",
  "/v1/completions",
  "/v1/images/generations",
]);

export function normalizeEndpoint(endpoint: string) {
  if (endpoint.startsWith("/v1/")) {
    return endpoint;
  }

  if (
    endpoint === "/responses" ||
    endpoint.startsWith("/responses/") ||
    endpoint === "/response" ||
    endpoint.startsWith("/response/")
  ) {
    const normalizedEndpoint =
      endpoint === "/response" || endpoint.startsWith("/response/")
        ? endpoint.replace(/^\/response/, "/responses")
        : endpoint;
    return `/v1${normalizedEndpoint}`;
  }

  if (
    endpoint === "/chat/completions" ||
    endpoint === "/embeddings" ||
    endpoint === "/completions" ||
    endpoint === "/images/generations"
  ) {
    return `/v1${endpoint}`;
  }

  return endpoint;
}

export function normalizeRequestUrl(url: string) {
  const [path = "", query] = url.split("?");
  const normalizedPath = normalizeEndpoint(path);
  return query ? `${normalizedPath}?${query}` : normalizedPath;
}

export function isSupportedEndpoint(endpoint: string) {
  return proxiedEndpoints.has(endpoint) || isResponsesEndpoint(endpoint);
}

export function isAllowedMethod(endpoint: string, method: string) {
  if (!isResponsesEndpoint(endpoint)) {
    return method === "POST";
  }

  if (endpoint === "/v1/responses") {
    return method === "POST";
  }

  if (endpoint === "/v1/responses/compact") {
    return method === "POST";
  }

  if (endpoint === "/v1/responses/input_tokens") {
    return method === "POST";
  }

  if (/^\/v1\/responses\/[^/]+\/cancel$/.test(endpoint)) {
    return method === "POST";
  }

  if (/^\/v1\/responses\/[^/]+\/input_items$/.test(endpoint)) {
    return method === "GET";
  }

  return (
    /^\/v1\/responses\/[^/]+$/.test(endpoint) &&
    (method === "GET" || method === "DELETE")
  );
}

export function shouldReturnApiKeyNotice(endpoint: string, method: string) {
  return method === "POST" && isNoticeResponseEndpoint(endpoint);
}

export function isNoticeResponseEndpoint(endpoint: string) {
  return (
    endpoint === "/v1/chat/completions" ||
    endpoint === "/v1/completions" ||
    endpoint === "/v1/responses"
  );
}

export function isNoticeStreamEndpoint(endpoint: string) {
  return isNoticeResponseEndpoint(endpoint);
}

export function shouldCheckNewRequestLimits(endpoint: string, method: string) {
  return (
    method === "POST" &&
    (endpoint === "/v1/chat/completions" ||
      endpoint === "/v1/completions" ||
      endpoint === "/v1/embeddings" ||
      endpoint === "/v1/images/generations" ||
      endpoint === "/v1/responses")
  );
}

export function isBillableEndpoint(endpoint: string, method: string) {
  return (
    method === "POST" &&
    (endpoint === "/v1/chat/completions" ||
      endpoint === "/v1/completions" ||
      endpoint === "/v1/embeddings" ||
      endpoint === "/v1/images/generations" ||
      endpoint === "/v1/responses" ||
      endpoint === "/v1/responses/compact" ||
      endpoint === "/v1/responses/input_tokens")
  );
}

export function inferModelFromEndpoint(endpoint: string) {
  if (endpoint.startsWith("/v1/responses")) {
    return "responses-meta";
  }

  return "unknown";
}

export function isResponsesEndpoint(endpoint: string) {
  return (
    endpoint === "/v1/responses" ||
    endpoint === "/v1/responses/compact" ||
    endpoint === "/v1/responses/input_tokens" ||
    /^\/v1\/responses\/[^/]+$/.test(endpoint) ||
    /^\/v1\/responses\/[^/]+\/cancel$/.test(endpoint) ||
    /^\/v1\/responses\/[^/]+\/input_items$/.test(endpoint)
  );
}

export function shouldStreamResponse(
  upstreamResponse: Response,
  body: ProxyBody,
  requestUrl: string,
  endpoint?: string,
) {
  if (endpoint === "/v1/responses/compact") {
    return false;
  }

  const contentType = upstreamResponse.headers.get("content-type") ?? "";

  return (
    requestAsksForStream(body, requestUrl) ||
    contentType.includes("text/event-stream")
  );
}

export function requestAsksForStream(body: ProxyBody, requestUrl: string) {
  const url = new URL(requestUrl, "http://gateway.local");
  return body.stream === true || url.searchParams.get("stream") === "true";
}

export function redactBodyForLog(body: ProxyBody) {
  return sanitizeJsonForPostgres(redactLogValue(body));
}

const logSensitiveKeyPattern =
  /(?:api[_-]?key|authorization|token|secret|password|credential|cookie|session|encrypted_content)$/i;
const maxLoggedStringLength = 1200;
const maxLoggedArrayItems = 12;
const maxLoggedObjectKeys = 80;
const maxLoggedDepth = 8;

function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > maxLoggedDepth) {
    return "[TRUNCATED_DEPTH]";
  }

  if (typeof value === "string") {
    return truncateLogString(value);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const items =
      value.length > maxLoggedArrayItems
        ? value.slice(-maxLoggedArrayItems)
        : value;
    const redacted = items.map((item) => redactLogValue(item, depth + 1));
    return value.length > maxLoggedArrayItems
      ? [
          {
            omittedItems: value.length - maxLoggedArrayItems,
            reason: "log_array_truncated",
          },
          ...redacted,
        ]
      : redacted;
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  const entries = Object.entries(value).filter(([, item]) => item !== undefined);
  const visibleEntries = entries.slice(0, maxLoggedObjectKeys);
  const redacted = Object.fromEntries(
    visibleEntries.map(([key, item]) => [
      key,
      logSensitiveKeyPattern.test(key)
        ? "[REDACTED]"
        : redactLogValue(item, depth + 1),
    ]),
  );

  if (entries.length > maxLoggedObjectKeys) {
    redacted.__logTruncatedKeys = entries.length - maxLoggedObjectKeys;
  }

  return redacted;
}

function truncateLogString(value: string) {
  if (/^data:[^;]+;base64,/.test(value)) {
    return `[REDACTED_DATA_URL length=${value.length}]`;
  }

  if (value.length <= maxLoggedStringLength) {
    return value;
  }

  return `${value.slice(0, maxLoggedStringLength)}...[truncated ${value.length - maxLoggedStringLength} chars]`;
}

export function pickHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).find(Boolean) ?? null;
  }

  return value?.trim() || null;
}

export function pickForwardedFor(value: string | string[] | undefined) {
  const raw = pickHeaderValue(value);
  if (!raw) {
    return null;
  }

  return (
    raw
      .split(",")
      .map((item) => item.trim())
      .find(Boolean) ?? null
  );
}

export function getClientIp(request: FastifyRequest) {
  const headers = request.headers;

  const headerCandidates = [
    pickHeaderValue(headers["cf-connecting-ip"]),
    pickHeaderValue(headers["x-real-ip"]),
    pickHeaderValue(headers["x-client-ip"]),
    pickHeaderValue(headers["true-client-ip"]),
    pickForwardedFor(headers["x-forwarded-for"]),
  ];

  for (const candidate of headerCandidates) {
    if (candidate) {
      return candidate;
    }
  }

  return request.ip || request.socket.remoteAddress || null;
}

export function buildUpstreamBody(
  endpoint: string,
  body: ProxyBody,
  provider: { name: string; baseUrl: string },
) {
  let upstreamBody = body;

  if (endpoint === "/v1/responses") {
    upstreamBody = normalizeResponsesCreateBody(upstreamBody);
  }

  if (endpoint === "/v1/responses/compact" && isPlainObject(upstreamBody)) {
    upstreamBody = { ...upstreamBody };
    delete upstreamBody.stream;
    delete upstreamBody.stream_options;
  }

  if (
    endpoint === "/v1/responses" &&
    needsResponsesCompatibilityBody(provider)
  ) {
    upstreamBody = buildResponsesCompatibilityBody(upstreamBody);
  }

  if (!upstreamBody.stream || endpoint.startsWith("/v1/responses")) {
    return upstreamBody;
  }

  return {
    ...upstreamBody,
    stream_options: {
      ...(upstreamBody.stream_options ?? {}),
      include_usage: true,
    },
  };
}

function normalizeResponsesCreateBody(body: ProxyBody): ProxyBody {
  const normalized: ProxyBody = { ...body };

  if (!Object.prototype.hasOwnProperty.call(normalized, "instructions")) {
    normalized.instructions = "";
  }

  return normalized;
}

function needsResponsesCompatibilityBody(provider: {
  name: string;
  baseUrl: string;
}) {
  try {
    const host = new URL(provider.baseUrl).hostname.toLowerCase();
    return (
      host === "share-api.com" ||
      host.endsWith(".share-api.com") ||
      host === "toltol.me" ||
      host.endsWith(".toltol.me")
    );
  } catch {
    return (
      provider.name.includes("share-api.com") ||
      provider.baseUrl.includes("share-api.com") ||
      provider.name.includes("toltol.me") ||
      provider.baseUrl.includes("toltol.me")
    );
  }
}

function buildResponsesCompatibilityBody(body: ProxyBody): ProxyBody {
  const normalized: ProxyBody = { ...body };

  delete normalized.max_output_tokens;
  delete normalized.output;

  if (typeof normalized.input === "string") {
    normalized.input = [{ role: "user", content: normalized.input }];
  }

  return normalized;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const UPSTREAM_RESPONSE_MAX_BYTES = 5 * 1024 * 1024; // 5MB
export const UPSTREAM_COMPACT_RESPONSE_MAX_BYTES = 16 * 1024 * 1024; // 16MB

type SafeBodyResult =
  | { json: unknown; text: string }
  | { error: { message: string; statusCode: number } };

export function getUpstreamResponseMaxBytes(endpoint: string) {
  return endpoint === "/v1/responses/compact"
    ? UPSTREAM_COMPACT_RESPONSE_MAX_BYTES
    : UPSTREAM_RESPONSE_MAX_BYTES;
}

export async function safeReadUpstreamBody(
  response: Response,
  options?: {
    logger?: { warn: (value: unknown, message?: string) => void };
    maxBytes?: number;
  },
): Promise<SafeBodyResult> {
  const maxBytes = options?.maxBytes ?? UPSTREAM_RESPONSE_MAX_BYTES;
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const size = Number(contentLength);
    if (Number.isFinite(size) && size > maxBytes) {
      options?.logger?.warn(
        { contentLength: size, maxBytes },
        "Upstream response body too large, rejecting",
      );
      return {
        error: {
          message: `Upstream response body too large (${(size / 1024 / 1024).toFixed(1)}MB)`,
          statusCode: 502,
        },
      };
    }
  }

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    return {
      error: {
        message: `Failed to read upstream response body: ${err instanceof Error ? err.message : "unknown error"}`,
        statusCode: 502,
      },
    };
  }

  if (text.length > maxBytes) {
    options?.logger?.warn(
      { bodyBytes: text.length, maxBytes },
      "Upstream response body exceeds limit after reading, rejecting",
    );
    return {
      error: {
        message: `Upstream response body too large (${(text.length / 1024 / 1024).toFixed(1)}MB)`,
        statusCode: 502,
      },
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return { json: JSON.parse(text), text };
    } catch (_err) {
      options?.logger?.warn(
        { bodyBytes: text.length },
        "Upstream returned invalid JSON, returning as text",
      );
    }
  }

  return { json: text, text };
}
