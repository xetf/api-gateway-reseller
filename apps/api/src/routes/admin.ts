import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { exec as execCallback } from "node:child_process";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { createRedeemCode } from "../lib/crypto.js";
import { hashPassword, requireAdmin, requireUser } from "../services/auth.js";
import {
  checkModelPoolChannel,
  getModelPoolChannelHealthTiming,
  getModelPoolHealthCheckIntervalSeconds,
  maxModelPoolHealthCheckIntervalSeconds,
  minModelPoolHealthCheckIntervalSeconds,
  setModelPoolHealthCheckIntervalSeconds,
} from "../services/model-pool-health.js";

const exec = promisify(execCallback);
let lastCpuSnapshot = {
  measuredAtMs: performance.now(),
  usage: process.cpuUsage(),
};
let lastSystemCpuSnapshot = getSystemCpuSnapshot();

const callableChannelStatuses = new Set(["ACTIVE", "FORCED_ACTIVE"]);
const channelStatusSchema = z.enum(["ACTIVE", "FORCED_ACTIVE", "DISABLED", "UNAVAILABLE"]);

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

  app.get("/admin/users", async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        status: true,
        allowedModels: true,
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
        _count: {
          select: {
            apiKeys: true,
            apiRequests: true,
          },
        },
      },
    });

    return { users };
  });

  app.patch("/admin/users/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        email: z.string().email().optional(),
        name: z.string().max(120).nullable().optional(),
        role: z.enum(["USER", "ADMIN"]).optional(),
        status: z.enum(["ACTIVE", "DISABLED"]).optional(),
        allowedModels: z.array(z.string()).optional(),
        password: z.string().min(8).optional(),
      })
      .parse(request.body);

    const data = {
      ...(body.email ? { email: body.email } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.role ? { role: body.role } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.allowedModels ? { allowedModels: body.allowedModels } : {}),
      ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
    };

    const user = await prisma.user.update({
      where: { id: params.id },
      data,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        status: true,
        allowedModels: true,
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
        password: z.string().min(8),
        name: z.string().optional(),
        role: z.enum(["USER", "ADMIN"]).default("USER"),
        allowedModels: z.array(z.string()).default([]),
        initialBalance: z.string().or(z.number()).optional(),
      })
      .parse(request.body);

    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: body.email,
            name: body.name,
            role: body.role,
            allowedModels: body.allowedModels,
            passwordHash: await hashPassword(body.password),
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

  app.get("/admin/requests", async (request) => {
    const query = z
      .object({
        q: z.string().optional(),
        userId: z.string().optional(),
        model: z.string().optional(),
        status: z.enum(["PENDING", "SUCCESS", "FAILED"]).optional(),
        dateFrom: z.string().datetime().optional(),
        dateTo: z.string().datetime().optional(),
        take: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(request.query);
    const andFilters = [];

    if (query.userId) {
      andFilters.push({ userId: query.userId });
    }

    if (query.model) {
      andFilters.push({
        model: {
          contains: query.model,
          mode: "insensitive" as const,
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

    if (query.q) {
      andFilters.push({
        OR: [
          {
            model: {
              contains: query.q,
              mode: "insensitive" as const,
            },
          },
          {
            endpoint: {
              contains: query.q,
              mode: "insensitive" as const,
            },
          },
          {
            clientIp: {
              contains: query.q,
              mode: "insensitive" as const,
            },
          },
          {
            user: {
              email: {
                contains: query.q,
                mode: "insensitive" as const,
              },
            },
          },
        ],
      });
    }

    const requests = await prisma.apiRequest.findMany({
      where: andFilters.length > 0 ? { AND: andFilters } : undefined,
      orderBy: { createdAt: "desc" },
      take: query.take,
      select: {
        id: true,
        upstreamProvider: true,
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
        createdAt: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    return { requests };
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
    return { modelPrices };
  });

  app.get("/admin/model-pools", async () => {
    const serverNow = new Date();
    const healthCheckIntervalSeconds = await getModelPoolHealthCheckIntervalSeconds();
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
          const healthTiming = pool.autoHealthCheckEnabled
            ? baseHealthTiming
            : {
                ...baseHealthTiming,
                nextCheckAt: null,
                nextCheckRemainingSeconds: null,
              };
          return {
            ...channel,
            hasPrice: Boolean(price),
            priceEnabled: price?.enabled ?? false,
            providerStatus: provider?.status ?? "MISSING",
            providerPriority: provider?.priority ?? null,
            ...healthTiming,
            effectiveStatus:
              pool.status === "ACTIVE" &&
              callableChannelStatuses.has(channel.status) &&
              provider?.status === "ACTIVE" &&
              price?.enabled
                ? channel.status === "FORCED_ACTIVE"
                  ? "FORCED_READY"
                  : "READY"
                : "UNAVAILABLE",
          };
        }).sort(compareModelPoolChannelsForAdmin);

        return {
          ...pool,
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
      })),
      healthCheck: {
        intervalSeconds: healthCheckIntervalSeconds,
        minIntervalSeconds: minModelPoolHealthCheckIntervalSeconds,
        maxIntervalSeconds: maxModelPoolHealthCheckIntervalSeconds,
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
          .max(maxModelPoolHealthCheckIntervalSeconds),
      })
      .parse(request.body);
    const intervalSeconds = await setModelPoolHealthCheckIntervalSeconds(body.intervalSeconds);

    return {
      healthCheck: {
        intervalSeconds,
        minIntervalSeconds: minModelPoolHealthCheckIntervalSeconds,
        maxIntervalSeconds: maxModelPoolHealthCheckIntervalSeconds,
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
        ...(body.status === "ACTIVE" ? { consecutiveFailures: 0 } : {}),
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
        timeoutMs: z.number().int().min(5000).max(600000).default(120000),
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

    return { provider: maskProviderKey(provider) };
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
  const visibleStart = provider.apiKey.slice(0, 7);
  const visibleEnd = provider.apiKey.slice(-4);

  return {
    ...provider,
    apiKey: `${visibleStart}...${visibleEnd}`,
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
  return status === "UNAVAILABLE" ? 1 : 0;
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
  const [channels, healthCheckIntervalSeconds] = await Promise.all([
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
        lastCheckStatus: true,
        lastCheckedAt: true,
        lastLatencyMs: true,
        lastFirstTokenLatencyMs: true,
        modelPool: {
          select: {
            model: true,
          },
        },
      },
    }),
    getModelPoolHealthCheckIntervalSeconds(),
  ]);

  const activeChannels = channels.filter((channel) => channel.status === "ACTIVE" || channel.status === "FORCED_ACTIVE");
  const unavailableChannels = channels.filter((channel) => channel.status === "UNAVAILABLE");
  const inflightCounts = await readRedisCounts(
    app,
    channels.map((channel) => `modelpool:balance:inflight:${channel.id}`),
  );
  const channelSummaries = channels.map((channel, index) => ({
    id: channel.id,
    model: channel.modelPool.model,
    status: channel.status,
    priority: channel.priority,
    consecutiveFailures: channel.consecutiveFailures,
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
    inflightRequests: inflightCounts.reduce((total, value) => total + value, 0),
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
