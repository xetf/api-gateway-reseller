import { redis } from "../lib/redis.js";

export type LoadBalanceCandidate = {
  channelId: string;
  speedScoreMs: number;
  stickyOccupancy?: number;
};

const inflightTtlSeconds = 180;
const refreshInflightTtlMs = 30_000;

function inflightKey(channelId: string) {
  return `modelpool:balance:inflight:${channelId}`;
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

export async function reserveBalancedModelPoolChannel(
  candidates: LoadBalanceCandidate[],
) {
  if (candidates.length === 0) {
    return null;
  }

  try {
    const selectedChannelId = await reserveChannelAtomically(candidates);
    if (!selectedChannelId) {
      return null;
    }

    return createReservation(selectedChannelId);
  } catch {
    return null;
  }
}

async function reserveChannelAtomically(candidates: LoadBalanceCandidate[]) {
  const keys = candidates.map((candidate) => inflightKey(candidate.channelId));
  const args = [
    String(inflightTtlSeconds),
    ...candidates.flatMap((candidate) => [
      candidate.channelId,
      String(candidate.speedScoreMs),
    ]),
  ];

  const result = await redis.eval(
    `
	local ttl = tonumber(ARGV[1])
	local bestIndex = 1
	local bestScore = nil
	local bestInflight = nil
	local argIndex = 2

	for index = 1, #KEYS do
	  local score = tonumber(ARGV[argIndex + 1])
	  local inflight = tonumber(redis.call("GET", KEYS[index]) or "0")

	  if bestScore == nil or score < bestScore or (score == bestScore and inflight < bestInflight) then
	    bestScore = score
	    bestInflight = inflight
	    bestIndex = index
	  end

	  argIndex = argIndex + 2
	end

	redis.call("INCR", KEYS[bestIndex])
	redis.call("EXPIRE", KEYS[bestIndex], ttl)
	return ARGV[2 + ((bestIndex - 1) * 2)]
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
