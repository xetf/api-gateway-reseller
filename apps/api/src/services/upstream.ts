import { prisma } from "@gateway/db";
import { env } from "../env.js";

type Provider = NonNullable<Awaited<ReturnType<typeof getDefaultProvider>>>;

export async function getDefaultProvider() {
  const provider = await prisma.upstreamProvider.findFirst({
    where: {
      status: "ACTIVE",
    },
    orderBy: {
      priority: "asc",
    },
  });

  if (provider) {
    return provider;
  }

  if (!env.UPSTREAM_API_KEY) {
    return null;
  }

  return {
    id: "env",
    name: "default",
    baseUrl: env.UPSTREAM_BASE_URL,
    apiKey: env.UPSTREAM_API_KEY,
    status: "ACTIVE",
    priority: 100,
    timeoutMs: env.UPSTREAM_TIMEOUT_MS,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getProviderForModel(model: string): Promise<{
  provider: Provider;
  price: NonNullable<Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>>;
  channelId?: string;
} | null> {
  const modelPool = await prisma.modelPool.findFirst({
    where: {
      model,
      status: "ACTIVE",
    },
    include: {
      channels: {
        where: { status: { in: ["ACTIVE", "FORCED_ACTIVE"] } },
        orderBy: [
          { lastFirstTokenLatencyMs: "asc" },
          { lastLatencyMs: "asc" },
          { priority: "asc" },
          { updatedAt: "desc" },
        ],
      },
    },
  });

  if (!modelPool || modelPool.channels.length === 0) {
    return null;
  }

  for (const channel of modelPool.channels) {
    const provider = await prisma.upstreamProvider.findFirst({
      where: {
        name: channel.upstreamProvider,
        status: "ACTIVE",
      },
    });

    if (!provider) {
      continue;
    }

    const price = await prisma.modelPrice.findUnique({
      where: {
        upstreamProvider_model: {
          upstreamProvider: channel.upstreamProvider,
          model,
        },
      },
    });

    if (price?.enabled) {
      return { provider, price, channelId: channel.id };
    }
  }

  return null;
}

export function buildUpstreamUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedBase.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${normalizedBase}${normalizedPath.slice(3)}`;
  }

  return `${normalizedBase}${normalizedPath}`;
}
