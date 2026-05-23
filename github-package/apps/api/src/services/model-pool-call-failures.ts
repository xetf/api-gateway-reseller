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
  logger?: Logger;
}) {
  const { userId, apiKeyId, callerIdentity, model, channelId, failed, logger } = params;

  if (!channelId) {
    return;
  }

  const key = failureKey(callerIdentity, model, channelId);

  try {
    if (!failed) {
      await redis.del(key);
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
