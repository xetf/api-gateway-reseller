import { Readable } from "node:stream";
import { Prisma } from "@prisma/client";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "@gateway/db";
import { sanitizeJsonForPostgres } from "../lib/db-sanitize.js";
import { sendApiError } from "../lib/errors.js";
import { createRequestTraceCode } from "../lib/crypto.js";
import { usageFromOpenAIResponse, usageFromStreamChunk } from "../lib/usage.js";
import {
  chargeForRequest,
  ensureWalletCanStart,
  markRequestFailed,
} from "../services/billing.js";
import { requireApiKey } from "../services/auth.js";
import {
  createManualTerminateUsage,
  isManualTerminateError,
  manualTerminateMessage,
  manualTerminateStatusCode,
  registerActiveApiRequest,
  unregisterActiveApiRequest,
} from "../services/active-api-requests.js";
import { disableApiKeyIfTotalLimitReached } from "../services/api-key-limits.js";
import { recordModelPoolUserCallResult } from "../services/model-pool-call-failures.js";
import { recordStickyModelPoolResult } from "../services/model-pool-stickiness.js";
import {
  buildUpstreamUrl,
  getDefaultProvider,
  getProviderForModel,
} from "../services/upstream.js";
import {
  findIpBanRule,
  ipBanErrorUsageSource,
  ipBanNoticeUsageSource,
  type IpBanRule,
} from "../services/ip-ban-rules.js";
import {
  applyReasoningEffortTransform,
  getReasoningEffortFromBody,
} from "../services/reasoning-effort-transform-settings.js";
import {
  collectEncryptedContents,
  createCompactChannelFingerprint,
  extractEncryptedItems,
  findCachedCompactForBody,
  hashEncryptedContent,
  readTargetCompactItems,
  replaceCompactionItemsByEncryptedContentHashes,
  saveCompactCache,
  saveTargetCompactItems,
} from "../services/compact-cache.js";
import type { ApiRequestWithUser, Usage } from "../types.js";

type ModelRoute = NonNullable<Awaited<ReturnType<typeof getProviderForModel>>>;
type UpstreamAttemptRoute = {
  provider:
    | ModelRoute["provider"]
    | Awaited<ReturnType<typeof getDefaultProvider>>;
  price: ModelRoute["price"] | null;
  channelId?: string;
  upstreamProviderKeyId?: string;
  release?: () => Promise<void>;
};

type UpstreamAttemptResult =
  | { kind: "sent" }
  | {
      kind: "failed";
      statusCode: number;
      message: string;
      retryableFailure: boolean;
      responseBody?: string;
      responseContentType?: string;
    };

type CompactItemType = "compaction" | "compaction_summary";

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
const clientStreamClosedStatusCode = 499;
const clientStreamClosedMessage =
  "Client closed the stream before the gateway finished sending the response";
const missingUsageMessage =
  "Upstream response did not include billable token usage";
const staleResponsesContextNotice =
  "这个会话的上下文已经失效，不能继续接着上一轮回答。请新建对话，或清空当前会话上下文后重试。";
const invalidEncryptedContentNotice =
  "当前会话上下文暂时不可继续，请稍后重试，或新建对话后继续。";
const missingUsageNotice = "请新建对话或清空当前会话上下文后重试。";
const recoveryNoticeUsageSource = "gateway_recovery_notice";

type CompactFallbackTrace = {
  gatewayCompactFallback: true;
  fallbackAttempted: boolean;
  fallbackSucceeded: boolean;
  replacements?: number;
  compactCacheId?: string;
  encryptedContentHash?: string;
  sourceFingerprint?: string;
  targetFingerprint?: string;
  targetCacheHit?: boolean;
  error?: string;
};

type CompactFallbackContext = {
  attempted: boolean;
  trace?: CompactFallbackTrace;
};

type GatewayRequestLimitLock =
  | {
      ok: true;
      release: () => Promise<void>;
    }
  | {
      ok: false;
      noticeText: string;
      release: () => Promise<void>;
    };

type GatewayConcurrencyLock =
  | {
      ok: true;
      release: () => Promise<void>;
    }
  | {
      ok: false;
      layer: "user" | "key";
      limit: number;
      release: () => Promise<void>;
    };

type GatewayRateLimitResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      layer: "user" | "key";
      limit: number;
      retryAfterSeconds: number;
    };

type EstimatedUsageReason =
  | "missing_stream_usage"
  | "missing_compact_stream_usage"
  | "missing_response_usage"
  | "missing_compact_response_usage";

export async function proxyRoutes(app: FastifyInstance) {
  for (const pattern of proxyRoutePatterns) {
    app.all(pattern, async (request: ApiRequestWithUser, reply) => {
      const rawEndpoint = request.url.split("?")[0] ?? request.url;
      const endpoint = normalizeEndpoint(rawEndpoint);
      const upstreamRequestUrl = normalizeRequestUrl(request.url);

      if (!isSupportedEndpoint(endpoint)) {
        return sendApiError(
          reply,
          404,
          "Endpoint not supported by this gateway",
        );
      }

      await requireApiKey(app, request, reply);
      if (reply.sent || !request.apiAuth) {
        return;
      }

      const body = (request.body ?? {}) as ProxyBody;
      const { apiKey, user } = request.apiAuth;
      const model = body.model;
      const clientIp = getClientIp(request);
      const ipBanRule = await findIpBanRule(clientIp);
      if (ipBanRule) {
        return sendIpBanResponse({
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          ipBanRule,
          clientIp,
          userId: user.id,
          apiKeyId: apiKey.id,
          method: request.method,
          userAgent: request.headers["user-agent"],
          acceptHeader: request.headers.accept,
        });
      }

      if (
        apiKey.noticeEnabled &&
        apiKey.noticeText?.trim() &&
        shouldReturnApiKeyNotice(endpoint, request.method)
      ) {
        return sendApiKeyNotice(
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          apiKey.noticeText,
          request.headers.accept,
        );
      }

      if (await disableApiKeyIfTotalLimitReached(apiKey)) {
        return sendApiError(
          reply,
          429,
          "API key total quota exceeded and has been disabled",
          "insufficient_quota",
        );
      }

      if (!isAllowedMethod(endpoint, request.method)) {
        return sendApiError(reply, 405, "Method not allowed");
      }

      const billable = isBillableEndpoint(endpoint, request.method);

      if (billable && !model) {
        return sendApiError(reply, 400, "Missing model");
      }

      if (
        model &&
        apiKey.allowedModels.length > 0 &&
        !apiKey.allowedModels.includes(model)
      ) {
        return sendApiError(
          reply,
          403,
          "Model is not allowed for this API key",
        );
      }

      if (
        model &&
        user.allowedModels.length > 0 &&
        !user.allowedModels.includes(model)
      ) {
        return sendApiError(reply, 403, "Model is not allowed for this user");
      }

      if (billable) {
        const walletCheck = await ensureWalletCanStart(user.id);
        if (!walletCheck.ok) {
          return sendApiError(
            reply,
            402,
            walletCheck.reason,
            "insufficient_quota",
          );
        }
      }

      const runtimeLimitLock = shouldCheckNewRequestLimits(
        endpoint,
        request.method,
      )
        ? await checkNewRequestLimits(app, {
            userId: user.id,
            userConcurrencyLimit: user.concurrencyLimit,
            userRateLimitPerMinute: user.rateLimitPerMinute,
            apiKeyId: apiKey.id,
            apiKeyConcurrencyLimit: apiKey.concurrencyLimit,
            apiKeyRateLimitPerMinute: apiKey.rateLimitPerMinute,
          })
        : createNoopConcurrencyLock();

      if (!runtimeLimitLock.ok) {
        return sendApiKeyNotice(
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          runtimeLimitLock.noticeText,
          request.headers.accept,
        );
      }

      const stickyIdentity = getGatewaySessionIdentity(
        request,
        body,
        apiKey.id,
      );
      let initialRoute: UpstreamAttemptRoute;
      try {
        initialRoute = await selectUpstreamRoute({
          billable,
          model,
          callerIdentity: stickyIdentity,
        });
      } catch (error) {
        await runtimeLimitLock.release();
        throw error;
      }
      const billableModel = billable ? model : undefined;

      if (billable && (!initialRoute.price || !initialRoute.price.enabled)) {
        await runtimeLimitLock.release();
        await initialRoute.release?.();
        return sendApiError(
          reply,
          400,
          `Model ${model} is not enabled on any active upstream`,
        );
      }

      const start = performance.now();
      bindConcurrencyRelease(reply, runtimeLimitLock.release);
      const routeRelease = createMutableLifecycleRelease(reply);
      routeRelease.set(initialRoute.release);

      const apiRequest = await prisma.apiRequest.create({
        data: {
          traceCode: createRequestTraceCode(),
          userId: user.id,
          apiKeyId: apiKey.id,
          upstreamProviderKeyId: getLoggedUpstreamProviderKeyId(initialRoute),
          upstreamProvider: initialRoute.provider.name,
          model: model ?? inferModelFromEndpoint(endpoint),
          reasoningEffort: getReasoningEffortFromBody(body),
          endpoint,
          method: request.method,
          status: "PENDING",
          clientIp,
          userAgent: request.headers["user-agent"],
          requestBody: redactBodyForLog(body) as Prisma.InputJsonValue,
          ...(endpoint === "/v1/responses/compact"
            ? {
                responseUsage: createNormalCompactResponseUsage(
                  "compact_request_in_progress",
                ) as Prisma.InputJsonValue,
              }
            : {}),
        },
      });

      let activeRoute = initialRoute;
      const skippedChannelIds = new Set<string>();
      const compactFallbackContext: CompactFallbackContext = {
        attempted: false,
      };

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const result = await runUpstreamAttempt({
          app,
          request,
          reply,
          body,
          endpoint,
          upstreamRequestUrl,
          apiRequestId: apiRequest.id,
          userId: user.id,
          apiKeyId: apiKey.id,
          callerIdentity: stickyIdentity,
          route: activeRoute,
          billable,
          model,
          billableModel,
          startedAt: start,
          attempt,
          compactFallbackContext,
        });

        if (result.kind === "sent") {
          return;
        }

        if (
          attempt >= 2 ||
          !billable ||
          !model ||
          !activeRoute.channelId ||
          reply.sent ||
          !result.retryableFailure
        ) {
          return sendFinalAttemptFailure(
            reply,
            apiRequest.id,
            result,
            start,
            compactFallbackContext,
          );
        }

        skippedChannelIds.add(activeRoute.channelId);
        const nextRoute = await selectUpstreamRoute({
          billable,
          model,
          callerIdentity: stickyIdentity,
          excludeChannelIds: [...skippedChannelIds],
          bypassSticky: true,
          skipStickyUpdate: true,
        });

        if (
          !nextRoute.channelId ||
          nextRoute.channelId === activeRoute.channelId ||
          !nextRoute.price?.enabled
        ) {
          await nextRoute.release?.();
          return sendFinalAttemptFailure(
            reply,
            apiRequest.id,
            result,
            start,
            compactFallbackContext,
          );
        }

        app.log.info(
          {
            model,
            requestId: apiRequest.id,
            fromChannelId: activeRoute.channelId,
            fromProvider: activeRoute.provider.name,
            toChannelId: nextRoute.channelId,
            toProvider: nextRoute.provider.name,
            status: result.statusCode,
          },
          "Retrying upstream request on another model pool channel",
        );
        await activeRoute.release?.();
        activeRoute = nextRoute;
        routeRelease.set(nextRoute.release);
        await updateApiRequestRoute(
          apiRequest.id,
          nextRoute,
          result.statusCode,
        );
      }
    });
  }
}

function bindConcurrencyRelease(
  reply: FastifyReply,
  release: () => Promise<void>,
) {
  bindLifecycleRelease(reply, release);
}

function bindLifecycleRelease(
  reply: FastifyReply,
  release: () => Promise<void>,
) {
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

function createMutableLifecycleRelease(reply: FastifyReply) {
  let release: (() => Promise<void>) | undefined;

  bindLifecycleRelease(reply, async () => {
    await release?.();
  });

  return {
    set(nextRelease: (() => Promise<void>) | undefined) {
      release = nextRelease;
    },
  };
}

async function selectUpstreamRoute(params: {
  billable: boolean;
  model?: string;
  callerIdentity: string;
  excludeChannelIds?: string[];
  bypassSticky?: boolean;
  skipStickyUpdate?: boolean;
}): Promise<UpstreamAttemptRoute> {
  const modelRoute =
    params.billable && params.model
      ? await getProviderForModel(params.callerIdentity, params.model, {
          excludeChannelIds: params.excludeChannelIds,
          bypassSticky: params.bypassSticky,
          skipStickyUpdate: params.skipStickyUpdate,
        })
      : null;

  if (modelRoute) {
    return {
      provider: modelRoute.provider,
      price: modelRoute.price,
      channelId: modelRoute.channelId,
      upstreamProviderKeyId: getLoggedUpstreamProviderKeyId(modelRoute),
      release: modelRoute.release,
    };
  }

  return {
    provider: await getDefaultProvider(),
    price: null,
  };
}

function getLoggedUpstreamProviderKeyId(
  route: Pick<UpstreamAttemptRoute, "upstreamProviderKeyId" | "provider">,
) {
  const providerKeyId =
    "upstreamProviderKeyId" in route.provider
      ? route.provider.upstreamProviderKeyId
      : undefined;
  const keyId = route.upstreamProviderKeyId ?? providerKeyId;
  return keyId === "env" ? undefined : keyId;
}

function getCompactChannelFingerprint(route: UpstreamAttemptRoute) {
  return createCompactChannelFingerprint({
    channelId: route.channelId,
    upstreamProviderKeyId:
      route.upstreamProviderKeyId ?? getLoggedUpstreamProviderKeyId(route),
    providerId: route.provider.id,
    providerName: route.provider.name,
    providerApiKey: route.provider.apiKey,
  });
}

async function applyCompactFallback(params: {
  app: FastifyInstance;
  endpoint: string;
  method: string;
  body: ProxyBody;
  route: UpstreamAttemptRoute;
  apiRequestId: string;
  userId: string;
  apiKeyId: string;
  model?: string;
  compactFallbackContext: CompactFallbackContext;
}): Promise<ProxyBody> {
  const {
    app,
    endpoint,
    method,
    body,
    route,
    apiRequestId,
    userId,
    apiKeyId,
    model,
    compactFallbackContext,
  } = params;
  if (
    endpoint !== "/v1/responses" ||
    method !== "POST" ||
    compactFallbackContext.attempted
  ) {
    return body;
  }

  let cachedCompact: Awaited<ReturnType<typeof findCachedCompactForBody>>;
  try {
    cachedCompact = await findCachedCompactForBody(body);
  } catch (error) {
    app.log.warn(
      { error },
      "Responses compact cache lookup failed; continuing original request",
    );
    return body;
  }

  if (!cachedCompact) {
    return body;
  }

  if (
    cachedCompact.cache.userId !== userId ||
    cachedCompact.cache.apiKeyId !== apiKeyId ||
    cachedCompact.cache.model !== model
  ) {
    app.log.warn(
      {
        compactCacheId: cachedCompact.compactCacheId,
        encryptedContentHash: cachedCompact.encryptedContentHash,
      },
      "Responses compact cache ownership mismatch; continuing original request",
    );
    return body;
  }

  const targetFingerprint = getCompactChannelFingerprint(route);
  if (cachedCompact.cache.sourceFingerprint === targetFingerprint) {
    return body;
  }

  if (isCompactFallbackDisabledForUser(userId)) {
    app.log.info(
      {
        compactCacheId: cachedCompact.compactCacheId,
        userId,
      },
      "Responses compact fallback disabled for user; continuing original request",
    );
    return body;
  }

  const targetCacheHit = await readTargetCompactItems({
    compactCacheId: cachedCompact.compactCacheId,
    targetFingerprint,
  });
  if (targetCacheHit) {
    const replacementsByHash = buildCompactFallbackReplacements(
      cachedCompact.cache.encryptedContentHashes,
      targetCacheHit,
      getTargetCompactItemType(route),
    );
    const replaced = replaceCompactionItemsByEncryptedContentHashes(
      body,
      replacementsByHash,
    );
    if (replaced.replacements > 0) {
      compactFallbackContext.attempted = true;
      compactFallbackContext.trace = {
        gatewayCompactFallback: true,
        fallbackAttempted: false,
        fallbackSucceeded: true,
        replacements: replaced.replacements,
        compactCacheId: cachedCompact.compactCacheId,
        encryptedContentHash: cachedCompact.encryptedContentHash,
        sourceFingerprint: cachedCompact.cache.sourceFingerprint,
        targetFingerprint,
        targetCacheHit: true,
      };
      return replaced.value;
    }
  }

  compactFallbackContext.attempted = true;
  const trace: CompactFallbackTrace = {
    gatewayCompactFallback: true,
    fallbackAttempted: true,
    fallbackSucceeded: false,
    compactCacheId: cachedCompact.compactCacheId,
    encryptedContentHash: cachedCompact.encryptedContentHash,
    sourceFingerprint: cachedCompact.cache.sourceFingerprint,
    targetFingerprint,
  };
  compactFallbackContext.trace = trace;
  await prisma.apiRequest.updateMany({
    where: {
      id: apiRequestId,
      status: "PENDING",
    },
    data: {
      responseUsage: createCompactFallbackResponseUsage(
        trace,
        "compact_fallback_in_progress",
      ) as Prisma.InputJsonValue,
    },
  });

  try {
    const targetCompactItems = await requestTargetCompact({
      route,
      requestBody: cachedCompact.cache.requestBody,
    });
    await saveTargetCompactItems({
      compactCacheId: cachedCompact.compactCacheId,
      targetFingerprint,
      targetItems: targetCompactItems,
    });
    const replacementsByHash = buildCompactFallbackReplacements(
      cachedCompact.cache.encryptedContentHashes,
      targetCompactItems,
      getTargetCompactItemType(route),
    );
    const replaced = replaceCompactionItemsByEncryptedContentHashes(
      body,
      replacementsByHash,
    );
    trace.replacements = replaced.replacements;
    trace.fallbackSucceeded = replaced.replacements > 0;

    return replaced.replacements > 0 ? replaced.value : body;
  } catch (error) {
    trace.error =
      error instanceof Error ? error.message : "compact fallback failed";
    compactFallbackContext.trace = undefined;
    app.log.warn(
      {
        error,
        compactCacheId: cachedCompact.compactCacheId,
        targetFingerprint,
      },
      "Responses compact fallback failed; continuing original request",
    );
    return body;
  }

  function isCompactFallbackDisabledForUser(userId: string) {
    const disabledUserIds = (
      process.env.GATEWAY_COMPACT_FALLBACK_DISABLED_USER_IDS ?? ""
    )
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    return disabledUserIds.includes(userId);
  }
}

async function recoverInvalidEncryptedContentWithCompact(params: {
  app: FastifyInstance;
  body: ProxyBody;
  route: UpstreamAttemptRoute;
  apiRequestId: string;
  userId: string;
  apiKeyId: string;
  model?: string;
  compactFallbackContext: CompactFallbackContext;
}): Promise<ProxyBody | null> {
  const {
    app,
    body,
    route,
    apiRequestId,
    userId,
    apiKeyId,
    model,
    compactFallbackContext,
  } = params;

  let cachedCompact: Awaited<ReturnType<typeof findCachedCompactForBody>>;
  try {
    cachedCompact = await findCachedCompactForBody(body);
  } catch (error) {
    app.log.warn(
      { error },
      "Responses compact cache lookup failed during invalid encrypted content recovery",
    );
    return null;
  }

  if (!cachedCompact) {
    return null;
  }

  if (
    cachedCompact.cache.userId !== userId ||
    cachedCompact.cache.apiKeyId !== apiKeyId ||
    cachedCompact.cache.model !== model
  ) {
    app.log.warn(
      {
        compactCacheId: cachedCompact.compactCacheId,
        encryptedContentHash: cachedCompact.encryptedContentHash,
      },
      "Responses compact cache ownership mismatch during invalid encrypted content recovery",
    );
    return null;
  }

  const targetFingerprint = getCompactChannelFingerprint(route);
  compactFallbackContext.attempted = true;
  const trace: CompactFallbackTrace = {
    gatewayCompactFallback: true,
    fallbackAttempted: true,
    fallbackSucceeded: false,
    compactCacheId: cachedCompact.compactCacheId,
    encryptedContentHash: cachedCompact.encryptedContentHash,
    sourceFingerprint: cachedCompact.cache.sourceFingerprint,
    targetFingerprint,
  };
  compactFallbackContext.trace = trace;
  await prisma.apiRequest.updateMany({
    where: {
      id: apiRequestId,
      status: "PENDING",
    },
    data: {
      responseUsage: createCompactFallbackResponseUsage(
        trace,
        "invalid_encrypted_content_recovery_in_progress",
      ) as Prisma.InputJsonValue,
    },
  });

  try {
    const targetCompactItems = await requestTargetCompact({
      route,
      requestBody: cachedCompact.cache.requestBody,
    });
    await saveTargetCompactItems({
      compactCacheId: cachedCompact.compactCacheId,
      targetFingerprint,
      targetItems: targetCompactItems,
    });
    const replacementsByHash = buildCompactFallbackReplacements(
      cachedCompact.cache.encryptedContentHashes,
      targetCompactItems,
      getTargetCompactItemType(route),
    );
    const replaced = replaceCompactionItemsByEncryptedContentHashes(
      body,
      replacementsByHash,
    );
    trace.replacements = replaced.replacements;
    trace.fallbackSucceeded = replaced.replacements > 0;

    return replaced.replacements > 0 ? replaced.value : null;
  } catch (error) {
    trace.error =
      error instanceof Error
        ? error.message
        : "invalid encrypted content recovery compact failed";
    app.log.warn(
      {
        error,
        compactCacheId: cachedCompact.compactCacheId,
        targetFingerprint,
      },
      "Responses compact recovery failed; continuing original invalid encrypted content handling",
    );
    return null;
  }
}

function buildCompactFallbackReplacements(
  sourceEncryptedContentHashes: string[],
  targetItems: Array<{ encryptedContent: string; item: unknown }>,
  targetItemType: CompactItemType,
) {
  const replacements = new Map<string, unknown>();
  const maxLength = Math.min(
    sourceEncryptedContentHashes.length,
    targetItems.length,
  );
  for (let index = 0; index < maxLength; index += 1) {
    const sourceHash = sourceEncryptedContentHashes[index];
    const targetItem = targetItems[index];
    if (sourceHash && targetItem) {
      replacements.set(
        sourceHash,
        normalizeCompactItemForTarget(targetItem.item, targetItemType),
      );
    }
  }
  return replacements;
}

function getTargetCompactItemType(route: UpstreamAttemptRoute): CompactItemType {
  const value =
    "compactItemType" in route.provider
      ? route.provider.compactItemType
      : undefined;
  return value === "compaction" ? "compaction" : "compaction_summary";
}

function normalizeCompactItemForTarget(
  item: unknown,
  targetItemType: CompactItemType,
) {
  if (!isPlainObject(item)) {
    return item;
  }

  const encryptedContent = item.encrypted_content;
  if (typeof encryptedContent !== "string" || !encryptedContent) {
    return item;
  }

  if (targetItemType === "compaction") {
    const { id: _id, object: _object, ...rest } = item;
    return {
      ...rest,
      type: "compaction",
      encrypted_content: encryptedContent,
    };
  }

  return {
    ...item,
    id:
      typeof item.id === "string" && item.id
        ? item.id
        : `compact_${hashEncryptedContent(encryptedContent).slice(0, 24)}`,
    type: "compaction_summary",
    encrypted_content: encryptedContent,
  };
}

async function requestTargetCompact(params: {
  route: UpstreamAttemptRoute;
  requestBody: unknown;
}): Promise<Array<{ encryptedContent: string; item: unknown }>> {
  const { route, requestBody } = params;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    route.provider.timeoutMs,
  );
  try {
    const response = await fetch(
      buildUpstreamUrl(route.provider.baseUrl, "/v1/responses/compact"),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${route.provider.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(buildInternalCompactRequestBody(requestBody)),
        signal: controller.signal,
      },
    );
    const contentType = response.headers.get("content-type") ?? "";
    const responseBody = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message =
        typeof responseBody === "string"
          ? responseBody.slice(0, 1000)
          : JSON.stringify(responseBody).slice(0, 1000);
      throw new Error(
        `compact fallback upstream failed with ${response.status}: ${message}`,
      );
    }

    const parsedResponseBody =
      typeof responseBody === "string" &&
      contentType.includes("text/event-stream")
        ? parseSseJsonPayloads(responseBody)
        : responseBody;
    const encryptedItems = extractEncryptedItems(parsedResponseBody);
    if (encryptedItems.length === 0) {
      throw new Error("compact fallback response missing encrypted_content");
    }

    return encryptedItems;
  } finally {
    clearTimeout(timeout);
  }
}

function buildInternalCompactRequestBody(requestBody: unknown) {
  if (!isPlainObject(requestBody)) {
    return requestBody;
  }

  const compactBody = { ...requestBody };
  delete compactBody.stream;
  delete compactBody.stream_options;
  return compactBody;
}

async function updateApiRequestRoute(
  requestId: string,
  route: UpstreamAttemptRoute,
  previousStatusCode?: number,
) {
  await prisma.apiRequest.update({
    where: { id: requestId },
    data: {
      upstreamProvider: route.provider.name,
      upstreamProviderKeyId: getLoggedUpstreamProviderKeyId(route),
      httpStatus: previousStatusCode,
    },
  });
}

async function sendFinalAttemptFailure(
  reply: FastifyReply,
  requestId: string,
  result: Extract<UpstreamAttemptResult, { kind: "failed" }>,
  startedAt: number,
  compactFallbackContext?: CompactFallbackContext,
) {
  await markRequestFailed(
    { id: requestId },
    result.message,
    result.statusCode,
    Math.round(performance.now() - startedAt),
    compactFallbackContext?.trace
      ? createCompactFallbackResponseUsage(
          compactFallbackContext.trace,
          "final_attempt_failure",
        )
      : undefined,
  );

  if (result.responseBody !== undefined) {
    reply.status(result.statusCode);
    reply.header(
      "content-type",
      result.responseContentType ?? "application/json",
    );
    return reply.send(result.responseBody);
  }

  return sendApiError(
    reply,
    result.statusCode,
    result.message,
    result.statusCode === 504 ? "timeout_error" : "upstream_error",
  );
}

async function runUpstreamAttempt(params: {
  app: FastifyInstance;
  request: ApiRequestWithUser;
  reply: FastifyReply;
  body: ProxyBody;
  endpoint: string;
  upstreamRequestUrl: string;
  apiRequestId: string;
  userId: string;
  apiKeyId: string;
  callerIdentity: string;
  route: UpstreamAttemptRoute;
  billable: boolean;
  model?: string;
  billableModel?: string;
  startedAt: number;
  attempt: number;
  compactFallbackContext: CompactFallbackContext;
  invalidCompactRetryAttempted?: boolean;
}): Promise<UpstreamAttemptResult> {
  const {
    app,
    request,
    reply,
    body,
    endpoint,
    upstreamRequestUrl,
    apiRequestId,
    userId,
    apiKeyId,
    callerIdentity,
    route,
    billable,
    model,
    billableModel,
    startedAt,
    compactFallbackContext,
    invalidCompactRetryAttempted,
  } = params;
  const { provider, price, channelId } = route;
  const upstreamProviderKeyId = getLoggedUpstreamProviderKeyId(route);
  const fallbackBody = await applyCompactFallback({
    app,
    endpoint,
    method: request.method,
    body,
    route,
    apiRequestId,
    userId,
    apiKeyId,
    model,
    compactFallbackContext,
  });
  const upstreamBody = await applyReasoningEffortTransform(
    buildUpstreamBody(endpoint, fallbackBody, provider),
  );
  const actualReasoningEffort = getReasoningEffortFromBody(upstreamBody);
  if (actualReasoningEffort) {
    await prisma.apiRequest.update({
      where: { id: apiRequestId },
      data: { reasoningEffortActual: actualReasoningEffort },
    });
  }
  let activeController: AbortController | undefined;
  let activeControllerHandedOff = false;

  try {
    const controller = new AbortController();
    activeController = controller;
    registerActiveApiRequest(apiRequestId, controller);
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
        body:
          request.method === "GET" || request.method === "DELETE"
            ? undefined
            : JSON.stringify(upstreamBody),
        signal: controller.signal,
      },
    ).finally(() => {
      clearTimeout(timeout);
    });

    await prisma.apiRequest.update({
      where: { id: apiRequestId },
      data: {
        upstreamProvider: provider.name,
        upstreamProviderKeyId,
        httpStatus: upstreamResponse.status,
        upstreamRequestId: upstreamResponse.headers.get("x-request-id"),
      },
    });

    if (!upstreamResponse.ok) {
      const text = await upstreamResponse.text();
      const statusCode = upstreamResponse.status;
      const retryableFailure = isRetryableUpstreamFailure(statusCode, text);

      if (
        endpoint === "/v1/responses" &&
        request.method === "POST" &&
        !invalidCompactRetryAttempted &&
        isInvalidEncryptedContentError(text)
      ) {
        const recoveredBody = await recoverInvalidEncryptedContentWithCompact({
          app,
          body: fallbackBody,
          route,
          apiRequestId,
          userId,
          apiKeyId,
          model,
          compactFallbackContext,
        });

        if (recoveredBody) {
          return runUpstreamAttempt({
            ...params,
            body: recoveredBody,
            invalidCompactRetryAttempted: true,
          });
        }
      }

      if (
        retryableFailure &&
        params.attempt < 2 &&
        billable &&
        model &&
        channelId
      ) {
        await recordFailedChannelAttempt({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          upstreamProviderKeyId,
          retryableFailure,
          startedAt,
          logger: app.log,
        });
        return {
          kind: "failed",
          statusCode,
          message: text.slice(0, 2000),
          retryableFailure,
          responseBody: text,
          responseContentType:
            upstreamResponse.headers.get("content-type") ?? "application/json",
        };
      }

      const recoveryNotice = getGatewayRecoveryNotice(text);
      await markRequestFailed(
        { id: apiRequestId },
        text.slice(0, 2000),
        statusCode,
        Math.round(performance.now() - startedAt),
        compactFallbackContext.trace
          ? createCompactFallbackResponseUsage(
              compactFallbackContext.trace,
              "upstream_non_ok",
            )
          : undefined,
      );
      if (recoveryNotice && endpoint !== "/v1/responses/compact") {
        await markRecoveryNoticeReturned(
          apiRequestId,
          recoveryNotice,
          "upstream_non_ok",
          compactFallbackContext.trace,
          endpoint === "/v1/responses/compact"
            ? createNormalCompactResponseUsage("compact_request_failed")
            : undefined,
        );
        sendApiKeyNotice(
          reply,
          endpoint,
          body,
          upstreamRequestUrl,
          recoveryNotice,
          request.headers.accept,
        );
        return { kind: "sent" };
      }
      if (billable && model) {
        await recordFailedChannelAttempt({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          upstreamProviderKeyId,
          retryableFailure,
          startedAt,
          logger: app.log,
        });
      }
      reply.status(statusCode);
      reply.header(
        "content-type",
        upstreamResponse.headers.get("content-type") ?? "application/json",
      );
      reply.send(text);
      return { kind: "sent" };
    }

    const shouldStream = shouldStreamResponse(
      upstreamResponse,
      body,
      upstreamRequestUrl,
      endpoint,
    );

    if (shouldStream && billable && price) {
      activeControllerHandedOff = true;
      await proxyStream({
        reply,
        upstreamResponse,
        activeController: controller,
        apiRequestId,
        endpoint,
        requestBody: upstreamBody,
        userId,
        callerIdentity,
        apiKeyId,
        priceId: price.id,
        model: billableModel ?? price.model,
        channelId,
        upstreamProviderKeyId,
        startedAt,
        logger: app.log,
        compactFallbackTrace: compactFallbackContext.trace,
        compactCacheRequestBody:
          endpoint === "/v1/responses/compact" ? body : undefined,
        compactCacheSourceFingerprint:
          endpoint === "/v1/responses/compact"
            ? getCompactChannelFingerprint(route)
            : undefined,
      });
      return { kind: "sent" };
    }

    if (shouldStream) {
      activeControllerHandedOff = true;
      await proxyPassthroughStream({
        reply,
        upstreamResponse,
        activeController: controller,
        apiRequestId,
        startedAt,
      });
      return { kind: "sent" };
    }

    const contentType = upstreamResponse.headers.get("content-type") ?? "";
    const rawBody = await safeReadUpstreamBody(upstreamResponse, {
      logger: app.log,
      maxBytes: getUpstreamResponseMaxBytes(endpoint),
    });
    if ("error" in rawBody) {
      await markRequestFailed(
        { id: apiRequestId },
        rawBody.error.message,
        rawBody.error.statusCode,
        Math.round(performance.now() - startedAt),
      );
      reply.status(rawBody.error.statusCode);
      reply.header("content-type", "application/json");
      reply.send({ error: rawBody.error.message });
      return { kind: "sent" };
    }
    const responseBody = contentType.includes("application/json")
      ? rawBody.json
      : contentType.includes("text/event-stream")
        ? parseSseJsonPayloads(rawBody.text)
        : rawBody.text;

    let normalCompactUsageMetadata:
      | ReturnType<typeof createNormalCompactResponseUsage>
      | undefined;
    if (endpoint === "/v1/responses/compact") {
      const compactCacheResult = await cacheCompactResponse({
        logger: app.log,
        requestBody: body,
        responseBody,
        userId,
        apiKeyId,
        model,
        route,
      });
      if (compactCacheResult?.saved) {
        normalCompactUsageMetadata = createNormalCompactResponseUsage(
          "compact_request_completed",
          {
            compactCacheId: compactCacheResult.compactCacheId,
            encryptedContentHashes: compactCacheResult.encryptedContentHashes,
            sourceFingerprint: getCompactChannelFingerprint(route),
          },
        );
      }
    }

    if (!billable || !price) {
      await prisma.apiRequest.update({
        where: { id: apiRequestId },
        data: {
          status: "SUCCESS",
          latencyMs: Math.round(performance.now() - startedAt),
        },
      });

      reply.status(upstreamResponse.status);
      reply.header("content-type", contentType || "application/json");
      reply.send(responseBody);
      return { kind: "sent" };
    }

    let usage = usageFromOpenAIResponse(responseBody);
    if (usage.totalTokens <= 0) {
      const estimatedUsage = estimateUsageFromResponse(
        endpoint,
        upstreamBody,
        responseBody,
      );
      if (estimatedUsage) {
        usage = estimatedUsage;
        app.log.warn(
          { apiRequestId, model: billableModel ?? price.model, channelId },
          "Upstream response did not include usage; using estimated billable usage",
        );
      }
    }
    if (normalCompactUsageMetadata) {
      usage.raw = isPlainObject(usage.raw)
        ? { ...usage.raw, ...normalCompactUsageMetadata }
        : normalCompactUsageMetadata;
    }
    usage = withCompactFallbackUsage(usage, compactFallbackContext.trace);
    assertBillableUsage(usage);
    await chargeForRequest({
      requestId: apiRequestId,
      userId,
      price,
      usage,
      startedAt,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    await recordStickyModelPoolResult({
      callerIdentity,
      model: billableModel ?? price.model,
      channelId,
      upstreamProviderKeyId,
      streamed: false,
      firstTokenLatencyMs: null,
      latencyMs,
      ignoreSlowPenalty:
        endpoint === "/v1/responses/compact" ||
        compactFallbackContext.trace?.gatewayCompactFallback === true,
    });
    await recordModelPoolUserCallResult({
      userId,
      apiKeyId,
      callerIdentity,
      model: billableModel ?? price.model,
      channelId,
      failed: false,
      firstTokenLatencyMs: null,
      latencyMs,
      logger: app.log,
    });

    reply.status(upstreamResponse.status);
    reply.header("content-type", contentType || "application/json");
    reply.send(responseBody);
    return { kind: "sent" };
  } catch (error) {
    const manualTerminated = isManualTerminateError(error);
    const message = manualTerminated
      ? manualTerminateMessage
      : error instanceof Error
        ? error.message
        : "Upstream request failed";
    const statusCode = manualTerminated ? manualTerminateStatusCode : 502;
    const retryableFailure = isRetryableProxyError(error, endpoint);

    if (
      !manualTerminated &&
      retryableFailure &&
      params.attempt < 2 &&
      billable &&
      model &&
      channelId
    ) {
      await recordFailedChannelAttempt({
        userId,
        apiKeyId,
        callerIdentity,
        model,
        channelId,
        upstreamProviderKeyId,
        retryableFailure,
        startedAt,
        ignoreSlowPenalty:
          endpoint === "/v1/responses/compact" ||
          compactFallbackContext.trace?.gatewayCompactFallback === true,
        logger: app.log,
      });
      return {
        kind: "failed",
        statusCode,
        message,
        retryableFailure,
      };
    }

    const recoveryNotice = getGatewayRecoveryNotice(error);
    await markRequestFailed(
      { id: apiRequestId },
      message,
      statusCode,
      Math.round(performance.now() - startedAt),
      createFailureResponseUsage({
        manualTerminated,
        compactFallbackTrace: compactFallbackContext.trace,
        reason: "proxy_catch",
      }),
    );
    if (recoveryNotice && endpoint !== "/v1/responses/compact") {
      await markRecoveryNoticeReturned(
        apiRequestId,
        recoveryNotice,
        "proxy_catch",
        compactFallbackContext.trace,
        endpoint === "/v1/responses/compact"
          ? createNormalCompactResponseUsage("compact_request_failed")
          : undefined,
      );
      sendApiKeyNotice(
        reply,
        endpoint,
        body,
        upstreamRequestUrl,
        recoveryNotice,
        request.headers.accept,
      );
      return { kind: "sent" };
    }
    if (billable && model && !manualTerminated) {
      await recordFailedChannelAttempt({
        userId,
        apiKeyId,
        callerIdentity,
        model,
        channelId,
        upstreamProviderKeyId,
        retryableFailure,
        startedAt,
        ignoreSlowPenalty:
          endpoint === "/v1/responses/compact" ||
          compactFallbackContext.trace?.gatewayCompactFallback === true,
        logger: app.log,
      });
    }
    return {
      kind: "failed",
      statusCode,
      message,
      retryableFailure,
    };
  } finally {
    if (activeController && !activeControllerHandedOff) {
      unregisterActiveApiRequest(apiRequestId, activeController);
    }
  }
}

async function recordFailedChannelAttempt(params: {
  userId: string;
  apiKeyId: string;
  callerIdentity: string;
  model: string;
  channelId?: string;
  upstreamProviderKeyId?: string | null;
  retryableFailure: boolean;
  startedAt: number;
  ignoreSlowPenalty?: boolean;
  logger?: {
    warn: (value: unknown, message?: string) => void;
    info?: (value: unknown, message?: string) => void;
  };
}) {
  if (!params.retryableFailure) {
    return;
  }

  const latencyMs = Math.round(performance.now() - params.startedAt);
  await recordStickyModelPoolResult({
    callerIdentity: params.callerIdentity,
    model: params.model,
    channelId: params.channelId,
    upstreamProviderKeyId: params.upstreamProviderKeyId,
    failed: params.retryableFailure,
    streamed: false,
    latencyMs,
    ignoreSlowPenalty: params.ignoreSlowPenalty,
  });
  await recordModelPoolUserCallResult({
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    callerIdentity: params.callerIdentity,
    model: params.model,
    channelId: params.channelId,
    failed: params.retryableFailure,
    retryableFailure: params.retryableFailure,
    latencyMs,
    logger: params.logger,
  });
}

function createNoopConcurrencyLock(): GatewayRequestLimitLock {
  return {
    ok: true,
    release: async () => {},
  };
}

async function checkNewRequestLimits(
  app: FastifyInstance,
  params: {
    userId: string;
    userConcurrencyLimit: number;
    userRateLimitPerMinute: number;
    apiKeyId: string;
    apiKeyConcurrencyLimit: number;
    apiKeyRateLimitPerMinute: number;
  },
): Promise<GatewayRequestLimitLock> {
  const concurrencyLock = await acquireGatewayConcurrency(app, params);
  if (!concurrencyLock.ok) {
    return {
      ok: false,
      noticeText: concurrencyNotice(
        concurrencyLock.layer,
        concurrencyLock.limit,
      ),
      release: concurrencyLock.release,
    };
  }

  const rateLimit = await checkGatewayRateLimit(app, params);
  if (!rateLimit.ok) {
    await concurrencyLock.release();
    return {
      ok: false,
      noticeText: rateLimitNotice(
        rateLimit.layer,
        rateLimit.limit,
        rateLimit.retryAfterSeconds,
      ),
      release: async () => {},
    };
  }

  return concurrencyLock;
}

async function acquireGatewayConcurrency(
  app: FastifyInstance,
  params: {
    userId: string;
    userConcurrencyLimit: number;
    apiKeyId: string;
    apiKeyConcurrencyLimit: number;
  },
): Promise<GatewayConcurrencyLock> {
  const userLock = await acquireConcurrencySlot(app, {
    layer: "user",
    key: `concurrency:user:${params.userId}`,
    limit: params.userConcurrencyLimit,
    logContext: { userId: params.userId, layer: "user" },
  });

  if (!userLock.ok) {
    return {
      ok: false,
      layer: "user",
      limit: params.userConcurrencyLimit,
      release: userLock.release,
    };
  }

  const apiKeyLock = await acquireConcurrencySlot(app, {
    layer: "key",
    key: `concurrency:${params.apiKeyId}`,
    limit: params.apiKeyConcurrencyLimit,
    logContext: { apiKeyId: params.apiKeyId, layer: "key" },
  });

  if (!apiKeyLock.ok) {
    await userLock.release();
    return {
      ok: false,
      layer: "key",
      limit: params.apiKeyConcurrencyLimit,
      release: apiKeyLock.release,
    };
  }

  return {
    ok: true,
    release: async () => {
      await Promise.all([apiKeyLock.release(), userLock.release()]);
    },
  };
}

async function acquireConcurrencySlot(
  app: FastifyInstance,
  params: {
    layer: "user" | "key";
    key: string;
    limit: number;
    logContext: Record<string, unknown>;
  },
): Promise<GatewayConcurrencyLock> {
  const { layer, key, limit, logContext } = params;
  if (limit <= 0) {
    return {
      ok: true as const,
      release: async () => {},
    };
  }

  try {
    const count = await app.redis.incr(key);
    if (count === 1) {
      await app.redis.expire(key, 120);
    }

    if (count > limit) {
      await app.redis.decr(key);
      return {
        ok: false as const,
        layer,
        limit,
        release: async () => {},
      };
    }

    let released = false;
    const refreshTtl = setInterval(() => {
      void app.redis.expire(key, 120).catch((error: unknown) => {
        app.log.warn(
          { error, ...logContext },
          "Failed to refresh gateway concurrency lock",
        );
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
          app.log.warn(
            { error, ...logContext },
            "Failed to release gateway concurrency slot",
          );
        }
      },
    };
  } catch (error) {
    app.log.warn(
      { error, ...logContext },
      "Redis concurrency check failed, allowing request",
    );
    return {
      ok: true as const,
      release: async () => {},
    };
  }
}

async function checkGatewayRateLimit(
  app: FastifyInstance,
  params: {
    userId: string;
    userRateLimitPerMinute: number;
    apiKeyId: string;
    apiKeyRateLimitPerMinute: number;
  },
): Promise<GatewayRateLimitResult> {
  const userLimit = normalizeRuntimeLimit(params.userRateLimitPerMinute);
  const apiKeyLimit = normalizeRuntimeLimit(params.apiKeyRateLimitPerMinute);

  if (userLimit <= 0 && apiKeyLimit <= 0) {
    return { ok: true };
  }

  const now = Date.now();
  const minuteBucket = Math.floor(now / 60000);
  const retryAfterSeconds = secondsUntilNextMinute(now);

  try {
    const result = await app.redis.eval(
      `
      local userLimit = tonumber(ARGV[1]) or 0
      local keyLimit = tonumber(ARGV[2]) or 0
      local ttl = tonumber(ARGV[3]) or 70
      local userCurrent = 0
      local keyCurrent = 0

      if userLimit > 0 then
        userCurrent = tonumber(redis.call("GET", KEYS[1]) or "0") or 0
        if userCurrent >= userLimit then
          return {0, "user", userLimit}
        end
      end

      if keyLimit > 0 then
        keyCurrent = tonumber(redis.call("GET", KEYS[2]) or "0") or 0
        if keyCurrent >= keyLimit then
          return {0, "key", keyLimit}
        end
      end

      if userLimit > 0 then
        redis.call("INCR", KEYS[1])
        redis.call("EXPIRE", KEYS[1], ttl)
      end

      if keyLimit > 0 then
        redis.call("INCR", KEYS[2])
        redis.call("EXPIRE", KEYS[2], ttl)
      end

      return {1, "", 0}
      `,
      2,
      `ratelimit:user:${params.userId}:${minuteBucket}`,
      `ratelimit:${params.apiKeyId}:${minuteBucket}`,
      userLimit,
      apiKeyLimit,
      70,
    );

    if (!Array.isArray(result)) {
      return { ok: true };
    }

    const [allowed, layer, limit] = result;
    if (Number(allowed) === 1) {
      return { ok: true };
    }

    const limitedLayer = layer === "user" ? "user" : "key";
    const numericLimit = Number(limit);
    return {
      ok: false,
      layer: limitedLayer,
      limit:
        Number.isFinite(numericLimit) && numericLimit > 0
          ? numericLimit
          : limitedLayer === "user"
            ? userLimit
            : apiKeyLimit,
      retryAfterSeconds,
    };
  } catch (error) {
    app.log.warn(
      { error, userId: params.userId, apiKeyId: params.apiKeyId },
      "Redis gateway rate limit check failed, allowing request",
    );
    return { ok: true };
  }
}

function normalizeRuntimeLimit(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function secondsUntilNextMinute(now: number) {
  return Math.max(1, 60 - (Math.floor(now / 1000) % 60));
}

function concurrencyNotice(layer: "user" | "key", limit: number) {
  if (layer === "user") {
    return `当前账号并发请求已达到 ${limit} 个，请等待已有请求完成后重试。`;
  }

  return `当前 API Key 并发请求已达到 ${limit} 个，请等待已有请求完成后重试。`;
}

function rateLimitNotice(
  layer: "user" | "key",
  limit: number,
  retryAfterSeconds: number,
) {
  if (layer === "user") {
    return `当前账号已达到每分钟 ${limit} 次请求限制，请约 ${retryAfterSeconds} 秒后重试。`;
  }

  return `当前 API Key 已达到每分钟 ${limit} 次请求限制，请约 ${retryAfterSeconds} 秒后重试。`;
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
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model
      : "gateway-notice";
  const accept = Array.isArray(acceptHeader)
    ? acceptHeader.join(",")
    : (acceptHeader ?? "");

  reply.status(200);
  reply.header("x-gateway-notice", "true");
  reply.header("cache-control", "no-store");

  if (
    requestAsksForStream(body, requestUrl) ||
    accept.includes("text/event-stream")
  ) {
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

  const text =
    typeof error === "string"
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
    (normalized.includes("item with id") &&
      normalized.includes("not found") &&
      normalized.includes("rs_")) ||
    (normalized.includes("previous_response_id") &&
      normalized.includes("not found"));

  if (isStoreFalseItemError) {
    return staleResponsesContextNotice;
  }

  if (isInvalidEncryptedContentError(normalized)) {
    return invalidEncryptedContentNotice;
  }

  if (normalized.includes(missingUsageMessage.toLowerCase())) {
    return missingUsageNotice;
  }

  return null;
}

function isInvalidEncryptedContentError(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const normalized = text.toLowerCase();
  return (
    normalized.includes("invalid_encrypted_content") ||
    normalized.includes("encrypted content could not be decrypted or parsed")
  );
}

async function markRecoveryNoticeReturned(
  requestId: string,
  noticeText: string,
  reason: string,
  compactFallbackTrace?: CompactFallbackTrace,
  extraUsage?: Record<string, unknown>,
) {
  await prisma.apiRequest.update({
    where: { id: requestId },
    data: {
      responseUsage: {
        source: recoveryNoticeUsageSource,
        returnedToUser: true,
        reason,
        noticeText,
        ...extraUsage,
        ...compactFallbackUsageFields(compactFallbackTrace),
      },
    },
  });
}

function withCompactFallbackUsage(
  usage: Usage,
  compactFallbackTrace?: CompactFallbackTrace,
): Usage {
  if (!compactFallbackTrace) {
    return usage;
  }

  return {
    ...usage,
    raw: {
      ...(isPlainObject(usage.raw) ? usage.raw : { upstreamUsage: usage.raw }),
      ...compactFallbackUsageFields(compactFallbackTrace),
    },
  };
}

function createFailureResponseUsage(params: {
  manualTerminated: boolean;
  compactFallbackTrace?: CompactFallbackTrace;
  reason: string;
}) {
  const manualUsage = params.manualTerminated
    ? createManualTerminateUsage(true)
    : undefined;
  if (!params.compactFallbackTrace) {
    return manualUsage;
  }

  return {
    ...(isPlainObject(manualUsage)
      ? manualUsage
      : { source: "gateway_compact_fallback" }),
    reason: params.reason,
    ...compactFallbackUsageFields(params.compactFallbackTrace),
  };
}

function createCompactFallbackResponseUsage(
  compactFallbackTrace: CompactFallbackTrace,
  reason: string,
) {
  return {
    source: "gateway_compact_fallback",
    reason,
    gatewayCompactKind: "fallback",
    ...compactFallbackUsageFields(compactFallbackTrace),
  };
}

function createNormalCompactResponseUsage(
  reason: string,
  compact?: {
    compactCacheId: string;
    encryptedContentHashes: string[];
    sourceFingerprint: string;
  },
) {
  return {
    source: "gateway_compact",
    reason,
    gatewayCompactKind: "normal",
    ...(compact
      ? {
          compactCacheId: compact.compactCacheId,
          encryptedContentHashes: compact.encryptedContentHashes,
          sourceFingerprint: compact.sourceFingerprint,
        }
      : {}),
  };
}

function compactFallbackUsageFields(
  compactFallbackTrace?: CompactFallbackTrace,
) {
  if (!compactFallbackTrace) {
    return {};
  }

  return {
    gatewayCompactFallback: true,
    fallbackAttempted: compactFallbackTrace.fallbackAttempted,
    fallbackSucceeded: compactFallbackTrace.fallbackSucceeded,
    compactFallback: compactFallbackTrace,
  };
}

async function sendIpBanResponse(params: {
  reply: FastifyReply;
  endpoint: string;
  body: ProxyBody;
  upstreamRequestUrl: string;
  ipBanRule: IpBanRule;
  clientIp: string | null;
  userId: string;
  apiKeyId: string;
  method: string;
  userAgent?: string | string[];
  acceptHeader?: string | string[];
}) {
  const {
    reply,
    endpoint,
    body,
    upstreamRequestUrl,
    ipBanRule,
    clientIp,
    userId,
    apiKeyId,
    method,
    userAgent,
    acceptHeader,
  } = params;
  const noticeReturned =
    ipBanRule.mode === "notice" && shouldReturnApiKeyNotice(endpoint, method);
  const responseUsage = {
    source: noticeReturned ? ipBanNoticeUsageSource : ipBanErrorUsageSource,
    returnedToUser: noticeReturned,
    reason: "ip_ban",
    mode: ipBanRule.mode,
    ip: ipBanRule.ip,
    ...(noticeReturned ? { noticeText: ipBanRule.message } : {}),
  };
  const userAgentText = Array.isArray(userAgent)
    ? userAgent.join(", ")
    : userAgent;

  await prisma.apiRequest.create({
    data: {
      traceCode: createRequestTraceCode(),
      userId,
      apiKeyId,
      upstreamProvider: "gateway",
      model:
        typeof body.model === "string" && body.model.trim()
          ? body.model
          : inferModelFromEndpoint(endpoint),
      reasoningEffort: getReasoningEffortFromBody(body),
      reasoningEffortActual: getReasoningEffortFromBody(body),
      endpoint,
      method,
      status: "FAILED",
      httpStatus: noticeReturned ? 200 : 403,
      errorMessage: `IP banned: ${ipBanRule.ip}${ipBanRule.reason ? ` (${ipBanRule.reason})` : ""}`,
      clientIp,
      userAgent: userAgentText,
      requestBody: redactBodyForLog(body) as Prisma.InputJsonValue,
      responseUsage,
    },
  });

  if (noticeReturned) {
    return sendApiKeyNotice(
      reply,
      endpoint,
      body,
      upstreamRequestUrl,
      ipBanRule.message,
      acceptHeader,
    );
  }

  return sendApiError(reply, 403, ipBanRule.message, "access_denied");
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

async function cacheCompactResponse(params: {
  logger?: {
    warn: (value: unknown, message?: string) => void;
  };
  requestBody: unknown;
  responseBody: unknown;
  userId: string;
  apiKeyId: string;
  model?: string;
  route?: UpstreamAttemptRoute;
  sourceFingerprint?: string;
}) {
  const sourceFingerprint =
    params.sourceFingerprint ??
    (params.route ? getCompactChannelFingerprint(params.route) : undefined);
  if (!sourceFingerprint) {
    return;
  }

  try {
    const result = await saveCompactCache({
      requestBody: params.requestBody,
      responseBody: params.responseBody,
      userId: params.userId,
      apiKeyId: params.apiKeyId,
      model: params.model ?? inferModelFromBody(params.requestBody),
      sourceFingerprint,
    });

    if (!result.saved && result.reason !== "no_encrypted_content") {
      params.logger?.warn(
        { reason: result.reason },
        "Responses compact result was not cached",
      );
    }

    return result;
  } catch (error) {
    params.logger?.warn({ error }, "Responses compact cache save failed");
    return { saved: false as const, reason: "cache_save_failed" };
  }
}

function inferModelFromBody(body: unknown) {
  return isPlainObject(body) && typeof body.model === "string"
    ? body.model
    : undefined;
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

  return (
    /^\/v1\/responses\/[^/]+$/.test(endpoint) &&
    (method === "GET" || method === "DELETE")
  );
}

function shouldReturnApiKeyNotice(endpoint: string, method: string) {
  return shouldCheckNewRequestLimits(endpoint, method);
}

function shouldCheckNewRequestLimits(endpoint: string, method: string) {
  return (
    method === "POST" &&
    (endpoint === "/v1/chat/completions" ||
      endpoint === "/v1/completions" ||
      endpoint === "/v1/embeddings" ||
      endpoint === "/v1/images/generations" ||
      endpoint === "/v1/responses")
  );
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
  return sanitizeJsonForPostgres(clone);
}

function buildStreamErrorEvent(message: string, statusCode: number) {
  return [
    sseEvent("error", {
      error: {
        message,
        type: statusCode === 504 ? "timeout_error" : "upstream_error",
        code: statusCode,
      },
    }),
    "data: [DONE]\n\n",
  ].join("");
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

function getGatewaySessionIdentity(
  request: ApiRequestWithUser,
  body: ProxyBody,
  apiKeyId: string,
) {
  const sessionId =
    pickHeaderValue(request.headers["x-gateway-session-id"]) ??
    getStringPath(body, ["prompt_cache_key"]) ??
    getStringPath(body, ["metadata", "gateway_session_id"]) ??
    getStringPath(body, ["metadata", "session_id"]) ??
    getStringPath(body, ["previous_response_id"]) ??
    getStringPath(body, ["conversation_id"]) ??
    getStringPath(body, ["conversation"]) ??
    getStringPath(body, ["thread_id"]) ??
    getCompactSessionAnchor(body);

  if (sessionId) {
    return `apiKey:${apiKeyId}:session:${normalizeStickyIdentityPart(sessionId)}`;
  }

  const clientIp = getClientIp(request);
  if (clientIp) {
    return `apiKey:${apiKeyId}:ip:${normalizeStickyIdentityPart(clientIp)}`;
  }

  return `apiKey:${apiKeyId}:session:missing`;
}

function getStringPath(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return null;
    }
    current = current[key];
  }

  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function getCompactSessionAnchor(body: ProxyBody) {
  const encryptedContent = collectEncryptedContents(body)[0];
  return encryptedContent
    ? `compact:${hashEncryptedContent(encryptedContent)}`
    : null;
}

function normalizeStickyIdentityPart(value: string) {
  return value
    .trim()
    .slice(0, 256)
    .replace(/[^a-zA-Z0-9._:@-]/g, "_");
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

function buildUpstreamBody(
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UPSTREAM_RESPONSE_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const UPSTREAM_COMPACT_RESPONSE_MAX_BYTES = 16 * 1024 * 1024; // 16MB

type SafeBodyResult =
  | { json: unknown; text: string }
  | { error: { message: string; statusCode: number } };

function getUpstreamResponseMaxBytes(endpoint: string) {
  return endpoint === "/v1/responses/compact"
    ? UPSTREAM_COMPACT_RESPONSE_MAX_BYTES
    : UPSTREAM_RESPONSE_MAX_BYTES;
}

async function safeReadUpstreamBody(
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

async function proxyStream(params: {
  reply: FastifyReply;
  upstreamResponse: Response;
  activeController?: AbortController;
  apiRequestId: string;
  endpoint: string;
  requestBody: ProxyBody;
  userId: string;
  callerIdentity: string;
  apiKeyId: string;
  model: string;
  channelId?: string;
  upstreamProviderKeyId?: string | null;
  priceId: string;
  startedAt: number;
  logger?: {
    warn: (value: unknown, message?: string) => void;
    info?: (value: unknown, message?: string) => void;
  };
  compactFallbackTrace?: CompactFallbackTrace;
  compactCacheRequestBody?: ProxyBody;
  compactCacheSourceFingerprint?: string;
}) {
  const {
    reply,
    upstreamResponse,
    activeController,
    apiRequestId,
    endpoint,
    requestBody,
    userId,
    callerIdentity,
    apiKeyId,
    model,
    channelId,
    upstreamProviderKeyId,
    priceId,
    startedAt,
    logger,
    compactFallbackTrace,
    compactCacheRequestBody,
    compactCacheSourceFingerprint,
  } = params;
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
      const safeController = createSafeStreamController(controller, reply);
      const reader = upstreamResponse.body?.getReader();
      if (!reader) {
        const error = new Error("Stream body missing");
        await markRequestFailed(
          { id: apiRequestId },
          error.message,
          502,
          Math.round(performance.now() - startedAt),
        );
        await recordStickyModelPoolResult({
          callerIdentity,
          model,
          channelId,
          upstreamProviderKeyId,
          failed: true,
          streamed: true,
          latencyMs: Math.round(performance.now() - startedAt),
          ignoreSlowPenalty: endpoint === "/v1/responses/compact",
        });
        await recordModelPoolUserCallResult({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          failed: true,
          retryableFailure: true,
          logger,
        });
        safeController.enqueue(
          encoder.encode(buildStreamErrorEvent(error.message, 502)),
        );
        safeController.close();
        return;
      }
      const markFirstTokenSeen = () => {
        firstTokenLatencyMs = Math.round(performance.now() - startedAt);
      };
      const flushBufferedStreamChunks = () => {
        if (hasForwardedStream) {
          return;
        }

        hasForwardedStream = true;
        for (const chunk of bufferedStreamChunks) {
          if (!safeController.enqueue(encoder.encode(chunk))) {
            throw createClientStreamClosedError();
          }
        }
        bufferedStreamChunks.length = 0;
      };
      const forwardStreamText = (text: string) => {
        if (hasForwardedStream || firstTokenLatencyMs !== null) {
          flushBufferedStreamChunks();
          if (!safeController.enqueue(encoder.encode(text))) {
            throw createClientStreamClosedError();
          }
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
            if (
              firstTokenLatencyMs === null &&
              sseBufferHasOutputToken(pending)
            ) {
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
          if (
            firstTokenLatencyMs === null &&
            sseBufferHasOutputToken(pending)
          ) {
            markFirstTokenSeen();
          }
          streamUsage = parseUsageFromSseBuffer(pending) ?? streamUsage;
          forwardStreamText(trailing);
        }

        if (!streamUsage) {
          streamUsage = estimateUsageFromStream(
            endpoint,
            requestBody,
            rawStreamText,
          );
          if (streamUsage) {
            logger?.warn(
              { apiRequestId, model, channelId },
              "Upstream stream did not include usage; using estimated billable usage",
            );
          } else {
            throw createMissingUsageError();
          }
        }
        streamUsage = withCompactFallbackUsage(
          streamUsage,
          compactFallbackTrace,
        );
        assertBillableUsage(streamUsage);
        flushBufferedStreamChunks();

        if (
          endpoint === "/v1/responses/compact" &&
          compactCacheRequestBody &&
          compactCacheSourceFingerprint
        ) {
          const compactCacheResult = await cacheCompactResponse({
            logger,
            requestBody: compactCacheRequestBody,
            responseBody: parseSseJsonPayloads(rawStreamText),
            userId,
            apiKeyId,
            model,
            sourceFingerprint: compactCacheSourceFingerprint,
          });
          if (compactCacheResult?.saved) {
            const compactUsage = createNormalCompactResponseUsage(
              "compact_request_completed",
              {
                compactCacheId: compactCacheResult.compactCacheId,
                encryptedContentHashes:
                  compactCacheResult.encryptedContentHashes,
                sourceFingerprint: compactCacheSourceFingerprint,
              },
            );
            streamUsage.raw = isPlainObject(streamUsage.raw)
              ? { ...streamUsage.raw, ...compactUsage }
              : compactUsage;
          }
        }

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
          upstreamProviderKeyId,
          streamed: true,
          firstTokenLatencyMs,
          latencyMs: Math.round(performance.now() - startedAt),
          ignoreSlowPenalty:
            endpoint === "/v1/responses/compact" ||
            compactFallbackTrace?.gatewayCompactFallback === true,
        });
        await recordModelPoolUserCallResult({
          userId,
          apiKeyId,
          callerIdentity,
          model,
          channelId,
          failed: false,
          firstTokenLatencyMs,
          latencyMs: Math.round(performance.now() - startedAt),
          logger,
        });
      } catch (error) {
        const manualTerminated = isManualTerminateError(error);
        const message = manualTerminated
          ? manualTerminateMessage
          : error instanceof Error
            ? error.message
            : "Stream failed";
        if (isClientStreamClosedError(error)) {
          await markRequestFailed(
            { id: apiRequestId },
            clientStreamClosedMessage,
            clientStreamClosedStatusCode,
            Math.round(performance.now() - startedAt),
            createFailureResponseUsage({
              manualTerminated: false,
              compactFallbackTrace,
              reason: "client_stream_closed",
            }),
          );
          logger?.info?.(
            { apiRequestId, model, channelId },
            "Client stream closed before gateway completed response",
          );
          return;
        }

        const recoveryNotice = hasForwardedStream
          ? null
          : (getGatewayRecoveryNotice(rawStreamText) ??
            getGatewayRecoveryNotice(error));
        await markRequestFailed(
          { id: apiRequestId },
          message,
          manualTerminated ? manualTerminateStatusCode : 502,
          Math.round(performance.now() - startedAt),
          createFailureResponseUsage({
            manualTerminated,
            compactFallbackTrace,
            reason: "stream_recovery_notice",
          }),
        );
        if (recoveryNotice && endpoint !== "/v1/responses/compact") {
          await markRecoveryNoticeReturned(
            apiRequestId,
            recoveryNotice,
            "stream_recovery_notice",
            compactFallbackTrace,
            endpoint === "/v1/responses/compact"
              ? createNormalCompactResponseUsage("compact_request_failed")
              : undefined,
          );
          safeController.enqueue(
            encoder.encode(buildNoticeStream(endpoint, model, recoveryNotice)),
          );
          return;
        }
        if (!manualTerminated) {
          await recordStickyModelPoolResult({
            callerIdentity,
            model,
            channelId,
            upstreamProviderKeyId,
            failed: true,
            streamed: true,
            latencyMs: Math.round(performance.now() - startedAt),
            ignoreSlowPenalty:
              endpoint === "/v1/responses/compact" ||
              compactFallbackTrace?.gatewayCompactFallback === true,
          });
          await recordModelPoolUserCallResult({
            userId,
            apiKeyId,
            callerIdentity,
            model,
            channelId,
            failed: true,
            retryableFailure: isRetryableProxyError(error, endpoint),
            logger,
          });
          safeController.error(error);
          return;
        }
        safeController.close();
        return;
      } finally {
        unregisterActiveApiRequest(apiRequestId, activeController);
        safeController.close();
      }
    },
  });

  reply.status(upstreamResponse.status);
  reply.header(
    "content-type",
    upstreamResponse.headers.get("content-type") ?? "text/event-stream",
  );
  reply.header("cache-control", "no-cache");
  return reply.send(
    Readable.fromWeb(
      stream as unknown as import("node:stream/web").ReadableStream,
    ),
  );
}

async function proxyPassthroughStream(params: {
  reply: FastifyReply;
  upstreamResponse: Response;
  activeController?: AbortController;
  apiRequestId: string;
  startedAt: number;
}) {
  const { reply, upstreamResponse, activeController, apiRequestId, startedAt } =
    params;
  let firstTokenLatencyMs: number | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeController = createSafeStreamController(controller, reply);
      const reader = upstreamResponse.body?.getReader();
      if (!reader) {
        const error = new Error("Stream body missing");
        await markRequestFailed(
          { id: apiRequestId },
          error.message,
          502,
          Math.round(performance.now() - startedAt),
        );
        safeController.enqueue(
          new TextEncoder().encode(buildStreamErrorEvent(error.message, 502)),
        );
        safeController.close();
        return;
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            if (firstTokenLatencyMs === null) {
              firstTokenLatencyMs = Math.round(performance.now() - startedAt);
            }
            if (!safeController.enqueue(value)) {
              throw createClientStreamClosedError();
            }
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
        const manualTerminated = isManualTerminateError(error);
        const message = manualTerminated
          ? manualTerminateMessage
          : error instanceof Error
            ? error.message
            : "Stream failed";
        const clientStreamClosed = isClientStreamClosedError(error);
        await markRequestFailed(
          { id: apiRequestId },
          clientStreamClosed ? clientStreamClosedMessage : message,
          clientStreamClosed
            ? clientStreamClosedStatusCode
            : manualTerminated
              ? manualTerminateStatusCode
              : 502,
          Math.round(performance.now() - startedAt),
          manualTerminated ? createManualTerminateUsage(true) : undefined,
        );
        if (!clientStreamClosed) {
          if (manualTerminated) {
            safeController.close();
            return;
          }
          safeController.enqueue(
            new TextEncoder().encode(buildStreamErrorEvent(message, 502)),
          );
        }
        return;
      } finally {
        unregisterActiveApiRequest(apiRequestId, activeController);
        safeController.close();
      }
    },
  });

  reply.status(upstreamResponse.status);
  reply.header(
    "content-type",
    upstreamResponse.headers.get("content-type") ?? "text/event-stream",
  );
  reply.header("cache-control", "no-cache");
  return reply.send(
    Readable.fromWeb(
      stream as unknown as import("node:stream/web").ReadableStream,
    ),
  );
}

function createSafeStreamController(
  controller: ReadableStreamDefaultController<Uint8Array>,
  reply: FastifyReply,
) {
  let closed = false;

  const isReplyClosed = () => reply.raw.destroyed || reply.raw.writableEnded;

  return {
    enqueue(value: Uint8Array) {
      if (closed || isReplyClosed()) {
        closed = true;
        return false;
      }

      try {
        controller.enqueue(value);
        return true;
      } catch (error) {
        if (isClosedControllerError(error)) {
          closed = true;
          return false;
        }

        throw error;
      }
    },
    error(error: unknown) {
      if (closed || isReplyClosed()) {
        closed = true;
        return;
      }

      try {
        controller.error(error);
      } catch (controllerError) {
        if (!isClosedControllerError(controllerError)) {
          throw controllerError;
        }
      } finally {
        closed = true;
      }
    },
    close() {
      if (closed || isReplyClosed()) {
        closed = true;
        return;
      }

      try {
        controller.close();
      } catch (error) {
        if (!isClosedControllerError(error)) {
          throw error;
        }
      } finally {
        closed = true;
      }
    },
  };
}

function isClosedControllerError(error: unknown) {
  if (!(error instanceof TypeError)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("controller is already closed") ||
    (message.includes("invalid state") && message.includes("closed"))
  );
}

function createClientStreamClosedError() {
  const error = new Error(clientStreamClosedMessage);
  error.name = "ClientStreamClosedError";
  return error;
}

function isClientStreamClosedError(error: unknown) {
  if (error instanceof Error && error.name === "ClientStreamClosedError") {
    return true;
  }

  if (isClosedControllerError(error)) {
    return true;
  }

  if (getErrorCode(error) === "ERR_STREAM_PREMATURE_CLOSE") {
    return true;
  }

  return error instanceof Error && error.message === "Premature close";
}

function getErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function isRetryableUpstreamFailure(statusCode: number, responseBody?: unknown) {
  return (
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode >= 500 ||
    isUpstreamQuotaExhaustedError(responseBody)
  );
}

function isUpstreamQuotaExhaustedError(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const normalized = text.toLowerCase();
  return (
    normalized.includes("insufficient_user_quota") ||
    normalized.includes("预扣费额度失败")
  );
}

function isRetryableProxyError(error: unknown, endpoint?: string) {
  if (endpoint === "/v1/responses/compact" && isMissingUsageError(error)) {
    return true;
  }

  return error instanceof TypeError || isAbortError(error);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
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

function estimateUsageFromResponse(
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

function estimateUsageFromStream(
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

function sseBufferHasCompletedResponse(buffer: string) {
  return parseSseJsonPayloads(buffer).some(isCompletedResponsePayload);
}

function hasEncryptedContent(value: unknown): boolean {
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

function isCompletedResponsePayload(payload: unknown) {
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
