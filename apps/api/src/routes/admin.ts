import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { Decimal } from "decimal.js";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { createRedeemCode } from "../lib/crypto.js";
import { hashPassword, requireAdmin, requireUser } from "../services/auth.js";

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
        model: true,
        endpoint: true,
        method: true,
        status: true,
        httpStatus: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        chargedAmountUsd: true,
        upstreamCostUsd: true,
        latencyMs: true,
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
      orderBy: { model: "asc" },
    });
    return { modelPrices };
  });

  app.post("/admin/model-prices", async (request) => {
    const body = z
      .object({
        model: z.string().min(1).max(120),
        upstreamProvider: z.string().default("default"),
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
      where: { model: body.model },
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

  app.patch("/admin/upstream-providers/:id", async (request) => {
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

    const provider = await prisma.upstreamProvider.update({
      where: { id: params.id },
      data,
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

    await prisma.upstreamProvider.delete({
      where: { id: params.id },
    });

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

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
