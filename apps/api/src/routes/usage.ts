import type { FastifyInstance } from "fastify";
import { prisma } from "@gateway/db";
import { requireUser } from "../services/auth.js";

export async function usageRoutes(app: FastifyInstance) {
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
        acc.outputTokens += item.outputTokens;
        acc.totalTokens += item.totalTokens;
        acc.chargedAmountUsd += Number(item.chargedAmountUsd);
        return acc;
      },
      {
        requests: 0,
        inputTokens: 0,
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
  model: true,
  endpoint: true,
  method: true,
  status: true,
  httpStatus: true,
  inputTokens: true,
  outputTokens: true,
  totalTokens: true,
  chargedAmountUsd: true,
  latencyMs: true,
  errorMessage: true,
  createdAt: true,
} as const;
