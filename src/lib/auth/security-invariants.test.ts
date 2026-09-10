import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("authentication security invariants", () => {
  it("does not expose a passwordless owner bootstrap", () => {
    expect(fs.existsSync(path.join(root, "src/lib/auth/owner-bootstrap.ts"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src/app/api/setup/owner/route.ts"))).toBe(false);
    expect(read("src/app/login/page.tsx")).not.toContain("signInOwner");
    expect(read("src/app/login/page.tsx")).not.toContain("Continue as owner");
  });

  it("does not reuse the former bootstrap token for worker dispatch", () => {
    expect(read("src/lib/worker/trigger-worker.ts")).not.toContain(
      "GITHUB_BOOTSTRAP_TOKEN",
    );
  });

  it("requires target-specific environment files", () => {
    const cliScript = read("scripts/push-vercel-env.sh");
    const apiScript = read("scripts/push-vercel-env-api.sh");
    expect(cliScript).toContain('.env.${target}.local');
    expect(apiScript).toContain('.env.${target}.local');
    expect(cliScript).not.toContain("for env in production preview development");
    expect(apiScript).not.toContain("for target in production preview development");
  });
});
