import { prisma } from "@gateway/db";

export type GlobalCircuitBreakerSettings = {
  enabled: boolean;
  allowAdmins: boolean;
  allowedUserIds: string[];
  message: string;
};

export const defaultGlobalCircuitBreakerSettings: GlobalCircuitBreakerSettings = {
  enabled: false,
  allowAdmins: true,
  allowedUserIds: [],
  message: "网关维护中，暂时暂停普通调用，请稍后再试。",
};

const settingKey = "global_circuit_breaker_settings";
const cacheTtlMs = 5_000;
let cachedSettings = defaultGlobalCircuitBreakerSettings;
let cachedAtMs = 0;

export async function readGlobalCircuitBreakerSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeGlobalCircuitBreakerSettings(parseSettings(setting?.value));
  cachedAtMs = nowMs;
  return cachedSettings;
}

export async function saveGlobalCircuitBreakerSettings(
  input: Partial<GlobalCircuitBreakerSettings>,
) {
  const current = await readGlobalCircuitBreakerSettings();
  const settings = normalizeGlobalCircuitBreakerSettings({ ...current, ...input });
  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(settings) },
    create: { key: settingKey, value: JSON.stringify(settings) },
  });
  cachedSettings = settings;
  cachedAtMs = Date.now();
  return settings;
}

export function canBypassGlobalCircuitBreaker(
  settings: GlobalCircuitBreakerSettings,
  principal: {
    userId: string;
    userRole?: string | null;
  },
) {
  if (!settings.enabled) {
    return true;
  }

  return (
    settings.allowedUserIds.includes(principal.userId) ||
    (settings.allowAdmins && principal.userRole === "ADMIN")
  );
}

function parseSettings(value: string | null | undefined) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as Partial<GlobalCircuitBreakerSettings>;
  } catch {
    return {};
  }
}

function normalizeGlobalCircuitBreakerSettings(
  input: Partial<GlobalCircuitBreakerSettings>,
) {
  const message = String(input.message ?? "").trim();
  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : defaultGlobalCircuitBreakerSettings.enabled,
    allowAdmins:
      typeof input.allowAdmins === "boolean"
        ? input.allowAdmins
        : defaultGlobalCircuitBreakerSettings.allowAdmins,
    allowedUserIds: Array.isArray(input.allowedUserIds)
      ? Array.from(
          new Set(
            input.allowedUserIds
              .map((item) => String(item ?? "").trim())
              .filter(Boolean),
          ),
        ).slice(0, 500)
      : defaultGlobalCircuitBreakerSettings.allowedUserIds,
    message:
      (message || defaultGlobalCircuitBreakerSettings.message).slice(0, 1000),
  };
}
