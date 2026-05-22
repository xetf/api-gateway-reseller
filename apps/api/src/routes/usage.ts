import type { FastifyInstance } from "fastify";
import { prisma } from "@gateway/db";
import { requireUser } from "../services/auth.js";

export async function usageRoutes(app: FastifyInstance) {
  app.get("/models", { preHandler: requireUser }, async (request, reply) => {
    const authUser = request.user as { sub: string };
    const user = await prisma.user.findUnique({
      where: { id: authUser.sub },
      select: { status: true, allowedModels: true },
    });

    if (!user || user.status !== "ACTIVE") {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const pools = await prisma.modelPool.findMany({
      where: {
        status: "ACTIVE",
        ...(user.allowedModels.length > 0
          ? { model: { in: user.allowedModels } }
          : {}),
      },
      orderBy: { model: "asc" },
      include: {
        channels: {
          where: { status: { in: ["ACTIVE", "FORCED_ACTIVE"] } },
          orderBy: [
            { lastFirstTokenLatencyMs: "asc" },
            { lastLatencyMs: "asc" },
            { priority: "asc" },
          ],
        },
      },
    });
    const [prices, providers] = await Promise.all([
      prisma.modelPrice.findMany({
        where: {
          enabled: true,
          model: { in: pools.map((pool) => pool.model) },
        },
        select: {
          model: true,
          upstreamProvider: true,
        },
      }),
      prisma.upstreamProvider.findMany({
        where: { status: "ACTIVE" },
        select: { name: true },
      }),
    ]);
    const priceSet = new Set(
      prices.map((price) => `${price.upstreamProvider}:${price.model}`),
    );
    const providerSet = new Set(providers.map((provider) => provider.name));
    const models = pools
      .map((pool) => {
        const readyChannelCount = pool.channels.filter(
          (channel) =>
            providerSet.has(channel.upstreamProvider) &&
            priceSet.has(`${channel.upstreamProvider}:${pool.model}`),
        ).length;

        return {
          model: pool.model,
          status: readyChannelCount > 0 ? "READY" : "UNAVAILABLE",
          readyChannelCount,
        };
      })
      .filter((model) => model.readyChannelCount > 0);

    return { models };
  });

  app.get("/usage/summary", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const requests = await prisma.apiRequest.findMany({
      where: {
        userId: user.sub,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: publicRequestSelect,
    });

    const totals = requests.reduce(
      (acc, item) => {
        acc.requests += 1;
        acc.inputTokens += item.inputTokens;
        acc.cachedInputTokens += item.cachedInputTokens;
        acc.outputTokens += item.outputTokens;
        acc.totalTokens += item.totalTokens;
        acc.chargedAmountUsd += Number(item.chargedAmountUsd);
        return acc;
      },
      {
        requests: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        chargedAmountUsd: 0,
      },
    );

    return { totals, requests };
  });

  app.get("/usage/requests", { preHandler: requireUser }, async (request) => {
    const user = request.user as { sub: string };
    const requests = await prisma.apiRequest.findMany({
      where: { userId: user.sub },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: publicRequestSelect,
    });

    return { requests };
  });
}

const publicRequestSelect = {
  id: true,
  upstreamProvider: true,
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
  latencyMs: true,
  firstTokenLatencyMs: true,
  errorMessage: true,
  createdAt: true,
} as const;
