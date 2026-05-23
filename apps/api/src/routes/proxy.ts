import { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@gateway/db";
import { sendApiError } from "../lib/errors.js";
import { usageFromOpenAIResponse, usageFromStreamChunk } from "../lib/usage.js";
import { chargeForRequest, ensureWalletCanStart, markRequestFailed } from "../services/billing.js";
import { requireApiKey } from "../services/auth.js";
import { recordModelPoolUserCallResult } from "../services/model-pool-call-failures.js";
import { recordStickyModelPoolResult } from "../services/model-pool-stickiness.js";
import { buildUpstreamUrl, getDefaultProvider, getProviderForModel } from "../services/upstream.js";
import type { ApiRequestWithUser, Usage } from "../types.js";

const proxiedEndpoints = new Set([
  "/v1/chat/completions",
  "/v1/embeddings",
  "/v1/completions",
  "/v1/images/generations",
]);

type ProxyBody = {
  model?: string;
  stream?: boolean;
  stream_options?: {
    include_usage?: boolean;
  };
  [key: string]: unknown;
};

type NoticeResponse = {
  id: string;
  object: "response";
  created_at: number;
  status: "completed";
  background: false;
  completed_at: number;
  error: null;
  incomplete_details: null;
  model: string;
  output: [
    {
      id: string;
      type: "message";
      status: "completed";
      role: "assistant";
      content: [
        {
          type: "output_text";
          text: string;
          annotations: unknown[];
        },
      ];
    },
  ];
  output_text: string;
  usage: ReturnType<typeof zeroResponseUsage>;
};

const proxyRoutePatterns = [
  "/v1/*",
  "/response",
  "/response/*",
  "/responses",
  "/responses/*",
  "/chat/completions",
  "/embeddings",
  "/completions",
  "/images/generations",
];
const streamFirstTokenTimeoutMs = 60_000;
const streamFirstTokenTimeoutMessage = "Stream first token timeout after 60 seconds";
const missingUsageMessage = "Upstream response did not include billable token usage";
const staleResponsesContextNotice = [
  "这个会话的上游上下文已经失效，不能继续接着上一轮回答。",
  "请新建对话，或清空当前会话上下文后重试。",
  "如果你的客户端使用 Responses API，请不要在 store=false 时复用 previous_response_id、rs_... item 或旧 input item；需要跨轮复用时请开启 store=true。",
].join("\n");
const missingUsageNotice = [
  "这次上游没有返回可计费用量，网关无法安全完成扣费。",
  "请新建对话或清空当前会话上下文后重试；如果仍失败，请换一个上游渠道或联系管理员查看后台失败记录。",
].join("\n");

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

    const body = (request.body ?? {}) as ProxyBody;
    const { apiKey, user } = request.apiAuth;
    if (apiKey.noticeEnabled && apiKey.noticeText?.trim()) {
      return sendApiKeyNotice(
        reply,
        endpoint,
        body,
        upstreamRequestUrl,
        apiKey.noticeText,
        request.headers.accept,
      );
    }

    if (!isAllowedMethod(endpoint, request.method)) {
      return sendApiError(reply, 405, "Method not allowed");
    }

    const model = body.model;
    const billable = isBillableEndpoint(endpoint, request.method);

    if (billable && !model) {
      return sendApiError(reply, 400, "Missing model");
    }

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

    const clientIp = getClientIp(request);
    const callerIpIdentity = clientIp ?? apiKey.id;
    const modelRoute = billable && model ? await getProviderForModel(callerIpIdentity, model) : null;
    const provider = modelRoute?.provider ?? await getDefaultProvider();
    const price = modelRoute?.price ?? null;
    const channelId = modelRoute?.channelId;
    const upstreamProviderKeyId = modelRoute?.provider.upstreamProviderKeyId === "env"
      ? undefined
      : modelRoute?.provider.upstreamProviderKeyId;
    const releaseModelPoolReservation = modelRoute?.release;
    const billableModel = billable ? model : undefined;

    if (billable && (!price || !price.enabled)) {
      return sendApiError(reply, 400, `Model ${model} is not enabled on any active upstream`);
    }

    const start = performance.now();
    const concurrencyLock = await acquireApiKeyConcurrency(app, apiKey.id, apiKey.concurrencyLimit);
    if (!concurrencyLock.ok) {
      await releaseModelPoolReservation?.();
      return sendApiError(reply, 429, "API key concurrency limit exceeded", "rate_limit_error");
    }
    bindConcurrencyRelease(reply, concurrencyLock.release);
    if (releaseModelPoolReservation) {
      bindLifecycleRelease(reply, releaseModelPoolReservation);
    }

    const apiRequest = await prisma.apiRequest.create({
      data: {
        userId: user.id,
        apiKeyId: apiKey.id,
        upstreamProviderKeyId,
        upstreamProvider: provider.name,
        model: model ?? inferModelFromEndpoint(endpoint),
        endpoint,
        method: request.method,
        status: "PENDING",
        clientIp,
        userAgent: request.headers["user-agent"],
        requestBody: redactBodyForLog(body) as Prisma.InputJsonValue,
      },
    });

    const upstreamBody = buildUpstreamBody(endpoint, body, provider);
    const requestedStream = requestAsksForStream(body, upstreamRequestUrl);
    let streamFirstTokenFetchTimedOut = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
      const firstTokenFetchTimeout = requestedStream
        ? startFirstTokenTimeout(start, () => {
            streamFirstTokenFetchTimedOut = true;
            controller.abort(createFirstTokenTimeoutError());
          })
        : undefined;

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
      ).finally(() => {
        clearTimeout(timeout);
        if (firstTokenFetchTimeout) {
          clearTimeout(firstTokenFetchTimeout);
        }
      });

      await prisma.apiRequest.update({
        where: { id: apiRequest.id },
        data: {
          httpStatus: upstreamResponse.status,
          upstreamRequestId: upstreamResponse.headers.get("x-request-id"),
        },
      });

      if (!upstreamResponse.ok) {
        const text = await upstreamResponse.text();
        const recoveryNotice = getGatewayRecoveryNotice(text);
        await markRequestFailed(
          apiRequest,
          text.slice(0, 2000),
          upstreamResponse.status,
          Math.round(performance.now() - start),
        );
        if (recoveryNotice) {
          return sendApiKeyNotice(
            reply,
            endpoint,
            body,
            upstreamRequestUrl,
            recoveryNotice,
            request.headers.accept,
          );
        }
        if (billable && model) {
          await recordStickyModelPoolResult({
            callerIdentity: callerIpIdentity,
            model,
            channelId,
            failed: true,
            latencyMs: Math.round(performance.now() - start),
          });
          await recordModelPoolUserCallResult({
            userId: user.id,
            apiKeyId: apiKey.id,
            callerIdentity: callerIpIdentity,
            model,
            channelId,
            failed: true,
            logger: app.log,
          });
        }
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
          endpoint,
          requestBody: upstreamBody,
          userId: user.id,
          callerIdentity: callerIpIdentity,
          apiKeyId: apiKey.id,
          priceId: price.id,
          model: billableModel ?? price.model,
          channelId,
          startedAt: start,
          logger: app.log,
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
      assertBillableUsage(usage);
      await chargeForRequest({
        requestId: apiRequest.id,
        userId: user.id,
        price,
        usage,
        startedAt: start,
      });
      await recordStickyModelPoolResult({
        callerIdentity: callerIpIdentity,
        model: billableModel ?? price.model,
        channelId,
        latencyMs: Math.round(performance.now() - start),
      });
      await recordModelPoolUserCallResult({
        userId: user.id,
        apiKeyId: apiKey.id,
        callerIdentity: callerIpIdentity,
        model: billableModel ?? price.model,
        channelId,
        failed: false,
        logger: app.log,
      });

      reply.status(upstreamResponse.status);
      reply.header("content-type", contentType || "application/json");
      return reply.send(responseBody);
    } catch (error) {
      const effectiveError = streamFirstTokenFetchTimedOut ? createFirstTokenTimeoutError() : error;
      const message = effectiveError instanceof Error ? effectiveError.message : "Upstream request failed";
      const statusCode = isFirstTokenTimeoutError(effectiveError) ? 504 : 502;
      const recoveryNotice = getGatewayRecoveryNotice(effectiveError);
      await markRequestFailed(
        apiRequest,
        message,
        statusCode,
        Math.round(performance.now() - start),
      );
      if (recoveryNotice) {
        return sendApiKeyNotice(
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          recoveryNotice,
          request.headers.accept,
        );
      }
      if (billable && model) {
        await recordStickyModelPoolResult({
          callerIdentity: callerIpIdentity,
          model,
          channelId,
          failed: true,
          latencyMs: Math.round(performance.now() - start),
        });
        await recordModelPoolUserCallResult({
          userId: user.id,
          apiKeyId: apiKey.id,
          callerIdentity: callerIpIdentity,
          model,
          channelId,
          failed: true,
          logger: app.log,
        });
      }
      return sendApiError(reply, statusCode, message, statusCode === 504 ? "timeout_error" : "upstream_error");
    }
    });
  }
}

function bindConcurrencyRelease(reply: FastifyReply, release: () => Promise<void>) {
  bindLifecycleRelease(reply, release);
}

function bindLifecycleRelease(reply: FastifyReply, release: () => Promise<void>) {
  let released = false;
  const releaseOnce = () => {
    if (released) {
      return;
    }
    released = true;
    void release();
  };

  reply.raw.once("finish", releaseOnce);
  reply.raw.once("close", releaseOnce);
  reply.raw.once("error", releaseOnce);
}

async function acquireApiKeyConcurrency(
  app: FastifyInstance,
  apiKeyId: string,
  limit: number,
) {
  if (limit <= 0) {
    return {
      ok: true as const,
      release: async () => {},
    };
  }

  const key = `concurrency:${apiKeyId}`;

  try {
    const count = await app.redis.incr(key);
    if (count === 1) {
      await app.redis.expire(key, 120);
    }

    if (count > limit) {
      await app.redis.decr(key);
      return {
        ok: false as const,
        release: async () => {},
      };
    }

    let released = false;
    const refreshTtl = setInterval(() => {
      void app.redis.expire(key, 120).catch((error: unknown) => {
        app.log.warn({ error, apiKeyId }, "Failed to refresh API key concurrency lock");
      });
    }, 30_000);
    return {
      ok: true as const,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        clearInterval(refreshTtl);
        try {
          const current = await app.redis.decr(key);
          if (current <= 0) {
            await app.redis.del(key);
          }
        } catch (error) {
          app.log.warn({ error, apiKeyId }, "Failed to release API key concurrency slot");
        }
      },
    };
  } catch (error) {
    app.log.warn({ error, apiKeyId }, "Redis concurrency check failed, allowing request");
    return {
      ok: true as const,
      release: async () => {},
    };
  }
}

function sendApiKeyNotice(
  reply: FastifyReply,
  endpoint: string,
  body: ProxyBody,
  requestUrl: string,
  noticeText: string,
  acceptHeader?: string | string[],
) {
  const notice = noticeText.trim();
  const model = typeof body.model === "string" && body.model.trim() ? body.model : "gateway-notice";
  const accept = Array.isArray(acceptHeader) ? acceptHeader.join(",") : acceptHeader ?? "";

  reply.status(200);
  reply.header("x-gateway-notice", "true");
  reply.header("cache-control", "no-store");

  if (requestAsksForStream(body, requestUrl) || accept.includes("text/event-stream")) {
    reply.header("content-type", "text/event-stream; charset=utf-8");
    return reply.send(buildNoticeStream(endpoint, model, notice));
  }

  reply.header("content-type", "application/json; charset=utf-8");

  if (endpoint === "/v1/chat/completions") {
    return reply.send(buildNoticeChatCompletion(model, notice));
  }

  if (endpoint === "/v1/completions") {
    return reply.send(buildNoticeCompletion(model, notice));
  }

  if (isResponsesEndpoint(endpoint)) {
    return reply.send(buildNoticeResponse(model, notice));
  }

  return reply.send({
    id: createNoticeId("notice"),
    object: "gateway.notice",
    created: Math.floor(Date.now() / 1000),
    model,
    notice,
    output_text: notice,
    usage: zeroTokenUsage(),
  });
}

function getGatewayRecoveryNotice(error: unknown) {
  if (isMissingUsageError(error)) {
    return missingUsageNotice;
  }

  const text = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "";

  if (!text) {
    return null;
  }

  const normalized = text.toLowerCase();
  const isStoreFalseItemError =
    normalized.includes("items are not persisted when store is set to false") ||
    (normalized.includes("item with id") && normalized.includes("not found") && normalized.includes("rs_")) ||
    (normalized.includes("previous_response_id") && normalized.includes("not found"));

  if (isStoreFalseItemError) {
    return staleResponsesContextNotice;
  }

  if (normalized.includes(missingUsageMessage.toLowerCase())) {
    return missingUsageNotice;
  }

  return null;
}

function buildNoticeStream(endpoint: string, model: string, notice: string) {
  if (endpoint === "/v1/chat/completions") {
    const created = Math.floor(Date.now() / 1000);
    const id = createNoticeId("chatcmpl");
    return [
      sseData({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              role: "assistant",
            },
            finish_reason: null,
          },
        ],
      }),
      sseData({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              content: notice,
            },
            finish_reason: null,
          },
        ],
      }),
      sseData({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [
          {
            index: 0,
            delta: {
              content: "",
            },
            finish_reason: "stop",
          },
        ],
      }),
      sseData({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [],
        usage: zeroTokenUsage(),
      }),
      "data: [DONE]\n\n",
    ].join("");
  }

  if (endpoint === "/v1/completions") {
    const created = Math.floor(Date.now() / 1000);
    const id = createNoticeId("cmpl");
    return [
      sseData({
        id,
        object: "text_completion",
        created,
        model,
        choices: [
          {
            text: notice,
            index: 0,
            logprobs: null,
            finish_reason: null,
          },
        ],
        delta: notice,
      }),
      sseData({
        id,
        object: "text_completion",
        created,
        model,
        choices: [],
        usage: zeroTokenUsage(),
      }),
      "data: [DONE]\n\n",
    ].join("");
  }

  if (isResponsesEndpoint(endpoint)) {
    const response = buildNoticeResponse(model, notice);
    const outputItem = response.output[0];
    const contentPart = outputItem.content[0];
    const inProgressResponse = {
      ...response,
      status: "in_progress",
      completed_at: null,
      output: [],
      output_text: "",
      usage: null,
    };
    const completedStreamResponse = {
      ...response,
      output: [],
    };

    return [
      sseEvent("response.created", {
        type: "response.created",
        response: inProgressResponse,
        sequence_number: 0,
      }),
      sseEvent("response.in_progress", {
        type: "response.in_progress",
        response: inProgressResponse,
        sequence_number: 1,
      }),
      sseEvent("response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          ...outputItem,
          status: "in_progress",
          content: [],
        },
        sequence_number: 2,
      }),
      sseEvent("response.content_part.added", {
        type: "response.content_part.added",
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        part: {
          ...contentPart,
          text: "",
        },
        sequence_number: 3,
      }),
      sseEvent("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        delta: notice,
        sequence_number: 4,
      }),
      sseEvent("response.output_text.done", {
        type: "response.output_text.done",
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        text: notice,
        sequence_number: 5,
      }),
      sseEvent("response.content_part.done", {
        type: "response.content_part.done",
        item_id: outputItem.id,
        output_index: 0,
        content_index: 0,
        part: contentPart,
        sequence_number: 6,
      }),
      sseEvent("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: outputItem,
        sequence_number: 7,
      }),
      sseEvent("response.completed", {
        type: "response.completed",
        response: completedStreamResponse,
        sequence_number: 8,
      }),
      "data: [DONE]\n\n",
    ].join("");
  }

  return [
    sseData({
      id: createNoticeId("notice"),
      object: "gateway.notice.chunk",
      model,
      delta: notice,
      output_text: notice,
      notice,
      usage: zeroTokenUsage(),
    }),
    "data: [DONE]\n\n",
  ].join("");
}

function buildNoticeChatCompletion(model: string, notice: string) {
  return {
    id: createNoticeId("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: notice,
        },
        finish_reason: "stop",
      },
    ],
    usage: zeroTokenUsage(),
  };
}

function buildNoticeCompletion(model: string, notice: string) {
  return {
    id: createNoticeId("cmpl"),
    object: "text_completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        text: notice,
        index: 0,
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: zeroTokenUsage(),
  };
}

function buildNoticeResponse(model: string, notice: string): NoticeResponse {
  const messageId = createNoticeId("msg");
  return {
    id: createNoticeId("resp"),
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    background: false,
    completed_at: Math.floor(Date.now() / 1000),
    error: null,
    incomplete_details: null,
    model,
    output: [
      {
        id: messageId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: notice,
            annotations: [],
          },
        ],
      },
    ],
    output_text: notice,
    usage: zeroResponseUsage(),
  };
}

function zeroTokenUsage() {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
}

function zeroResponseUsage() {
  return {
    input_tokens: 0,
    input_tokens_details: {
      cached_tokens: 0,
    },
    output_tokens: 0,
    output_tokens_details: {
      reasoning_tokens: 0,
    },
    total_tokens: 0,
  };
}

function createNoticeId(prefix: string) {
  return `${prefix}_notice_${Date.now().toString(36)}`;
}

function sseData(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function sseEvent(event: string, value: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`;
}

function normalizeEndpoint(endpoint: string) {
  if (endpoint.startsWith("/v1/")) {
    return endpoint;
  }

  if (
    endpoint === "/responses" ||
    endpoint.startsWith("/responses/") ||
    endpoint === "/response" ||
    endpoint.startsWith("/response/")
  ) {
    const normalizedEndpoint = endpoint === "/response" || endpoint.startsWith("/response/")
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
      endpoint === "/v1/images/generations" ||
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

  return requestAsksForStream(body, requestUrl) || contentType.includes("text/event-stream");
}

function requestAsksForStream(body: ProxyBody, requestUrl: string) {
  const url = new URL(requestUrl, "http://gateway.local");

  return body.stream === true || url.searchParams.get("stream") === "true";
}

function redactBodyForLog(body: ProxyBody) {
  const clone = { ...body };
  if (typeof clone.input === "string" && clone.input.length > 500) {
    clone.input = `${clone.input.slice(0, 500)}...`;
  }
  if (typeof clone.prompt === "string" && clone.prompt.length > 500) {
    clone.prompt = `${clone.prompt.slice(0, 500)}...`;
  }
  if (Array.isArray(clone.messages)) {
    clone.messages = clone.messages.slice(-6);
  }
  return clone;
}

function getClientIp(request: ApiRequestWithUser) {
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

function pickHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).find(Boolean) ?? null;
  }

  return value?.trim() || null;
}

function pickForwardedFor(value: string | string[] | undefined) {
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

function buildUpstreamBody(endpoint: string, body: ProxyBody, provider: { name: string; baseUrl: string }) {
  let upstreamBody = body;

  if (endpoint === "/v1/responses" && isShareApiProvider(provider)) {
    upstreamBody = buildShareApiResponsesBody(body);
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

function isShareApiProvider(provider: { name: string; baseUrl: string }) {
  try {
    const host = new URL(provider.baseUrl).hostname.toLowerCase();
    return host === "share-api.com" || host.endsWith(".share-api.com");
  } catch {
    return provider.name.includes("share-api.com") || provider.baseUrl.includes("share-api.com");
  }
}

function buildShareApiResponsesBody(body: ProxyBody): ProxyBody {
  const normalized: ProxyBody = { ...body };

  if (!Object.prototype.hasOwnProperty.call(normalized, "instructions")) {
    normalized.instructions = "";
  }

  if (typeof normalized.input === "string") {
    normalized.input = [{ role: "user", content: normalized.input }];
  }

  return normalized;
}

async function proxyStream(params: {
  reply: FastifyReply;
  upstreamResponse: Response;
  apiRequestId: string;
  endpoint: string;
  requestBody: ProxyBody;
  userId: string;
  callerIdentity: string;
  apiKeyId: string;
  model: string;
  channelId?: string;
  priceId: string;
  startedAt: number;
  logger?: {
    warn: (value: unknown, message?: string) => void;
    info?: (value: unknown, message?: string) => void;
  };
}) {
  const { reply, upstreamResponse, apiRequestId, endpoint, requestBody, userId, callerIdentity, apiKeyId, model, channelId, priceId, startedAt, logger } = params;
  const price = await prisma.modelPrice.findUniqueOrThrow({
    where: { id: priceId },
  });
  let streamUsage: Usage | null = null;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let rawStreamText = "";
  let firstTokenLatencyMs: number | null = null;
  const bufferedStreamChunks: string[] = [];
  let hasForwardedStream = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstreamResponse.body?.getReader();
      if (!reader) {
        const error = new Error("Stream body missing");
        await markRequestFailed({ id: apiRequestId }, error.message, 502, Math.round(performance.now() - startedAt));
        await recordStickyModelPoolResult({
          callerIdentity,
          model,
          channelId,
          failed: true,
          latencyMs: Math.round(performance.now() - startedAt),
        });
        await recordModelPoolUserCallResult({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          failed: true,
          logger,
        });
        controller.error(error);
        return;
      }
      let firstTokenTimedOut = false;
      const firstTokenTimeout = startFirstTokenTimeout(startedAt, () => {
        if (firstTokenLatencyMs !== null) {
          return;
        }

        firstTokenTimedOut = true;
        void reader.cancel(createFirstTokenTimeoutError()).catch(() => undefined);
      });
      const markFirstTokenSeen = () => {
        firstTokenLatencyMs = Math.round(performance.now() - startedAt);
        clearTimeout(firstTokenTimeout);
      };
      const flushBufferedStreamChunks = () => {
        if (hasForwardedStream) {
          return;
        }

        hasForwardedStream = true;
        for (const chunk of bufferedStreamChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        bufferedStreamChunks.length = 0;
      };
      const forwardStreamText = (text: string) => {
        if (hasForwardedStream || firstTokenLatencyMs !== null) {
          flushBufferedStreamChunks();
          controller.enqueue(encoder.encode(text));
          return;
        }

        bufferedStreamChunks.push(text);
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value) {
            const text = decoder.decode(value, { stream: true });
            rawStreamText += text;
            pending += text;
            if (firstTokenLatencyMs === null && sseBufferHasOutputToken(pending)) {
              markFirstTokenSeen();
            }
            streamUsage = parseUsageFromSseBuffer(pending) ?? streamUsage;
            const lastEventBoundary = pending.lastIndexOf("\n\n");
            if (lastEventBoundary >= 0) {
              pending = pending.slice(lastEventBoundary + 2);
            }
            forwardStreamText(text);
          }
        }

        const trailing = decoder.decode();
        if (trailing) {
          rawStreamText += trailing;
          pending += trailing;
          if (firstTokenLatencyMs === null && sseBufferHasOutputToken(pending)) {
            markFirstTokenSeen();
          }
          streamUsage = parseUsageFromSseBuffer(pending) ?? streamUsage;
          forwardStreamText(trailing);
        }

        if (firstTokenTimedOut && firstTokenLatencyMs === null) {
          throw createFirstTokenTimeoutError();
        }

        if (!streamUsage) {
          streamUsage = estimateUsageFromStream(requestBody, rawStreamText);
          if (streamUsage) {
            logger?.warn(
              { apiRequestId, model, channelId },
              "Upstream stream did not include usage; using estimated billable usage",
            );
          } else {
            throw createMissingUsageError();
          }
        }
        assertBillableUsage(streamUsage);
        flushBufferedStreamChunks();

        await chargeForRequest({
          requestId: apiRequestId,
          userId,
          price,
          usage: streamUsage,
          startedAt,
        });

        await prisma.apiRequest.update({
          where: { id: apiRequestId },
          data: { firstTokenLatencyMs },
        });
        await recordStickyModelPoolResult({
          callerIdentity,
          model,
          channelId,
          firstTokenLatencyMs,
          latencyMs: Math.round(performance.now() - startedAt),
        });
        await recordModelPoolUserCallResult({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          failed: false,
          logger,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream failed";
        const recoveryNotice = hasForwardedStream
          ? null
          : getGatewayRecoveryNotice(rawStreamText) ?? getGatewayRecoveryNotice(error);
        await markRequestFailed(
          { id: apiRequestId },
          message,
          isFirstTokenTimeoutError(error) ? 504 : 502,
          Math.round(performance.now() - startedAt),
        );
        if (recoveryNotice) {
          controller.enqueue(encoder.encode(buildNoticeStream(endpoint, model, recoveryNotice)));
          return;
        }
        await recordStickyModelPoolResult({
          callerIdentity,
          model,
          channelId,
          failed: true,
          latencyMs: Math.round(performance.now() - startedAt),
        });
        await recordModelPoolUserCallResult({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          failed: true,
          logger,
        });
        controller.error(error);
        return;
      } finally {
        clearTimeout(firstTokenTimeout);
        safeCloseStreamController(controller);
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
        const error = new Error("Stream body missing");
        await markRequestFailed({ id: apiRequestId }, error.message, 502, Math.round(performance.now() - startedAt));
        controller.error(error);
        return;
      }
      let firstTokenTimedOut = false;
      const firstTokenTimeout = startFirstTokenTimeout(startedAt, () => {
        if (firstTokenLatencyMs !== null) {
          return;
        }

        firstTokenTimedOut = true;
        void reader.cancel(createFirstTokenTimeoutError()).catch(() => undefined);
      });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            if (firstTokenLatencyMs === null) {
              firstTokenLatencyMs = Math.round(performance.now() - startedAt);
              clearTimeout(firstTokenTimeout);
            }
            controller.enqueue(value);
          }
        }

        if (firstTokenTimedOut && firstTokenLatencyMs === null) {
          throw createFirstTokenTimeoutError();
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
        await markRequestFailed(
          { id: apiRequestId },
          message,
          isFirstTokenTimeoutError(error) ? 504 : 502,
          Math.round(performance.now() - startedAt),
        );
        controller.error(error);
        return;
      } finally {
        clearTimeout(firstTokenTimeout);
        safeCloseStreamController(controller);
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

function safeCloseStreamController(controller: ReadableStreamDefaultController<Uint8Array>) {
  try {
    controller.close();
  } catch (error) {
    if (!isClosedControllerError(error)) {
      throw error;
    }
  }
}

function isClosedControllerError(error: unknown) {
  return error instanceof TypeError && error.message.includes("Controller is already closed");
}

function startFirstTokenTimeout(startedAt: number, onTimeout: () => void) {
  const elapsedMs = performance.now() - startedAt;
  const remainingMs = Math.max(0, streamFirstTokenTimeoutMs - elapsedMs);
  return setTimeout(onTimeout, remainingMs);
}

function createFirstTokenTimeoutError() {
  const error = new Error(streamFirstTokenTimeoutMessage);
  error.name = "FirstTokenTimeoutError";
  return error;
}

function isFirstTokenTimeoutError(error: unknown) {
  return error instanceof Error && error.name === "FirstTokenTimeoutError";
}

function createMissingUsageError() {
  const error = new Error(missingUsageMessage);
  error.name = "MissingUsageError";
  return error;
}

function isMissingUsageError(error: unknown) {
  return error instanceof Error && error.name === "MissingUsageError";
}

function assertBillableUsage(usage: Usage) {
  if (usage.totalTokens > 0) {
    return;
  }

  throw createMissingUsageError();
}

function parseUsageFromSseBuffer(buffer: string): Usage | null {
  let found: Usage | null = null;

  for (const parsed of parseSseJsonPayloads(buffer)) {
    found = usageFromStreamChunk(parsed) ?? found;
  }

  return found;
}

function estimateUsageFromStream(requestBody: ProxyBody, buffer: string): Usage | null {
  const outputText = extractOutputTextFromSseBuffer(buffer);

  if (!outputText.trim()) {
    return null;
  }

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
      reason: "missing_stream_usage",
    },
  };
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

function extractTextForTokenEstimate(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
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

  for (const key of ["content", "text", "arguments", "input", "messages", "tool_calls", "tools", "function"]) {
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
  const wordLikeTokens = nonCjkText.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)?.length ?? 0;
  return Math.max(1, Math.ceil(cjkChars * 1.15 + wordLikeTokens * 0.75));
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
    textLikeValueHasContent(record.delta) ||
    textLikeValueHasContent(record.tool_calls) ||
    textLikeValueHasContent(record.function_call) ||
    textLikeValueHasContent(record.function) ||
    textLikeValueHasContent(record.arguments)
  );
}
