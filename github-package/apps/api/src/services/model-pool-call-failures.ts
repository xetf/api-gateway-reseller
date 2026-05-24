import { prisma } from "@gateway/db";
import { redis } from "../lib/redis.js";
import {
  getModelPoolPenaltySeconds,
  schedulePenalizedChannelRecovery,
} from "./model-pool-health.js";
import { clearStickyModelPoolChannel } from "./model-pool-stickiness.js";

type Logger = {
  warn: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
};

const consecutiveFailureThreshold = 2;
const failureCounterTtlSeconds = 600;
const liveMetricSmoothingFactor = 0.25;

function failureKey(callerIdentity: string, model: string, channelId: string) {
  return `modelpool:caller-channel-failure:${callerIdentity}:${model}:${channelId}`;
}

export async function recordModelPoolUserCallResult(params: {
  userId: string;
  apiKeyId: string;
  callerIdentity: string;
  model: string;
  channelId?: string;
  failed?: boolean;
  retryableFailure?: boolean;
  firstTokenLatencyMs?: number | null;
  latencyMs?: number | null;
  logger?: Logger;
}) {
  const { userId, apiKeyId, callerIdentity, model, channelId, failed, retryableFailure, firstTokenLatencyMs, latencyMs, logger } = params;

  if (!channelId) {
    return;
  }

  const key = failureKey(callerIdentity, model, channelId);

  try {
    if (!failed) {
      await redis.del(key);
      await updateChannelLiveMetrics(channelId, latencyMs, firstTokenLatencyMs, logger);
      return;
    }

    if (failed && retryableFailure === false) {
      return;
    }

    if (!retryableFailure) {
      return;
    }

    const failures = await redis.incr(key);
    await redis.expire(key, failureCounterTtlSeconds);

    if (failures < consecutiveFailureThreshold) {
      return;
    }

    await redis.del(key);
    await penalizeChannel({ userId, apiKeyId, callerIdentity, model, channelId, logger });
  } catch (error) {
    logger?.warn(
      { error, userId, apiKeyId, callerIdentity, model, channelId },
      "Failed to record model pool caller channel failure",
    );
  }
}

async function penalizeChannel(params: {
  userId: string;
  apiKeyId: string;
  callerIdentity: string;
  model: string;
  channelId: string;
  logger?: Logger;
}) {
  const { userId, apiKeyId, callerIdentity, model, channelId, logger } = params;
  const penaltySeconds = await getModelPoolPenaltySeconds();
  const penalizedUntil = new Date(Date.now() + penaltySeconds * 1000);
  const penaltyReason = `Caller ${callerIdentity} failed this channel ${consecutiveFailureThreshold} times`;

  const channel = await prisma.modelPoolChannel.update({
    where: { id: channelId },
    data: {
      status: "PENALIZED",
      penalizedUntil,
      penaltyReason,
      recoverySuccesses: 0,
      consecutiveFailures: { increment: 1 },
      lastCheckStatus: "FAILED",
      lastError: penaltyReason.slice(0, 1000),
    },
  }).catch(() => null);

  await clearStickyModelPoolChannel(callerIdentity, model, channelId);

  if (!channel) {
    logger?.warn(
      { userId, apiKeyId, callerIdentity, model, channelId },
      "Penalized model pool channel could not be found",
    );
    return;
  }

  logger?.info?.(
    {
      userId,
      apiKeyId,
      callerIdentity,
      model,
      channelId,
      penalizedUntil: penalizedUntil.toISOString(),
      penaltySeconds,
    },
    "Model pool channel entered penalty period after caller failures",
  );

  schedulePenalizedChannelRecovery(channelId, penalizedUntil, logger);
}

async function updateChannelLiveMetrics(
  channelId: string,
  latencyMs?: number | null,
  firstTokenLatencyMs?: number | null,
  logger?: Logger,
) {
  const observedLatencyMs = latencyMs === undefined ? null : latencyMs;
  const observedFirstTokenLatencyMs = firstTokenLatencyMs === undefined ? null : firstTokenLatencyMs;
  const scoreSourceMs = observedFirstTokenLatencyMs ?? observedLatencyMs;

  if (!scoreSourceMs || scoreSourceMs <= 0) {
    return;
  }

  try {
    const channel = await prisma.modelPoolChannel.findUnique({
      where: { id: channelId },
      select: {
        priority: true,
        lastLatencyMs: true,
        lastFirstTokenLatencyMs: true,
      },
    });

    if (!channel) {
      return;
    }

    const nextFirstTokenLatencyMs = smoothMetric(channel.lastFirstTokenLatencyMs, observedFirstTokenLatencyMs);
    const nextLatencyMs = smoothMetric(channel.lastLatencyMs, observedLatencyMs);
    const nextPriority = Math.max(1, smoothMetric(channel.priority, scoreSourceMs) ?? scoreSourceMs);

    await prisma.modelPoolChannel.update({
      where: { id: channelId },
      data: {
        priority: nextPriority,
        lastLatencyMs: nextLatencyMs,
        lastFirstTokenLatencyMs: nextFirstTokenLatencyMs,
      },
    });
  } catch (error) {
    logger?.warn({ error, channelId }, "Failed to update model pool channel live metrics");
  }
}

function smoothMetric(current: number | null, observed: number | null) {
  if (observed === null || observed <= 0) {
    return current;
  }

  if (current === null || current <= 0) {
    return Math.round(observed);
  }

  return Math.round((current * (1 - liveMetricSmoothingFactor)) + (observed * liveMetricSmoothingFactor));
}
