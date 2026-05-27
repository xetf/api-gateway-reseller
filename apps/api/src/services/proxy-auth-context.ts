import type { FastifyRequest } from "fastify";
import { ipMatchesPattern } from "./access-routing.js";
import {
  collectEncryptedContents,
  hashEncryptedContent,
} from "./compact-cache.js";
import {
  getClientIp,
  isPlainObject,
  pickHeaderValue,
  type ProxyBody,
} from "./proxy-request-utils.js";

export function getGatewaySessionIdentity(
  request: FastifyRequest,
  body: ProxyBody,
  apiKeyId: string,
) {
  const sessionId =
    pickHeaderValue(request.headers["x-gateway-session-id"]) ??
    getStringPath(body, ["prompt_cache_key"]) ??
    getStringPath(body, ["metadata", "gateway_session_id"]) ??
    getStringPath(body, ["metadata", "session_id"]) ??
    getStringPath(body, ["previous_response_id"]) ??
    getStringPath(body, ["conversation_id"]) ??
    getStringPath(body, ["conversation"]) ??
    getStringPath(body, ["thread_id"]) ??
    getCompactSessionAnchor(body);

  if (sessionId) {
    return `apiKey:${apiKeyId}:session:${normalizeStickyIdentityPart(sessionId)}`;
  }

  const clientIp = getClientIp(request);
  if (clientIp) {
    return `apiKey:${apiKeyId}:ip:${normalizeStickyIdentityPart(clientIp)}`;
  }

  return `apiKey:${apiKeyId}:session:missing`;
}

export function apiKeyIpAllowed(
  whitelist: string[] | null | undefined,
  clientIp: string | null,
) {
  if (!whitelist || whitelist.length === 0) {
    return true;
  }

  if (!clientIp) {
    return false;
  }

  return whitelist.some((pattern) => {
    const normalized = pattern.trim();
    if (!normalized) {
      return false;
    }

    return normalized.includes("/")
      ? ipMatchesPattern(clientIp, normalized)
      : clientIp === normalized;
  });
}

function getStringPath(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!isPlainObject(current)) {
      return null;
    }
    current = current[key];
  }

  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function getCompactSessionAnchor(body: ProxyBody) {
  const encryptedContent = collectEncryptedContents(body)[0];
  return encryptedContent
    ? `compact:${hashEncryptedContent(encryptedContent)}`
    : null;
}

function normalizeStickyIdentityPart(value: string) {
  return value
    .trim()
    .slice(0, 256)
    .replace(/[^a-zA-Z0-9._:@-]/g, "_");
}
