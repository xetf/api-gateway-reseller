import { prisma, type UpstreamProvider, type UpstreamProviderKey } from "@gateway/db";
import { redis } from "../lib/redis.js";
import { getStickyProviderKeyOccupancies } from "./model-pool-stickiness.js";

const initialProviderKeyName = "key-1";

export type UpstreamKeyReservation = {
  key: Pick<
    UpstreamProviderKey,
    | "id"
    | "upstreamProviderId"
    | "name"
    | "key"
    | "keyPrefix"
    | "status"
    | "priority"
    | "lastUsedAt"
    | "lastCheckStatus"
    | "lastCheckedAt"
    | "lastError"
    | "createdAt"
    | "updatedAt"
  >;
  release: () => Promise<void>;
};

const keyInflightTtlSeconds = 180;
const refreshKeyInflightTtlMs = 30_000;

export function maskUpstreamKeySecret(secret: string) {
  if (!secret) {
    return "-";
  }

  const visibleStart = secret.slice(0, Math.min(7, secret.length));
  const visibleEnd = secret.length > 10 ? secret.slice(-4) : "";
  return `${visibleStart}${visibleEnd ? `...${visibleEnd}` : ""}`;
}

export function upstreamKeyPrefix(secret: string) {
  return secret.slice(0, Math.min(12, secret.length));
}

export function formatUpstreamKeyLabel(key: Pick<UpstreamProviderKey, "name" | "keyPrefix">) {
  const name = key.name === "默认 Key" ? initialProviderKeyName : key.name;
  return `${name} (${key.keyPrefix})`;
}

export function upstreamKeyInflightKey(keyId: string) {
  return `upstream-provider-key:inflight:${keyId}`;
}

export async function ensureDefaultProviderKey(
  provider: Pick<UpstreamProvider, "id" | "apiKey" | "status">,
) {
  if (!provider.apiKey.trim()) {
    return null;
  }

  const key = await prisma.upstreamProviderKey.findFirst({
    where: {
      upstreamProviderId: provider.id,
      key: provider.apiKey,
    },
  });

  if (key) {
    return key;
  }

  return prisma.upstreamProviderKey.upsert({
    where: {
      upstreamProviderId_name: {
        upstreamProviderId: provider.id,
        name: initialProviderKeyName,
      },
    },
    update: {
      key: provider.apiKey,
      keyPrefix: upstreamKeyPrefix(provider.apiKey),
      status: provider.status === "ACTIVE" ? "ACTIVE" : "DISABLED",
    },
    create: {
      upstreamProviderId: provider.id,
      name: initialProviderKeyName,
      key: provider.apiKey,
      keyPrefix: upstreamKeyPrefix(provider.apiKey),
      status: provider.status === "ACTIVE" ? "ACTIVE" : "DISABLED",
      priority: 100,
    },
  });
}

export async function getActiveProviderKeys(
  provider: Pick<UpstreamProvider, "id" | "apiKey" | "status">,
) {
  const keys = await prisma.upstreamProviderKey.findMany({
    where: {
      upstreamProviderId: provider.id,
      status: "ACTIVE",
    },
    orderBy: [
      { priority: "asc" },
      { lastUsedAt: "asc" },
      { createdAt: "asc" },
    ],
  });

  if (keys.length > 0 || provider.status !== "ACTIVE") {
    return keys;
  }

  const keyCount = await prisma.upstreamProviderKey.count({
    where: {
      upstreamProviderId: provider.id,
    },
  });

  if (keyCount > 0) {
    return [];
  }

  const defaultKey = await ensureDefaultProviderKey(provider);
  return defaultKey?.status === "ACTIVE" ? [defaultKey] : [];
}

export async function reserveProviderKey(
  provider: Pick<UpstreamProvider, "id" | "apiKey" | "status">,
  preferredKeyId?: string | null,
): Promise<UpstreamKeyReservation | null> {
  const keys = await getActiveProviderKeys(provider);

  if (keys.length === 0) {
    return null;
  }

  if (preferredKeyId) {
    const preferredKey = keys.find((key) => key.id === preferredKeyId);
    if (preferredKey) {
      await prisma.upstreamProviderKey.update({
        where: { id: preferredKey.id },
        data: { lastUsedAt: new Date() },
      });
      return createKeyReservation(preferredKey);
    }
  }

  const stickyOccupancies = await getStickyProviderKeyOccupancies(keys.map((key) => key.id));

  try {
    const selectedKeyId = await reserveKeyAtomically(keys, stickyOccupancies);
    const selectedKey =
      keys.find((key) => key.id === selectedKeyId) ??
      chooseFallbackKey(keys, stickyOccupancies);

    if (!selectedKey) {
      return null;
    }

    await prisma.upstreamProviderKey.update({
      where: { id: selectedKey.id },
      data: { lastUsedAt: new Date() },
    });

    return createKeyReservation(selectedKey);
  } catch {
    const fallbackKey = chooseFallbackKey(keys, stickyOccupancies);
    if (!fallbackKey) {
      return null;
    }

    await prisma.upstreamProviderKey.update({
      where: { id: fallbackKey.id },
      data: { lastUsedAt: new Date() },
    });

    return {
      key: fallbackKey,
      release: async () => {},
    };
  }
}

async function reserveKeyAtomically(
  keys: UpstreamProviderKey[],
  stickyOccupancies: Map<string, number>,
) {
  const redisKeys = keys.map((key) => upstreamKeyInflightKey(key.id));
  const args = [
    String(keyInflightTtlSeconds),
    ...keys.flatMap((key) => [
      key.id,
      String(stickyOccupancies.get(key.id) ?? 0),
      String(key.priority),
      String(key.lastUsedAt?.getTime() ?? 0),
    ]),
  ];

  const result = await redis.eval(
    `
local ttl = tonumber(ARGV[1])
local bestIndex = 1
local bestSticky = nil
local bestInflight = nil
local bestPriority = nil
local bestLastUsed = nil
local argIndex = 2

for index = 1, #KEYS do
  local sticky = tonumber(ARGV[argIndex + 1])
  local priority = tonumber(ARGV[argIndex + 2])
  local lastUsed = tonumber(ARGV[argIndex + 3])
  local inflight = tonumber(redis.call("GET", KEYS[index]) or "0")

  if bestSticky == nil
    or sticky < bestSticky
    or (sticky == bestSticky and inflight < bestInflight)
    or (sticky == bestSticky and inflight == bestInflight and priority < bestPriority)
    or (sticky == bestSticky and inflight == bestInflight and priority == bestPriority and lastUsed < bestLastUsed)
  then
    bestSticky = sticky
    bestInflight = inflight
    bestPriority = priority
    bestLastUsed = lastUsed
    bestIndex = index
  end

  argIndex = argIndex + 4
end

redis.call("INCR", KEYS[bestIndex])
redis.call("EXPIRE", KEYS[bestIndex], ttl)
return ARGV[2 + ((bestIndex - 1) * 4)]
`,
    redisKeys.length,
    ...redisKeys,
    ...args,
  );

  return typeof result === "string" ? result : null;
}

function chooseFallbackKey(
  keys: UpstreamProviderKey[],
  stickyOccupancies: Map<string, number>,
) {
  return [...keys].sort((left, right) => {
    const stickyDelta =
      (stickyOccupancies.get(left.id) ?? 0) - (stickyOccupancies.get(right.id) ?? 0);
    if (stickyDelta !== 0) {
      return stickyDelta;
    }

    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return (left.lastUsedAt?.getTime() ?? 0) - (right.lastUsedAt?.getTime() ?? 0);
  })[0] ?? null;
}

function createKeyReservation(key: UpstreamProviderKey) {
  const redisKey = upstreamKeyInflightKey(key.id);
  let released = false;
  const refreshTtl = setInterval(() => {
    void redis.expire(redisKey, keyInflightTtlSeconds).catch(() => undefined);
  }, refreshKeyInflightTtlMs);

  return {
    key,
    release: async () => {
      if (released) {
        return;
      }

      released = true;
      clearInterval(refreshTtl);

      try {
        const current = await redis.decr(redisKey);
        if (current <= 0) {
          await redis.del(redisKey);
        } else {
          await redis.expire(redisKey, keyInflightTtlSeconds);
        }
      } catch {
        // TTL handles stale counters if Redis release fails.
      }
    },
  };
}
