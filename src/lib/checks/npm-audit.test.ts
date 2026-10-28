import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyPinBumps,
  bumpSpec,
  diffLockfiles,
  gitBlobSha,
  planPinBumps,
  runIsolatedNpmAudit,
  summarizeBlockers,
  triageAudit,
  type NpmAuditReport,
  type NpmExec,
} from "@/lib/checks/npm-audit";

const lockfile = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": { dependencies: { next: "15.5.2", resend: "^4.0.0" }, devDependencies: { eslint: "^9.0.0" } },
    "node_modules/next": { version: "15.5.2", dependencies: { postcss: "8.4.31" } },
    "node_modules/postcss": { version: "8.4.31" },
    "node_modules/resend": { version: "4.0.0", dependencies: { "@react-email/render": "^1.0.0" } },
    "node_modules/@react-email/render": { version: "1.0.0", dependencies: { prismjs: "^1.0.0" } },
    "node_modules/prismjs": { version: "1.29.0" },
    "node_modules/eslint": { version: "9.0.0", dev: true, dependencies: { "brace-expansion": "^2.0.0" } },
    "node_modules/brace-expansion": { version: "2.0.1", dev: true },
  },
});

const advisory = (title: string, severity = "high") => ({ title, url: `https://github.com/advisories/${title}`, severity });

const report: NpmAuditReport = {
  vulnerabilities: {
    next: { name: "next", severity: "critical", via: [advisory("Middleware bypass", "critical"), "postcss"], effects: [], nodes: ["node_modules/next"], fixAvailable: { name: "next", version: "15.5.9", isSemVerMajor: false } },
    postcss: { name: "postcss", severity: "high", via: [advisory("XSS in stringify")], effects: ["next"], nodes: ["node_modules/postcss"], fixAvailable: { name: "next", version: "16.1.0", isSemVerMajor: true } },
    prismjs: { name: "prismjs", severity: "moderate", via: [advisory("DOM clobbering", "moderate")], effects: ["@react-email/render"], nodes: ["node_modules/prismjs"], fixAvailable: { name: "resend", version: "6.0.0", isSemVerMajor: true } },
    "@react-email/render": { name: "@react-email/render", severity: "moderate", via: ["prismjs"], effects: ["resend"], nodes: ["node_modules/@react-email/render"], fixAvailable: { name: "resend", version: "6.0.0", isSemVerMajor: true } },
    "brace-expansion": { name: "brace-expansion", severity: "high", via: [advisory("ReDoS")], effects: [], nodes: ["node_modules/brace-expansion"], fixAvailable: true },
  },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 2, high: 2, critical: 1, total: 5 } },
};

describe("triageAudit", () => {
  const findings = triageAudit({ report, lockfile, lockfilePath: "package-lock.json" });
  const byPkg = (name: string) => findings.find((f) => f.title.includes(`${name}@`));

  it("emits one finding per package with advisories, not for packages only flagged via a dependency", () => {
    expect(findings.map((f) => f.title)).toEqual([
      "Vulnerable dependency: next@15.5.2",
      "Vulnerable dependency: postcss@8.4.31",
      "Vulnerable dependency: prismjs@1.29.0",
      "Vulnerable dependency: brace-expansion@2.0.1",
    ]);
  });

  it("traces transitive packages to the top-level dependency that brings them in", () => {
    expect(byPkg("prismjs")?.description).toContain("Comes in through: `resend`");
    expect(byPkg("next")?.description).toContain("You depend on it directly.");
  });

  it("steps severity down one level for dev-only packages and says so", () => {
    const brace = byPkg("brace-expansion")!;
    expect(brace.severity).toBe("MEDIUM");
    expect(brace.description).toContain("development/build-time only");
    expect(byPkg("postcss")?.severity).toBe("HIGH");
  });

  it("explains a fix blocked by a parent that needs a major upgrade", () => {
    expect(byPkg("postcss")?.recommendation).toContain("Blocked by `next`");
    expect(byPkg("prismjs")?.recommendation).toContain("upgrading `resend` to 6.0.0");
  });

  it("only claims the fix PR covers a finding when the patched lockfile's audit proves it", () => {
    const afterFix: NpmAuditReport = { vulnerabilities: { postcss: report.vulnerabilities!.postcss, prismjs: report.vulnerabilities!.prismjs } };
    const withPr = triageAudit({ report, lockfile, lockfilePath: "package-lock.json", afterFix });
    expect(withPr.find((f) => f.title.includes("next@"))?.recommendation).toContain("dependency fix PR applies this");
    expect(withPr.find((f) => f.title.includes("postcss@"))?.recommendation).not.toContain("fix PR applies this");
    expect(findings.every((f) => !f.recommendation?.includes("fix PR applies this"))).toBe(true);
  });

  it("doesn't call a suggested downgrade an upgrade", () => {
    const downgrade: NpmAuditReport = {
      vulnerabilities: { "brace-expansion": { ...report.vulnerabilities!["brace-expansion"], fixAvailable: { name: "eslint", version: "8.0.0", isSemVerMajor: true } } },
    };
    const [finding] = triageAudit({ report: downgrade, lockfile, lockfilePath: "package-lock.json" });
    expect(finding.recommendation).toContain("No real fix yet");
    expect(summarizeBlockers({ report: downgrade, lockfile, packageJsonPath: "package.json" })).toEqual([]);
  });
});

describe("summarizeBlockers", () => {
  it("names the pinned parent blocking the remaining fixes, once per parent", () => {
    const blockers = summarizeBlockers({ report, lockfile, packageJsonPath: "package.json" });
    expect(blockers.map((b) => b.title)).toEqual([
      "Upgrading `next` to 16.1.0 is blocking 1 security fix",
      "Upgrading `resend` to 6.0.0 is blocking 1 security fix",
    ]);
    expect(blockers[0].severity).toBe("MEDIUM");
  });
});

describe("pin bumps", () => {
  it("raises plain version pins, keeping their prefix, and leaves ranges it can't reason about alone", () => {
    expect(bumpSpec("15.5.2", "15.5.9")).toBe("15.5.9");
    expect(bumpSpec("^15.5.2", "15.5.9")).toBe("^15.5.9");
    expect(bumpSpec("~1.2.0", "1.2.4")).toBe("~1.2.4");
    expect(bumpSpec("15.5.9", "15.5.2")).toBeNull();
    expect(bumpSpec(">=1 <2", "1.5.0")).toBeNull();
    expect(bumpSpec("latest", "1.5.0")).toBeNull();
    expect(bumpSpec("github:user/repo", "1.5.0")).toBeNull();
  });

  it("plans bumps only for non-major fixes of direct dependencies and rewrites only those specs", () => {
    const packageJson = `{\n    "name": "app",\n    "dependencies": {\n        "next": "15.5.2",\n        "resend": "^4.0.0"\n    }\n}\n`;
    const bumps = planPinBumps(packageJson, report);
    expect(bumps).toEqual([{ name: "next", field: "dependencies", from: "15.5.2", to: "15.5.9" }]);
    const patched = applyPinBumps(packageJson, bumps);
    expect(patched).toBe(packageJson.replace('"next": "15.5.2"', '"next": "15.5.9"'));
  });
});

describe("diffLockfiles", () => {
  it("lists updated, added and removed packages", () => {
    const after = JSON.parse(lockfile);
    after.packages["node_modules/next"].version = "15.5.9";
    delete after.packages["node_modules/prismjs"];
    after.packages["node_modules/@babel/core"] = { version: "7.29.0" };
    expect(diffLockfiles(lockfile, JSON.stringify(after))).toEqual([
      { name: "@babel/core", from: null, to: "7.29.0" },
      { name: "next", from: "15.5.2", to: "15.5.9" },
      { name: "prismjs", from: "1.29.0", to: null },
    ]);
  });
});

describe("gitBlobSha", () => {
  it("matches git hash-object", () => {
    expect(gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
  });
});

describe("runIsolatedNpmAudit", () => {
  function fakeNpm(patched?: string) {
    const calls: Array<{ args: string[]; cwd: string; env: Record<string, string | undefined>; files: string[] }> = [];
    const exec: NpmExec = async (args, cwd, env) => {
      calls.push({ args, cwd, env, files: fs.readdirSync(cwd).sort() });
      if (args[0] === "audit" && args[1] === "fix" && patched) fs.writeFileSync(path.join(cwd, "package-lock.json"), patched);
      if (args[0] === "audit" && args[1] === "--json") return { stdout: JSON.stringify(report), stderr: "", code: 1 };
      return { stdout: "", stderr: "", code: 0 };
    };
    return { calls, exec };
  }

  it("runs npm only on copies of package.json and package-lock.json, with scripts off and secrets withheld", async () => {
    process.env.DATABASE_URL = "postgres://secret";
    process.env.GITHUB_TOKEN = "ghp_secret";
    const { calls, exec } = fakeNpm();
    const result = await runIsolatedNpmAudit({ packageJson: '{"name":"app"}', lockfile, fix: true }, exec);
    delete process.env.DATABASE_URL;
    delete process.env.GITHUB_TOKEN;

    expect(result.ok).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.files).toEqual(["package-lock.json", "package.json"]);
      expect(call.args).toContain("--package-lock-only");
      expect(call.args).toContain("--ignore-scripts");
      expect(call.args).toContain("--registry=https://registry.npmjs.org/");
      expect(call.env.DATABASE_URL).toBeUndefined();
      expect(call.env.GITHUB_TOKEN).toBeUndefined();
      expect(call.env.HOME).toBe(call.cwd);
    }
    expect(fs.existsSync(calls[0].cwd)).toBe(false);
  });

  it("returns the patched lockfile when audit fix changes it", async () => {
    const patched = lockfile.replace('"version":"15.5.2"', '"version":"15.5.9"');
    const { exec } = fakeNpm(patched);
    const result = await runIsolatedNpmAudit({ packageJson: '{"name":"app","dependencies":{"next":"^15.5.2"}}', lockfile, fix: true }, exec);
    expect(result.ok && result.patchedLockfile).toBe(patched);
  });

  it("fails cleanly when npm's output isn't an audit report", async () => {
    const exec: NpmExec = async () => ({ stdout: "", stderr: "npm error network ETIMEDOUT", code: 1 });
    const result = await runIsolatedNpmAudit({ packageJson: "{}", lockfile, fix: false }, exec);
    expect(result).toEqual({ ok: false, error: "npm error network ETIMEDOUT" });
  });
});
