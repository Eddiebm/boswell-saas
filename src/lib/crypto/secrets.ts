import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

/**
 * Key for credentials Boswell stores on users' behalf (staging test
 * accounts, provider tokens). Derived from AUTH_SECRET so there's no extra
 * secret to manage; set BOSWELL_ENCRYPTION_KEY to rotate it independently.
 */
function key(): Buffer {
  // `||`, not `??`: an unset GitHub Actions secret arrives as an empty string.
  const base = process.env.BOSWELL_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!base) throw new Error("AUTH_SECRET (or BOSWELL_ENCRYPTION_KEY) must be set to store credentials");
  return Buffer.from(hkdfSync("sha256", base, "boswell", "credentials-v1", 32));
}

/** AES-256-GCM; the output is self-describing so older plaintext rows can still be read. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function decryptSecret(stored: string): string {
  // Rows written before encryption existed are plaintext; they're re-encrypted the next time they're saved.
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored credential can't be decrypted (was AUTH_SECRET changed?). Re-enter it to continue.");
  }
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
