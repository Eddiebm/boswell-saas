import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./token-crypto";

describe("provider token encryption", () => {
  const originalKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it("encrypts and authenticates tokens", () => {
    const encrypted = encryptToken("github-secret");
    expect(encrypted).not.toContain("github-secret");
    expect(decryptToken(encrypted)).toBe("github-secret");
  });

  it("rejects legacy plaintext", () => {
    expect(() => decryptToken("plaintext-token")).toThrow(/Unencrypted/);
  });
});
