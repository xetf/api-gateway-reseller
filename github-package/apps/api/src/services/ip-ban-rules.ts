import { isIP } from "node:net";
import { prisma } from "@gateway/db";

export const ipBanRulesSettingKey = "ip_ban_rules";
export const ipBanNoticeUsageSource = "gateway_ip_ban_notice";
export const ipBanErrorUsageSource = "gateway_ip_ban_error";
export const defaultIpBanMessage = "当前 IP 已被网关封禁，请联系管理员。";

export const ipBanModes = ["error", "notice"] as const;
export type IpBanMode = (typeof ipBanModes)[number];

export type IpBanRule = {
  ip: string;
  mode: IpBanMode;
  message: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IpBanRuleInput = {
  ip: string;
  mode: IpBanMode;
  message?: string | null;
  reason?: string | null;
};

const cacheTtlMs = 5_000;
let cachedRules: IpBanRule[] = [];
let cachedRulesLoadedAtMs = 0;

export async function listIpBanRules() {
  return readIpBanRules();
}

export async function findIpBanRule(ip: string | null | undefined) {
  const normalizedIp = normalizeIpAddress(ip);
  if (!normalizedIp) {
    return null;
  }

  const rules = await readIpBanRules();
  return rules.find((rule) => rule.ip === normalizedIp) ?? null;
}

export async function saveIpBanRule(input: IpBanRuleInput) {
  const normalizedIp = normalizeIpAddress(input.ip);
  if (!normalizedIp) {
    throw Object.assign(new Error("Invalid IP address"), { statusCode: 400 });
  }

  const mode = normalizeIpBanMode(input.mode);
  const now = new Date().toISOString();
  const current = await readIpBanRules();
  const existing = current.find((rule) => rule.ip === normalizedIp);
  const nextRule: IpBanRule = {
    ip: normalizedIp,
    mode,
    message: normalizeIpBanMessage(input.message),
    reason: normalizeIpBanReason(input.reason),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const nextRules = current
    .filter((rule) => rule.ip !== normalizedIp)
    .concat(nextRule)
    .sort((left, right) => left.ip.localeCompare(right.ip));

  await writeIpBanRules(nextRules);
  return nextRule;
}

export async function deleteIpBanRule(ip: string) {
  const normalizedIp = normalizeIpAddress(ip);
  if (!normalizedIp) {
    throw Object.assign(new Error("Invalid IP address"), { statusCode: 400 });
  }

  const current = await readIpBanRules();
  const nextRules = current.filter((rule) => rule.ip !== normalizedIp);
  await writeIpBanRules(nextRules);
  return { ip: normalizedIp, deleted: nextRules.length !== current.length };
}

export function normalizeIpAddress(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text.includes("/")) {
    return null;
  }

  const ipVersion = isIP(text);
  if (ipVersion === 4) {
    return text;
  }

  if (ipVersion === 6) {
    return normalizeIpv6Address(text);
  }

  return null;
}

function normalizeIpv6Address(value: string) {
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    return hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1).toLowerCase()
      : hostname.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function normalizeIpBanMode(value: unknown): IpBanMode {
  return value === "notice" ? "notice" : "error";
}

function normalizeIpBanMessage(value: unknown) {
  const text = String(value ?? "").trim();
  return text || defaultIpBanMessage;
}

function normalizeIpBanReason(value: unknown) {
  const text = String(value ?? "").trim();
  return text || null;
}

async function readIpBanRules() {
  const nowMs = Date.now();
  if (nowMs - cachedRulesLoadedAtMs < cacheTtlMs) {
    return cachedRules;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: ipBanRulesSettingKey },
  });
  const rules = normalizeStoredRules(parseStoredRules(setting?.value));

  cachedRules = rules;
  cachedRulesLoadedAtMs = nowMs;

  return rules;
}

async function writeIpBanRules(rules: IpBanRule[]) {
  await prisma.systemSetting.upsert({
    where: { key: ipBanRulesSettingKey },
    update: { value: JSON.stringify(rules) },
    create: { key: ipBanRulesSettingKey, value: JSON.stringify(rules) },
  });

  cachedRules = rules;
  cachedRulesLoadedAtMs = Date.now();
}

function parseStoredRules(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return [];
  }
}

function normalizeStoredRules(value: unknown): IpBanRule[] {
  const rawRules = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { rules?: unknown }).rules)
      ? (value as { rules: unknown[] }).rules
      : [];
  const byIp = new Map<string, IpBanRule>();

  for (const rawRule of rawRules) {
    if (!rawRule || typeof rawRule !== "object" || Array.isArray(rawRule)) {
      continue;
    }

    const record = rawRule as Record<string, unknown>;
    const ip = normalizeIpAddress(record.ip);
    if (!ip) {
      continue;
    }

    const createdAt = normalizeIsoDate(record.createdAt);
    const updatedAt = normalizeIsoDate(record.updatedAt);
    byIp.set(ip, {
      ip,
      mode: normalizeIpBanMode(record.mode),
      message: normalizeIpBanMessage(record.message),
      reason: normalizeIpBanReason(record.reason),
      createdAt: createdAt ?? updatedAt ?? new Date(0).toISOString(),
      updatedAt: updatedAt ?? createdAt ?? new Date(0).toISOString(),
    });
  }

  return Array.from(byIp.values()).sort((left, right) => left.ip.localeCompare(right.ip));
}

function normalizeIsoDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
