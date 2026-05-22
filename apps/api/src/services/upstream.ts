import { prisma } from "@gateway/db";
import { env } from "../env.js";
import {
  clearStickyModelPoolChannel,
  getStickyModelPoolChannel,
  setStickyModelPoolChannel,
} from "./model-pool-stickiness.js";

type Provider = Awaited<ReturnType<typeof getDefaultProvider>>;

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

export async function getProviderForModel(userId: string, model: string): Promise<{
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

  const stickyChannelId = await getStickyModelPoolChannel(userId, model);
  if (stickyChannelId) {
    const stickyChannel = modelPool.channels.find((channel) => channel.id === stickyChannelId);
    if (stickyChannel) {
      const stickyRoute = await getRouteForChannel(model, stickyChannel);

      if (stickyRoute) {
        await setStickyModelPoolChannel(userId, model, stickyChannel.id);
        return stickyRoute;
      }
    }

    await clearStickyModelPoolChannel(userId, model, stickyChannelId);
  }

  for (const channel of modelPool.channels) {
    const route = await getRouteForChannel(model, channel);
    if (route) {
      await setStickyModelPoolChannel(userId, model, channel.id);
      return route;
    }
  }

  return null;
}

async function getRouteForChannel(
  model: string,
  channel: {
    id: string;
    upstreamProvider: string;
  },
): Promise<{
  provider: Provider;
  price: NonNullable<Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>>;
  channelId: string;
} | null> {
  const provider = await prisma.upstreamProvider.findFirst({
    where: {
      name: channel.upstreamProvider,
      status: "ACTIVE",
    },
  });

  if (!provider) {
    return null;
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
