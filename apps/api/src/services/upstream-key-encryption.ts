import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";

const encryptionVersion = "aes-256-gcm:v1";

export function encryptUpstreamKey(secret: string) {
  const encryptionSecret = env.UPSTREAM_KEY_ENCRYPTION_SECRET;
  if (!encryptionSecret) {
    return null;
  }

  const key = createEncryptionKey(encryptionSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: [
      encryptionVersion,
      iv.toString("base64url"),
      authTag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(":"),
    encryptionKeyVersion: encryptionVersion,
  };
}

export function decryptUpstreamKey(encryptedKey: string | null | undefined) {
  if (!encryptedKey) {
    return null;
  }

  const encryptionSecret = env.UPSTREAM_KEY_ENCRYPTION_SECRET;
  if (!encryptionSecret) {
    return null;
  }

  const [algorithm, version, ivText, authTagText, ciphertextText] =
    encryptedKey.split(":");
  if (`${algorithm}:${version}` !== encryptionVersion) {
    return null;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createEncryptionKey(encryptionSecret),
      Buffer.from(ivText ?? "", "base64url"),
    );
    decipher.setAuthTag(Buffer.from(authTagText ?? "", "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText ?? "", "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function resolveStoredUpstreamKey(key: {
  key: string;
  encryptedKey?: string | null;
}) {
  return decryptUpstreamKey(key.encryptedKey) ?? key.key;
}

function createEncryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}
