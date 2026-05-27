import { prisma } from "@gateway/db";

export type CharityAnnouncementFrequency = "every_visit" | "interval";

export type CharityAnnouncementSettings = {
  serviceEnabled: boolean;
  serviceDisabledMessage: string;
  enabled: boolean;
  frequency: CharityAnnouncementFrequency;
  intervalHours: number;
  title: string;
  content: string;
};

export const minCharityAnnouncementIntervalHours = 1;
export const maxCharityAnnouncementIntervalHours = 24 * 30;

export const defaultCharityAnnouncementSettings: CharityAnnouncementSettings = {
  serviceEnabled: true,
  serviceDisabledMessage: "公益 API 当前暂不可用，请稍后再试。",
  enabled: false,
  frequency: "every_visit",
  intervalHours: 24,
  title: "公益 API 使用公告",
  content: "",
};

const settingKey = "charity_announcement_settings";

export async function readCharityAnnouncementSettings() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });

  return normalizeCharityAnnouncementSettings(parseStoredSettings(setting?.value));
}

export async function saveCharityAnnouncementSettings(
  input: Partial<CharityAnnouncementSettings>,
) {
  const current = await readCharityAnnouncementSettings();
  const settings = normalizeCharityAnnouncementSettings({
    ...current,
    ...input,
  });

  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(settings) },
    create: { key: settingKey, value: JSON.stringify(settings) },
  });

  return settings;
}

function parseStoredSettings(value: string | undefined) {
  if (!value) {
    return defaultCharityAnnouncementSettings;
  }

  try {
    return JSON.parse(value) as Partial<CharityAnnouncementSettings>;
  } catch {
    return defaultCharityAnnouncementSettings;
  }
}

function normalizeCharityAnnouncementSettings(
  input: Partial<CharityAnnouncementSettings>,
): CharityAnnouncementSettings {
  return {
    serviceEnabled:
      typeof input.serviceEnabled === "boolean"
        ? input.serviceEnabled
        : defaultCharityAnnouncementSettings.serviceEnabled,
    serviceDisabledMessage: String(
      input.serviceDisabledMessage ??
        defaultCharityAnnouncementSettings.serviceDisabledMessage,
    )
      .trim()
      .slice(0, 8000),
    enabled: typeof input.enabled === "boolean" ? input.enabled : defaultCharityAnnouncementSettings.enabled,
    frequency: input.frequency === "interval" ? "interval" : "every_visit",
    intervalHours: clampInteger(
      input.intervalHours,
      minCharityAnnouncementIntervalHours,
      maxCharityAnnouncementIntervalHours,
      defaultCharityAnnouncementSettings.intervalHours,
    ),
    title: String(input.title ?? defaultCharityAnnouncementSettings.title).trim().slice(0, 80),
    content: String(input.content ?? defaultCharityAnnouncementSettings.content).trim().slice(0, 2000),
  };
}

function clampInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}
