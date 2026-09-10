import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function decodeKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function configuredKeys(): Buffer[] {
  const values = [
    process.env.TOKEN_ENCRYPTION_KEY,
    ...(process.env.TOKEN_ENCRYPTION_OLD_KEYS ?? "").split(","),
  ].filter((value): value is string => Boolean(value?.trim()));
  return values.map((value) => decodeKey(value.trim()));
}

export function encryptToken(value: string): string {
  const [key] = configuredKeys();
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is required to store provider tokens");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptToken(value: string): string {
  if (!value.startsWith(PREFIX)) {
    throw new Error("Unencrypted provider token detected; reconnect GitHub to migrate it");
  }
  const [ivText, tagText, ciphertextText] = value.slice(PREFIX.length).split(":");
  if (!ivText || !tagText || !ciphertextText) throw new Error("Invalid encrypted token format");

  for (const key of configuredKeys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64"));
      decipher.setAuthTag(Buffer.from(tagText, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextText, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      // Try the next configured rotation key.
    }
  }
  throw new Error("Provider token cannot be decrypted with the configured keys");
}
