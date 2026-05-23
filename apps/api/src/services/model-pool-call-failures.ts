import { redis } from "../lib/redis.js";
import { checkModelPoolChannel } from "./model-pool-health.js";

type Logger = {
  warn: (value: Record<string, unknown>, message?: string) => void;
  info?: (value: Record<string, unknown>, message?: string) => void;
};

const consecutiveFailureThreshold = 2;
const failureCounterTtlSeconds = 600;

function failureKey(apiKeyId: string, model: string, channelId: string) {
  return `modelpool:api-key-call-failure:${apiKeyId}:${model}:${channelId}`;
}

export async function recordModelPoolUserCallResult(params: {
  userId: string;
  apiKeyId: string;
  model: string;
  channelId?: string;
  failed?: boolean;
  logger?: Logger;
}) {
  const { userId, apiKeyId, model, channelId, failed, logger } = params;

  if (!channelId) {
    return;
  }

  const key = failureKey(apiKeyId, model, channelId);

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
    triggerImmediateHealthCheck({ userId, apiKeyId, model, channelId, logger });
  } catch (error) {
    logger?.warn(
      { error, userId, apiKeyId, model, channelId },
      "Failed to record model pool API key call failure",
    );
  }
}

function triggerImmediateHealthCheck(params: {
  userId: string;
  apiKeyId: string;
  model: string;
  channelId: string;
  logger?: Logger;
}) {
  const { userId, apiKeyId, model, channelId, logger } = params;

  void checkModelPoolChannel(channelId, { unavailableOnFailure: true })
    .then((channel) => {
      if (!channel) {
        logger?.warn(
          { userId, apiKeyId, model, channelId },
          "Triggered model pool health check could not find channel",
        );
        return;
      }

      logger?.info?.(
        {
          userId,
          apiKeyId,
          model,
          channelId,
          status: channel.status,
          lastCheckStatus: channel.lastCheckStatus,
          lastError: channel.lastError,
        },
        "Triggered model pool health check after user call failures",
      );
    })
    .catch((error) => {
      logger?.warn(
        { error, userId, apiKeyId, model, channelId },
        "Triggered model pool health check failed",
      );
    });
}
