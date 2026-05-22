import { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@gateway/db";
import { sendApiError } from "../lib/errors.js";
import { usageFromOpenAIResponse, usageFromStreamChunk } from "../lib/usage.js";
import { chargeForRequest, ensureWalletCanStart, markRequestFailed } from "../services/billing.js";
import { requireApiKey } from "../services/auth.js";
import { buildUpstreamUrl, getDefaultProvider, getProviderForModel } from "../services/upstream.js";
import type { ApiRequestWithUser, Usage } from "../types.js";

const proxiedEndpoints = new Set([
  "/v1/chat/completions",
  "/v1/embeddings",
  "/v1/completions",
]);

type ProxyBody = {
  model?: string;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  [key: string]: unknown;
};

const proxyRoutePatterns = [
  "/v1/*",
  "/responses",
  "/responses/*",
  "/chat/completions",
  "/embeddings",
  "/completions",
];

export async function proxyRoutes(app: FastifyInstance) {
  for (const pattern of proxyRoutePatterns) {
    app.all(pattern, async (request: ApiRequestWithUser, reply) => {
    const rawEndpoint = request.url.split("?")[0] ?? request.url;
    const endpoint = normalizeEndpoint(rawEndpoint);
    const upstreamRequestUrl = normalizeRequestUrl(request.url);

    if (!isSupportedEndpoint(endpoint)) {
      return sendApiError(reply, 404, "Endpoint not supported by this gateway");
    }

    await requireApiKey(app, request, reply);
    if (reply.sent || !request.apiAuth) {
      return;
    }

    if (!isAllowedMethod(endpoint, request.method)) {
      return sendApiError(reply, 405, "Method not allowed");
    }

    const body = (request.body ?? {}) as ProxyBody;
    const model = body.model;
    const billable = isBillableEndpoint(endpoint, request.method);

    if (billable && !model) {
      return sendApiError(reply, 400, "Missing model");
    }

    const { apiKey, user } = request.apiAuth;

    if (model && apiKey.allowedModels.length > 0 && !apiKey.allowedModels.includes(model)) {
      return sendApiError(reply, 403, "Model is not allowed for this API key");
    }

    if (model && user.allowedModels.length > 0 && !user.allowedModels.includes(model)) {
      return sendApiError(reply, 403, "Model is not allowed for this user");
    }

    if (billable) {
      const walletCheck = await ensureWalletCanStart(user.id);
      if (!walletCheck.ok) {
        return sendApiError(reply, 402, walletCheck.reason, "insufficient_quota");
      }
    }

    const modelRoute = billable && model ? await getProviderForModel(model) : null;
    const provider = modelRoute?.provider ?? await getDefaultProvider();
    const price = modelRoute?.price ?? null;

    if (billable && (!price || !price.enabled)) {
      return sendApiError(reply, 400, `Model ${model} is not enabled on any active upstream`);
    }

    if (!provider) {
      return sendApiError(reply, 400, "No active upstream provider is configured");
    }

    const start = performance.now();

    const apiRequest = await prisma.apiRequest.create({
      data: {
        userId: user.id,
        apiKeyId: apiKey.id,
        upstreamProvider: provider.name,
        model: model ?? inferModelFromEndpoint(endpoint),
        endpoint,
        method: request.method,
        status: "PENDING",
        clientIp: request.ip,
        userAgent: request.headers["user-agent"],
        requestBody: redactBodyForLog(body) as Prisma.InputJsonValue,
      },
    });

    const upstreamBody = buildUpstreamBody(endpoint, body);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);

      const upstreamResponse = await fetch(
        buildUpstreamUrl(provider.baseUrl, upstreamRequestUrl),
        {
          method: request.method,
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
            Accept: body.stream ? "text/event-stream" : "application/json",
          },
          body: request.method === "GET" || request.method === "DELETE"
            ? undefined
            : JSON.stringify(upstreamBody),
          signal: controller.signal,
        },
      ).finally(() => clearTimeout(timeout));

      await prisma.apiRequest.update({
        where: { id: apiRequest.id },
        data: {
          httpStatus: upstreamResponse.status,
          upstreamRequestId: upstreamResponse.headers.get("x-request-id"),
        },
      });

      if (!upstreamResponse.ok) {
        const text = await upstreamResponse.text();
        await markRequestFailed(
          apiRequest,
          text.slice(0, 2000),
          upstreamResponse.status,
          Math.round(performance.now() - start),
        );
        reply.status(upstreamResponse.status);
        reply.header(
          "content-type",
          upstreamResponse.headers.get("content-type") ?? "application/json",
        );
        return reply.send(text);
      }

      const shouldStream = shouldStreamResponse(upstreamResponse, body, upstreamRequestUrl);

      if (shouldStream && billable && price) {
        return proxyStream({
          reply,
          upstreamResponse,
          apiRequestId: apiRequest.id,
          userId: user.id,
          priceId: price.id,
          startedAt: start,
        });
      }

      if (shouldStream) {
        return proxyPassthroughStream({
          reply,
          upstreamResponse,
          apiRequestId: apiRequest.id,
          startedAt: start,
        });
      }

      const contentType = upstreamResponse.headers.get("content-type") ?? "";
      const responseBody = contentType.includes("application/json")
        ? await upstreamResponse.json()
        : await upstreamResponse.text();

      if (!billable || !price) {
        await prisma.apiRequest.update({
          where: { id: apiRequest.id },
          data: {
            status: "SUCCESS",
            latencyMs: Math.round(performance.now() - start),
          },
        });

        reply.status(upstreamResponse.status);
        reply.header("content-type", contentType || "application/json");
        return reply.send(responseBody);
      }

      const usage = usageFromOpenAIResponse(responseBody);
      await chargeForRequest({
        requestId: apiRequest.id,
        userId: user.id,
        price,
        usage,
        startedAt: start,
      });

      reply.status(upstreamResponse.status);
      reply.header("content-type", contentType || "application/json");
      return reply.send(responseBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upstream request failed";
      await markRequestFailed(apiRequest, message, 502, Math.round(performance.now() - start));
      return sendApiError(reply, 502, message, "upstream_error");
    }
    });
  }
}

function normalizeEndpoint(endpoint: string) {
  if (endpoint.startsWith("/v1/")) {
    return endpoint;
  }

  if (endpoint === "/responses" || endpoint.startsWith("/responses/")) {
    return `/v1${endpoint}`;
  }

  if (
    endpoint === "/chat/completions" ||
    endpoint === "/embeddings" ||
    endpoint === "/completions"
  ) {
    return `/v1${endpoint}`;
  }

  return endpoint;
}

function normalizeRequestUrl(url: string) {
  const [path = "", query] = url.split("?");
  const normalizedPath = normalizeEndpoint(path);
  return query ? `${normalizedPath}?${query}` : normalizedPath;
}
function isSupportedEndpoint(endpoint: string) {
  return proxiedEndpoints.has(endpoint) || isResponsesEndpoint(endpoint);
}

function isAllowedMethod(endpoint: string, method: string) {
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

  return /^\/v1\/responses\/[^/]+$/.test(endpoint) && (method === "GET" || method === "DELETE");
}

function isBillableEndpoint(endpoint: string, method: string) {
  return (
    method === "POST" &&
    (endpoint === "/v1/chat/completions" ||
      endpoint === "/v1/completions" ||
      endpoint === "/v1/embeddings" ||
      endpoint === "/v1/responses" ||
      endpoint === "/v1/responses/compact" ||
      endpoint === "/v1/responses/input_tokens")
  );
}

function inferModelFromEndpoint(endpoint: string) {
  if (endpoint.startsWith("/v1/responses")) {
    return "responses-meta";
  }

  return "unknown";
}

function isResponsesEndpoint(endpoint: string) {
  return (
    endpoint === "/v1/responses" ||
    endpoint === "/v1/responses/compact" ||
    endpoint === "/v1/responses/input_tokens" ||
    /^\/v1\/responses\/[^/]+$/.test(endpoint) ||
    /^\/v1\/responses\/[^/]+\/cancel$/.test(endpoint) ||
    /^\/v1\/responses\/[^/]+\/input_items$/.test(endpoint)
  );
}

function shouldStreamResponse(
  upstreamResponse: Response,
  body: ProxyBody,
  requestUrl: string,
) {
  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  const url = new URL(requestUrl, "http://gateway.local");

  return (
    body.stream === true ||
    url.searchParams.get("stream") === "true" ||
    contentType.includes("text/event-stream")
  );
}

function redactBodyForLog(body: ProxyBody) {
  const clone = { ...body };
  if (typeof clone.input === "string" && clone.input.length > 500) {
    clone.input = `${clone.input.slice(0, 500)}...`;
  }
  if (Array.isArray(clone.messages)) {
    clone.messages = clone.messages.slice(-6);
  }
  return clone;
}

function buildUpstreamBody(endpoint: string, body: ProxyBody) {
  if (!body.stream || endpoint.startsWith("/v1/responses")) {
    return body;
  }

  return {
    ...body,
    stream_options: {
      ...(body.stream_options ?? {}),
      include_usage: true,
    },
  };
}

async function proxyStream(params: {
  reply: FastifyReply;
  upstreamResponse: Response;
  apiRequestId: string;
  userId: string;
  priceId: string;
  startedAt: number;
}) {
  const { reply, upstreamResponse, apiRequestId, userId, priceId, startedAt } =
    params;
  const price = await prisma.modelPrice.findUniqueOrThrow({
    where: { id: priceId },
  });
  let streamUsage: Usage | null = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let firstTokenLatencyMs: number | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamResponse.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value) {
            const text = decoder.decode(value, { stream: true });
            pending += text;
            if (firstTokenLatencyMs === null && sseBufferHasOutputToken(pending)) {
              firstTokenLatencyMs = Math.round(performance.now() - startedAt);
            }
            streamUsage = parseUsageFromSseBuffer(pending) ?? streamUsage;
            const lastEventBoundary = pending.lastIndexOf("\n\n");
            if (lastEventBoundary >= 0) {
              pending = pending.slice(lastEventBoundary + 2);
            }
            controller.enqueue(encoder.encode(text));
          }
        }

        const trailing = decoder.decode();
        if (trailing) {
          pending += trailing;
          if (firstTokenLatencyMs === null && sseBufferHasOutputToken(pending)) {
            firstTokenLatencyMs = Math.round(performance.now() - startedAt);
          }
          streamUsage = parseUsageFromSseBuffer(pending) ?? streamUsage;
          controller.enqueue(encoder.encode(trailing));
        }

        const usage = streamUsage ?? {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          raw: null,
        };

        await chargeForRequest({
        requestId: apiRequestId,
        userId,
        price,
        usage,
        startedAt,
      });

        await prisma.apiRequest.update({
          where: { id: apiRequestId },
          data: { firstTokenLatencyMs },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream failed";
        await markRequestFailed({ id: apiRequestId }, message, 502, Math.round(performance.now() - startedAt));
        controller.error(error);
        return;
      } finally {
        controller.close();
      }
    },
  });

  reply.status(upstreamResponse.status);
  reply.header(
    "content-type",
    upstreamResponse.headers.get("content-type") ?? "text/event-stream",
  );
  reply.header("cache-control", "no-cache");
  return reply.send(Readable.fromWeb(stream as unknown as import("node:stream/web").ReadableStream));
}

async function proxyPassthroughStream(params: {
  reply: FastifyReply;
  upstreamResponse: Response;
  apiRequestId: string;
  startedAt: number;
}) {
  const { reply, upstreamResponse, apiRequestId, startedAt } = params;
  let firstTokenLatencyMs: number | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamResponse.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            firstTokenLatencyMs ??= Math.round(performance.now() - startedAt);
            controller.enqueue(value);
          }
        }

        await prisma.apiRequest.update({
          where: { id: apiRequestId },
          data: {
            status: "SUCCESS",
            latencyMs: Math.round(performance.now() - startedAt),
            firstTokenLatencyMs,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream failed";
        await markRequestFailed({ id: apiRequestId }, message, 502, Math.round(performance.now() - startedAt));
        controller.error(error);
        return;
      } finally {
        controller.close();
      }
    },
  });

  reply.status(upstreamResponse.status);
  reply.header(
    "content-type",
    upstreamResponse.headers.get("content-type") ?? "text/event-stream",
  );
  reply.header("cache-control", "no-cache");
  return reply.send(Readable.fromWeb(stream as unknown as import("node:stream/web").ReadableStream));
}

function parseUsageFromSseBuffer(buffer: string): Usage | null {
  let found: Usage | null = null;

  for (const parsed of parseSseJsonPayloads(buffer)) {
    found = usageFromStreamChunk(parsed) ?? found;
  }

  return found;
}

function sseBufferHasOutputToken(buffer: string) {
  return parseSseJsonPayloads(buffer).some(streamChunkHasOutputToken);
}

function parseSseJsonPayloads(buffer: string) {
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
      return textLikeValueHasContent(item.text) || textLikeValueHasContent(item.delta);
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
    textLikeValueHasContent(record.delta)
  );
}
