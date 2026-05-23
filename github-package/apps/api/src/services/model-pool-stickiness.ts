import { redis } from "../lib/redis.js";

export const modelPoolStickinessTtlSeconds = 180;
const slowFirstTokenThresholdMs = 10_000;
const slowTotalLatencyThresholdMs = 15_000;
const maxConsecutiveSlowCalls = 3;

function stickyKey(callerIdentity: string, model: string) {
  return `modelpool:sticky:${callerIdentity}:${model}`;
}

function slowKey(callerIdentity: string, model: string, channelId: string) {
  return `modelpool:sticky-slow:${callerIdentity}:${model}:${channelId}`;
}

export async function getStickyModelPoolChannel(callerIdentity: string, model: string) {
  try {
    return await redis.get(stickyKey(callerIdentity, model));
  } catch {
    return null;
  }
}

export async function setStickyModelPoolChannel(callerIdentity: string, model: string, channelId: string) {
  try {
    await redis.set(stickyKey(callerIdentity, model), channelId, "EX", modelPoolStickinessTtlSeconds);
  } catch {
    // Redis stickiness is best-effort; ranking fallback still works without it.
  }
}

export async function clearStickyModelPoolChannel(callerIdentity: string, model: string, channelId?: string) {
  try {
    const key = stickyKey(callerIdentity, model);
    const currentChannelId = await redis.get(key);
    if (!channelId || currentChannelId === channelId) {
      await redis.del(key);
    }
    if (channelId) {
      await redis.del(slowKey(callerIdentity, model, channelId));
    }
  } catch {
    // Best-effort cleanup only.
  }
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
  failed?: boolean;
  firstTokenLatencyMs?: number | null;
  latencyMs?: number | null;
}) {
  const { callerIdentity, model, channelId } = params;

  if (!channelId) {
    return;
  }

  const slow = isStickyCallSlow(params);

  try {
    const key = slowKey(callerIdentity, model, channelId);

    if (!slow) {
      await Promise.all([
        redis.del(key),
        setStickyModelPoolChannel(callerIdentity, model, channelId),
      ]);
      return;
    }

    const slowCount = await redis.incr(key);
    await redis.expire(key, modelPoolStickinessTtlSeconds);

    if (slowCount >= maxConsecutiveSlowCalls) {
      await clearStickyModelPoolChannel(callerIdentity, model, channelId);
      return;
    }

    await setStickyModelPoolChannel(callerIdentity, model, channelId);
  } catch {
    // Redis stickiness is best-effort; never fail user requests because of it.
  }
}
