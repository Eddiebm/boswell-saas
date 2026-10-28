import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRepoChecks } from "@/lib/checks";
import type { NpmAuditReport, NpmExec } from "@/lib/checks/npm-audit";

const report: NpmAuditReport = {
  vulnerabilities: {
    zod: { name: "zod", severity: "high", via: [{ title: "ReDoS", severity: "high" }], effects: [], nodes: ["node_modules/zod"], fixAvailable: true },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
};
const clean: NpmAuditReport = { vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } };

const lock = (zod: string) =>
  JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { zod: "^4.0.0" } }, "node_modules/zod": { version: zod } } }, null, 2);

/** Fake npm: `audit fix` writes `patched` into the lockfile; later audits come back clean. */
function fakeNpm(patched: string) {
  let fixed = false;
  const calls: string[][] = [];
  const exec: NpmExec = async (args, cwd) => {
    calls.push(args);
    if (args[1] === "fix") {
      fs.writeFileSync(path.join(cwd, "package-lock.json"), patched);
      fixed = true;
    }
    if (args[1] === "--json") return { stdout: JSON.stringify(fixed ? clean : report), stderr: "", code: fixed ? 0 : 1 };
    return { stdout: "", stderr: "", code: 0 };
  };
  return { exec, calls };
}

const dirs: string[] = [];
function repo(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "boswell-checks-test-"));
  dirs.push(dir);
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), content);
  }
  return dir;
}
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const packageJson = JSON.stringify({ name: "app", dependencies: { zod: "^4.0.0" } });

describe("runRepoChecks", () => {
  it("triages vulnerabilities and returns a sound patched lockfile as a dependency fix", async () => {
    const { exec } = fakeNpm(lock("4.1.0"));
    const dir = repo({ "package.json": packageJson, "package-lock.json": lock("4.0.0"), "src/a.ts": 'import { z } from "zod";' });
    const result = await runRepoChecks(dir, { exec });

    expect(result.findings.find((f) => f.title === "Vulnerable dependency: zod@4.0.0")?.recommendation).toContain("fix PR applies this");
    expect(result.dependencyFixes).toHaveLength(1);
    expect(result.dependencyFixes[0]).toMatchObject({
      lockfilePath: "package-lock.json",
      changes: [{ name: "zod", from: "4.0.0", to: "4.1.0" }],
      patchedPackageJson: null,
    });
  });

  it("discards a patch that no longer matches package.json instead of offering it as a PR", async () => {
    const broken = JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: {} } } });
    const { exec } = fakeNpm(broken);
    const dir = repo({ "package.json": packageJson, "package-lock.json": lock("4.0.0") });
    const result = await runRepoChecks(dir, { exec });
    expect(result.dependencyFixes).toEqual([]);
    expect(result.findings.find((f) => f.title.startsWith("Vulnerable dependency"))?.recommendation).not.toContain("fix PR");
  });

  it("audits workspace roots but never patches them in isolation", async () => {
    const { exec, calls } = fakeNpm(lock("4.1.0"));
    const dir = repo({ "package.json": JSON.stringify({ name: "mono", workspaces: ["packages/*"], dependencies: { zod: "^4.0.0" } }), "package-lock.json": lock("4.0.0") });
    const result = await runRepoChecks(dir, { exec });
    expect(calls.some((args) => args[1] === "fix")).toBe(false);
    expect(result.dependencyFixes).toEqual([]);
    expect(result.findings.some((f) => f.title.startsWith("Vulnerable dependency"))).toBe(true);
  });

  it("can skip npm entirely and still run the file checks", async () => {
    const { calls, exec } = fakeNpm(lock("4.1.0"));
    const dir = repo({ "package.json": packageJson, "package-lock.json": lock("4.0.0"), "lib/x.ts": "process.env.SECRET_A; process.env.SECRET_B; process.env.SECRET_C;" });
    const result = await runRepoChecks(dir, { exec, dependencyAudit: false });
    expect(calls).toEqual([]);
    expect(result.findings.map((f) => f.title)).toContain("No .env.example: 3 environment variables are undocumented");
  });

  it("leaves dependency coverage unverified when requirements.txt has unpinned entries", async () => {
    const fetchJson = async () => ({ results: [{}] });
    const gitLog = async () => "";
    const pinned = repo({ "requirements.txt": "requests==2.32.5\n" });
    expect((await runRepoChecks(pinned, { fetchJson, gitLog })).summary.coverage.dependencies).toBe("checked");

    const partial = repo({ "requirements.txt": "requests==2.32.5\nDjango>=3.2\n" });
    const result = await runRepoChecks(partial, { fetchJson, gitLog });
    expect(result.summary.coverage.dependencies).toBe("unverifiable");
    expect(result.findings.find((f) => f.ruleId === "deps.audit-unavailable")?.description).toContain("Django>=3.2");

    const unpinnedOnly = repo({ "requirements.txt": "flask\n" });
    expect((await runRepoChecks(unpinnedOnly, { fetchJson, gitLog })).summary.coverage.dependencies).toBe("unverifiable");
  });

  it("reports a finding once when a monorepo carries two copies of the schema", async () => {
    const schema = "model User {\n  id String @id\n  password String\n}\n";
    const dir = repo({
      "prisma/schema.prisma": schema,
      "apps/web/prisma/schema.prisma": schema,
      "apps/web/app/api/me/route.ts": "export async function GET() { const u = await prisma.user.findUnique({ where: { id } }); return Response.json(u); }",
    });
    const result = await runRepoChecks(dir, { dependencyAudit: false, gitLog: async () => "" });
    expect(result.findings.filter((f) => f.ruleId === "secrets.row-exposure")).toHaveLength(1);
  });
});
