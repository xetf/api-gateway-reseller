import { prisma } from "@gateway/db";
import { env } from "../env.js";
import {
  clearStickyModelPoolChannel,
  getStickyModelPoolChannel,
  setStickyModelPoolChannel,
} from "./model-pool-stickiness.js";
import {
  getInflightPenaltyMs,
  getSpeedScoreMs,
  getSpeedWindowMs,
  reserveBalancedModelPoolChannel,
} from "./model-pool-load-balancer.js";
import { reserveProviderKey, type UpstreamKeyReservation } from "./upstream-provider-keys.js";

type Provider = Awaited<ReturnType<typeof getDefaultProvider>>;
type ReleaseModelPoolReservation = () => Promise<void>;
type RoutedProvider = Provider & {
  apiKey: string;
  upstreamProviderKeyId?: string;
  upstreamProviderKeyName?: string;
  upstreamProviderKeyPrefix?: string;
};

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
    status: "ACTIVE" as const,
    priority: 100,
    timeoutMs: env.UPSTREAM_TIMEOUT_MS,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export async function getProviderForModel(callerIdentity: string, model: string): Promise<{
  provider: RoutedProvider;
  price: NonNullable<Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>>;
  channelId?: string;
  release?: ReleaseModelPoolReservation;
} | null> {
  const modelPool = await prisma.modelPool.findFirst({
    where: {
      model,
      status: "ACTIVE",
    },
    include: {
      channels: {
        where: {
          status: { in: ["ACTIVE", "FORCED_ACTIVE"] },
        },
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

  const stickyChannelId = await getStickyModelPoolChannel(callerIdentity, model);
  if (stickyChannelId) {
    const stickyChannel = modelPool.channels.find((channel) => channel.id === stickyChannelId);
    if (stickyChannel) {
      const stickyRoute = await getRouteForChannelWithKey(model, stickyChannel);

      if (stickyRoute) {
        await setStickyModelPoolChannel(callerIdentity, model, stickyChannel.id);
        return stickyRoute;
      }
    }

    await clearStickyModelPoolChannel(callerIdentity, model, stickyChannelId);
  }

  const routeCandidates = await getRouteCandidates(model, modelPool.channels);
  if (routeCandidates.length === 0) {
    return null;
  }

  const skippedChannelIds = new Set<string>();

  while (skippedChannelIds.size < routeCandidates.length) {
    const selectableRoutes = routeCandidates.filter((route) => !skippedChannelIds.has(route.channelId));
    const balancedRoute = await getBalancedRoute(selectableRoutes);
    if (!balancedRoute) {
      return null;
    }

    const preparedRoute = await prepareRoute(balancedRoute);
    if (preparedRoute) {
      await setStickyModelPoolChannel(callerIdentity, model, balancedRoute.channelId);
      return preparedRoute;
    }

    await balancedRoute.release?.();
    skippedChannelIds.add(balancedRoute.channelId);
    await clearStickyModelPoolChannel(callerIdentity, model, balancedRoute.channelId);
  }

  return null;
}

async function getRouteCandidates(
  model: string,
  channels: Array<{
    id: string;
    upstreamProvider: string;
    lastFirstTokenLatencyMs: number | null;
    lastLatencyMs: number | null;
    priority: number;
  }>,
) {
  const routes = await Promise.all(
    channels.map(async (channel) => {
      const route = await getRouteForChannel(model, channel);

      if (!route) {
        return null;
      }

      return {
        ...route,
        speedScoreMs: getSpeedScoreMs({
          firstTokenLatencyMs: channel.lastFirstTokenLatencyMs,
          latencyMs: channel.lastLatencyMs,
          priority: channel.priority,
        }),
      };
    }),
  );

  return routes
    .filter((route): route is NonNullable<(typeof routes)[number]> => Boolean(route))
    .sort((a, b) => a.speedScoreMs - b.speedScoreMs);
}

async function getBalancedRoute(
  routes: Array<{
    provider: Provider;
    price: NonNullable<Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>>;
    channelId: string;
    speedScoreMs: number;
  }>,
) {
  if (routes.length === 0) {
    return null;
  }

  const fastestScoreMs = routes[0]?.speedScoreMs ?? 0;
  const speedWindowMs = getSpeedWindowMs(fastestScoreMs);
  const eligibleRoutes = routes.filter(
    (route) => route.speedScoreMs <= fastestScoreMs + speedWindowMs,
  );
  const reservation = await reserveBalancedModelPoolChannel(
    eligibleRoutes.map((route) => ({
      channelId: route.channelId,
      speedScoreMs: route.speedScoreMs,
    })),
    getInflightPenaltyMs(fastestScoreMs),
  );

  if (reservation) {
    const route = eligibleRoutes.find((candidate) => candidate.channelId === reservation.channelId);
    if (route) {
      return {
        provider: route.provider,
        price: route.price,
        channelId: route.channelId,
        release: reservation.release,
      };
    }

    await reservation.release();
  }

  const fallbackRoute = routes[0];
  if (!fallbackRoute) {
    return null;
  }

  return {
    provider: fallbackRoute.provider,
    price: fallbackRoute.price,
    channelId: fallbackRoute.channelId,
  };
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
    const [activeKeyCount, keyCount] = await Promise.all([
      prisma.upstreamProviderKey.count({
        where: {
          upstreamProviderId: provider.id,
          status: "ACTIVE",
        },
      }),
      prisma.upstreamProviderKey.count({
        where: {
          upstreamProviderId: provider.id,
        },
      }),
    ]);

    if (activeKeyCount === 0 && (keyCount > 0 || !provider.apiKey.trim())) {
      return null;
    }

    return { provider, price, channelId: channel.id };
  }

  return null;
}

async function getRouteForChannelWithKey(
  model: string,
  channel: {
    id: string;
    upstreamProvider: string;
  },
) {
  const route = await getRouteForChannel(model, channel);

  if (!route) {
    return null;
  }

  const preparedRoute = await prepareRoute(route);
  if (!preparedRoute) {
    return null;
  }

  return preparedRoute;
}

async function prepareRoute(route: {
  provider: Provider;
  price: NonNullable<Awaited<ReturnType<typeof prisma.modelPrice.findUnique>>>;
  channelId: string;
  release?: ReleaseModelPoolReservation;
}) {
  const keyReservation = await reserveKeyForProvider(route.provider);

  if (!keyReservation) {
    return null;
  }

  return {
    provider: {
      ...route.provider,
      apiKey: keyReservation.key.key,
      upstreamProviderKeyId: keyReservation.key.id,
      upstreamProviderKeyName: keyReservation.key.name,
      upstreamProviderKeyPrefix: keyReservation.key.keyPrefix,
    },
    price: route.price,
    channelId: route.channelId,
    release: composeReleases(route.release, keyReservation.release),
  };
}

async function reserveKeyForProvider(provider: Provider): Promise<UpstreamKeyReservation | null> {
  if (provider.id === "env") {
    return {
      key: {
        id: "env",
        upstreamProviderId: "env",
        name: "环境变量 Key",
        key: provider.apiKey,
        keyPrefix: provider.apiKey.slice(0, Math.min(12, provider.apiKey.length)),
        status: "ACTIVE",
        priority: provider.priority,
        lastUsedAt: null,
        lastCheckStatus: null,
        lastCheckedAt: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      release: async () => {},
    };
  }

  return reserveProviderKey(provider);
}

function composeReleases(
  first: ReleaseModelPoolReservation | undefined,
  second: ReleaseModelPoolReservation,
): ReleaseModelPoolReservation {
  return async () => {
    await Promise.allSettled([first?.(), second()]);
  };
}

export function buildUpstreamUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedBase.endsWith("/v1") && normalizedPath.startsWith("/v1/")) {
    return `${normalizedBase}${normalizedPath.slice(3)}`;
  }

  return `${normalizedBase}${normalizedPath}`;
}
