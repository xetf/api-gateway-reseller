import type { Redis } from "ioredis";
import { prisma } from "@gateway/db";
import { normalizeIpAddress } from "./ip-ban-rules.js";

const defaultConsecutiveAutoTerminateThreshold = 2;
const defaultConsecutiveAutoTerminateWindowSeconds = 10 * 60;
const defaultTemporaryBanSeconds = 60;
const defaultTemporaryBanMessage = "您的网络较差，请一分钟后再试";
export const minTemporaryIpNoticeBanSeconds = 10;
export const maxTemporaryIpNoticeBanSeconds = 3600;
export const minTemporaryIpNoticeBanThreshold = 2;
export const maxTemporaryIpNoticeBanThreshold = 20;
export const minTemporaryIpNoticeBanWindowSeconds = 60;
export const maxTemporaryIpNoticeBanWindowSeconds = 86400;
const temporaryIpNoticeBanSettingsKey = "temporary_ip_notice_ban_settings";
const settingsCacheTtlMs = 5_000;
let cachedSettings = {
  enabled: true,
  threshold: defaultConsecutiveAutoTerminateThreshold,
  windowSeconds: defaultConsecutiveAutoTerminateWindowSeconds,
  banSeconds: defaultTemporaryBanSeconds,
  message: defaultTemporaryBanMessage,
};
let cachedSettingsLoadedAtMs = 0;

export type TemporaryIpNoticeBan = {
  ip: string;
  message: string;
  ttlSeconds: number;
};

export type TemporaryIpNoticeBanSettings = {
  enabled: boolean;
  threshold: number;
  windowSeconds: number;
  banSeconds: number;
  message: string;
};

export async function findTemporaryIpNoticeBan(
  redis: Redis,
  ip: string | null | undefined,
): Promise<TemporaryIpNoticeBan | null> {
  const normalizedIp = normalizeIpAddress(ip);
  if (!normalizedIp) {
    return null;
  }

  const key = temporaryIpNoticeBanKey(normalizedIp);
  const ttlSeconds = await redis.ttl(key);
  if (ttlSeconds <= 0) {
    return null;
  }

  const settings = await readTemporaryIpNoticeBanSettings();
  return {
    ip: normalizedIp,
    message: settings.message,
    ttlSeconds,
  };
}

export async function recordAutoTerminatedIp(redis: Redis, ip: string | null | undefined) {
  const normalizedIp = normalizeIpAddress(ip);
  if (!normalizedIp) {
    return { banned: false as const, count: 0 };
  }

  const settings = await readTemporaryIpNoticeBanSettings();
  if (!settings.enabled) {
    return { banned: false as const, count: 0 };
  }

  const countKey = temporaryIpNoticeBanCountKey(normalizedIp);
  const banKey = temporaryIpNoticeBanKey(normalizedIp);
  const count = await redis.incr(countKey);
  if (count === 1) {
    await redis.expire(countKey, settings.windowSeconds);
  }

  if (count >= settings.threshold) {
    await redis.set(banKey, "1", "EX", settings.banSeconds);
    await redis.del(countKey);
    return { banned: true as const, count };
  }

  return { banned: false as const, count };
}

export async function listTemporaryIpNoticeBans(redis: Redis) {
  const bans: TemporaryIpNoticeBan[] = [];
  const settings = await readTemporaryIpNoticeBanSettings();
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      `${temporaryIpNoticeBanKey("*")}`,
      "COUNT",
      100,
    );
    cursor = nextCursor;

    for (const key of keys) {
      const ttlSeconds = await redis.ttl(key);
      if (ttlSeconds <= 0) {
        continue;
      }

      const ip = key.slice(temporaryIpNoticeBanKey("").length);
      bans.push({
        ip,
        message: settings.message,
        ttlSeconds,
      });
    }
  } while (cursor !== "0");

  return bans.sort((left, right) => right.ttlSeconds - left.ttlSeconds);
}

export async function deleteTemporaryIpNoticeBan(redis: Redis, ip: string) {
  const normalizedIp = normalizeIpAddress(ip);
  if (!normalizedIp) {
    throw Object.assign(new Error("Invalid IP address"), { statusCode: 400 });
  }

  await Promise.all([
    redis.del(temporaryIpNoticeBanKey(normalizedIp)),
    redis.del(temporaryIpNoticeBanCountKey(normalizedIp)),
  ]);
  return { ip: normalizedIp, deleted: true };
}

export async function readTemporaryIpNoticeBanSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedSettingsLoadedAtMs < settingsCacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: temporaryIpNoticeBanSettingsKey },
  });
  cachedSettings = normalizeTemporaryIpNoticeBanSettings(
    parseStoredSettings(setting?.value),
  );
  cachedSettingsLoadedAtMs = nowMs;
  return cachedSettings;
}

export async function saveTemporaryIpNoticeBanSettings(
  input: Partial<TemporaryIpNoticeBanSettings>,
) {
  const settings = normalizeTemporaryIpNoticeBanSettings(input);
  await prisma.systemSetting.upsert({
    where: { key: temporaryIpNoticeBanSettingsKey },
    update: { value: JSON.stringify(settings) },
    create: {
      key: temporaryIpNoticeBanSettingsKey,
      value: JSON.stringify(settings),
    },
  });
  cachedSettings = settings;
  cachedSettingsLoadedAtMs = Date.now();
  return settings;
}

function parseStoredSettings(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Partial<TemporaryIpNoticeBanSettings>;
  } catch {
    return {};
  }
}

function normalizeTemporaryIpNoticeBanSettings(
  input: Partial<TemporaryIpNoticeBanSettings>,
) {
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : true,
    threshold: normalizeTemporaryIpNoticeBanThreshold(input.threshold),
    windowSeconds: normalizeTemporaryIpNoticeBanWindowSeconds(input.windowSeconds),
    banSeconds: normalizeTemporaryIpNoticeBanSeconds(input.banSeconds),
    message: normalizeTemporaryIpNoticeBanMessage(input.message),
  };
}

export function normalizeTemporaryIpNoticeBanSeconds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return defaultTemporaryBanSeconds;
  }

  return Math.min(
    maxTemporaryIpNoticeBanSeconds,
    Math.max(minTemporaryIpNoticeBanSeconds, Math.round(numeric)),
  );
}

function normalizeTemporaryIpNoticeBanMessage(value: unknown) {
  const text = String(value ?? "").trim();
  return text || defaultTemporaryBanMessage;
}

function normalizeTemporaryIpNoticeBanThreshold(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return defaultConsecutiveAutoTerminateThreshold;
  }

  return Math.min(
    maxTemporaryIpNoticeBanThreshold,
    Math.max(minTemporaryIpNoticeBanThreshold, Math.round(numeric)),
  );
}

function normalizeTemporaryIpNoticeBanWindowSeconds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return defaultConsecutiveAutoTerminateWindowSeconds;
  }

  return Math.min(
    maxTemporaryIpNoticeBanWindowSeconds,
    Math.max(minTemporaryIpNoticeBanWindowSeconds, Math.round(numeric)),
  );
}

function temporaryIpNoticeBanKey(ip: string) {
  return `temporary-ip-notice-ban:${ip}`;
}

function temporaryIpNoticeBanCountKey(ip: string) {
  return `temporary-ip-auto-terminate-count:${ip}`;
}
