import { performance } from "node:perf_hooks";
import { prisma, type ModelPoolChannel } from "@gateway/db";
import { buildUpstreamUrl } from "./upstream.js";

type HealthLogger = {
  error: (value: unknown, message?: string) => void;
  info?: (value: unknown, message?: string) => void;
};

export const defaultModelPoolHealthCheckIntervalSeconds = 30;
export const minModelPoolHealthCheckIntervalSeconds = 5;
export const maxModelPoolHealthCheckIntervalSeconds = 3600;
export const modelPoolHealthCheckIntervalSettingKey = "model_pool_health_interval_seconds";
const schedulerTickMs = 1_000;
const maxCheckMs = 30_000;
const checkedChannelStatuses = ["ACTIVE", "UNAVAILABLE"];
const checkedChannelStatusSet = new Set(checkedChannelStatuses);
const inFlightChannelChecks = new Map<
  string,
  {
    startedAt: Date;
    promise: Promise<ModelPoolChannel | null>;
  }
>();
const visibleCheckCooldowns = new Map<
  string,
  {
    resultCheckedAtMs: number;
    startedAtMs: number;
  }
>();
const pendingVisibleCheckCooldowns = new Map<
  string,
  {
    resultCheckedAtMs: number;
  }
>();
let cachedHealthCheckIntervalSeconds = defaultModelPoolHealthCheckIntervalSeconds;
let cachedHealthCheckIntervalLoadedAtMs = 0;
const healthCheckIntervalCacheTtlMs = 5_000;

export async function getModelPoolHealthCheckIntervalSeconds() {
  const nowMs = Date.now();
  if (nowMs - cachedHealthCheckIntervalLoadedAtMs < healthCheckIntervalCacheTtlMs) {
    return cachedHealthCheckIntervalSeconds;
  }

  const setting = await prisma.systemSetting.findUnique({
    where: { key: modelPoolHealthCheckIntervalSettingKey },
  });
  const intervalSeconds = normalizeModelPoolHealthCheckIntervalSeconds(setting?.value);

  cachedHealthCheckIntervalSeconds = intervalSeconds;
  cachedHealthCheckIntervalLoadedAtMs = nowMs;

  return intervalSeconds;
}

export async function setModelPoolHealthCheckIntervalSeconds(value: number) {
  const intervalSeconds = normalizeModelPoolHealthCheckIntervalSeconds(value);

  await prisma.systemSetting.upsert({
    where: { key: modelPoolHealthCheckIntervalSettingKey },
    update: { value: String(intervalSeconds) },
    create: {
      key: modelPoolHealthCheckIntervalSettingKey,
      value: String(intervalSeconds),
    },
  });

  cachedHealthCheckIntervalSeconds = intervalSeconds;
  cachedHealthCheckIntervalLoadedAtMs = Date.now();
  visibleCheckCooldowns.clear();
  pendingVisibleCheckCooldowns.clear();

  return intervalSeconds;
}

export function normalizeModelPoolHealthCheckIntervalSeconds(value: unknown) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return defaultModelPoolHealthCheckIntervalSeconds;
  }

  return Math.min(
    maxModelPoolHealthCheckIntervalSeconds,
    Math.max(minModelPoolHealthCheckIntervalSeconds, Math.round(numeric)),
  );
}

export function getModelPoolChannelHealthTiming(
  channel: ModelPoolChannel,
  intervalSeconds: number,
  now = new Date(),
) {
  const inFlightCheck = inFlightChannelChecks.get(channel.id);
  const isChecking = Boolean(inFlightCheck);
  const checkIntervalSeconds = normalizeModelPoolHealthCheckIntervalSeconds(intervalSeconds);
  const checkIntervalMs = checkIntervalSeconds * 1000;

  if (!checkedChannelStatusSet.has(channel.status)) {
    visibleCheckCooldowns.delete(channel.id);
    pendingVisibleCheckCooldowns.delete(channel.id);
    return {
      isChecking,
      checkingStartedAt: inFlightCheck?.startedAt.toISOString() ?? null,
      checkIntervalSeconds,
      nextCheckAt: null,
      nextCheckRemainingSeconds: null,
      healthCheckVersion: channel.lastCheckedAt?.toISOString() ?? null,
    };
  }

  if (isChecking) {
    return {
      isChecking: true,
      checkingStartedAt: inFlightCheck?.startedAt.toISOString() ?? null,
      checkIntervalSeconds,
      nextCheckAt: null,
      nextCheckRemainingSeconds: null,
      healthCheckVersion: channel.lastCheckedAt?.toISOString() ?? null,
    };
  }

  if (!channel.lastCheckedAt) {
    return {
      isChecking: false,
      checkingStartedAt: null,
      checkIntervalSeconds,
      nextCheckAt: now.toISOString(),
      nextCheckRemainingSeconds: 0,
      healthCheckVersion: null,
    };
  }

  const nowMs = now.getTime();
  const resultCheckedAtMs = channel.lastCheckedAt.getTime();
  const existingCooldown = visibleCheckCooldowns.get(channel.id);
  const startedAtMs =
    existingCooldown?.resultCheckedAtMs === resultCheckedAtMs
      ? existingCooldown.startedAtMs
      : nowMs;

  if (existingCooldown?.resultCheckedAtMs !== resultCheckedAtMs) {
    visibleCheckCooldowns.set(channel.id, {
      resultCheckedAtMs,
      startedAtMs,
    });
    pendingVisibleCheckCooldowns.delete(channel.id);
  }

  const nextCheckAtMs = startedAtMs + checkIntervalMs;

  return {
    isChecking: false,
    checkingStartedAt: null,
    checkIntervalSeconds,
    nextCheckAt: new Date(nextCheckAtMs).toISOString(),
    nextCheckRemainingSeconds: Math.max(0, Math.ceil((nextCheckAtMs - nowMs) / 1000)),
    healthCheckVersion: channel.lastCheckedAt.toISOString(),
  };
}

export async function checkModelPoolChannel(channelId: string) {
  return runChannelHealthCheck(channelId);
}

async function performModelPoolChannelCheck(channelId: string): Promise<ModelPoolChannel | null> {
  const channel = await prisma.modelPoolChannel.findUnique({
    where: { id: channelId },
    include: { modelPool: true },
  });

  if (!channel) {
    return null;
  }

  const [provider, price] = await Promise.all([
    prisma.upstreamProvider.findUnique({
      where: { name: channel.upstreamProvider },
    }),
    prisma.modelPrice.findUnique({
      where: {
        upstreamProvider_model: {
          upstreamProvider: channel.upstreamProvider,
          model: channel.modelPool.model,
        },
      },
    }),
  ]);

  if (channel.modelPool.status !== "ACTIVE") {
    return markChannelFailure(channel, "Model pool is disabled");
  }

  if (!provider || provider.status !== "ACTIVE") {
    return markChannelFailure(channel, "Upstream provider is missing or disabled");
  }

  if (!price || !price.enabled) {
    return markChannelFailure(channel, "Model price is missing or disabled");
  }

  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.min(provider.timeoutMs, maxCheckMs),
  );

  try {
    const result = await probeUpstream({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: channel.modelPool.model,
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!result.ok) {
      return markChannelFailure(channel, result.message, latencyMs);
    }

    return markChannelSuccess(channel, latencyMs, result.firstTokenLatencyMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed";
    const latencyMs = Math.round(performance.now() - startedAt);
    return markChannelFailure(channel, message, latencyMs);
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkDueModelPoolChannels() {
  const channels = await findDueModelPoolChannels();
  const dueChannels = channels.filter((channel) => !inFlightChannelChecks.has(channel.id));

  await Promise.allSettled(dueChannels.map((channel) => runChannelHealthCheck(channel.id)));

  return { checked: dueChannels.length };
}

async function scheduleDueModelPoolChannels(logger?: HealthLogger) {
  const channels = await findDueModelPoolChannels();
  let checked = 0;

  for (const channel of channels) {
    if (inFlightChannelChecks.has(channel.id)) {
      continue;
    }

    checked += 1;
    void runChannelHealthCheck(channel.id).catch((error) => {
      logger?.error(error, "Model pool channel health check failed");
    });
  }

  return { checked, inFlight: inFlightChannelChecks.size };
}

async function findDueModelPoolChannels() {
  const intervalSeconds = await getModelPoolHealthCheckIntervalSeconds();
  const intervalMs = intervalSeconds * 1000;
  const candidates = await prisma.modelPoolChannel.findMany({
    where: {
      status: { in: checkedChannelStatuses },
      modelPool: { status: "ACTIVE" },
    },
    orderBy: [
      { lastCheckedAt: "asc" },
      { priority: "asc" },
    ],
    take: 100,
  });
  const nowMs = Date.now();

  return candidates
    .filter((channel) => isModelPoolChannelDueForHealthCheck(channel, nowMs, intervalMs))
    .slice(0, 20);
}

export function startModelPoolHealthScheduler(logger?: HealthLogger) {
  let running = false;

  const tick = async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      const result = await scheduleDueModelPoolChannels(logger);
      if (result.checked > 0) {
        logger?.info?.(result, "Model pool health check completed");
      }
    } catch (error) {
      logger?.error(error, "Model pool health check failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, schedulerTickMs);

  void tick();

  return () => clearInterval(timer);
}

async function runChannelHealthCheck(channelId: string) {
  const existing = inFlightChannelChecks.get(channelId);

  if (existing) {
    return existing.promise;
  }

  visibleCheckCooldowns.delete(channelId);
  const startedAt = new Date();
  const promise = performModelPoolChannelCheck(channelId);
  inFlightChannelChecks.set(channelId, { startedAt, promise });

  try {
    const result = await promise;
    if (result?.lastCheckedAt) {
      pendingVisibleCheckCooldowns.set(channelId, {
        resultCheckedAtMs: result.lastCheckedAt.getTime(),
      });
    }
    return result;
  } finally {
    if (inFlightChannelChecks.get(channelId)?.promise === promise) {
      inFlightChannelChecks.delete(channelId);
    }
  }
}

function isModelPoolChannelDueForHealthCheck(channel: ModelPoolChannel, nowMs: number, intervalMs: number) {
  if (!checkedChannelStatusSet.has(channel.status)) {
    return false;
  }

  if (!channel.lastCheckedAt) {
    return true;
  }

  const resultCheckedAtMs = channel.lastCheckedAt.getTime();
  const pendingCooldown = pendingVisibleCheckCooldowns.get(channel.id);

  if (pendingCooldown?.resultCheckedAtMs === resultCheckedAtMs) {
    return false;
  }

  const visibleCooldown = visibleCheckCooldowns.get(channel.id);

  if (visibleCooldown?.resultCheckedAtMs !== resultCheckedAtMs) {
    return false;
  }

  const intervalStartedAtMs = visibleCooldown.startedAtMs;

  return intervalStartedAtMs + intervalMs <= nowMs;
}

async function markChannelSuccess(
  channel: ModelPoolChannel,
  latencyMs: number,
  firstTokenLatencyMs: number | null,
) {
  return prisma.modelPoolChannel.update({
    where: { id: channel.id },
    data: {
      status: channel.status === "FORCED_ACTIVE" ? "FORCED_ACTIVE" : "ACTIVE",
      priority: Math.max(1, firstTokenLatencyMs ?? latencyMs),
      consecutiveFailures: 0,
      lastCheckStatus: "SUCCESS",
      lastCheckedAt: new Date(),
      lastLatencyMs: latencyMs,
      lastFirstTokenLatencyMs: firstTokenLatencyMs,
      lastError: null,
    },
  });
}

async function markChannelFailure(
  channel: ModelPoolChannel,
  message: string,
  latencyMs?: number,
) {
  const consecutiveFailures = channel.consecutiveFailures + 1;
  const shouldKeepCallable = channel.status === "FORCED_ACTIVE";

  return prisma.modelPoolChannel.update({
    where: { id: channel.id },
    data: {
      status: shouldKeepCallable
        ? "FORCED_ACTIVE"
        : consecutiveFailures >= 2
          ? "UNAVAILABLE"
          : channel.status,
      priority: Math.min(10_000, channel.priority + 1000),
      consecutiveFailures,
      lastCheckStatus: "FAILED",
      lastCheckedAt: new Date(),
      lastLatencyMs: latencyMs,
      lastFirstTokenLatencyMs: null,
      lastError: message.slice(0, 1000),
    },
  });
}

type ProbeInput = {
  baseUrl: string;
  apiKey: string;
  model: string;
  signal: AbortSignal;
};

type ProbeResult =
  | { ok: true; mode: "responses" | "chat.completions"; firstTokenLatencyMs: number | null }
  | { ok: false; message: string };

async function probeUpstream(input: ProbeInput): Promise<ProbeResult> {
  const responsesResult = await postHealthProbe({
    ...input,
    mode: "responses",
    path: "/v1/responses",
    body: {
      model: input.model,
      input: "ok",
      max_output_tokens: 1,
      store: false,
      stream: true,
    },
  });

  if (responsesResult.ok) {
    return responsesResult;
  }

  const chatResult = await postHealthProbe({
    ...input,
    mode: "chat.completions",
    path: "/v1/chat/completions",
    body: {
      model: input.model,
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 1,
      stream: true,
    },
  });

  if (chatResult.ok) {
    return chatResult;
  }

  return {
    ok: false,
    message: [responsesResult.message, chatResult.message].join(" | ").slice(0, 1000),
  };
}

type PostHealthProbeInput = ProbeInput & {
  mode: "responses" | "chat.completions";
  path: string;
  body: unknown;
};

async function postHealthProbe(input: PostHealthProbeInput): Promise<ProbeResult> {
  const startedAt = performance.now();
  const response = await fetch(buildUpstreamUrl(input.baseUrl, input.path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return {
      ok: false,
      message: `${input.mode}: ${response.status} ${text}`.slice(0, 1000),
    };
  }

  const firstTokenLatencyMs = await readHealthProbeResponse(response, startedAt);
  return { ok: true, mode: input.mode, firstTokenLatencyMs };
}

async function readHealthProbeResponse(response: Response, startedAt: number) {
  if (!response.body) {
    await response.arrayBuffer().catch(() => undefined);
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let firstTokenLatencyMs: number | null = null;
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (value.length > 0) {
        pending += decoder.decode(value, { stream: true });

        if (firstTokenLatencyMs === null && sseBufferHasOutputToken(pending)) {
          firstTokenLatencyMs = Math.round(performance.now() - startedAt);
        }

        const lastEventBoundary = pending.lastIndexOf("\n\n");
        if (lastEventBoundary >= 0) {
          pending = pending.slice(lastEventBoundary + 2);
        }
      }
    }

    const trailing = decoder.decode();
    if (trailing) {
      pending += trailing;

      if (firstTokenLatencyMs === null && sseBufferHasOutputToken(pending)) {
        firstTokenLatencyMs = Math.round(performance.now() - startedAt);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return firstTokenLatencyMs;
}

function sseBufferHasOutputToken(buffer: string) {
  return parseSseJsonPayloads(buffer).some(streamChunkHasOutputToken);
}

function parseSseJsonPayloads(buffer: string) {
  const payloads: unknown[] = [];

  for (const event of buffer.split("\n\n")) {
    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    for (const data of dataLines) {
      if (!data || data === "[DONE]") {
        continue;
      }

      try {
        payloads.push(JSON.parse(data));
      } catch {
        continue;
      }
    }
  }

  return payloads;
}

function streamChunkHasOutputToken(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== "object") {
    return false;
  }

  const event = chunk as Record<string, unknown>;

  if (typeof event.delta === "string" && event.delta.length > 0) {
    return true;
  }

  if (typeof event.text === "string" && event.text.length > 0) {
    return true;
  }

  if (Array.isArray(event.choices)) {
    return event.choices.some((choice) => {
      if (!choice || typeof choice !== "object") {
        return false;
      }

      const item = choice as Record<string, unknown>;
      return textLikeValueHasContent(item.text) || textLikeValueHasContent(item.delta);
    });
  }

  return textLikeValueHasContent(event.output);
}

function textLikeValueHasContent(value: unknown): boolean {
  if (typeof value === "string") {
    return value.length > 0;
  }

  if (Array.isArray(value)) {
    return value.some(textLikeValueHasContent);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    textLikeValueHasContent(record.content) ||
    textLikeValueHasContent(record.text) ||
    textLikeValueHasContent(record.delta)
  );
}
