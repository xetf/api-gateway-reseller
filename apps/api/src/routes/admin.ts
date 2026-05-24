import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { exec as execCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { createApiKey, createRedeemCode } from "../lib/crypto.js";
import { hashPassword, requireAdmin, requireUser } from "../services/auth.js";
import { getApiKeyTotalUsageUsd } from "../services/api-key-limits.js";
import {
  readAuthSettings,
  isSmtpConfigured,
  saveAuthSettings,
  toAdminAuthSettings,
} from "../services/auth-settings.js";
import { sendSmtpTestEmail } from "../services/mailer.js";
import {
  checkModelPoolChannel,
  getModelPoolChannelHealthTiming,
  getModelPoolHealthCheckIntervalSeconds,
  getModelPoolPenaltySeconds,
  maxModelPoolHealthCheckIntervalSeconds,
  maxModelPoolPenaltySeconds,
  minModelPoolHealthCheckIntervalSeconds,
  minModelPoolPenaltySeconds,
  modelPoolHealthCheckEndpoints,
  normalizeModelPoolHealthCheckEndpoint,
  setModelPoolHealthCheckIntervalSeconds,
  setModelPoolPenaltySeconds,
} from "../services/model-pool-health.js";
import {
  ensureDefaultProviderKey,
  maskUpstreamKeySecret,
  upstreamKeyInflightKey,
  upstreamKeyPrefix,
} from "../services/upstream-provider-keys.js";
import {
  listUnifiedPriceSettings,
  saveUnifiedPriceSettings,
} from "../services/unified-pricing.js";
import {
  deleteIpBanRule,
  ipBanErrorUsageSource,
  ipBanModes,
  ipBanNoticeUsageSource,
  listIpBanRules,
  saveIpBanRule,
} from "../services/ip-ban-rules.js";

const exec = promisify(execCallback);
let lastCpuSnapshot = {
  measuredAtMs: performance.now(),
  usage: process.cpuUsage(),
};
let lastSystemCpuSnapshot = getSystemCpuSnapshot();

const callableChannelStatuses = new Set(["ACTIVE", "FORCED_ACTIVE"]);
const channelStatusSchema = z.enum(["ACTIVE", "FORCED_ACTIVE", "DISABLED", "UNAVAILABLE", "PENALIZED"]);
const modelPoolHealthCheckEndpointSchema = z.enum(modelPoolHealthCheckEndpoints);
const upstreamProviderKeyStatusSchema = z.enum(["ACTIVE", "DISABLED"]);
const moneyLimitSchema = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value, context) => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null || String(value).trim() === "") {
      return null;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      context.addIssue({
        code: "custom",
        message: "Limit must be a non-negative number",
      });
      return z.NEVER;
    }

    return numeric.toFixed(8);
  });
const expiresAtSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, context) => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null || value.trim() === "") {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must be a valid date",
      });
      return z.NEVER;
    }

    return date;
  });
const noticeTextSchema = z
  .union([z.string().max(8000), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  });
const userRuntimeLimitSchema = z.number().int().min(0).max(10000);
const nonNegativeMoneySchema = z.string().or(z.number()).transform((value, context) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    context.addIssue({
      code: "custom",
      message: "Amount must be a non-negative number",
    });
    return z.NEVER;
  }

  return numeric.toFixed(8);
});
const authSettingsSchema = z.object({
  emailCodeLoginEnabled: z.boolean(),
  emailCodeAutoRegisterEnabled: z.boolean(),
  newUserBonusUsd: nonNegativeMoneySchema,
  emailCodeTtlSeconds: z.number().int().min(60).max(3600),
  emailCodeCooldownSeconds: z.number().int().min(10).max(600),
  smtpHost: z.string().trim().max(255),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  smtpUser: z.string().trim().max(255),
  smtpPassword: z.string().max(1000).optional(),
  smtpFrom: z.string().trim().max(255),
});
const authSettingsTestEmailSchema = authSettingsSchema.extend({
  testEmail: z.string().trim().email().transform((value) => value.toLowerCase()),
});
const adminCreateApiKeySchema = z.object({
  name: z.string().min(1).max(80),
  rateLimitPerMinute: z.number().int().positive().max(10000).default(60),
  totalLimitUsd: moneyLimitSchema,
  dailyLimitUsd: moneyLimitSchema,
  expiresAt: expiresAtSchema,
  concurrencyLimit: z.number().int().min(0).max(10000).default(0),
  allowedModels: z.array(z.string()).default([]),
  noticeEnabled: z.boolean().default(false),
  noticeText: noticeTextSchema,
});
const adminPatchApiKeySchema = z.object({
  name: z.string().min(1).max(80).optional(),
  status: z.enum(["ACTIVE", "DISABLED", "REVOKED"]).optional(),
  rateLimitPerMinute: z.number().int().positive().max(10000).optional(),
  totalLimitUsd: moneyLimitSchema,
  dailyLimitUsd: moneyLimitSchema,
  expiresAt: expiresAtSchema,
  concurrencyLimit: z.number().int().min(0).max(10000).optional(),
  allowedModels: z.array(z.string()).optional(),
  noticeEnabled: z.boolean().optional(),
  noticeText: noticeTextSchema,
});
const adminBatchUpdateApiKeysSchema = z.object({
  keyIds: z.array(z.string()).min(1).max(500),
  status: z.enum(["ACTIVE", "DISABLED", "REVOKED"]).optional(),
  noticeEnabled: z.boolean().optional(),
  noticeText: noticeTextSchema,
});
const ipBanRuleSchema = z.object({
  ip: z.string().min(1).max(128),
  mode: z.enum(ipBanModes),
  message: z.string().max(8000).optional().nullable(),
  reason: z.string().max(1000).optional().nullable(),
});
const adminRequestResultTypes = ["notice", "ip_ban", "error"] as const;
const adminRequestsQuerySchema = z.object({
  q: z.string().optional(),
  userId: z.string().optional(),
  model: z.string().optional(),
  status: z.enum(["PENDING", "SUCCESS", "FAILED"]).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  clientIp: z.string().optional(),
  apiKey: z.string().optional(),
  upstreamProvider: z.string().optional(),
  upstreamKey: z.string().optional(),
  endpoint: z.string().optional(),
  httpStatus: z.string().optional(),
  resultType: z.enum(adminRequestResultTypes).optional(),
  minTokens: z.string().optional(),
  maxTokens: z.string().optional(),
  minChargedUsd: z.string().optional(),
  maxChargedUsd: z.string().optional(),
  minUpstreamCostUsd: z.string().optional(),
  maxUpstreamCostUsd: z.string().optional(),
  minGrossProfitUsd: z.string().optional(),
  maxGrossProfitUsd: z.string().optional(),
  minLatencyMs: z.string().optional(),
  maxLatencyMs: z.string().optional(),
  minFirstTokenLatencyMs: z.string().optional(),
  maxFirstTokenLatencyMs: z.string().optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(300).default(120),
});
type AdminRequestsQuery = z.infer<typeof adminRequestsQuerySchema>;
type FiniteRange = {
  min?: number;
  max?: number;
};
const recoveryNoticeUsageSource = "gateway_recovery_notice";

const adminApiKeySelect = {
  id: true,
  userId: true,
  name: true,
  keyPrefix: true,
  keySecret: true,
  status: true,
  rateLimitPerMinute: true,
  dailyLimitUsd: true,
  totalLimitUsd: true,
  expiresAt: true,
  concurrencyLimit: true,
  allowedModels: true,
  noticeEnabled: true,
  noticeText: true,
  lastUsedAt: true,
  createdAt: true,
} satisfies Prisma.ApiKeySelect;

function cleanAdminRequestFilter(value: string | undefined) {
  return value?.trim() ?? "";
}

function badAdminRequestFilter(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function parseOptionalFiniteNumber(value: string | undefined, label: string) {
  const text = cleanAdminRequestFilter(value);
  if (!text) {
    return undefined;
  }

  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    throw badAdminRequestFilter(`${label} must be a finite number`);
  }

  return numeric;
}

function parseFiniteRange(min: string | undefined, max: string | undefined, label: string): FiniteRange | null {
  const range = {
    min: parseOptionalFiniteNumber(min, `${label} min`),
    max: parseOptionalFiniteNumber(max, `${label} max`),
  };

  if (range.min === undefined && range.max === undefined) {
    return null;
  }

  if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
    throw badAdminRequestFilter(`${label} min cannot be greater than max`);
  }

  return range;
}

function intRangeFilter(range: FiniteRange): Prisma.IntFilter<"ApiRequest"> {
  return {
    ...(range.min !== undefined ? { gte: Math.ceil(range.min) } : {}),
    ...(range.max !== undefined ? { lte: Math.floor(range.max) } : {}),
  };
}

function decimalRangeFilter(range: FiniteRange): Prisma.DecimalFilter<"ApiRequest"> {
  return {
    ...(range.min !== undefined ? { gte: new Decimal(range.min).toFixed(8) } : {}),
    ...(range.max !== undefined ? { lte: new Decimal(range.max).toFixed(8) } : {}),
  };
}

function responseSourceFilter(...sources: string[]): Prisma.ApiRequestWhereInput {
  return {
    OR: sources.map((source) => ({
      responseUsage: {
        path: ["source"],
        equals: source,
      },
    })),
  };
}

function noticeResultFilter(): Prisma.ApiRequestWhereInput {
  return {
    AND: [
      responseSourceFilter(recoveryNoticeUsageSource, ipBanNoticeUsageSource),
      {
        responseUsage: {
          path: ["returnedToUser"],
          equals: true,
        },
      },
    ],
  };
}

function ipBanResultFilter(): Prisma.ApiRequestWhereInput {
  return {
    OR: [
      responseSourceFilter(ipBanNoticeUsageSource, ipBanErrorUsageSource),
      {
        errorMessage: {
          contains: "IP banned",
          mode: "insensitive",
        },
      },
    ],
  };
}

function ordinaryErrorResultFilter(): Prisma.ApiRequestWhereInput {
  return {
    status: "FAILED",
    NOT: [noticeResultFilter(), ipBanResultFilter()],
  };
}

async function findGrossProfitRequestIds(range: FiniteRange) {
  const minClause = range.min !== undefined
    ? Prisma.sql`AND ("chargedAmountUsd" - "upstreamCostUsd") >= ${new Decimal(range.min).toFixed(8)}::numeric`
    : Prisma.empty;
  const maxClause = range.max !== undefined
    ? Prisma.sql`AND ("chargedAmountUsd" - "upstreamCostUsd") <= ${new Decimal(range.max).toFixed(8)}::numeric`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT id
      FROM "ApiRequest"
      WHERE 1 = 1
      ${minClause}
      ${maxClause}
    `,
  );

  return rows.map((row) => row.id);
}

async function buildAdminRequestsWhere(query: AdminRequestsQuery) {
  const andFilters: Prisma.ApiRequestWhereInput[] = [];
  const q = cleanAdminRequestFilter(query.q);
  const clientIp = cleanAdminRequestFilter(query.clientIp);
  const apiKey = cleanAdminRequestFilter(query.apiKey);
  const upstreamProvider = cleanAdminRequestFilter(query.upstreamProvider);
  const upstreamKey = cleanAdminRequestFilter(query.upstreamKey);
  const endpoint = cleanAdminRequestFilter(query.endpoint);
  const httpStatus = parseOptionalFiniteNumber(query.httpStatus, "HTTP status");
  const tokenRange = parseFiniteRange(query.minTokens, query.maxTokens, "total token range");
  const chargedRange = parseFiniteRange(query.minChargedUsd, query.maxChargedUsd, "charged USD range");
  const upstreamCostRange = parseFiniteRange(query.minUpstreamCostUsd, query.maxUpstreamCostUsd, "upstream cost USD range");
  const grossProfitRange = parseFiniteRange(query.minGrossProfitUsd, query.maxGrossProfitUsd, "gross profit USD range");
  const latencyRange = parseFiniteRange(query.minLatencyMs, query.maxLatencyMs, "latency ms range");
  const firstTokenLatencyRange = parseFiniteRange(
    query.minFirstTokenLatencyMs,
    query.maxFirstTokenLatencyMs,
    "first token latency ms range",
  );

  if (query.userId) {
    andFilters.push({ userId: query.userId });
  }

  if (query.model) {
    andFilters.push({
      model: {
        contains: query.model,
        mode: "insensitive",
      },
    });
  }

  if (query.status) {
    andFilters.push({ status: query.status });
  }

  if (query.dateFrom || query.dateTo) {
    andFilters.push({
      createdAt: {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      },
    });
  }

  if (q) {
    andFilters.push({
      OR: [
        {
          model: {
            contains: q,
            mode: "insensitive",
          },
        },
        {
          endpoint: {
            contains: q,
            mode: "insensitive",
          },
        },
        {
          clientIp: {
            contains: q,
            mode: "insensitive",
          },
        },
        {
          user: {
            email: {
              contains: q,
              mode: "insensitive",
            },
          },
        },
      ],
    });
  }

  if (clientIp) {
    andFilters.push({
      clientIp: {
        contains: clientIp,
        mode: "insensitive",
      },
    });
  }

  if (apiKey) {
    andFilters.push({
      apiKey: {
        is: {
          OR: [
            { name: { contains: apiKey, mode: "insensitive" } },
            { keyPrefix: { contains: apiKey, mode: "insensitive" } },
          ],
        },
      },
    });
  }

  if (upstreamProvider) {
    andFilters.push({
      upstreamProvider: {
        contains: upstreamProvider,
        mode: "insensitive",
      },
    });
  }

  if (upstreamKey) {
    andFilters.push({
      upstreamProviderKey: {
        is: {
          OR: [
            { name: { contains: upstreamKey, mode: "insensitive" } },
            { keyPrefix: { contains: upstreamKey, mode: "insensitive" } },
          ],
        },
      },
    });
  }

  if (endpoint) {
    andFilters.push({
      endpoint: {
        contains: endpoint,
        mode: "insensitive",
      },
    });
  }

  if (httpStatus !== undefined) {
    if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) {
      throw badAdminRequestFilter("HTTP status must be an integer between 100 and 599");
    }
    andFilters.push({ httpStatus });
  }

  if (query.resultType === "notice") {
    andFilters.push(noticeResultFilter());
  } else if (query.resultType === "ip_ban") {
    andFilters.push(ipBanResultFilter());
  } else if (query.resultType === "error") {
    andFilters.push(ordinaryErrorResultFilter());
  }

  if (tokenRange) {
    andFilters.push({ totalTokens: intRangeFilter(tokenRange) });
  }

  if (chargedRange) {
    andFilters.push({ chargedAmountUsd: decimalRangeFilter(chargedRange) });
  }

  if (upstreamCostRange) {
    andFilters.push({ upstreamCostUsd: decimalRangeFilter(upstreamCostRange) });
  }

  if (latencyRange) {
    andFilters.push({ latencyMs: intRangeFilter(latencyRange) });
  }

  if (firstTokenLatencyRange) {
    andFilters.push({ firstTokenLatencyMs: intRangeFilter(firstTokenLatencyRange) });
  }

  if (grossProfitRange) {
    const matchingIds = await findGrossProfitRequestIds(grossProfitRange);
    andFilters.push(matchingIds.length > 0 ? { id: { in: matchingIds } } : { id: "__no_matching_request__" });
  }

  return andFilters.length > 0 ? { AND: andFilters } : undefined;
}

async function getAdminRequestsSummary(where: Prisma.ApiRequestWhereInput | undefined) {
  const [aggregate, statusGroups] = await Promise.all([
    prisma.apiRequest.aggregate({
      where,
      _count: { _all: true },
      _sum: {
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        totalTokens: true,
        chargedAmountUsd: true,
        upstreamCostUsd: true,
      },
      _avg: {
        latencyMs: true,
        firstTokenLatencyMs: true,
      },
    }),
    prisma.apiRequest.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ]);
  const countByStatus = Object.fromEntries(
    statusGroups.map((group) => [group.status, group._count._all]),
  );
  const totalCount = aggregate._count._all;
  const successCount = countByStatus.SUCCESS ?? 0;
  const failedCount = countByStatus.FAILED ?? 0;
  const pendingCount = countByStatus.PENDING ?? 0;
  const chargedAmountUsd = new Decimal(aggregate._sum.chargedAmountUsd?.toString() ?? "0");
  const upstreamCostUsd = new Decimal(aggregate._sum.upstreamCostUsd?.toString() ?? "0");

  return {
    totalCount,
    successCount,
    failedCount,
    pendingCount,
    failureRate: totalCount > 0 ? (failedCount / totalCount) * 100 : 0,
    inputTokens: aggregate._sum.inputTokens ?? 0,
    cachedInputTokens: aggregate._sum.cachedInputTokens ?? 0,
    outputTokens: aggregate._sum.outputTokens ?? 0,
    totalTokens: aggregate._sum.totalTokens ?? 0,
    chargedAmountUsd: chargedAmountUsd.toFixed(8),
    upstreamCostUsd: upstreamCostUsd.toFixed(8),
    grossProfitUsd: chargedAmountUsd.minus(upstreamCostUsd).toFixed(8),
    avgLatencyMs: aggregate._avg.latencyMs,
    avgFirstTokenLatencyMs: aggregate._avg.firstTokenLatencyMs,
  };
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);
  app.addHook("preHandler", requireAdmin);

  app.get("/admin/overview", async () => {
    const [users, requests, walletAgg, requestAgg] = await Promise.all([
      prisma.user.count(),
      prisma.apiRequest.count(),
      prisma.wallet.aggregate({
        _sum: { balance: true },
      }),
      prisma.apiRequest.aggregate({
        _sum: {
          chargedAmountUsd: true,
          upstreamCostUsd: true,
          totalTokens: true,
        },
      }),
    ]);

    const revenue = new Decimal(
      requestAgg._sum.chargedAmountUsd?.toString() ?? "0",
    );
    const upstreamCost = new Decimal(
      requestAgg._sum.upstreamCostUsd?.toString() ?? "0",
    );

    return {
      users,
      requests,
      totalWalletBalance: walletAgg._sum.balance ?? "0",
      revenue: revenue.toFixed(8),
      upstreamCost: upstreamCost.toFixed(8),
      grossProfit: revenue.minus(upstreamCost).toFixed(8),
      totalTokens: requestAgg._sum.totalTokens ?? 0,
    };
  });

  app.get("/admin/server-status", async () => {
    const [redisPing, dbPing, pm2Status, modelPool, apiKeyStats] = await Promise.all([
      pingRedis(app),
      pingDatabase(),
      getPm2Status(),
      getModelPoolStatus(app),
      getApiKeyRuntimeStats(app),
    ]);

    return {
      server: {
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        system: getSystemStatus(),
        cpu: getProcessCpuStatus(),
        redis: redisPing,
        database: dbPing,
        pm2: pm2Status,
      },
      modelPool,
      apiKeys: apiKeyStats,
      checkedAt: new Date().toISOString(),
    };
  });

  app.get("/admin/auth-settings", async () => {
    const settings = await readAuthSettings();
    return { settings: toAdminAuthSettings(settings) };
  });

  app.put("/admin/auth-settings", async (request) => {
    const body = authSettingsSchema.parse(request.body);
    const settings = await saveAuthSettings({
      ...body,
      smtpPassword: body.smtpPassword?.trim() ? body.smtpPassword : undefined,
    });

    return { settings: toAdminAuthSettings(settings) };
  });

  app.post("/admin/auth-settings/test-email", async (request, reply) => {
    const body = authSettingsTestEmailSchema.parse(request.body);
    const currentSettings = await readAuthSettings();
    const settings = {
      ...currentSettings,
      ...body,
      smtpPassword: body.smtpPassword?.trim()
        ? body.smtpPassword
        : currentSettings.smtpPassword,
    };

    if (!isSmtpConfigured(settings)) {
      return reply.status(400).send({ message: "请先填写完整 SMTP Host、端口和发件人。" });
    }

    try {
      await sendSmtpTestEmail(settings, {
        to: body.testEmail,
        code: "482913",
        ttlMinutes: Math.max(1, Math.ceil(Number(body.emailCodeTtlSeconds) / 60)),
      });
    } catch (error) {
      app.log.error({ error, email: body.testEmail }, "Failed to send SMTP test email");
      return reply.status(502).send({ message: "测试邮件发送失败，请检查 SMTP 设置。" });
    }

    return { ok: true };
  });

  app.get("/admin/users", async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        allowedModels: true,
        rateLimitPerMinute: true,
        concurrencyLimit: true,
        tokenVersion: true,
        createdAt: true,
        wallet: true,
        walletTransactions: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            type: true,
            amount: true,
            balanceBefore: true,
            balanceAfter: true,
            remark: true,
            createdAt: true,
          },
        },
        apiKeys: {
          orderBy: { createdAt: "desc" },
          select: adminApiKeySelect,
        },
        _count: {
          select: {
            apiKeys: true,
            apiRequests: true,
          },
        },
      },
    });

    return {
      users: await Promise.all(
        users.map(async (user) => ({
          ...user,
          apiKeys: await Promise.all(user.apiKeys.map(withAdminApiKeyUsage)),
        })),
      ),
    };
  });

  app.patch("/admin/users/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        email: z.string().email().optional(),
        role: z.enum(["USER", "ADMIN"]).optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        allowedModels: z.array(z.string()).optional(),
        rateLimitPerMinute: userRuntimeLimitSchema.optional(),
        concurrencyLimit: userRuntimeLimitSchema.optional(),
      })
      .parse(request.body);

    const data = {
      ...(body.email ? { email: body.email } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.allowedModels !== undefined ? { allowedModels: body.allowedModels } : {}),
      ...(body.rateLimitPerMinute !== undefined
        ? { rateLimitPerMinute: body.rateLimitPerMinute }
        : {}),
      ...(body.concurrencyLimit !== undefined
        ? { concurrencyLimit: body.concurrencyLimit }
        : {}),
    };

    const user = await prisma.user.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        allowedModels: true,
        rateLimitPerMinute: true,
        concurrencyLimit: true,
        tokenVersion: true,
        createdAt: true,
        wallet: true,
        _count: {
          select: {
            apiKeys: true,
            apiRequests: true,
          },
        },
      },
    });

    return { user };
  });

  app.post("/admin/users", async (request) => {
    const body = z
      .object({
        email: z.string().email(),
        role: z.enum(["USER", "ADMIN"]).default("USER"),
        allowedModels: z.array(z.string()).default([]),
        rateLimitPerMinute: userRuntimeLimitSchema.default(0),
        concurrencyLimit: userRuntimeLimitSchema.default(0),
        initialBalance: z.string().or(z.number()).optional(),
      })
      .parse(request.body);

    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: body.email,
            role: body.role,
            allowedModels: body.allowedModels,
            rateLimitPerMinute: body.rateLimitPerMinute,
            concurrencyLimit: body.concurrencyLimit,
            passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
            wallet: {
              create: {
                balance: body.initialBalance ? String(body.initialBalance) : "0",
              },
            },
          },
        });

        if (body.initialBalance) {
          await tx.walletTransaction.create({
            data: {
              userId: created.id,
              type: "RECHARGE",
              amount: String(body.initialBalance),
              balanceBefore: "0",
              balanceAfter: String(body.initialBalance),
              remark: "Initial balance",
            },
          });
        }

        return created;
      });

      return { user };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw Object.assign(new Error("Email already exists"), {
          statusCode: 409,
        });
      }

      throw error;
    }
  });

  app.post("/admin/users/:id/logout", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const currentUser = request.user as { sub: string };

    if (params.id === currentUser.sub) {
      return reply.status(400).send({ message: "Cannot logout your own admin session" });
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
        tokenVersion: true,
      },
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: {
        tokenVersion: {
          increment: 1,
        },
      },
      select: {
        id: true,
        email: true,
        tokenVersion: true,
      },
    });

    return { ok: true, user: updated };
  });

  app.delete("/admin/users/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const currentUser = request.user as { sub: string };

    if (params.id === currentUser.sub) {
      return reply.status(400).send({ message: "Cannot delete your own admin account" });
    }

    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    }

    await prisma.user.delete({
      where: { id: params.id },
    });

    return { ok: true, user };
  });

  app.post("/admin/users/:id/balance", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        amount: z.string().or(z.number()).transform(String),
        remark: z.string().optional(),
      })
      .parse(request.body);
    const amount = new Decimal(body.amount);

    if (!amount.isFinite() || amount.equals(0)) {
      return reply.status(400).send({ message: "Amount cannot be zero" });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!targetUser) {
      return reply.status(404).send({ message: "User not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: params.id },
        update: {},
        create: {
          userId: params.id,
          balance: "0",
        },
      });
      const balanceBefore = new Decimal(wallet.balance.toString());
      const balanceAfter = balanceBefore.plus(amount);

      if (balanceAfter.lt(0)) {
        throw Object.assign(new Error("Balance cannot be negative"), {
          statusCode: 400,
        });
      }

      const updatedWallet = await tx.wallet.update({
        where: { userId: params.id },
        data: {
          balance: balanceAfter.toFixed(8),
        },
      });

      const transaction = await tx.walletTransaction.create({
        data: {
          userId: params.id,
          type: "ADJUST",
          amount: amount.toFixed(8),
          balanceBefore: balanceBefore.toFixed(8),
          balanceAfter: balanceAfter.toFixed(8),
          remark: body.remark ?? "Admin balance adjustment",
        },
      });

      return { wallet: updatedWallet, transaction };
    });

    return result;
  });

  app.get("/admin/users/:id/api-keys", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    }

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: params.id },
      orderBy: { createdAt: "desc" },
      select: adminApiKeySelect,
    });

    return { apiKeys: await Promise.all(apiKeys.map(withAdminApiKeyUsage)) };
  });

  app.post("/admin/users/:id/api-keys", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = adminCreateApiKeySchema.parse(request.body);
    const user = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!user) {
      return reply.status(404).send({ message: "User not found" });
    }

    if (body.noticeEnabled && !body.noticeText) {
      return reply.status(400).send({ message: "Notice text is required when notice is enabled" });
    }

    const generated = createApiKey();
    const apiKey = await prisma.apiKey.create({
      data: {
        userId: params.id,
        name: body.name,
        keyHash: generated.hash,
        keyPrefix: generated.prefix,
        keySecret: generated.key,
        rateLimitPerMinute: body.rateLimitPerMinute,
        totalLimitUsd: body.totalLimitUsd ?? body.dailyLimitUsd ?? null,
        expiresAt: body.expiresAt,
        concurrencyLimit: body.concurrencyLimit,
        allowedModels: body.allowedModels,
        noticeEnabled: body.noticeEnabled,
        noticeText: body.noticeText ?? null,
      },
      select: adminApiKeySelect,
    });

    return {
      apiKey: await withAdminApiKeyUsage(apiKey),
      secret: generated.key,
    };
  });

  app.patch("/admin/users/:id/api-keys/batch", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = adminBatchUpdateApiKeysSchema.parse(request.body);
    const data = {
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.noticeEnabled !== undefined ? { noticeEnabled: body.noticeEnabled } : {}),
      ...(body.noticeText !== undefined ? { noticeText: body.noticeText } : {}),
    };

    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ message: "No batch changes provided" });
    }

    if (body.noticeEnabled && !body.noticeText) {
      return reply.status(400).send({ message: "Notice text is required when notice is enabled" });
    }

    const uniqueKeyIds = Array.from(new Set(body.keyIds));
    const existingKeys = await prisma.apiKey.findMany({
      where: {
        id: { in: uniqueKeyIds },
        userId: params.id,
      },
      select: {
        id: true,
        expiresAt: true,
        totalLimitUsd: true,
      },
    });

    if (existingKeys.length !== uniqueKeyIds.length) {
      return reply.status(404).send({ message: "Some API keys were not found for this user" });
    }

    if (body.status === "ACTIVE") {
      const now = new Date();
      const expiredKey = existingKeys.find((apiKey) => apiKey.expiresAt && apiKey.expiresAt <= now);
      if (expiredKey) {
        return reply.status(400).send({ message: "Cannot enable expired API keys" });
      }

      for (const apiKey of existingKeys) {
        if (!apiKey.totalLimitUsd) {
          continue;
        }

        const usedUsd = await getApiKeyTotalUsageUsd(apiKey.id);
        if (usedUsd.gte(apiKey.totalLimitUsd.toString())) {
          return reply.status(400).send({ message: "Cannot enable API keys over their total quota" });
        }
      }
    }

    await prisma.apiKey.updateMany({
      where: {
        id: { in: uniqueKeyIds },
        userId: params.id,
      },
      data,
    });

    const apiKeys = await prisma.apiKey.findMany({
      where: {
        id: { in: uniqueKeyIds },
        userId: params.id,
      },
      orderBy: { createdAt: "desc" },
      select: adminApiKeySelect,
    });

    return {
      count: apiKeys.length,
      apiKeys: await Promise.all(apiKeys.map(withAdminApiKeyUsage)),
    };
  });

  app.patch("/admin/api-keys/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = adminPatchApiKeySchema.parse(request.body);
    const existing = await prisma.apiKey.findUnique({
      where: { id: params.id },
      select: adminApiKeySelect,
    });

    if (!existing) {
      return reply.status(404).send({ message: "API key not found" });
    }

    const totalLimitUsd =
      body.totalLimitUsd === undefined ? body.dailyLimitUsd : body.totalLimitUsd;
    const shouldActivate = body.status === "ACTIVE";
    const nextNoticeEnabled =
      body.noticeEnabled === undefined ? existing.noticeEnabled : body.noticeEnabled;
    const nextNoticeText =
      body.noticeText === undefined ? existing.noticeText : body.noticeText;

    if (nextNoticeEnabled && !nextNoticeText) {
      return reply.status(400).send({ message: "Notice text is required when notice is enabled" });
    }

    if (shouldActivate) {
      const nextExpiresAt = body.expiresAt !== undefined ? body.expiresAt : existing.expiresAt;
      if (nextExpiresAt && nextExpiresAt <= new Date()) {
        return reply.status(400).send({ message: "Cannot enable an expired API key" });
      }

      const nextTotalLimitUsd =
        totalLimitUsd === undefined ? existing.totalLimitUsd?.toString() : totalLimitUsd;
      if (nextTotalLimitUsd) {
        const usedUsd = await getApiKeyTotalUsageUsd(existing.id);
        if (usedUsd.gte(nextTotalLimitUsd)) {
          return reply.status(400).send({ message: "Cannot enable an API key over its total quota" });
        }
      }
    }

    const apiKey = await prisma.apiKey.update({
      where: { id: params.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.rateLimitPerMinute !== undefined
          ? { rateLimitPerMinute: body.rateLimitPerMinute }
          : {}),
        ...(totalLimitUsd !== undefined ? { totalLimitUsd } : {}),
        ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
        ...(body.concurrencyLimit !== undefined
          ? { concurrencyLimit: body.concurrencyLimit }
          : {}),
        ...(body.allowedModels !== undefined ? { allowedModels: body.allowedModels } : {}),
        ...(body.noticeEnabled !== undefined ? { noticeEnabled: body.noticeEnabled } : {}),
        ...(body.noticeText !== undefined ? { noticeText: body.noticeText } : {}),
      },
      select: adminApiKeySelect,
    });

    return { apiKey: await withAdminApiKeyUsage(apiKey) };
  });

  app.delete("/admin/api-keys/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const apiKey = await prisma.apiKey.findUnique({
      where: { id: params.id },
      select: adminApiKeySelect,
    });

    if (!apiKey) {
      return reply.status(404).send({ message: "API key not found" });
    }

    await prisma.apiKey.delete({
      where: { id: params.id },
    });

    return { ok: true, apiKey: await withAdminApiKeyUsage(apiKey) };
  });

  app.get("/admin/ip-ban-rules", async () => {
    return { rules: await listIpBanRules() };
  });

  app.put("/admin/ip-ban-rules/:ip", async (request) => {
    const params = z.object({ ip: z.string().min(1).max(128) }).parse(request.params);
    const body = ipBanRuleSchema.omit({ ip: true }).parse(request.body);
    const rule = await saveIpBanRule({
      ip: params.ip,
      mode: body.mode,
      message: body.message,
      reason: body.reason,
    });

    return {
      rule,
      rules: await listIpBanRules(),
    };
  });

  app.post("/admin/ip-ban-rules", async (request) => {
    const body = ipBanRuleSchema.parse(request.body);
    const rule = await saveIpBanRule(body);

    return {
      rule,
      rules: await listIpBanRules(),
    };
  });

  app.delete("/admin/ip-ban-rules/:ip", async (request) => {
    const params = z.object({ ip: z.string().min(1).max(128) }).parse(request.params);
    const result = await deleteIpBanRule(params.ip);

    return {
      ...result,
      rules: await listIpBanRules(),
    };
  });

  app.get("/admin/requests", async (request) => {
    const query = adminRequestsQuerySchema.parse(request.query);
    const where = await buildAdminRequestsWhere(query);

    const [rows, summary, ipBanRules] = await Promise.all([
      prisma.apiRequest.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.take + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          upstreamProvider: true,
          upstreamProviderKey: {
            select: {
              id: true,
              name: true,
              keyPrefix: true,
            },
          },
          clientIp: true,
          apiKey: {
            select: {
              id: true,
              name: true,
              keyPrefix: true,
            },
          },
          model: true,
          endpoint: true,
          method: true,
          status: true,
          httpStatus: true,
          inputTokens: true,
          cachedInputTokens: true,
          outputTokens: true,
          totalTokens: true,
          chargedAmountUsd: true,
          upstreamCostUsd: true,
          latencyMs: true,
          firstTokenLatencyMs: true,
          errorMessage: true,
          responseUsage: true,
          createdAt: true,
          user: {
            select: {
              email: true,
            },
          },
        },
      }),
      getAdminRequestsSummary(where),
      listIpBanRules(),
    ]);
    const hasMore = rows.length > query.take;
    const requests = hasMore ? rows.slice(0, query.take) : rows;

    return {
      requests,
      hasMore,
      summary,
      ipBanRules,
      nextCursor: hasMore ? requests.at(-1)?.id ?? null : null,
    };
  });

  app.get("/admin/requests/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const apiRequest = await prisma.apiRequest.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        upstreamProvider: true,
        upstreamRequestId: true,
        upstreamProviderKey: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
          },
        },
        clientIp: true,
        userAgent: true,
        apiKey: {
          select: {
            id: true,
            name: true,
            keyPrefix: true,
          },
        },
        model: true,
        endpoint: true,
        method: true,
        status: true,
        httpStatus: true,
        inputTokens: true,
        cachedInputTokens: true,
        outputTokens: true,
        totalTokens: true,
        chargedAmountUsd: true,
        upstreamCostUsd: true,
        latencyMs: true,
        firstTokenLatencyMs: true,
        errorMessage: true,
        requestBody: true,
        responseUsage: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    if (!apiRequest) {
      return reply.status(404).send({ message: "Request not found" });
    }

    return { request: apiRequest };
  });

  app.get("/admin/redeem-codes", async () => {
    const codes = await prisma.redeemCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        redemptions: {
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            user: {
              select: {
                email: true,
              },
            },
          },
        },
      },
    });

    return { codes };
  });

  app.post("/admin/redeem-codes", async (request, reply) => {
    const admin = request.user as { sub: string };
    const body = z
      .object({
        amount: z.string().or(z.number()).transform(String),
        count: z.number().int().min(1).max(100).default(1),
        maxRedemptions: z.number().int().min(1).max(1000).default(1),
        expiresAt: z.string().datetime().nullable().optional(),
        remark: z.string().max(500).optional(),
      })
      .parse(request.body);
    const amount = new Decimal(body.amount);

    if (!amount.isFinite() || amount.lte(0)) {
      return reply.status(400).send({ message: "Amount must be positive" });
    }

    const generated = Array.from({ length: body.count }, () => createRedeemCode());
    const codes = await prisma.$transaction(
      generated.map((item) =>
        prisma.redeemCode.create({
          data: {
            codeHash: item.hash,
            codePrefix: item.prefix,
            amount: amount.toFixed(8),
            maxRedemptions: body.maxRedemptions,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            createdByUserId: admin.sub,
            remark: body.remark,
          },
        }),
      ),
    );

    return {
      codes: codes.map((code, index) => ({
        ...code,
        code: generated[index]?.code,
      })),
    };
  });

  app.patch("/admin/redeem-codes/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        expiresAt: z.string().datetime().nullable().optional(),
        remark: z.string().max(500).nullable().optional(),
      })
      .parse(request.body);

    const code = await prisma.redeemCode.update({
      where: { id: params.id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.expiresAt !== undefined
          ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
          : {}),
        ...(body.remark !== undefined ? { remark: body.remark } : {}),
      },
    });

    return { code };
  });

  app.get("/admin/model-prices", async () => {
    const modelPrices = await prisma.modelPrice.findMany({
      orderBy: [{ upstreamProvider: "asc" }, { model: "asc" }],
    });
    const unifiedPriceSettings = await listUnifiedPriceSettings(modelPrices.map((price) => price.model));

    return { modelPrices, unifiedPriceSettings };
  });

  app.get("/admin/model-pools", async () => {
    const serverNow = new Date();
    const [healthCheckIntervalSeconds, penaltySeconds] = await Promise.all([
      getModelPoolHealthCheckIntervalSeconds(),
      getModelPoolPenaltySeconds(),
    ]);
    const [pools, prices, providers] = await Promise.all([
      prisma.modelPool.findMany({
        orderBy: { model: "asc" },
        include: {
          channels: {
            orderBy: [{ upstreamProvider: "asc" }],
          },
        },
      }),
      prisma.modelPrice.findMany({
        orderBy: [{ model: "asc" }, { upstreamProvider: "asc" }],
      }),
      prisma.upstreamProvider.findMany({
        orderBy: [{ priority: "asc" }, { name: "asc" }],
        select: {
          name: true,
          status: true,
          priority: true,
          keys: {
            where: { status: "ACTIVE" },
            select: { id: true },
          },
        },
      }),
    ]);
    const priceMap = new Map(prices.map((price) => [`${price.upstreamProvider}:${price.model}`, price]));
    const providerMap = new Map(providers.map((provider) => [provider.name, provider]));
    const availablePrices = prices.filter(
      (price) =>
        providerMap.has(price.upstreamProvider) &&
        price.upstreamProvider.trim().toLowerCase() !== "default",
    );

    return {
      modelPools: pools.map((pool) => {
        const channels = pool.channels.map((channel) => {
          const price = priceMap.get(`${channel.upstreamProvider}:${pool.model}`);
          const provider = providerMap.get(channel.upstreamProvider);
          const baseHealthTiming = getModelPoolChannelHealthTiming(channel, healthCheckIntervalSeconds, serverNow);
          const healthTiming = pool.autoHealthCheckEnabled || channel.status === "PENALIZED"
            ? baseHealthTiming
            : {
                ...baseHealthTiming,
                nextCheckAt: null,
                nextCheckRemainingSeconds: null,
              };
          const activeKeyCount = provider?.keys.length ?? 0;
          return {
            ...channel,
            hasPrice: Boolean(price),
            priceEnabled: price?.enabled ?? false,
            providerStatus: provider?.status ?? "MISSING",
            providerPriority: provider?.priority ?? null,
            activeKeyCount,
            ...healthTiming,
            effectiveStatus:
              pool.status === "ACTIVE" &&
              callableChannelStatuses.has(channel.status) &&
              provider?.status === "ACTIVE" &&
              activeKeyCount > 0 &&
              price?.enabled
                ? channel.status === "FORCED_ACTIVE"
                  ? "FORCED_READY"
                  : "READY"
                : "UNAVAILABLE",
          };
        }).sort(compareModelPoolChannelsForAdmin);

        return {
          ...pool,
          healthCheckEndpoint: normalizeModelPoolHealthCheckEndpoint(pool.healthCheckEndpoint),
          channels,
          readyChannelCount: channels.filter((channel) => channel.effectiveStatus !== "UNAVAILABLE").length,
          pricedChannelCount: availablePrices.filter((price) => price.model === pool.model).length,
        };
      }),
      availableChannels: availablePrices.map((price) => ({
        id: price.id,
        model: price.model,
        upstreamProvider: price.upstreamProvider,
        priceEnabled: price.enabled,
        providerStatus: providerMap.get(price.upstreamProvider)?.status ?? "MISSING",
        activeKeyCount: providerMap.get(price.upstreamProvider)?.keys.length ?? 0,
      })),
      healthCheck: {
        intervalSeconds: healthCheckIntervalSeconds,
        minIntervalSeconds: minModelPoolHealthCheckIntervalSeconds,
        maxIntervalSeconds: maxModelPoolHealthCheckIntervalSeconds,
        penaltySeconds,
        minPenaltySeconds: minModelPoolPenaltySeconds,
        maxPenaltySeconds: maxModelPoolPenaltySeconds,
        serverNow: serverNow.toISOString(),
      },
    };
  });

  app.patch("/admin/model-pools/health-check", async (request) => {
    const body = z
      .object({
        intervalSeconds: z
          .number()
          .int()
          .min(minModelPoolHealthCheckIntervalSeconds)
          .max(maxModelPoolHealthCheckIntervalSeconds)
          .optional(),
        penaltySeconds: z
          .number()
          .int()
          .min(minModelPoolPenaltySeconds)
          .max(maxModelPoolPenaltySeconds)
          .optional(),
      })
      .parse(request.body);
    const [intervalSeconds, penaltySeconds] = await Promise.all([
      body.intervalSeconds === undefined
        ? getModelPoolHealthCheckIntervalSeconds()
        : setModelPoolHealthCheckIntervalSeconds(body.intervalSeconds),
      body.penaltySeconds === undefined
        ? getModelPoolPenaltySeconds()
        : setModelPoolPenaltySeconds(body.penaltySeconds),
    ]);

    return {
      healthCheck: {
        intervalSeconds,
        minIntervalSeconds: minModelPoolHealthCheckIntervalSeconds,
        maxIntervalSeconds: maxModelPoolHealthCheckIntervalSeconds,
        penaltySeconds,
        minPenaltySeconds: minModelPoolPenaltySeconds,
        maxPenaltySeconds: maxModelPoolPenaltySeconds,
        serverNow: new Date().toISOString(),
      },
    };
  });

  app.post("/admin/model-pools", async (request, reply) => {
    const body = z
      .object({
        model: z.string().min(1).max(120),
        status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
        autoHealthCheckEnabled: z.boolean().default(true),
        healthCheckEndpoint: modelPoolHealthCheckEndpointSchema.default("responses"),
      })
      .parse(request.body);
    const providers = await prisma.upstreamProvider.findMany({
      select: { name: true },
    });
    const priceCount = await prisma.modelPrice.count({
      where: {
        model: body.model,
        upstreamProvider: { in: providers.map((provider) => provider.name) },
      },
    });

    if (priceCount === 0) {
      return reply.status(400).send({ message: "Model must have upstream pricing before it can be added to the pool" });
    }

    const pool = await prisma.modelPool.upsert({
      where: { model: body.model },
      update: {
        status: body.status,
        autoHealthCheckEnabled: body.autoHealthCheckEnabled,
        healthCheckEndpoint: body.healthCheckEndpoint,
      },
      create: body,
    });

    return { modelPool: pool };
  });

  app.patch("/admin/model-pools/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        autoHealthCheckEnabled: z.boolean().optional(),
        healthCheckEndpoint: modelPoolHealthCheckEndpointSchema.optional(),
      })
      .parse(request.body);
    const modelPool = await prisma.modelPool.update({
      where: { id: params.id },
      data: body,
    });

    return { modelPool };
  });

  app.delete("/admin/model-pools/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const modelPool = await prisma.modelPool.findUnique({
      where: { id: params.id },
      select: { id: true, model: true },
    });

    if (!modelPool) {
      return reply.status(404).send({ message: "Model pool not found" });
    }

    await prisma.modelPool.delete({
      where: { id: params.id },
    });

    return { ok: true, modelPool };
  });

  app.post("/admin/model-pools/:id/channels", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        upstreamProvider: z.string().min(1).max(80),
        status: channelStatusSchema.default("ACTIVE"),
      })
      .parse(request.body);
    const pool = await prisma.modelPool.findUnique({
      where: { id: params.id },
    });

    if (!pool) {
      return reply.status(404).send({ message: "Model pool not found" });
    }

    if (body.upstreamProvider.trim().toLowerCase() === "default") {
      return reply.status(400).send({ message: "Default upstream cannot be added to the model pool" });
    }

    const [provider, price] = await Promise.all([
      prisma.upstreamProvider.findUnique({
        where: { name: body.upstreamProvider },
      }),
      prisma.modelPrice.findUnique({
        where: {
          upstreamProvider_model: {
            upstreamProvider: body.upstreamProvider,
            model: pool.model,
          },
        },
      }),
    ]);

    if (!provider) {
      return reply.status(400).send({ message: "Upstream provider must exist before it can be added to the model pool" });
    }

    if (!price) {
      return reply.status(400).send({ message: "Only priced upstream channels can be added to the model pool" });
    }

    const channel = await prisma.modelPoolChannel.upsert({
      where: {
        modelPoolId_upstreamProvider: {
          modelPoolId: pool.id,
          upstreamProvider: body.upstreamProvider,
        },
      },
      update: {
        status: body.status,
      },
      create: {
        modelPoolId: pool.id,
        upstreamProvider: body.upstreamProvider,
        status: body.status,
      },
    });

    return { channel };
  });

  app.patch("/admin/model-pool-channels/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        status: channelStatusSchema.optional(),
        priority: z.number().int().min(1).max(10000).optional(),
      })
      .parse(request.body);
    const channel = await prisma.modelPoolChannel.update({
      where: { id: params.id },
      data: {
        ...body,
        ...(body.status === "ACTIVE"
          ? {
              consecutiveFailures: 0,
              recoverySuccesses: 0,
              penalizedUntil: null,
              penaltyReason: null,
            }
          : {}),
      },
    });

    return { channel };
  });

  app.delete("/admin/model-pool-channels/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const channel = await prisma.modelPoolChannel.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!channel) {
      return reply.status(404).send({ message: "Model pool channel not found" });
    }

    await prisma.modelPoolChannel.delete({
      where: { id: params.id },
    });

    return { ok: true };
  });

  app.post("/admin/model-pool-channels/:id/check", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await checkModelPoolChannel(params.id);

    if (!result) {
      return reply.status(404).send({ message: "Model pool channel not found" });
    }

    return { result };
  });

  app.post("/admin/model-prices", async (request) => {
    const body = z
      .object({
        model: z.string().min(1).max(120),
        upstreamProvider: z.string().min(1).max(80).default("default"),
        currency: z.string().default("USD"),
        upstreamInputPer1MTok: z.string().or(z.number()),
        upstreamOutputPer1MTok: z.string().or(z.number()),
        upstreamCachedInputPer1MTok: z.string().or(z.number()).default("0"),
        upstreamPriceMultiplier: z.string().or(z.number()).default("1"),
        customerInputPer1MTok: z.string().or(z.number()),
        customerOutputPer1MTok: z.string().or(z.number()),
        customerCachedInputPer1MTok: z.string().or(z.number()).default("0"),
        customerPriceMultiplier: z.string().or(z.number()).default("1"),
        minimumChargeUsd: z.string().or(z.number()).default("0"),
        enabled: z.boolean().default(true),
      })
      .parse(request.body);

    const modelPrice = await prisma.modelPrice.upsert({
      where: {
        upstreamProvider_model: {
          upstreamProvider: body.upstreamProvider,
          model: body.model,
        },
      },
      update: {
        upstreamProvider: body.upstreamProvider,
        currency: body.currency,
        upstreamInputPer1MTok: String(body.upstreamInputPer1MTok),
        upstreamOutputPer1MTok: String(body.upstreamOutputPer1MTok),
        upstreamCachedInputPer1MTok: String(body.upstreamCachedInputPer1MTok),
        upstreamPriceMultiplier: String(body.upstreamPriceMultiplier),
        customerInputPer1MTok: String(body.customerInputPer1MTok),
        customerOutputPer1MTok: String(body.customerOutputPer1MTok),
        customerCachedInputPer1MTok: String(body.customerCachedInputPer1MTok),
        customerPriceMultiplier: String(body.customerPriceMultiplier),
        minimumChargeUsd: String(body.minimumChargeUsd),
        enabled: body.enabled,
      },
      create: {
        model: body.model,
        upstreamProvider: body.upstreamProvider,
        currency: body.currency,
        upstreamInputPer1MTok: String(body.upstreamInputPer1MTok),
        upstreamOutputPer1MTok: String(body.upstreamOutputPer1MTok),
        upstreamCachedInputPer1MTok: String(body.upstreamCachedInputPer1MTok),
        upstreamPriceMultiplier: String(body.upstreamPriceMultiplier),
        customerInputPer1MTok: String(body.customerInputPer1MTok),
        customerOutputPer1MTok: String(body.customerOutputPer1MTok),
        customerCachedInputPer1MTok: String(body.customerCachedInputPer1MTok),
        customerPriceMultiplier: String(body.customerPriceMultiplier),
        minimumChargeUsd: String(body.minimumChargeUsd),
        enabled: body.enabled,
      },
    });

    return { modelPrice };
  });

  app.put("/admin/model-prices/unified", async (request) => {
    const body = z
      .object({
        updates: z
          .array(
            z.object({
              model: z.string().min(1).max(120),
              enabled: z.boolean(),
              customerInputPer1MTok: z.string().or(z.number()),
              customerCachedInputPer1MTok: z.string().or(z.number()).default("0"),
              customerOutputPer1MTok: z.string().or(z.number()),
              customerPriceMultiplier: z.string().or(z.number()).default("1"),
            }),
          )
          .min(1),
      })
      .parse(request.body);

    const updatesByModel = new Map(
      body.updates.map((update) => [
        update.model,
        {
          model: update.model,
          enabled: update.enabled,
          customerInputPer1MTok: String(update.customerInputPer1MTok),
          customerCachedInputPer1MTok: String(update.customerCachedInputPer1MTok),
          customerOutputPer1MTok: String(update.customerOutputPer1MTok),
          customerPriceMultiplier: String(update.customerPriceMultiplier),
        },
      ]),
    );

    const pricedModels = await prisma.modelPrice.findMany({
      where: { model: { in: Array.from(updatesByModel.keys()) } },
      select: { model: true },
    });
    const pricedModelSet = new Set(pricedModels.map((price) => price.model));
    const validUpdates = Array.from(updatesByModel.values()).filter((update) => pricedModelSet.has(update.model));
    const unifiedPriceSettings = validUpdates.length > 0 ? await saveUnifiedPriceSettings(validUpdates) : [];

    return {
      updated: validUpdates.length,
      models: validUpdates.length,
      unifiedPriceSettings,
    };
  });

  app.put("/admin/model-prices/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        model: z.string().min(1).max(120).optional(),
        upstreamProvider: z.string().min(1).max(80).optional(),
        currency: z.string().optional(),
        upstreamInputPer1MTok: z.string().or(z.number()).optional(),
        upstreamOutputPer1MTok: z.string().or(z.number()).optional(),
        upstreamCachedInputPer1MTok: z.string().or(z.number()).optional(),
        upstreamPriceMultiplier: z.string().or(z.number()).optional(),
        customerInputPer1MTok: z.string().or(z.number()).optional(),
        customerOutputPer1MTok: z.string().or(z.number()).optional(),
        customerCachedInputPer1MTok: z.string().or(z.number()).optional(),
        customerPriceMultiplier: z.string().or(z.number()).optional(),
        minimumChargeUsd: z.string().or(z.number()).optional(),
        enabled: z.boolean().optional(),
      })
      .parse(request.body);

    const data = Object.fromEntries(
      Object.entries(body).map(([key, value]) => [
        key,
        typeof value === "boolean" ? value : String(value),
      ]),
    );

    const modelPrice = await prisma.modelPrice.update({
      where: { id: params.id },
      data,
    });

    return { modelPrice };
  });

  app.delete("/admin/model-prices/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const modelPrice = await prisma.modelPrice.findUnique({
      where: { id: params.id },
      select: { id: true, model: true, upstreamProvider: true },
    });

    if (!modelPrice) {
      return reply.status(404).send({ message: "Model price not found" });
    }

    await prisma.$transaction(async (tx) => {
      const pools = await tx.modelPool.findMany({
        where: { model: modelPrice.model },
        select: { id: true },
      });

      await tx.modelPoolChannel.deleteMany({
        where: {
          modelPoolId: { in: pools.map((pool) => pool.id) },
          upstreamProvider: modelPrice.upstreamProvider,
        },
      });

      await tx.modelPrice.delete({
        where: { id: params.id },
      });
    });

    return { ok: true };
  });

  app.get("/admin/upstream-providers", async () => {
    const providers = await prisma.upstreamProvider.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      include: {
        keys: {
          orderBy: [
            { priority: "asc" },
            { createdAt: "asc" },
          ],
        },
      },
    });

    return {
      providers: providers.map(maskProviderKey),
    };
  });

  app.post("/admin/upstream-providers", async (request) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        baseUrl: z.string().url(),
        apiKey: z.string().min(1),
        priority: z.number().int().min(1).max(10000).default(100),
        timeoutMs: z.number().int().min(5000).max(600000).default(180000),
        status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
      })
      .parse(request.body);

    const provider = await prisma.upstreamProvider.upsert({
      where: { name: body.name },
      update: {
        baseUrl: body.baseUrl.replace(/\/+$/, ""),
        apiKey: body.apiKey,
        priority: body.priority,
        timeoutMs: body.timeoutMs,
        status: body.status,
      },
      create: {
        ...body,
        baseUrl: body.baseUrl.replace(/\/+$/, ""),
      },
    });

    await ensureDefaultProviderKey(provider);

    return { provider: maskProviderKey(provider) };
  });

  app.patch("/admin/upstream-providers/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        baseUrl: z.string().url().optional(),
        apiKey: z.string().optional(),
        priority: z.number().int().min(1).max(10000).optional(),
        timeoutMs: z.number().int().min(5000).max(600000).optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
      })
      .parse(request.body);

    const data = {
      ...body,
      ...(body.baseUrl ? { baseUrl: body.baseUrl.replace(/\/+$/, "") } : {}),
      ...(body.apiKey && body.apiKey.trim().length > 0
        ? { apiKey: body.apiKey.trim() }
        : {}),
    };

    if (body.apiKey !== undefined && body.apiKey.trim().length === 0) {
      delete data.apiKey;
    }

    const existingProvider = await prisma.upstreamProvider.findUnique({
      where: { id: params.id },
      select: { name: true },
    });

    if (!existingProvider) {
      return reply.status(404).send({ message: "Upstream provider not found" });
    }

    const provider = await prisma.$transaction(async (tx) => {
      const updatedProvider = await tx.upstreamProvider.update({
        where: { id: params.id },
        data,
      });

      if (body.name && body.name !== existingProvider.name) {
        await tx.modelPrice.deleteMany({
          where: { upstreamProvider: body.name },
        });
        await tx.modelPoolChannel.deleteMany({
          where: { upstreamProvider: body.name },
        });
        await tx.modelPrice.updateMany({
          where: { upstreamProvider: existingProvider.name },
          data: { upstreamProvider: body.name },
        });
        await tx.modelPoolChannel.updateMany({
          where: { upstreamProvider: existingProvider.name },
          data: { upstreamProvider: body.name },
        });
      }

      return updatedProvider;
    });

    if (body.apiKey && body.apiKey.trim().length > 0) {
      await ensureDefaultProviderKey(provider);
    }

    return { provider: maskProviderKey(provider) };
  });

  app.post("/admin/upstream-providers/:id/keys", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        key: z.string().min(1),
        status: upstreamProviderKeyStatusSchema.default("ACTIVE"),
        priority: z.number().int().min(1).max(10000).default(100),
      })
      .parse(request.body);
    const provider = await prisma.upstreamProvider.findUnique({
      where: { id: params.id },
      select: { id: true },
    });

    if (!provider) {
      return reply.status(404).send({ message: "Upstream provider not found" });
    }

    let key;
    try {
      key = await prisma.upstreamProviderKey.create({
        data: {
          upstreamProviderId: params.id,
          name: body.name,
          key: body.key.trim(),
          keyPrefix: upstreamKeyPrefix(body.key.trim()),
          status: body.status,
          priority: body.priority,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ message: "Upstream key name already exists for this provider" });
      }
      throw error;
    }

    return { key: maskProviderPoolKey(key) };
  });

  app.patch("/admin/upstream-provider-keys/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        key: z.string().optional(),
        status: upstreamProviderKeyStatusSchema.optional(),
        priority: z.number().int().min(1).max(10000).optional(),
      })
      .parse(request.body);
    const existing = await prisma.upstreamProviderKey.findUnique({
      where: { id: params.id },
    });

    if (!existing) {
      return reply.status(404).send({ message: "Upstream key not found" });
    }

    const trimmedKey = body.key?.trim();
    let key;
    try {
      key = await prisma.upstreamProviderKey.update({
        where: { id: params.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(trimmedKey ? { key: trimmedKey, keyPrefix: upstreamKeyPrefix(trimmedKey) } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.status(409).send({ message: "Upstream key name already exists for this provider" });
      }
      throw error;
    }

    return { key: maskProviderPoolKey(key) };
  });

  app.delete("/admin/upstream-provider-keys/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const key = await prisma.upstreamProviderKey.findUnique({
      where: { id: params.id },
    });

    if (!key) {
      return reply.status(404).send({ message: "Upstream key not found" });
    }

    await prisma.upstreamProviderKey.delete({
      where: { id: params.id },
    });

    return { ok: true, key: maskProviderPoolKey(key) };
  });

  app.delete("/admin/upstream-providers/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);

    const provider = await prisma.upstreamProvider.findUnique({
      where: { id: params.id },
    });

    if (!provider) {
      return reply.status(404).send({ message: "Upstream provider not found" });
    }

    await prisma.$transaction([
      prisma.modelPoolChannel.deleteMany({
        where: { upstreamProvider: provider.name },
      }),
      prisma.modelPrice.deleteMany({
        where: { upstreamProvider: provider.name },
      }),
      prisma.upstreamProvider.delete({
        where: { id: params.id },
      }),
    ]);

    return { ok: true, provider: maskProviderKey(provider) };
  });
}

function maskProviderKey<T extends { apiKey: string }>(provider: T) {
  const keys = "keys" in provider && Array.isArray(provider.keys)
    ? { keys: provider.keys.map(maskProviderPoolKey) }
    : {};

  return {
    ...provider,
    apiKey: maskUpstreamKeySecret(provider.apiKey),
    ...keys,
  };
}

function maskProviderPoolKey<T extends { key: string }>(key: T) {
  return {
    ...key,
    key: maskUpstreamKeySecret(key.key),
  };
}

async function withAdminApiKeyUsage<T extends { id: string; totalLimitUsd?: unknown }>(apiKey: T) {
  const usedUsd = await getApiKeyTotalUsageUsd(apiKey.id);
  const totalLimitUsd = apiKey.totalLimitUsd?.toString();
  const remainingUsd =
    totalLimitUsd && Number(totalLimitUsd) > 0
      ? Decimal.max(0, new Decimal(totalLimitUsd).minus(usedUsd)).toFixed(8)
      : null;

  return {
    ...apiKey,
    totalUsedUsd: usedUsd.toFixed(8),
    totalRemainingUsd: remainingUsd,
  };
}

function compareModelPoolChannelsForAdmin(
  left: {
    effectiveStatus: string;
    lastFirstTokenLatencyMs: number | null;
    lastLatencyMs: number | null;
    priority: number;
    upstreamProvider: string;
  },
  right: {
    effectiveStatus: string;
    lastFirstTokenLatencyMs: number | null;
    lastLatencyMs: number | null;
    priority: number;
    upstreamProvider: string;
  },
) {
  return (
    modelPoolChannelAvailabilityRank(left.effectiveStatus) -
      modelPoolChannelAvailabilityRank(right.effectiveStatus) ||
    nullableNumberRank(left.lastFirstTokenLatencyMs) -
      nullableNumberRank(right.lastFirstTokenLatencyMs) ||
    nullableNumberRank(left.lastLatencyMs) - nullableNumberRank(right.lastLatencyMs) ||
    left.priority - right.priority ||
    left.upstreamProvider.localeCompare(right.upstreamProvider)
  );
}

function modelPoolChannelAvailabilityRank(status: string) {
  return status === "READY" || status === "FORCED_READY" ? 0 : 1;
}

function nullableNumberRank(value: number | null | undefined) {
  return value ?? Number.MAX_SAFE_INTEGER;
}

async function pingRedis(app: FastifyInstance) {
  try {
    const startedAt = Date.now();
    const pong = await app.redis.ping();
    return {
      ok: pong === "PONG",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : "Redis ping failed",
    };
  }
}

async function pingDatabase() {
  try {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : "Database ping failed",
    };
  }
}

function getSystemStatus() {
  const totalMemoryBytes = totalmem();
  const freeMemoryBytes = freemem();
  const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);
  const cpuCount = cpus().length || 1;
  const cpuSnapshot = getSystemCpuSnapshot();
  const totalDelta = cpuSnapshot.total - lastSystemCpuSnapshot.total;
  const idleDelta = cpuSnapshot.idle - lastSystemCpuSnapshot.idle;
  const usagePercent = totalDelta > 0
    ? Number((Math.max(0, 1 - idleDelta / totalDelta) * 100).toFixed(2))
    : 0;
  lastSystemCpuSnapshot = cpuSnapshot;

  return {
    cpuCount,
    cpuUsagePercent: usagePercent,
    loadAverage: loadavg(),
    totalMemoryBytes,
    freeMemoryBytes,
    usedMemoryBytes,
    memoryUsagePercent: totalMemoryBytes > 0
      ? Number(((usedMemoryBytes / totalMemoryBytes) * 100).toFixed(2))
      : 0,
  };
}

function getSystemCpuSnapshot() {
  return cpus().reduce(
    (total, cpu) => {
      const cpuTotal = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      return {
        idle: total.idle + cpu.times.idle,
        total: total.total + cpuTotal,
      };
    },
    { idle: 0, total: 0 },
  );
}

function getProcessCpuStatus() {
  const measuredAtMs = performance.now();
  const usage = process.cpuUsage();
  const elapsedMs = Math.max(1, measuredAtMs - lastCpuSnapshot.measuredAtMs);
  const userDiffMs = (usage.user - lastCpuSnapshot.usage.user) / 1000;
  const systemDiffMs = (usage.system - lastCpuSnapshot.usage.system) / 1000;
  const cpuCount = cpus().length || 1;
  const percent = ((userDiffMs + systemDiffMs) / elapsedMs) * 100 / cpuCount;

  lastCpuSnapshot = {
    measuredAtMs,
    usage,
  };

  return {
    percent: Number(Math.max(0, percent).toFixed(2)),
    userMs: Math.round(usage.user / 1000),
    systemMs: Math.round(usage.system / 1000),
  };
}

async function getPm2Status() {
  try {
    const { stdout } = await exec("pm2 jlist");
    const processes = JSON.parse(stdout) as Array<{
      pm2_env?: { name?: string; status?: string };
      pm2_env_status?: string;
      pm_id?: number;
      monit?: { cpu?: number; memory?: number };
      pid?: number;
      name?: string;
    }>;

    return {
      ok: true,
      processes: processes
        .map((process) => ({
          name: process.pm2_env?.name ?? process.name ?? `pm2-${process.pm_id ?? "unknown"}`,
          pid: process.pid ?? null,
          status: process.pm2_env?.status ?? process.pm2_env_status ?? "unknown",
          cpu: process.monit?.cpu ?? null,
          memory: process.monit?.memory ?? null,
        }))
        .filter((process) => process.name.includes("api-gateway")),
    };
  } catch (error) {
    return {
      ok: false,
      processes: [],
      error: error instanceof Error ? error.message : "PM2 status failed",
    };
  }
}

async function getModelPoolStatus(app: FastifyInstance) {
  const [channels, healthCheckIntervalSeconds, upstreamKeys] = await Promise.all([
    prisma.modelPoolChannel.findMany({
      where: {
        modelPool: {
          status: "ACTIVE",
        },
      },
      select: {
        id: true,
        status: true,
        priority: true,
        consecutiveFailures: true,
        recoverySuccesses: true,
        penalizedUntil: true,
        lastCheckStatus: true,
        lastCheckedAt: true,
        lastLatencyMs: true,
        lastFirstTokenLatencyMs: true,
        modelPool: {
          select: {
            model: true,
            healthCheckEndpoint: true,
          },
        },
      },
    }),
    getModelPoolHealthCheckIntervalSeconds(),
    prisma.upstreamProviderKey.findMany({
      select: { id: true, status: true },
    }),
  ]);

  const activeChannels = channels.filter((channel) => channel.status === "ACTIVE" || channel.status === "FORCED_ACTIVE");
  const unavailableChannels = channels.filter((channel) => channel.status === "UNAVAILABLE");
  const penalizedChannels = channels.filter((channel) => channel.status === "PENALIZED");
  const recoveringChannels = channels.filter(
    (channel) => channel.status === "UNAVAILABLE" && channel.recoverySuccesses > 0,
  );
  const inflightCounts = await readRedisCounts(
    app,
    channels.map((channel) => `modelpool:balance:inflight:${channel.id}`),
  );
  const keyInflightCounts = await readRedisCounts(
    app,
    upstreamKeys.map((key) => upstreamKeyInflightKey(key.id)),
  );
  const channelSummaries = channels.map((channel, index) => ({
    id: channel.id,
    model: channel.modelPool.model,
    healthCheckEndpoint: normalizeModelPoolHealthCheckEndpoint(channel.modelPool.healthCheckEndpoint),
    status: channel.status,
    priority: channel.priority,
    consecutiveFailures: channel.consecutiveFailures,
    recoverySuccesses: channel.recoverySuccesses,
    penalizedUntil: channel.penalizedUntil,
    lastCheckStatus: channel.lastCheckStatus,
    lastCheckedAt: channel.lastCheckedAt,
    lastLatencyMs: channel.lastLatencyMs,
    lastFirstTokenLatencyMs: channel.lastFirstTokenLatencyMs,
    inflightRequests: inflightCounts[index] ?? 0,
  }));

  return {
    healthCheckIntervalSeconds,
    totalChannels: channels.length,
    activeChannels: activeChannels.length,
    unavailableChannels: unavailableChannels.length,
    penalizedChannels: penalizedChannels.length,
    recoveringChannels: recoveringChannels.length,
    inflightRequests: inflightCounts.reduce((total, value) => total + value, 0),
    upstreamKeys: {
      total: upstreamKeys.length,
      active: upstreamKeys.filter((key) => key.status === "ACTIVE").length,
      inflightRequests: keyInflightCounts.reduce((total, value) => total + value, 0),
    },
    autoCheckEnabledPools: await prisma.modelPool.count({
      where: { autoHealthCheckEnabled: true, status: "ACTIVE" },
    }),
    channels: channelSummaries.slice(0, 20),
  };
}

async function getApiKeyRuntimeStats(app: FastifyInstance) {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const [apiKeys, limitedKeys] = await Promise.all([
    prisma.apiKey.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ concurrencyLimit: { gt: 0 } }, { rateLimitPerMinute: { gt: 0 } }],
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        concurrencyLimit: true,
        rateLimitPerMinute: true,
      },
      take: 50,
      orderBy: { lastUsedAt: "desc" },
    }),
    prisma.apiKey.count({
      where: {
        status: "ACTIVE",
        OR: [{ concurrencyLimit: { gt: 0 } }, { rateLimitPerMinute: { gt: 0 } }],
      },
    }),
  ]);
  const concurrencyCounts = await readRedisCounts(
    app,
    apiKeys.map((apiKey) => `concurrency:${apiKey.id}`),
  );
  const minuteCounts = await readRedisCounts(
    app,
    apiKeys.map((apiKey) => `ratelimit:${apiKey.id}:${minuteBucket}`),
  );
  const sample = apiKeys.slice(0, 10).map((apiKey, index) => ({
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    concurrencyLimit: apiKey.concurrencyLimit,
    currentConcurrency: concurrencyCounts[index] ?? 0,
    rateLimitPerMinute: apiKey.rateLimitPerMinute,
    currentMinuteRequests: minuteCounts[index] ?? 0,
  }));

  return {
    monitoredKeys: apiKeys.length,
    limitedKeys,
    activeConcurrency: concurrencyCounts.reduce((total, value) => total + value, 0),
    currentMinuteRequests: minuteCounts.reduce((total, value) => total + value, 0),
    sample,
  };
}

async function readRedisCounts(app: FastifyInstance, keys: string[]) {
  if (keys.length === 0) {
    return [];
  }

  try {
    const values = await app.redis.mget(...keys);
    return values.map((value) => {
      const numberValue = Number(value ?? 0);
      return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
    });
  } catch {
    return keys.map(() => 0);
  }
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
