import { createHash, randomBytes } from "node:crypto";

export function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export function createApiKey() {
  const body = randomBytes(32).toString("base64url");
  const key = `sk_live_${body}`;
  const prefix = key.slice(0, 18);

  return {
    key,
    prefix,
    hash: hashSecret(key),
  };
}

export function createRedeemCode() {
  const body = randomBytes(24).toString("base64url");
  const code = `rdm_${body}`;

  return {
    code,
    prefix: code.slice(0, 12),
    hash: hashSecret(code),
  };
}
