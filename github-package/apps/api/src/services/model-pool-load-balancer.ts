import { redis } from "../lib/redis.js";

export type LoadBalanceCandidate = {
  channelId: string;
  speedScoreMs: number;
  stickyOccupancy?: number;
};

const inflightTtlSeconds = 180;
const refreshInflightTtlMs = 30_000;
const recentPickTtlSeconds = 60;

function inflightKey(channelId: string) {
  return `modelpool:balance:inflight:${channelId}`;
}

function recentPickKey(channelId: string) {
  return `modelpool:balance:recent:${channelId}`;
}

export function getSpeedScoreMs(params: {
  firstTokenLatencyMs?: number | null;
  latencyMs?: number | null;
  priority: number;
}) {
  return params.firstTokenLatencyMs ?? params.latencyMs ?? params.priority;
}

export function getSpeedWindowMs(fastestScoreMs: number) {
  return Math.max(500, fastestScoreMs * 0.35);
}

export function getInflightPenaltyMs(fastestScoreMs: number) {
  return Math.max(300, fastestScoreMs * 0.2);
}

export function getRecentPickPenaltyMs(fastestScoreMs: number) {
  return Math.max(400, fastestScoreMs * 0.2);
}

export function getStickyOccupancyPenaltyMs(fastestScoreMs: number) {
  return Math.max(800, fastestScoreMs * 0.35);
}

export async function reserveBalancedModelPoolChannel(
  candidates: LoadBalanceCandidate[],
  penaltyMs: number,
) {
  if (candidates.length === 0) {
    return null;
  }

  try {
    const selectedChannelId = await reserveChannelAtomically(candidates, penaltyMs);
    if (!selectedChannelId) {
      return null;
    }

    return createReservation(selectedChannelId);
  } catch {
    return null;
  }
}

async function reserveChannelAtomically(
  candidates: LoadBalanceCandidate[],
  penaltyMs: number,
) {
  const keys = candidates.flatMap((candidate) => [
    inflightKey(candidate.channelId),
    recentPickKey(candidate.channelId),
  ]);
  const recentPickPenaltyMs = getRecentPickPenaltyMs(
    Math.min(...candidates.map((candidate) => candidate.speedScoreMs)),
  );
  const stickyOccupancyPenaltyMs = getStickyOccupancyPenaltyMs(
    Math.min(...candidates.map((candidate) => candidate.speedScoreMs)),
  );
  const args = [
    String(inflightTtlSeconds),
    String(penaltyMs),
    String(recentPickTtlSeconds),
    String(recentPickPenaltyMs),
    String(stickyOccupancyPenaltyMs),
    ...candidates.flatMap((candidate) => [
      candidate.channelId,
      String(candidate.speedScoreMs),
      String(candidate.stickyOccupancy ?? 0),
    ]),
  ];

  const result = await redis.eval(
    `
	local ttl = tonumber(ARGV[1])
	local penalty = tonumber(ARGV[2])
	local recentTtl = tonumber(ARGV[3])
	local recentPenalty = tonumber(ARGV[4])
	local stickyPenalty = tonumber(ARGV[5])
	local bestIndex = 1
	local bestScore = nil
	local argIndex = 6

	for index = 1, (#KEYS / 2) do
	  local speed = tonumber(ARGV[argIndex + 1])
	  local sticky = tonumber(ARGV[argIndex + 2] or "0")
	  local inflightKeyIndex = ((index - 1) * 2) + 1
	  local recentKeyIndex = inflightKeyIndex + 1
	  local inflight = tonumber(redis.call("GET", KEYS[inflightKeyIndex]) or "0")
	  local recent = tonumber(redis.call("GET", KEYS[recentKeyIndex]) or "0")
	  local score = speed + (inflight * penalty) + (recent * recentPenalty) + (sticky * stickyPenalty)

	  if bestScore == nil or score < bestScore then
	    bestScore = score
	    bestIndex = index
	  end

	  argIndex = argIndex + 3
	end

	local selectedInflightKeyIndex = ((bestIndex - 1) * 2) + 1
	local selectedRecentKeyIndex = selectedInflightKeyIndex + 1
	redis.call("INCR", KEYS[selectedInflightKeyIndex])
	redis.call("EXPIRE", KEYS[selectedInflightKeyIndex], ttl)
	redis.call("INCR", KEYS[selectedRecentKeyIndex])
	redis.call("EXPIRE", KEYS[selectedRecentKeyIndex], recentTtl)
	return ARGV[6 + ((bestIndex - 1) * 3)]
	`,
    keys.length,
    ...keys,
    ...args,
  );

  return typeof result === "string" ? result : null;
}

function createReservation(channelId: string) {
  const key = inflightKey(channelId);
  let released = false;
  const refreshTtl = setInterval(() => {
    void redis.expire(key, inflightTtlSeconds).catch(() => undefined);
  }, refreshInflightTtlMs);

  return {
    channelId,
    release: async () => {
      if (released) {
        return;
      }

      released = true;
      clearInterval(refreshTtl);

      try {
        const current = await redis.decr(key);
        if (current <= 0) {
          await redis.del(key);
        } else {
          await redis.expire(key, inflightTtlSeconds);
        }
      } catch {
        // Best-effort cleanup. TTL keeps stale counters from living forever.
      }
    },
  };
}
