import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { createApiKey } from "../lib/crypto.js";
import { requireUser } from "../services/auth.js";
import {
  disableApiKeyIfTotalLimitReached,
  disableExpiredOrOverLimitApiKeys,
  getApiKeyTotalUsageUsd,
} from "../services/api-key-limits.js";

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

const createKeySchema = z.object({
  name: z.string().min(1).max(80),
  rateLimitPerMinute: z.number().int().positive().max(10000).default(60),
  totalLimitUsd: moneyLimitSchema,
  dailyLimitUsd: moneyLimitSchema,
  expiresAt: expiresAtSchema,
  concurrencyLimit: z.number().int().min(0).max(10000).default(0),
  allowedModels: z.array(z.string()).default([]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  ipWhitelist: z.array(z.string().trim().min(1).max(128)).max(100).default([]),
});

const modelMappingsSchema = z.object({
  mappings: z
    .array(
      z.object({
        fromModel: z.string().trim().min(1).max(200),
        toModel: z.string().trim().min(1).max(200),
      }),
    )
    .max(500),
});

function normalizeTags(tags: string[] | undefined) {
  return Array.from(
    new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
  ).slice(0, 20);
}

function normalizeIpPatterns(patterns: string[] | undefined) {
  return Array.from(
    new Set((patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean)),
  ).slice(0, 100);
}

export async function apiKeyRoutes(app: FastifyInstance) {
  app.get("/model-mappings", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const mappings = await prisma.userModelMapping.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        fromModel: true,
        toModel: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return { mappings };
  });

  app.put("/model-mappings", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const body = modelMappingsSchema.parse(request.body);
    const mappings = normalizeModelMappings(body.mappings);

    await prisma.$transaction([
      prisma.userModelMapping.deleteMany({ where: { userId: user.sub } }),
      ...mappings.map((mapping) =>
        prisma.userModelMapping.create({
          data: {
            userId: user.sub,
            fromModel: mapping.fromModel,
            toModel: mapping.toModel,
          },
        }),
      ),
    ]);

    return {
      mappings: await prisma.userModelMapping.findMany({
        where: { userId: user.sub },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fromModel: true,
          toModel: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    };
  });

  app.get("/api-keys", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    await disableExpiredOrOverLimitApiKeys(user.sub);

    const apiKeys = await prisma.apiKey.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
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
        tags: true,
        disabledReason: true,
        disabledAt: true,
        ipWhitelist: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return { apiKeys: await Promise.all(apiKeys.map(withApiKeyUsage)) };
  });

  app.post("/api-keys", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const body = createKeySchema.parse(request.body);
    const generated = createApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        userId: user.sub,
        name: body.name,
        keyHash: generated.hash,
        keyPrefix: generated.prefix,
        keySecret: generated.key,
        rateLimitPerMinute: body.rateLimitPerMinute,
        totalLimitUsd: body.totalLimitUsd ?? body.dailyLimitUsd ?? null,
        expiresAt: body.expiresAt,
        concurrencyLimit: body.concurrencyLimit,
        allowedModels: body.allowedModels,
        tags: normalizeTags(body.tags),
        ipWhitelist: normalizeIpPatterns(body.ipWhitelist),
      },
      select: {
        id: true,
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
        tags: true,
        disabledReason: true,
        disabledAt: true,
        ipWhitelist: true,
        createdAt: true,
      },
    });

    return {
      apiKey: await withApiKeyUsage(apiKey),
      secret: generated.key,
    };
  });

  app.patch("/api-keys/:id", { preHandler: requireUser }, async (request, reply) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        status: z.enum(["ACTIVE", "DISABLED", "REVOKED"]).optional(),
        rateLimitPerMinute: z.number().int().positive().max(10000).optional(),
        totalLimitUsd: moneyLimitSchema,
        dailyLimitUsd: moneyLimitSchema,
        expiresAt: expiresAtSchema,
        concurrencyLimit: z.number().int().min(0).max(10000).optional(),
        allowedModels: z.array(z.string()).optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        ipWhitelist: z.array(z.string().trim().min(1).max(128)).max(100).optional(),
      })
      .parse(request.body);
    const shouldActivate = body.status === "ACTIVE";
    const data = {
      ...body,
      totalLimitUsd:
        body.totalLimitUsd === undefined ? body.dailyLimitUsd : body.totalLimitUsd,
      dailyLimitUsd: undefined,
      status: shouldActivate ? undefined : body.status,
      ...(body.tags !== undefined ? { tags: normalizeTags(body.tags) } : {}),
      ...(body.ipWhitelist !== undefined
        ? { ipWhitelist: normalizeIpPatterns(body.ipWhitelist) }
        : {}),
    };

    const existing = await prisma.apiKey.findFirst({
      where: {
        id: params.id,
        userId: user.sub,
      },
      select: {
        id: true,
        expiresAt: true,
        totalLimitUsd: true,
        disabledReason: true,
        disabledAt: true,
      },
    });

    if (!existing) {
      return reply.status(404).send({ message: "API key not found" });
    }

    if (shouldActivate) {
      const nextExpiresAt = body.expiresAt !== undefined ? body.expiresAt : existing.expiresAt;
      if (nextExpiresAt && nextExpiresAt <= new Date()) {
        return reply.status(400).send({ message: "Cannot enable an expired API key" });
      }

      const nextTotalLimitUsd =
        data.totalLimitUsd === undefined ? existing.totalLimitUsd?.toString() : data.totalLimitUsd;
      if (nextTotalLimitUsd) {
        const usedUsd = await getApiKeyTotalUsageUsd(existing.id);
        if (usedUsd.gte(nextTotalLimitUsd)) {
          return reply.status(400).send({ message: "Cannot enable an API key over its total quota" });
        }
      }
    }

    const apiKey = await prisma.apiKey.update({
      where: {
        id: params.id,
        userId: user.sub,
      },
      data,
    });

    if (shouldActivate) {
      const activatedApiKey = await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { status: "ACTIVE", disabledReason: null, disabledAt: null },
      });
      return { apiKey: await withApiKeyUsage(activatedApiKey) };
    }

    if (apiKey.status === "ACTIVE" && apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
      const disabledApiKey = await prisma.apiKey.update({
        where: { id: apiKey.id },
        data: {
          status: "DISABLED",
          disabledReason: "Expired",
          disabledAt: new Date(),
        },
      });
      return { apiKey: await withApiKeyUsage(disabledApiKey) };
    }

    if (apiKey.status === "ACTIVE" && (await disableApiKeyIfTotalLimitReached(apiKey))) {
      return { apiKey: await withApiKeyUsage({ ...apiKey, status: "DISABLED" }) };
    }

    return { apiKey: await withApiKeyUsage(apiKey) };
  });

  app.delete("/api-keys/:id", { preHandler: requireUser }, async (request, reply) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);

    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: params.id,
        userId: user.sub,
      },
      select: { id: true, keyPrefix: true, keySecret: true, name: true },
    });

    if (!apiKey) {
      return reply.status(404).send({ message: "API key not found" });
    }

    await prisma.apiKey.delete({
      where: { id: params.id },
    });

    return { ok: true, apiKey };
  });
}

function normalizeModelMappings(
  mappings: Array<{ fromModel: string; toModel: string }>,
) {
  const byFromModel = new Map<string, { fromModel: string; toModel: string }>();
  for (const mapping of mappings) {
    const fromModel = mapping.fromModel.trim();
    const toModel = mapping.toModel.trim();
    if (!fromModel || !toModel) {
      continue;
    }
    byFromModel.set(fromModel, { fromModel, toModel });
  }
  return [...byFromModel.values()];
}

async function withApiKeyUsage<T extends { id: string; totalLimitUsd?: unknown }>(apiKey: T) {
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
