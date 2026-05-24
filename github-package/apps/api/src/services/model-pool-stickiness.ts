import { redis } from "../lib/redis.js";

export const modelPoolStickinessTtlSeconds = 120;
const slowFirstTokenThresholdMs = 10_000;
const slowTotalLatencyThresholdMs = 15_000;
const maxConsecutiveSlowCalls = 3;
const stickyOccupancyTtlSeconds = modelPoolStickinessTtlSeconds + 30;

export type StickyModelPoolRoute = {
  channelId: string;
  upstreamProviderKeyId?: string | null;
};

function stickyKey(callerIdentity: string, model: string) {
  return `modelpool:sticky:${callerIdentity}:${model}`;
}

export function stickyProviderKeyOccupancyKey(upstreamProviderKeyId: string) {
  return `modelpool:sticky-key-callers:${upstreamProviderKeyId}`;
}

function stickyOccupancyMember(callerIdentity: string, model: string) {
  return JSON.stringify([callerIdentity, model]);
}

function slowKey(
  callerIdentity: string,
  model: string,
  channelId: string,
  upstreamProviderKeyId?: string | null,
) {
  return `modelpool:sticky-slow:${callerIdentity}:${model}:${channelId}:${upstreamProviderKeyId ?? "provider"}`;
}

export async function getStickyModelPoolRoute(callerIdentity: string, model: string) {
  try {
    return parseStickyRoute(await redis.get(stickyKey(callerIdentity, model)));
  } catch {
    return null;
  }
}

export async function getStickyModelPoolChannel(callerIdentity: string, model: string) {
  const route = await getStickyModelPoolRoute(callerIdentity, model);
  return route?.channelId ?? null;
}

export async function setStickyModelPoolChannel(
  callerIdentity: string,
  model: string,
  channelId: string,
  upstreamProviderKeyId?: string | null,
) {
  try {
    const key = stickyKey(callerIdentity, model);
    const previousRoute = parseStickyRoute(await redis.get(key));
    const member = stickyOccupancyMember(callerIdentity, model);
    const expiresAtMs = Date.now() + modelPoolStickinessTtlSeconds * 1000;
    const operations = redis.multi();

    operations.set(
      key,
      JSON.stringify({
        version: 2,
        channelId,
        upstreamProviderKeyId: upstreamProviderKeyId ?? null,
      }),
      "EX",
      modelPoolStickinessTtlSeconds,
    );

    if (
      previousRoute?.upstreamProviderKeyId &&
      previousRoute.upstreamProviderKeyId !== upstreamProviderKeyId
    ) {
      operations.zrem(
        stickyProviderKeyOccupancyKey(previousRoute.upstreamProviderKeyId),
        member,
      );
    }

    if (upstreamProviderKeyId) {
      const occupancyKey = stickyProviderKeyOccupancyKey(upstreamProviderKeyId);
      operations.zadd(occupancyKey, expiresAtMs, member);
      operations.expire(occupancyKey, stickyOccupancyTtlSeconds);
    }

    await operations.exec();
  } catch {
    // Redis stickiness is best-effort; ranking fallback still works without it.
  }
}

export async function getStickyProviderKeyOccupancies(upstreamProviderKeyIds: string[]) {
  const uniqueIds = [...new Set(upstreamProviderKeyIds)];
  const entries = await Promise.all(
    uniqueIds.map(async (keyId) => {
      try {
        const occupancyKey = stickyProviderKeyOccupancyKey(keyId);
        await redis.zremrangebyscore(occupancyKey, "-inf", Date.now());
        return [keyId, await redis.zcard(occupancyKey)] as const;
      } catch {
        return [keyId, 0] as const;
      }
    }),
  );

  return new Map(entries);
}

export async function clearStickyModelPoolChannel(
  callerIdentity: string,
  model: string,
  channelId?: string,
  upstreamProviderKeyId?: string | null,
) {
  try {
    const key = stickyKey(callerIdentity, model);
    const currentRoute = parseStickyRoute(await redis.get(key));
    const shouldClearSticky = !channelId || currentRoute?.channelId === channelId;
    if (shouldClearSticky) {
      const operations = redis.multi();
      operations.del(key);
      if (currentRoute?.upstreamProviderKeyId) {
        operations.zrem(
          stickyProviderKeyOccupancyKey(currentRoute.upstreamProviderKeyId),
          stickyOccupancyMember(callerIdentity, model),
        );
      }
      await operations.exec();
    }
    if (channelId) {
      await redis.del(slowKey(callerIdentity, model, channelId, upstreamProviderKeyId));
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function parseStickyRoute(value: string | null): StickyModelPoolRoute | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<StickyModelPoolRoute> & {
      version?: number;
    };
    if (typeof parsed.channelId === "string" && parsed.channelId) {
      return {
        channelId: parsed.channelId,
        upstreamProviderKeyId:
          typeof parsed.upstreamProviderKeyId === "string"
            ? parsed.upstreamProviderKeyId
            : null,
      };
    }
  } catch {
    // Legacy sticky values were stored as a raw channel id.
  }

  return { channelId: value, upstreamProviderKeyId: null };
}

export function isStickyCallSlow(params: {
  failed?: boolean;
  firstTokenLatencyMs?: number | null;
  latencyMs?: number | null;
}) {
  if (params.failed) {
    return true;
  }

  if (params.firstTokenLatencyMs !== undefined && params.firstTokenLatencyMs !== null) {
    return params.firstTokenLatencyMs >= slowFirstTokenThresholdMs;
  }

  if (params.latencyMs !== undefined && params.latencyMs !== null) {
    return params.latencyMs >= slowTotalLatencyThresholdMs;
  }

  return false;
}

export async function recordStickyModelPoolResult(params: {
  callerIdentity: string;
  model: string;
  channelId?: string;
  upstreamProviderKeyId?: string | null;
  failed?: boolean;
  firstTokenLatencyMs?: number | null;
  latencyMs?: number | null;
}) {
  const { callerIdentity, model, channelId, upstreamProviderKeyId } = params;

  if (!channelId) {
    return;
  }

  const slow = isStickyCallSlow(params);

  try {
    const key = slowKey(callerIdentity, model, channelId, upstreamProviderKeyId);

    if (!slow) {
      await Promise.all([
        redis.del(key),
        setStickyModelPoolChannel(callerIdentity, model, channelId, upstreamProviderKeyId),
      ]);
      return;
    }

    const slowCount = await redis.incr(key);
    await redis.expire(key, modelPoolStickinessTtlSeconds);

    if (slowCount >= maxConsecutiveSlowCalls) {
      await clearStickyModelPoolChannel(callerIdentity, model, channelId, upstreamProviderKeyId);
      return;
    }

    await setStickyModelPoolChannel(callerIdentity, model, channelId, upstreamProviderKeyId);
  } catch {
    // Redis stickiness is best-effort; never fail user requests because of it.
  }
}
