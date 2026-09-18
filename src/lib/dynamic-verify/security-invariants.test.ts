import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("dynamic-verify safety invariants", () => {
  it("never issues a mutating request against the target beyond login", () => {
    const engine = read("src/lib/dynamic-verify/engine.ts");
    // The only POST in this file is the login call. Everything that reads
    // the target resource must stay GET.
    expect(engine).not.toMatch(/method:\s*["']PUT["']/);
    expect(engine).not.toMatch(/method:\s*["']DELETE["']/);
    expect(engine).not.toMatch(/method:\s*["']PATCH["']/);
    const postCount = (engine.match(/method:\s*["']POST["']/g) ?? []).length;
    expect(postCount).toBe(1);
  });

  it("never returns or persists the raw response body", () => {
    const engine = read("src/lib/dynamic-verify/engine.ts");
    expect(engine).not.toMatch(/VerifyCheckResult\s*=\s*{[^}]*\bbody\b/);
    expect(engine).not.toMatch(/VerifyCheckResult\s*=\s*{[^}]*\btext\b/);

    const run = read("src/lib/dynamic-verify/run.ts");
    expect(run).not.toContain(".text,");
    expect(run).not.toContain("crossAccount.text");
    expect(run).not.toContain("baseline.text");
  });

  it("requires explicit consent before a target can be queued for a run", () => {
    const run = read("src/lib/dynamic-verify/run.ts");
    expect(run).toContain("consentConfirmedAt");
  });

  it("gates the API route behind the Pro plan and explicit consent", () => {
    const targetsRoute = read("src/app/api/verify/targets/route.ts");
    expect(targetsRoute).toContain("canUseDynamicVerify");
    expect(targetsRoute).toContain("consentConfirmed");
  });
});
