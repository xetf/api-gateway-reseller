import { createHash, randomUUID } from "node:crypto";
import { redis } from "../lib/redis.js";

export type CompactCacheEntry = {
  id: string;
  requestBody: unknown;
  userId: string;
  apiKeyId: string;
  model?: string;
  sourceFingerprint: string;
  encryptedContentHashes: string[];
  createdAt: string;
};

export type CompactRouteFingerprintInput = {
  channelId?: string;
  upstreamProviderKeyId?: string | null;
  providerId: string;
  providerName: string;
  providerApiKey?: string;
};

const compactCacheTtlSeconds = 24 * 60 * 60;
const maxCompactRequestBodyBytes = 5 * 1024 * 1024;
const encryptedIndexPrefix = "gateway:compact:encrypted:";
const cachePrefix = "gateway:compact:cache:";
const targetPrefix = "gateway:compact:target:";

export function createCompactRouteFingerprint(
  input: CompactRouteFingerprintInput,
) {
  const keyFingerprint = input.upstreamProviderKeyId
    ? `key:${input.upstreamProviderKeyId}`
    : `provider:${input.providerId}:${input.providerName}:env:${shortHash(input.providerApiKey ?? "")}`;

  return input.channelId
    ? `channel:${input.channelId}:${keyFingerprint}`
    : keyFingerprint;
}

export function createCompactChannelFingerprint(
  input: CompactRouteFingerprintInput,
) {
  return input.channelId
    ? `channel:${input.channelId}`
    : `provider:${input.providerId}:${input.providerName}`;
}

export function hashEncryptedContent(encryptedContent: string) {
  return sha256(encryptedContent);
}

export function collectEncryptedContents(value: unknown) {
  const contents: string[] = [];
  visitJson(value, (record) => {
    const encryptedContent = record.encrypted_content;
    if (typeof encryptedContent === "string" && encryptedContent) {
      contents.push(encryptedContent);
    }
  });
  return [...new Set(contents)];
}

export function extractCompactionSummaryItem(value: unknown) {
  let fallback: string | null = null;
  let fallbackItem: unknown = null;
  let summaryEncryptedContent: string | null = null;
  let summaryItem: unknown = null;

  visitJson(value, (record) => {
    const encryptedContent = record.encrypted_content;
    if (typeof encryptedContent !== "string" || !encryptedContent) {
      return;
    }

    if (fallback === null) {
      fallback = encryptedContent;
      fallbackItem = record;
    }
    if (
      summaryEncryptedContent === null &&
      (record.type === "compaction_summary" ||
        record.type === "response.compaction_summary" ||
        record.type === "compaction" ||
        record.object === "compaction_summary")
    ) {
      summaryEncryptedContent = encryptedContent;
      summaryItem = record;
    }
  });

  const encryptedContent = summaryEncryptedContent ?? fallback;
  if (!encryptedContent) {
    return null;
  }

  return {
    encryptedContent,
    item: cloneJson(summaryItem ?? fallbackItem),
  };
}

export function extractEncryptedItems(value: unknown) {
  const items: Array<{ encryptedContent: string; item: unknown }> = [];

  visitJson(value, (record) => {
    const encryptedContent = record.encrypted_content;
    if (typeof encryptedContent === "string" && encryptedContent) {
      items.push({
        encryptedContent,
        item: cloneJson(record),
      });
    }
  });

  return items;
}

export async function saveCompactCache(params: {
  requestBody: unknown;
  responseBody: unknown;
  userId: string;
  apiKeyId: string;
  model?: string;
  sourceFingerprint: string;
}) {
  const requestBodyJson = JSON.stringify(params.requestBody);
  if (Buffer.byteLength(requestBodyJson, "utf8") > maxCompactRequestBodyBytes) {
    return { saved: false as const, reason: "request_body_too_large" };
  }

  const encryptedContents = collectEncryptedContents(params.responseBody);
  if (encryptedContents.length === 0) {
    return { saved: false as const, reason: "no_encrypted_content" };
  }

  const encryptedContentHashes = encryptedContents.map(hashEncryptedContent);
  const compactCacheId = randomUUID();
  const entry: CompactCacheEntry = {
    id: compactCacheId,
    requestBody: params.requestBody,
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    model: params.model,
    sourceFingerprint: params.sourceFingerprint,
    encryptedContentHashes,
    createdAt: new Date().toISOString(),
  };

  const operations = redis.multi();
  operations.set(
    cacheKey(compactCacheId),
    JSON.stringify(entry),
    "EX",
    compactCacheTtlSeconds,
  );
  for (const hash of encryptedContentHashes) {
    operations.set(
      encryptedIndexKey(hash),
      compactCacheId,
      "EX",
      compactCacheTtlSeconds,
    );
  }
  await operations.exec();

  return {
    saved: true as const,
    compactCacheId,
    encryptedContentHashes,
  };
}

export async function findCachedCompactForBody(value: unknown) {
  const encryptedContents = collectEncryptedContents(value);
  if (encryptedContents.length === 0) {
    return null;
  }

  const candidates = encryptedContents.map((encryptedContent) => ({
    encryptedContent,
    hash: hashEncryptedContent(encryptedContent),
  }));
  const compactCacheIds = await redis.mget(
    ...candidates.map((candidate) => encryptedIndexKey(candidate.hash)),
  );

  for (let index = 0; index < candidates.length; index += 1) {
    const compactCacheId = compactCacheIds[index];
    const candidate = candidates[index];
    if (!compactCacheId || !candidate) {
      continue;
    }

    const entry = await readCompactCache(compactCacheId);
    if (!entry) {
      continue;
    }

    return {
      encryptedContent: candidate.encryptedContent,
      encryptedContentHash: candidate.hash,
      compactCacheId,
      cache: entry,
    };
  }

  return null;
}

export async function readTargetCompactItems(params: {
  compactCacheId: string;
  targetFingerprint: string;
}) {
  const raw = await redis.get(
    targetKey(params.compactCacheId, params.targetFingerprint),
  );
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveTargetCompactItems(params: {
  compactCacheId: string;
  targetFingerprint: string;
  targetItems: Array<{ encryptedContent: string; item: unknown }>;
}) {
  await redis.set(
    targetKey(params.compactCacheId, params.targetFingerprint),
    JSON.stringify(params.targetItems),
    "EX",
    compactCacheTtlSeconds,
  );
}

export function replaceCompactionItemByEncryptedContentHash<T>(
  value: T,
  encryptedContentHash: string,
  nextCompactionItem: unknown,
) {
  const replace = (
    current: unknown,
  ): { value: unknown; replacements: number } => {
    if (Array.isArray(current)) {
      let replacements = 0;
      const nextItems = current.map((item) => {
        const replaced = replace(item);
        replacements += replaced.replacements;
        return replaced.value;
      });
      return { value: replacements > 0 ? nextItems : current, replacements };
    }

    if (!isPlainRecord(current)) {
      return { value: current, replacements: 0 };
    }

    const encryptedContent = current.encrypted_content;
    if (
      typeof encryptedContent === "string" &&
      hashEncryptedContent(encryptedContent) === encryptedContentHash
    ) {
      return { value: cloneJson(nextCompactionItem), replacements: 1 };
    }

    let replacements = 0;
    const nextRecord: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) {
      const replaced = replace(item);
      replacements += replaced.replacements;
      nextRecord[key] = replaced.value;
    }

    return { value: replacements > 0 ? nextRecord : current, replacements };
  };

  const replaced = replace(value);
  return {
    value: replaced.value as T,
    replacements: replaced.replacements,
  };
}

export function replaceCompactionItemsByEncryptedContentHashes<T>(
  value: T,
  replacementsByHash: Map<string, unknown>,
) {
  const replace = (
    current: unknown,
  ): { value: unknown; replacements: number } => {
    if (Array.isArray(current)) {
      let replacements = 0;
      const nextItems = current.map((item) => {
        const replaced = replace(item);
        replacements += replaced.replacements;
        return replaced.value;
      });
      return { value: replacements > 0 ? nextItems : current, replacements };
    }

    if (!isPlainRecord(current)) {
      return { value: current, replacements: 0 };
    }

    const encryptedContent = current.encrypted_content;
    if (typeof encryptedContent === "string") {
      const nextItem = replacementsByHash.get(
        hashEncryptedContent(encryptedContent),
      );
      if (nextItem !== undefined) {
        return { value: cloneJson(nextItem), replacements: 1 };
      }
    }

    let replacements = 0;
    const nextRecord: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(current)) {
      const replaced = replace(item);
      replacements += replaced.replacements;
      nextRecord[key] = replaced.value;
    }

    return { value: replacements > 0 ? nextRecord : current, replacements };
  };

  const replaced = replace(value);
  return {
    value: replaced.value as T,
    replacements: replaced.replacements,
  };
}

async function readCompactCache(compactCacheId: string) {
  const raw = await redis.get(cacheKey(compactCacheId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as CompactCacheEntry;
    return parsed &&
      typeof parsed.id === "string" &&
      parsed.id === compactCacheId
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function encryptedIndexKey(hash: string) {
  return `${encryptedIndexPrefix}${hash}`;
}

function cacheKey(compactCacheId: string) {
  return `${cachePrefix}${compactCacheId}`;
}

function targetKey(compactCacheId: string, targetFingerprint: string) {
  return `${targetPrefix}${compactCacheId}:${sha256(targetFingerprint)}`;
}

function visitJson(
  value: unknown,
  visitRecord: (record: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitJson(item, visitRecord);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    return;
  }

  visitRecord(value);
  for (const item of Object.values(value)) {
    visitJson(item, visitRecord);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function cloneJson<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function shortHash(value: string) {
  return sha256(value).slice(0, 16);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
