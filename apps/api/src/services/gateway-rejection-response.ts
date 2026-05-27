import { Prisma } from "@prisma/client";
import type { FastifyReply } from "fastify";
import { prisma } from "@gateway/db";
import { createRequestTraceCode } from "../lib/crypto.js";
import { sanitizeJsonForPostgres } from "../lib/db-sanitize.js";
import { sendApiError } from "../lib/errors.js";
import { getReasoningEffortFromBody } from "./reasoning-effort-transform-settings.js";
import {
  inferModelFromEndpoint,
  redactBodyForLog,
  shouldReturnApiKeyNotice,
  type ProxyBody,
} from "./proxy-request-utils.js";
import {
  ipBanErrorUsageSource,
  ipBanNoticeUsageSource,
  type IpBanRule,
} from "./ip-ban-rules.js";
import type { TemporaryIpNoticeBan } from "./temporary-ip-notice-ban.js";
import { sendApiKeyNotice } from "./gateway-notice-response.js";

type CommonRejectedParams = {
  body: ProxyBody;
  endpoint: string;
  method: string;
  userId: string;
  apiKeyId: string;
  clientIp: string | null;
  userAgent?: string | string[];
  accessTierId?: string | null;
  dedicatedRouteRuleId?: string | null;
};

export async function createGatewayRejectedRequest(
  params: CommonRejectedParams & {
    httpStatus: number;
    resultType:
      | "GATEWAY_NOTICE"
      | "IP_BAN"
      | "RATE_LIMITED"
      | "INSUFFICIENT_BALANCE"
      | "UPSTREAM_ERROR"
      | "GATEWAY_ERROR";
    errorMessage: string;
    responseUsage?: Record<string, unknown>;
  },
) {
  await prisma.apiRequest.create({
    data: {
      traceCode: createRequestTraceCode(),
      userId: params.userId,
      apiKeyId: params.apiKeyId,
      upstreamProvider: "gateway",
      model:
        typeof params.body.model === "string" && params.body.model.trim()
          ? params.body.model
          : inferModelFromEndpoint(params.endpoint),
      reasoningEffort: getReasoningEffortFromBody(params.body),
      reasoningEffortActual: getReasoningEffortFromBody(params.body),
      endpoint: params.endpoint,
      method: params.method,
      status: "FAILED",
      resultType: params.resultType,
      httpStatus: params.httpStatus,
      errorMessage: params.errorMessage,
      clientIp: params.clientIp,
      userAgent: normalizeUserAgent(params.userAgent),
      requestBody: redactBodyForLog(params.body) as Prisma.InputJsonValue,
      responseUsage:
        params.responseUsage === undefined
          ? undefined
          : (sanitizeJsonForPostgres(params.responseUsage) as Prisma.InputJsonValue),
      accessTierId: params.accessTierId,
      dedicatedRouteRuleId: params.dedicatedRouteRuleId,
    },
  });
}

export async function sendIpBanResponse(
  params: CommonRejectedParams & {
    reply: FastifyReply;
    upstreamRequestUrl: string;
    ipBanRule: IpBanRule;
    acceptHeader?: string | string[];
  },
) {
  const noticeReturned =
    params.ipBanRule.mode === "notice" &&
    shouldReturnApiKeyNotice(params.endpoint, params.method);
  const responseUsage = {
    source: noticeReturned ? ipBanNoticeUsageSource : ipBanErrorUsageSource,
    returnedToUser: noticeReturned,
    reason: "ip_ban",
    mode: params.ipBanRule.mode,
    ip: params.ipBanRule.ip,
    ...(noticeReturned ? { noticeText: params.ipBanRule.message } : {}),
  };

  await createGatewayRejectedRequest({
    ...params,
    httpStatus: noticeReturned ? 200 : 403,
    resultType: noticeReturned ? "GATEWAY_NOTICE" : "IP_BAN",
    errorMessage: `IP banned: ${params.ipBanRule.ip}${params.ipBanRule.reason ? ` (${params.ipBanRule.reason})` : ""}`,
    responseUsage,
  });

  if (noticeReturned) {
    return sendApiKeyNotice(
      params.reply,
      params.endpoint,
      params.body,
      params.upstreamRequestUrl,
      params.ipBanRule.message,
      params.acceptHeader,
    );
  }

  return sendApiError(params.reply, 403, params.ipBanRule.message, "access_denied");
}

export async function sendTemporaryIpNoticeBanResponse(
  params: CommonRejectedParams & {
    reply: FastifyReply;
    upstreamRequestUrl: string;
    temporaryIpNoticeBan: TemporaryIpNoticeBan;
    acceptHeader?: string | string[];
  },
) {
  const noticeReturned = shouldReturnApiKeyNotice(
    params.endpoint,
    params.method,
  );

  await createGatewayRejectedRequest({
    ...params,
    httpStatus: noticeReturned ? 200 : 429,
    resultType: noticeReturned ? "GATEWAY_NOTICE" : "RATE_LIMITED",
    errorMessage: `Temporary IP notice ban: ${params.clientIp ?? "unknown"}`,
    responseUsage: {
      source: "gateway_temporary_ip_notice_ban",
      returnedToUser: noticeReturned,
      reason: "consecutive_auto_terminated_requests",
      ttlSeconds: params.temporaryIpNoticeBan.ttlSeconds,
      ip: params.clientIp,
      noticeText: params.temporaryIpNoticeBan.message,
    },
  });

  if (noticeReturned) {
    return sendApiKeyNotice(
      params.reply,
      params.endpoint,
      params.body,
      params.upstreamRequestUrl,
      params.temporaryIpNoticeBan.message,
      params.acceptHeader,
    );
  }

  return sendApiError(
    params.reply,
    429,
    params.temporaryIpNoticeBan.message,
    "rate_limit_exceeded",
  );
}

export async function sendCharityServiceDisabledResponse(
  params: CommonRejectedParams & {
    reply: FastifyReply;
    upstreamRequestUrl: string;
    noticeText: string;
    acceptHeader?: string | string[];
  },
) {
  const noticeReturned = shouldReturnApiKeyNotice(
    params.endpoint,
    params.method,
  );

  await createGatewayRejectedRequest({
    ...params,
    httpStatus: noticeReturned ? 200 : 403,
    resultType: "GATEWAY_NOTICE",
    errorMessage: "Charity service disabled",
    responseUsage: {
      source: "gateway_charity_service_disabled_notice",
      returnedToUser: noticeReturned,
      reason: "charity_service_disabled",
      noticeText: params.noticeText,
    },
  });

  if (noticeReturned) {
    return sendApiKeyNotice(
      params.reply,
      params.endpoint,
      params.body,
      params.upstreamRequestUrl,
      params.noticeText,
      params.acceptHeader,
    );
  }

  return sendApiError(params.reply, 403, params.noticeText, "access_denied");
}

export async function sendModelUnavailableResponse(
  params: CommonRejectedParams & {
    reply: FastifyReply;
    upstreamRequestUrl: string;
    model?: string;
    noticeText: string;
    acceptHeader?: string | string[];
  },
) {
  const noticeReturned = shouldReturnApiKeyNotice(
    params.endpoint,
    params.method,
  );
  const model = params.model ?? inferModelFromEndpoint(params.endpoint);

  await createGatewayRejectedRequest({
    ...params,
    httpStatus: noticeReturned ? 200 : 503,
    resultType: noticeReturned ? "GATEWAY_NOTICE" : "UPSTREAM_ERROR",
    errorMessage: `Model unavailable: ${model}`,
    responseUsage: {
      source: "gateway_model_unavailable_notice",
      returnedToUser: noticeReturned,
      reason: "model_pool_unavailable",
      model,
      noticeText: params.noticeText,
    },
  });

  if (noticeReturned) {
    return sendApiKeyNotice(
      params.reply,
      params.endpoint,
      params.body,
      params.upstreamRequestUrl,
      params.noticeText,
      params.acceptHeader,
    );
  }

  return sendApiError(params.reply, 503, params.noticeText, "service_unavailable");
}

function normalizeUserAgent(userAgent?: string | string[]) {
  return Array.isArray(userAgent) ? userAgent.join(", ") : userAgent;
}
