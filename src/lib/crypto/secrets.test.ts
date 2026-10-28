import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted } from "@/lib/crypto/secrets";

const saved = { auth: process.env.AUTH_SECRET, key: process.env.BOSWELL_ENCRYPTION_KEY };
beforeEach(() => {
  process.env.AUTH_SECRET = "test-auth-secret-for-encryption";
  delete process.env.BOSWELL_ENCRYPTION_KEY;
});
afterEach(() => {
  process.env.AUTH_SECRET = saved.auth;
  if (saved.key === undefined) delete process.env.BOSWELL_ENCRYPTION_KEY;
  else process.env.BOSWELL_ENCRYPTION_KEY = saved.key;
});

describe("credential encryption", () => {
  it("round-trips, and never stores the plaintext", () => {
    const stored = encryptSecret("hunter2-staging");
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain("hunter2");
    expect(decryptSecret(stored)).toBe("hunter2-staging");
    expect(encryptSecret("hunter2-staging")).not.toBe(stored);
  });

  it("still reads rows written before encryption existed", () => {
    expect(decryptSecret("legacy-plaintext")).toBe("legacy-plaintext");
  });

  it("refuses tampered ciphertext or a changed key with a clear message", () => {
    const stored = encryptSecret("secret");
    const tampered = stored.slice(0, -2) + (stored.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(tampered)).toThrow(/can't be decrypted/);
    process.env.AUTH_SECRET = "rotated";
    expect(() => decryptSecret(stored)).toThrow(/AUTH_SECRET/);
  });

  it("treats an empty BOSWELL_ENCRYPTION_KEY (an unset CI secret) as unset", () => {
    const stored = encryptSecret("secret");
    process.env.BOSWELL_ENCRYPTION_KEY = "";
    expect(decryptSecret(stored)).toBe("secret");
  });

  it("the cloud worker gets the key it needs to decrypt", () => {
    const workflow = fs.readFileSync(path.join(process.cwd(), ".github/workflows/audit-worker.yml"), "utf8");
    expect(workflow).toContain("AUTH_SECRET: ${{ secrets.AUTH_SECRET }}");
  });

  it("live verification stores test-account passwords encrypted", () => {
    const run = fs.readFileSync(path.join(process.cwd(), "src/lib/dynamic-verify/run.ts"), "utf8");
    expect(run).toContain("accountAPassword: encryptSecret(input.accountAPassword)");
    expect(run).toContain("accountBPassword: encryptSecret(input.accountBPassword)");
    expect(run).not.toMatch(/accountAPassword: input\.accountAPassword/);
  });
});
