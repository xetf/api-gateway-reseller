import { prisma } from "@gateway/db";

export type PendingAutoTerminateSettings = {
  enabled: boolean;
  timeoutSeconds: number;
};

export const defaultPendingAutoTerminateSettings: PendingAutoTerminateSettings = {
  enabled: true,
  timeoutSeconds: 30,
};

export const minPendingAutoTerminateSeconds = 5;
export const maxPendingAutoTerminateSeconds = 3600;

const pendingAutoTerminateSettingsKey = "pending_auto_terminate_settings";
const settingsCacheTtlMs = 5_000;
let cachedSettings = defaultPendingAutoTerminateSettings;
let cachedSettingsLoadedAtMs = 0;

export async function readPendingAutoTerminateSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedSettingsLoadedAtMs < settingsCacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: pendingAutoTerminateSettingsKey },
  });

  cachedSettings = normalizePendingAutoTerminateSettings(parseStoredSettings(setting?.value));
  cachedSettingsLoadedAtMs = nowMs;

  return cachedSettings;
}

export async function savePendingAutoTerminateSettings(input: Partial<PendingAutoTerminateSettings>) {
  const current = await readPendingAutoTerminateSettings();
  const settings = normalizePendingAutoTerminateSettings({
    ...current,
    ...input,
  });

  await prisma.systemSetting.upsert({
    where: { key: pendingAutoTerminateSettingsKey },
    update: { value: JSON.stringify(settings) },
    create: { key: pendingAutoTerminateSettingsKey, value: JSON.stringify(settings) },
  });

  cachedSettings = settings;
  cachedSettingsLoadedAtMs = Date.now();

  return settings;
}

function parseStoredSettings(value: string | undefined) {
  if (!value) {
    return defaultPendingAutoTerminateSettings;
  }

  try {
    return JSON.parse(value) as Partial<PendingAutoTerminateSettings>;
  } catch {
    return defaultPendingAutoTerminateSettings;
  }
}

function normalizePendingAutoTerminateSettings(input: Partial<PendingAutoTerminateSettings>) {
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : defaultPendingAutoTerminateSettings.enabled,
    timeoutSeconds: normalizePendingAutoTerminateSeconds(input.timeoutSeconds),
  };
}

export function normalizePendingAutoTerminateSeconds(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return defaultPendingAutoTerminateSettings.timeoutSeconds;
  }

  return Math.min(
    maxPendingAutoTerminateSeconds,
    Math.max(minPendingAutoTerminateSeconds, Math.round(numeric)),
  );
}
