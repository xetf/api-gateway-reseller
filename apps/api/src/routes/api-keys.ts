import type { FastifyInstance } from "fastify";
import { prisma } from "@gateway/db";
import { z } from "zod";
import { createApiKey } from "../lib/crypto.js";
import { requireUser } from "../services/auth.js";

const createKeySchema = z.object({
  name: z.string().min(1).max(80),
  rateLimitPerMinute: z.number().int().positive().max(10000).default(60),
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
        status: true,
        rateLimitPerMinute: true,
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
        rateLimitPerMinute: body.rateLimitPerMinute,
        allowedModels: body.allowedModels,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        status: true,
        rateLimitPerMinute: true,
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
}
