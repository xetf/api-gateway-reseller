import type { FastifyInstance } from "fastify";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { createApiKey } from "../lib/crypto.js";
import { requireUser } from "../services/auth.js";

const dailyLimitUsdSchema = z
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
        message: "dailyLimitUsd must be a non-negative number",
      });
      return z.NEVER;
    }

    return numeric.toFixed(8);
  });

const createKeySchema = z.object({
  name: z.string().min(1).max(80),
  rateLimitPerMinute: z.number().int().positive().max(10000).default(60),
  dailyLimitUsd: dailyLimitUsdSchema,
  concurrencyLimit: z.number().int().min(0).max(10000).default(0),
  allowedModels: z.array(z.string()).default([]),
});

export async function apiKeyRoutes(app: FastifyInstance) {
  app.get("/api-keys", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };

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
        concurrencyLimit: true,
        allowedModels: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    return { apiKeys };
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
        dailyLimitUsd: body.dailyLimitUsd ?? null,
        concurrencyLimit: body.concurrencyLimit,
        allowedModels: body.allowedModels,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        keySecret: true,
        status: true,
        rateLimitPerMinute: true,
        dailyLimitUsd: true,
        concurrencyLimit: true,
        allowedModels: true,
        createdAt: true,
      },
    });

    return {
      apiKey,
      secret: generated.key,
    };
  });

  app.patch("/api-keys/:id", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().min(1).max(80).optional(),
        status: z.enum(["ACTIVE", "DISABLED", "REVOKED"]).optional(),
        rateLimitPerMinute: z.number().int().positive().max(10000).optional(),
        dailyLimitUsd: dailyLimitUsdSchema,
        concurrencyLimit: z.number().int().min(0).max(10000).optional(),
        allowedModels: z.array(z.string()).optional(),
      })
      .parse(request.body);

    const apiKey = await prisma.apiKey.update({
      where: {
        id: params.id,
        userId: user.sub,
      },
      data: body,
    });

    return { apiKey };
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
