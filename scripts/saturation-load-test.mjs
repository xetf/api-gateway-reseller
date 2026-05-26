#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const defaults = {
  baseUrl: process.env.LOAD_TEST_BASE_URL || process.env.PUBLIC_API_BASE_URL || "http://127.0.0.1:4100",
  endpoint: process.env.LOAD_TEST_ENDPOINT || "/v1/responses",
  model: process.env.LOAD_TEST_MODEL || "gpt-5.5",
  apiKeys: splitCsv(process.env.LOAD_TEST_API_KEYS),
  ipCount: toInt(process.env.LOAD_TEST_IPS, 16),
  userCount: toInt(process.env.LOAD_TEST_USERS, 1),
  concurrency: toInt(process.env.LOAD_TEST_CONCURRENCY, 10),
  durationSeconds: toInt(process.env.LOAD_TEST_DURATION_SECONDS, 30),
  rampSeconds: toInt(process.env.LOAD_TEST_RAMP_SECONDS, 0),
  timeoutMs: toInt(process.env.LOAD_TEST_TIMEOUT_MS, 120_000),
  stream: parseBool(process.env.LOAD_TEST_STREAM, false),
  reasoningEffort: process.env.LOAD_TEST_REASONING_EFFORT || "low",
  mode: process.env.LOAD_TEST_MODE || "gateway",
};

const args = parseArgs(process.argv.slice(2));
const config = {
  ...defaults,
  ...args,
  apiKeys: args.apiKeys ?? defaults.apiKeys,
};

if (config.mode !== "health" && config.apiKeys.length === 0) {
  die("gateway 模式需要 API Key：传 --api-keys sk_xxx,sk_yyy 或设置 LOAD_TEST_API_KEYS。");
}

if (config.concurrency < 1 || config.durationSeconds < 1 || config.ipCount < 1 || config.userCount < 1) {
  die("concurrency、duration、ips、users 都必须大于 0。");
}

const targetUrl = new URL(config.mode === "health" ? "/health" : config.endpoint, config.baseUrl).toString();
const startedAt = performance.now();
const deadline = startedAt + config.durationSeconds * 1000;
const stats = {
  completed: 0,
  failed: 0,
  bytes: 0,
  latencies: [],
  statusCounts: new Map(),
  errorCounts: new Map(),
};
let launched = 0;

console.log(JSON.stringify({
  event: "load_test_start",
  mode: config.mode,
  targetUrl,
  model: config.mode === "health" ? undefined : config.model,
  apiKeyCount: config.apiKeys.length,
  simulatedUsers: config.userCount,
  simulatedIps: config.ipCount,
  concurrency: config.concurrency,
  durationSeconds: config.durationSeconds,
  rampSeconds: config.rampSeconds,
  stream: config.stream,
  reasoningEffort: config.mode === "health" ? undefined : config.reasoningEffort,
}, null, 2));

await runLoad();
printSummary();

async function runLoad() {
  const workers = Array.from({ length: config.concurrency }, (_, index) => worker(index));
  await Promise.all(workers);
}

async function worker(workerIndex) {
  while (performance.now() < deadline) {
    if (config.rampSeconds > 0) {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;
      const allowedWorkers = Math.max(1, Math.ceil((elapsedSeconds / config.rampSeconds) * config.concurrency));
      if (workerIndex >= allowedWorkers) {
        await sleep(100);
        continue;
      }
    }

    const requestIndex = launched++;
    await sendOne(requestIndex);
  }
}

async function sendOne(requestIndex) {
  const requestStartedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(targetUrl, {
      method: config.mode === "health" ? "GET" : "POST",
      headers: buildHeaders(requestIndex),
      body: config.mode === "health" ? undefined : JSON.stringify(buildBody()),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    const latencyMs = Math.round(performance.now() - requestStartedAt);
    stats.completed += 1;
    stats.bytes += text.length;
    stats.latencies.push(latencyMs);
    increment(stats.statusCounts, String(response.status));
  } catch (error) {
    const latencyMs = Math.round(performance.now() - requestStartedAt);
    stats.failed += 1;
    stats.latencies.push(latencyMs);
    increment(stats.errorCounts, normalizeError(error));
  } finally {
    clearTimeout(timeout);
  }
}

function buildHeaders(requestIndex) {
  const headers = {
    "X-Forwarded-For": simulatedIp(requestIndex),
    "X-Client-IP": simulatedIp(requestIndex),
    "User-Agent": `gateway-saturation-test/${simulatedUser(requestIndex)}`,
  };

  if (config.mode !== "health") {
    headers.Authorization = `Bearer ${config.apiKeys[requestIndex % config.apiKeys.length]}`;
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

function buildBody() {
  if (config.endpoint.includes("/chat/completions")) {
    return {
      model: config.model,
      messages: [{ role: "user", content: "只回复 ok" }],
      stream: config.stream,
      reasoning_effort: config.reasoningEffort,
      max_tokens: 8,
    };
  }

  return {
    model: config.model,
    input: "只回复 ok",
    stream: config.stream,
    reasoning: { effort: config.reasoningEffort },
    max_output_tokens: 8,
    store: false,
  };
}

function simulatedIp(index) {
  const n = (index % config.ipCount) + 1;
  return `198.18.${Math.floor(n / 255)}.${(n % 254) + 1}`;
}

function simulatedUser(index) {
  return `user-${(index % config.userCount) + 1}`;
}

function printSummary() {
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const latencies = stats.latencies.slice().sort((a, b) => a - b);
  const summary = {
    event: "load_test_done",
    elapsedSeconds: round(elapsedSeconds, 2),
    completed: stats.completed,
    failed: stats.failed,
    rps: round(stats.completed / elapsedSeconds, 2),
    bytes: stats.bytes,
    latencyMs: {
      min: percentile(latencies, 0),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: percentile(latencies, 100),
    },
    statusCounts: Object.fromEntries(stats.statusCounts),
    errorCounts: Object.fromEntries(stats.errorCounts),
  };

  console.log(JSON.stringify(summary, null, 2));
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=");
    const value = inlineValue ?? (next && !next.startsWith("--") ? argv[++i] : "true");
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    if (key === "apiKeys") {
      result.apiKeys = splitCsv(value);
    } else if (["ipCount", "userCount", "concurrency", "durationSeconds", "rampSeconds", "timeoutMs"].includes(key)) {
      result[key] = toInt(value, defaults[key]);
    } else if (key === "stream") {
      result.stream = parseBool(value, defaults.stream);
    } else {
      result[key] = value;
    }
  }

  if (result.ips !== undefined) {
    result.ipCount = toInt(result.ips, defaults.ipCount);
    delete result.ips;
  }

  if (result.users !== undefined) {
    result.userCount = toInt(result.users, defaults.userCount);
    delete result.users;
  }

  return result;
}

function printHelp() {
  console.log(`Usage:
  node scripts/saturation-load-test.mjs --mode health --concurrency 50 --duration-seconds 30
  node scripts/saturation-load-test.mjs --api-keys sk_xxx,sk_yyy --model gpt-5.5 --concurrency 20 --ips 100 --users 10

Options:
  --base-url URL              默认读取 PUBLIC_API_BASE_URL，回退 http://127.0.0.1:4100
  --mode gateway|health       gateway 会打真实模型调用；health 只压 /health
  --api-keys a,b,c            多用户 API Key，gateway 模式必填
  --endpoint PATH             /v1/responses 或 /v1/chat/completions
  --model MODEL               默认 gpt-5.5
  --concurrency N             并发数
  --duration-seconds N        持续秒数
  --ramp-seconds N            爬坡秒数
  --ips N                     模拟 IP 数，写入 X-Forwarded-For
  --users N                   模拟用户数，写入 User-Agent
  --stream true|false         是否流式
  --reasoning-effort VALUE    默认 low
`);
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBool(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function percentile(values, p) {
  if (values.length === 0) {
    return null;
  }

  if (p <= 0) {
    return values[0];
  }

  if (p >= 100) {
    return values[values.length - 1];
  }

  return values[Math.ceil((p / 100) * values.length) - 1];
}

function normalizeError(error) {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "timeout" : error.message.slice(0, 120);
  }

  return "unknown";
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function die(message) {
  console.error(message);
  process.exit(1);
}
