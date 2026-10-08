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

  it("keeps discovery a pure static analyzer with no network access", () => {
    const discover = read("src/lib/dynamic-verify/discover.ts");
    expect(discover).not.toContain("fetch(");
    expect(discover).not.toContain("http.");
    expect(discover).not.toContain("https.");
  });

  it("bounds every outbound request with a timeout", () => {
    const engine = read("src/lib/dynamic-verify/engine.ts");
    const fetchCount = (engine.match(/await fetch\(/g) ?? []).length;
    const signalCount = (engine.match(/signal:\s*AbortSignal\.timeout/g) ?? []).length;
    expect(fetchCount).toBeGreaterThan(0);
    expect(signalCount).toBe(fetchCount);
  });

  it("refuses to resolve a path to a different origin than the staging URL", () => {
    const engine = read("src/lib/dynamic-verify/engine.ts");
    expect(engine).toContain("url.origin !== baseOrigin");
  });

  it("validates stagingUrl and path fields before a target can be saved or run", () => {
    const run = read("src/lib/dynamic-verify/run.ts");
    expect(run).toContain("assertSafeStagingUrl");
    expect(run).toContain("assertRelativePath");
  });

  it("never returns stored account passwords from the API", () => {
    const targetsRoute = read("src/app/api/verify/targets/route.ts");
    expect(targetsRoute).not.toMatch(/NextResponse\.json\(\{\s*target(s)?\s*\}\)/);
  });

  it("scopes fix-queue deletion on audit refresh to audit-derived items only", () => {
    const audits = read("src/lib/audits.ts");
    expect(audits).toMatch(/delete\(fixQueueItems\)[\s\S]{0,200}fixQueueItems\.source/);
  });
});
