import type { FastifyInstance } from "fastify";
import { exec as execCallback } from "node:child_process";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { prisma } from "@gateway/db";
import { getModelPoolHealthCheckIntervalSeconds, normalizeModelPoolHealthCheckEndpoint } from "./model-pool-health.js";
import { upstreamKeyInflightKey } from "./upstream-provider-keys.js";

const exec = promisify(execCallback);

export type OperationalAlert = {
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
};

export type ExternalAlertSettings = {
  enabled: boolean;
  webhookUrl: string;
  minSeverity: OperationalAlert["severity"];
  intervalSeconds: number;
  mentionText: string;
};

export const defaultExternalAlertSettings: ExternalAlertSettings = {
  enabled: false,
  webhookUrl: "",
  minSeverity: "warning",
  intervalSeconds: 300,
  mentionText: "",
};

export const alertSeverityValues = ["info", "warning", "critical"] as const;
export const minExternalAlertIntervalSeconds = 60;
export const maxExternalAlertIntervalSeconds = 86400;

const settingKey = "external_alert_settings";
const cacheTtlMs = 5_000;
const schedulerTickMs = 30_000;
let cachedSettings = defaultExternalAlertSettings;
let cachedAtMs = 0;
let lastCpuSnapshot = {
  measuredAtMs: performance.now(),
  usage: process.cpuUsage(),
};
let lastSystemCpuSnapshot = getSystemCpuSnapshot();
let lastPushAtMs = 0;
let pushing = false;

type AlertLogger = {
  error: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
  warn?: (value: unknown, message?: string) => void;
};

export async function buildOperationalStatus(app: FastifyInstance) {
  const [redisPing, dbPing, pm2Status, modelPool, apiKeyStats] =
    await Promise.all([
      pingRedis(app),
      pingDatabase(),
      getPm2Status(),
      getModelPoolStatus(app),
      getApiKeyRuntimeStats(app),
    ]);

  return {
    server: {
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
      system: getSystemStatus(),
      cpu: getProcessCpuStatus(),
      redis: redisPing,
      database: dbPing,
      pm2: pm2Status,
    },
    modelPool,
    apiKeys: apiKeyStats,
    alerts: buildOperationalAlerts({
      redis: redisPing,
      database: dbPing,
      pm2: pm2Status,
      modelPool,
      apiKeys: apiKeyStats,
    }),
    checkedAt: new Date().toISOString(),
  };
}

export async function readExternalAlertSettings() {
  const nowMs = Date.now();
  if (nowMs - cachedAtMs < cacheTtlMs) {
    return cachedSettings;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: settingKey },
  });
  cachedSettings = normalizeExternalAlertSettings(parseSettings(setting?.value));
  cachedAtMs = nowMs;
  return cachedSettings;
}

export async function saveExternalAlertSettings(
  input: Partial<ExternalAlertSettings>,
) {
  const current = await readExternalAlertSettings();
  const settings = normalizeExternalAlertSettings({ ...current, ...input });
  await prisma.systemSetting.upsert({
    where: { key: settingKey },
    update: { value: JSON.stringify(settings) },
    create: { key: settingKey, value: JSON.stringify(settings) },
  });
  cachedSettings = settings;
  cachedAtMs = Date.now();
  return settings;
}

export async function sendExternalAlertTest(
  settings: ExternalAlertSettings,
  appName = "APIshare Gateway",
) {
  const normalized = normalizeExternalAlertSettings(settings);
  if (!normalized.webhookUrl) {
    throw new Error("Webhook URL is required");
  }

  return sendWebhookAlert(normalized, {
    appName,
    checkedAt: new Date().toISOString(),
    alerts: [
      {
        severity: "info",
        title: "外部告警测试",
        message: "这是一条 APIshare 网关外部告警测试消息。",
      },
    ],
  });
}

export function startExternalAlertScheduler(
  app: FastifyInstance,
  logger?: AlertLogger,
) {
  const tick = () => {
    void pushDueExternalAlerts(app, logger).catch((error) => {
      logger?.error(error, "External alert push failed");
    });
  };
  const timer = setInterval(tick, schedulerTickMs);
  tick();
  return () => clearInterval(timer);
}

async function pushDueExternalAlerts(
  app: FastifyInstance,
  logger?: AlertLogger,
) {
  if (pushing) {
    return;
  }

  const settings = await readExternalAlertSettings();
  if (!settings.enabled || !settings.webhookUrl) {
    return;
  }

  const nowMs = Date.now();
  if (nowMs - lastPushAtMs < settings.intervalSeconds * 1000) {
    return;
  }

  pushing = true;
  try {
    const status = await buildOperationalStatus(app);
    const alerts = filterAlertsBySeverity(status.alerts, settings.minSeverity).filter(
      (alert) => alert.severity !== "info",
    );
    if (alerts.length === 0) {
      lastPushAtMs = nowMs;
      return;
    }

    await sendWebhookAlert(settings, {
      appName: "APIshare Gateway",
      checkedAt: status.checkedAt,
      alerts,
    });
    lastPushAtMs = nowMs;
    logger?.info?.(
      { alerts: alerts.length, minSeverity: settings.minSeverity },
      "External operational alerts pushed",
    );
  } finally {
    pushing = false;
  }
}

function filterAlertsBySeverity(
  alerts: OperationalAlert[],
  minSeverity: OperationalAlert["severity"],
) {
  const minRank = severityRank(minSeverity);
  return alerts.filter((alert) => severityRank(alert.severity) >= minRank);
}

async function sendWebhookAlert(
  settings: ExternalAlertSettings,
  payload: {
    appName: string;
    checkedAt: string;
    alerts: OperationalAlert[];
  },
) {
  const body = {
    msg_type: "text",
    text: {
      content: renderAlertText(settings, payload),
    },
    app: payload.appName,
    checkedAt: payload.checkedAt,
    alerts: payload.alerts,
  };

  const response = await fetch(settings.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Webhook push failed: HTTP ${response.status}${text ? ` ${text.slice(0, 300)}` : ""}`);
  }

  return { ok: true, status: response.status };
}

function renderAlertText(
  settings: ExternalAlertSettings,
  payload: {
    appName: string;
    checkedAt: string;
    alerts: OperationalAlert[];
  },
) {
  const lines = [
    settings.mentionText,
    `[${payload.appName}] 运维告警`,
    `时间：${payload.checkedAt}`,
    ...payload.alerts.map(
      (alert) => `- ${alert.severity.toUpperCase()} ${alert.title}: ${alert.message}`,
    ),
  ].filter(Boolean);
  return lines.join("\n").slice(0, 8000);
}

function normalizeExternalAlertSettings(
  input: Partial<ExternalAlertSettings>,
) {
  const webhookUrl = String(input.webhookUrl ?? "").trim();
  const minSeverity = alertSeverityValues.includes(
    input.minSeverity as OperationalAlert["severity"],
  )
    ? (input.minSeverity as OperationalAlert["severity"])
    : defaultExternalAlertSettings.minSeverity;
  const intervalSeconds = Number(input.intervalSeconds);

  return {
    enabled:
      typeof input.enabled === "boolean"
        ? input.enabled
        : defaultExternalAlertSettings.enabled,
    webhookUrl: webhookUrl.slice(0, 2000),
    minSeverity,
    intervalSeconds: Number.isFinite(intervalSeconds)
      ? Math.min(
          maxExternalAlertIntervalSeconds,
          Math.max(minExternalAlertIntervalSeconds, Math.round(intervalSeconds)),
        )
      : defaultExternalAlertSettings.intervalSeconds,
    mentionText: String(input.mentionText ?? "").trim().slice(0, 500),
  };
}

function parseSettings(value: string | null | undefined) {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as Partial<ExternalAlertSettings>;
  } catch {
    return {};
  }
}

function buildOperationalAlerts(params: {
  redis: Awaited<ReturnType<typeof pingRedis>>;
  database: Awaited<ReturnType<typeof pingDatabase>>;
  pm2: Awaited<ReturnType<typeof getPm2Status>>;
  modelPool: Awaited<ReturnType<typeof getModelPoolStatus>>;
  apiKeys: Awaited<ReturnType<typeof getApiKeyRuntimeStats>>;
}) {
  const alerts: OperationalAlert[] = [];

  if (!params.redis.ok) {
    alerts.push({
      severity: "critical",
      title: "Redis 不可用",
      message: params.redis.error ?? "Redis ping failed",
    });
  }
  if (!params.database.ok) {
    alerts.push({
      severity: "critical",
      title: "数据库不可用",
      message: params.database.error ?? "Database ping failed",
    });
  }
  if (!params.pm2.ok) {
    alerts.push({
      severity: "warning",
      title: "PM2 状态读取失败",
      message: params.pm2.error ?? "PM2 status unavailable",
    });
  }

  const offlineProcesses = params.pm2.processes.filter(
    (process) => process.status !== "online",
  );
  for (const process of offlineProcesses) {
    alerts.push({
      severity: "critical",
      title: `PM2 进程异常：${process.name}`,
      message: `当前状态 ${process.status}`,
    });
  }

  if (params.modelPool.activeChannels === 0) {
    alerts.push({
      severity: "critical",
      title: "模型池无可调用渠道",
      message: "所有 ACTIVE 模型池下都没有 ACTIVE/FORCED_ACTIVE 渠道。",
    });
  } else if (params.modelPool.unavailableChannels > 0) {
    alerts.push({
      severity: "warning",
      title: "存在不可用模型池渠道",
      message: `${params.modelPool.unavailableChannels} 个渠道不可用，${params.modelPool.penalizedChannels} 个渠道惩罚中。`,
    });
  }

  if (params.modelPool.upstreamKeys.active === 0) {
    alerts.push({
      severity: "critical",
      title: "上游无 ACTIVE Key",
      message: "上游 Key 池没有可用密钥，真实调用会失败。",
    });
  }

  if (params.apiKeys.activeConcurrency > 100) {
    alerts.push({
      severity: "warning",
      title: "API Key 并发偏高",
      message: `当前 API Key 并发 ${params.apiKeys.activeConcurrency}。`,
    });
  }

  if (alerts.length === 0) {
    alerts.push({
      severity: "info",
      title: "系统运行正常",
      message: "Redis、数据库、PM2、模型池和上游 Key 未发现阻断级风险。",
    });
  }

  return alerts;
}

async function pingRedis(app: FastifyInstance) {
  try {
    const startedAt = Date.now();
    const pong = await app.redis.ping();
    return {
      ok: pong === "PONG",
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : "Redis ping failed",
    };
  }
}

async function pingDatabase() {
  try {
    const startedAt = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      error: error instanceof Error ? error.message : "Database ping failed",
    };
  }
}

function getSystemStatus() {
  const totalMemoryBytes = totalmem();
  const freeMemoryBytes = freemem();
  const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);
  const cpuCount = cpus().length || 1;
  const cpuSnapshot = getSystemCpuSnapshot();
  const totalDelta = cpuSnapshot.total - lastSystemCpuSnapshot.total;
  const idleDelta = cpuSnapshot.idle - lastSystemCpuSnapshot.idle;
  const usagePercent =
    totalDelta > 0
      ? Number((Math.max(0, 1 - idleDelta / totalDelta) * 100).toFixed(2))
      : 0;
  lastSystemCpuSnapshot = cpuSnapshot;

  return {
    cpuCount,
    cpuUsagePercent: usagePercent,
    loadAverage: loadavg(),
    totalMemoryBytes,
    freeMemoryBytes,
    usedMemoryBytes,
    memoryUsagePercent:
      totalMemoryBytes > 0
        ? Number(((usedMemoryBytes / totalMemoryBytes) * 100).toFixed(2))
        : 0,
  };
}

function getSystemCpuSnapshot() {
  return cpus().reduce(
    (total, cpu) => {
      const cpuTotal = Object.values(cpu.times).reduce(
        (sum, value) => sum + value,
        0,
      );
      return {
        idle: total.idle + cpu.times.idle,
        total: total.total + cpuTotal,
      };
    },
    { idle: 0, total: 0 },
  );
}

function getProcessCpuStatus() {
  const measuredAtMs = performance.now();
  const usage = process.cpuUsage();
  const elapsedMs = Math.max(1, measuredAtMs - lastCpuSnapshot.measuredAtMs);
  const userDiffMs = (usage.user - lastCpuSnapshot.usage.user) / 1000;
  const systemDiffMs = (usage.system - lastCpuSnapshot.usage.system) / 1000;
  const cpuCount = cpus().length || 1;
  const percent = (((userDiffMs + systemDiffMs) / elapsedMs) * 100) / cpuCount;

  lastCpuSnapshot = {
    measuredAtMs,
    usage,
  };

  return {
    percent: Number(Math.max(0, percent).toFixed(2)),
    userMs: Math.round(usage.user / 1000),
    systemMs: Math.round(usage.system / 1000),
  };
}

async function getPm2Status() {
  try {
    const { stdout } = await exec("pm2 jlist");
    const processes = JSON.parse(stdout) as Array<{
      pm2_env?: { name?: string; status?: string };
      pm2_env_status?: string;
      pm_id?: number;
      monit?: { cpu?: number; memory?: number };
      pid?: number;
      name?: string;
    }>;

    return {
      ok: true,
      processes: processes
        .map((process) => ({
          name:
            process.pm2_env?.name ??
            process.name ??
            `pm2-${process.pm_id ?? "unknown"}`,
          pid: process.pid ?? null,
          status:
            process.pm2_env?.status ?? process.pm2_env_status ?? "unknown",
          cpu: process.monit?.cpu ?? null,
          memory: process.monit?.memory ?? null,
        }))
        .filter((process) => process.name.includes("api-gateway")),
    };
  } catch (error) {
    return {
      ok: false,
      processes: [],
      error: error instanceof Error ? error.message : "PM2 status failed",
    };
  }
}

async function getModelPoolStatus(app: FastifyInstance) {
  const [channels, healthCheckIntervalSeconds, upstreamKeys] =
    await Promise.all([
      prisma.modelPoolChannel.findMany({
        where: {
          modelPool: {
            status: "ACTIVE",
          },
        },
        select: {
          id: true,
          status: true,
          priority: true,
          consecutiveFailures: true,
          recoverySuccesses: true,
          penalizedUntil: true,
          lastCheckStatus: true,
          lastCheckedAt: true,
          lastLatencyMs: true,
          lastFirstTokenLatencyMs: true,
          modelPool: {
            select: {
              model: true,
              healthCheckEndpoint: true,
            },
          },
        },
      }),
      getModelPoolHealthCheckIntervalSeconds(),
      prisma.upstreamProviderKey.findMany({
        select: { id: true, status: true },
      }),
    ]);

  const activeChannels = channels.filter(
    (channel) =>
      channel.status === "ACTIVE" || channel.status === "FORCED_ACTIVE",
  );
  const unavailableChannels = channels.filter(
    (channel) => channel.status === "UNAVAILABLE",
  );
  const penalizedChannels = channels.filter(
    (channel) => channel.status === "PENALIZED",
  );
  const recoveringChannels = channels.filter(
    (channel) =>
      channel.status === "UNAVAILABLE" && channel.recoverySuccesses > 0,
  );
  const inflightCounts = await readRedisCounts(
    app,
    channels.map((channel) => `modelpool:balance:inflight:${channel.id}`),
  );
  const keyInflightCounts = await readRedisCounts(
    app,
    upstreamKeys.map((key) => upstreamKeyInflightKey(key.id)),
  );
  const channelSummaries = channels.map((channel, index) => ({
    id: channel.id,
    model: channel.modelPool.model,
    healthCheckEndpoint: normalizeModelPoolHealthCheckEndpoint(
      channel.modelPool.healthCheckEndpoint,
    ),
    status: channel.status,
    priority: channel.priority,
    consecutiveFailures: channel.consecutiveFailures,
    recoverySuccesses: channel.recoverySuccesses,
    penalizedUntil: channel.penalizedUntil,
    lastCheckStatus: channel.lastCheckStatus,
    lastCheckedAt: channel.lastCheckedAt,
    lastLatencyMs: channel.lastLatencyMs,
    lastFirstTokenLatencyMs: channel.lastFirstTokenLatencyMs,
    inflightRequests: inflightCounts[index] ?? 0,
  }));

  return {
    healthCheckIntervalSeconds,
    totalChannels: channels.length,
    activeChannels: activeChannels.length,
    unavailableChannels: unavailableChannels.length,
    penalizedChannels: penalizedChannels.length,
    recoveringChannels: recoveringChannels.length,
    inflightRequests: inflightCounts.reduce((total, value) => total + value, 0),
    upstreamKeys: {
      total: upstreamKeys.length,
      active: upstreamKeys.filter((key) => key.status === "ACTIVE").length,
      inflightRequests: keyInflightCounts.reduce(
        (total, value) => total + value,
        0,
      ),
    },
    autoCheckEnabledPools: await prisma.modelPool.count({
      where: { autoHealthCheckEnabled: true, status: "ACTIVE" },
    }),
    channels: channelSummaries.slice(0, 20),
  };
}

async function getApiKeyRuntimeStats(app: FastifyInstance) {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const [apiKeys, limitedKeys] = await Promise.all([
    prisma.apiKey.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { concurrencyLimit: { gt: 0 } },
          { rateLimitPerMinute: { gt: 0 } },
        ],
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        concurrencyLimit: true,
        rateLimitPerMinute: true,
      },
      take: 50,
      orderBy: { lastUsedAt: "desc" },
    }),
    prisma.apiKey.count({
      where: {
        status: "ACTIVE",
        OR: [
          { concurrencyLimit: { gt: 0 } },
          { rateLimitPerMinute: { gt: 0 } },
        ],
      },
    }),
  ]);
  const concurrencyCounts = await readRedisCounts(
    app,
    apiKeys.map((apiKey) => `concurrency:${apiKey.id}`),
  );
  const minuteCounts = await readRedisCounts(
    app,
    apiKeys.map((apiKey) => `ratelimit:${apiKey.id}:${minuteBucket}`),
  );
  const sample = apiKeys.slice(0, 10).map((apiKey, index) => ({
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    concurrencyLimit: apiKey.concurrencyLimit,
    currentConcurrency: concurrencyCounts[index] ?? 0,
    rateLimitPerMinute: apiKey.rateLimitPerMinute,
    currentMinuteRequests: minuteCounts[index] ?? 0,
  }));

  return {
    monitoredKeys: apiKeys.length,
    limitedKeys,
    activeConcurrency: concurrencyCounts.reduce(
      (total, value) => total + value,
      0,
    ),
    currentMinuteRequests: minuteCounts.reduce(
      (total, value) => total + value,
      0,
    ),
    sample,
  };
}

async function readRedisCounts(app: FastifyInstance, keys: string[]) {
  if (keys.length === 0) {
    return [];
  }

  try {
    const values = await app.redis.mget(...keys);
    return values.map((value) => {
      const numberValue = Number(value ?? 0);
      return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
    });
  } catch {
    return keys.map(() => 0);
  }
}

function severityRank(severity: OperationalAlert["severity"]) {
  if (severity === "critical") {
    return 2;
  }
  if (severity === "warning") {
    return 1;
  }
  return 0;
}
