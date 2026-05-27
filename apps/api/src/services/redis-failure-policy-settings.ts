import { prisma } from "@gateway/db";

export const redisFailurePolicyValues = [
  "fail-open",
  "fail-closed",
  "degraded",
] as const;

export type RedisFailurePolicy = (typeof redisFailurePolicyValues)[number];

export type RedisFailurePolicySettings = {
  policy: RedisFailurePolicy;
  degradedAdminBypassEnabled: boolean;
  degradedUserIds: string[];
  message: string;
};

export const defaultRedisFailurePolicySettings: RedisFailurePolicySettings = {
  policy: "fail-open",
  degradedAdminBypassEnabled: true,
  degradedUserIds: [],
  message: "网关风控组件暂不可用，请稍后重试。",
};

const settingKey = "redis_failure_policy_settings";
const cacheTtlMs = 5_000;
let cachedSettings = defaultRedisFailurePolicySettings;
let cachedAtMs = 0;

export async function readRedisFailurePolicySettings() {
  const nowMs = Date.now();
  if (nowMs - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeRedisFailurePolicySettings(parseSettings(setting?.value));
  cachedAtMs = nowMs;
  return cachedSettings;
}

export async function saveRedisFailurePolicySettings(
  input: Partial<RedisFailurePolicySettings>,
) {
  const current = await readRedisFailurePolicySettings();
  const settings = normalizeRedisFailurePolicySettings({ ...current, ...input });
  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(settings) },
    create: { key: settingKey, value: JSON.stringify(settings) },
  });
  cachedSettings = settings;
  cachedAtMs = Date.now();
  return settings;
}

export function shouldAllowWhenRedisFails(
  settings: RedisFailurePolicySettings,
  principal: {
    userId: string;
    userRole?: string | null;
  },
) {
  if (settings.policy === "fail-open") {
    return true;
  }

  if (settings.policy === "fail-closed") {
    return false;
  }

  return (
    settings.degradedUserIds.includes(principal.userId) ||
    (settings.degradedAdminBypassEnabled && principal.userRole === "ADMIN")
  );
}

function parseSettings(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Partial<RedisFailurePolicySettings>;
  } catch {
    return {};
  }
}

function normalizeRedisFailurePolicySettings(
  input: Partial<RedisFailurePolicySettings>,
) {
  const policy = redisFailurePolicyValues.includes(input.policy as RedisFailurePolicy)
    ? (input.policy as RedisFailurePolicy)
    : defaultRedisFailurePolicySettings.policy;
  const degradedUserIds = Array.isArray(input.degradedUserIds)
    ? Array.from(
        new Set(
          input.degradedUserIds
            .map((item) => String(item ?? "").trim())
            .filter(Boolean),
        ),
      ).slice(0, 500)
    : defaultRedisFailurePolicySettings.degradedUserIds;
  const message = String(input.message ?? "").trim();

  return {
    policy,
    degradedAdminBypassEnabled:
      typeof input.degradedAdminBypassEnabled === "boolean"
        ? input.degradedAdminBypassEnabled
        : defaultRedisFailurePolicySettings.degradedAdminBypassEnabled,
    degradedUserIds,
    message: (message || defaultRedisFailurePolicySettings.message).slice(0, 1000),
  };
}
