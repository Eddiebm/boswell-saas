import { describe, expect, it } from "vitest";
import { checkGitHistorySecrets, parseAddedLines } from "@/lib/checks/git-history";
import { checkLaunchBasics } from "@/lib/checks/launch-basics";
import { auditLockfile, type FetchJson } from "@/lib/checks/lockfile-audit";
import { parseBunLock, parseGemfileLock, parsePipfileLock, parsePnpmLock, parsePoetryLock, parseRequirements, parseYarnLock, type ParsedLockfile } from "@/lib/checks/lockfiles";
import type { RepoFile } from "@/lib/checks/types";

const versions = (m: Map<string, Set<string>>, name: string) => [...(m.get(name) ?? [])].sort();

describe("lockfile parsers", () => {
  it("reads pnpm v6 and v9 lockfiles, ignoring peer suffixes", () => {
    const v6 = "lockfileVersion: '6.0'\n\npackages:\n\n  /next@15.5.2(react@19.0.0):\n    resolution: {}\n  /@babel/core@7.24.0:\n    resolution: {}\n";
    const v9 = "lockfileVersion: '9.0'\n\npackages:\n\n  '@supabase/supabase-js@2.45.0':\n    resolution: {}\n  zod@3.23.8:\n    resolution: {}\n\nsnapshots:\n\n  zod@3.23.8: {}\n";
    expect(versions(parsePnpmLock(v6), "next")).toEqual(["15.5.2"]);
    expect(versions(parsePnpmLock(v6), "@babel/core")).toEqual(["7.24.0"]);
    expect(versions(parsePnpmLock(v9), "@supabase/supabase-js")).toEqual(["2.45.0"]);
    expect(versions(parsePnpmLock(v9), "zod")).toEqual(["3.23.8"]);
  });

  it("reads yarn classic and berry lockfiles, skipping workspaces", () => {
    const classic = '# yarn lockfile v1\n\n"@babel/core@^7.0.0", "@babel/core@^7.24.0":\n  version "7.24.0"\n  resolved "https://..."\n\nlodash@^4.17.15:\n  version "4.17.15"\n';
    const berry = '__metadata:\n  version: 8\n\n"next@npm:^15.0.0":\n  version: 15.5.2\n  resolution: "next@npm:15.5.2"\n\n"app@workspace:.":\n  version: 0.0.0-use.local\n';
    expect(versions(parseYarnLock(classic), "@babel/core")).toEqual(["7.24.0"]);
    expect(versions(parseYarnLock(classic), "lodash")).toEqual(["4.17.15"]);
    expect(versions(parseYarnLock(berry), "next")).toEqual(["15.5.2"]);
    expect(parseYarnLock(berry).has("app")).toBe(false);
  });

  it("reads bun.lock, requirements.txt, poetry.lock, Pipfile.lock and Gemfile.lock", () => {
    expect(versions(parseBunLock('{ "packages": { "next": ["next@15.5.2", "", {}, "sha512-x"], "@types/node": ["@types/node@22.1.0", "", {}, "sha"], } }'), "@types/node")).toEqual(["22.1.0"]);
    const req = parseRequirements("Django==3.2.0  # web\nrequests[socks]==2.25.0\nflask>=2.0\n-e git+https://x\n");
    expect(versions(req, "django")).toEqual(["3.2.0"]);
    expect(versions(req, "requests")).toEqual(["2.25.0"]);
    expect(req.has("flask")).toBe(false);
    expect(versions(parsePoetryLock('[[package]]\nname = "Jinja2"\nversion = "2.11.0"\n\n[[package]]\nname = "pyyaml"\nversion = "5.3"\n'), "jinja2")).toEqual(["2.11.0"]);
    expect(versions(parsePipfileLock('{"default": {"urllib3": {"version": "==1.25.0"}}, "develop": {}}'), "urllib3")).toEqual(["1.25.0"]);
    const gems = parseGemfileLock("GEM\n  remote: https://rubygems.org/\n  specs:\n    rails (7.0.4)\n      actionpack (= 7.0.4)\n    nokogiri (1.13.0-x86_64-linux)\n\nPLATFORMS\n  ruby\n");
    expect(versions(gems, "rails")).toEqual(["7.0.4"]);
    expect(versions(gems, "nokogiri")).toEqual(["1.13.0"]);
    expect(gems.has("actionpack")).toBe(false);
  });
});

const lock = (over: Partial<ParsedLockfile>): ParsedLockfile => ({ path: "pnpm-lock.yaml", kind: "pnpm", ecosystem: "npm", packages: new Map(), ...over });

describe("auditLockfile", () => {
  it("matches npm advisories against the installed versions only", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchJson: FetchJson = async (url, body) => {
      calls.push({ url, body });
      return {
        lodash: [
          { id: 1, title: "Command Injection in lodash", severity: "high", vulnerable_versions: "<4.17.21", url: "https://github.com/advisories/1" },
          { id: 2, title: "Old issue", severity: "critical", vulnerable_versions: "<4.0.0" },
        ],
        next: [{ id: 3, title: "Middleware bypass", severity: "critical", vulnerable_versions: ">=15.0.0 <15.5.9" }],
      };
    };
    const result = await auditLockfile(lock({ packages: new Map([["lodash", new Set(["4.17.15"])], ["next", new Set(["15.5.9"])]]) }), fetchJson);
    expect(calls[0].url).toBe("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk");
    expect(calls[0].body).toEqual({ lodash: ["4.17.15"], next: ["15.5.9"] });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ ruleId: "deps.vulnerable", severity: "HIGH", title: "Vulnerable dependency: lodash@4.17.15" });
    expect(result.findings[0].recommendation).toContain("pnpm update lodash");
    expect(result.findings[0].description).not.toContain("Old issue");
  });

  it("looks up Python and Ruby packages in OSV with severity and fixed version", async () => {
    const fetchJson: FetchJson = async (url) => {
      if (url.endsWith("querybatch")) return { results: [{ vulns: [{ id: "GHSA-aaaa" }] }, {}] };
      return {
        id: "GHSA-aaaa",
        summary: "SQL injection in Django",
        database_specific: { severity: "CRITICAL" },
        affected: [{ package: { name: "django" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "3.2.14" }] }] }],
      };
    };
    const result = await auditLockfile(
      lock({ path: "requirements.txt", kind: "requirements", ecosystem: "PyPI", packages: new Map([["django", new Set(["3.2.0"])], ["flask", new Set(["2.0.0"])]]) }),
      fetchJson,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ severity: "CRITICAL", title: "Vulnerable dependency: django@3.2.0" });
    expect(result.findings[0].recommendation).toContain("3.2.14 or later");
  });

  it("reports a lookup failure instead of a clean result", async () => {
    const result = await auditLockfile(lock({ packages: new Map([["a", new Set(["1.0.0"])]]) }), async () => {
      throw new Error("registry.npmjs.org returned 503");
    });
    expect(result).toEqual({ findings: [], ok: false, error: "registry.npmjs.org returned 503" });
  });
});

const stripeLive = ["sk", "live", "4eC39HqLyjWDarjtT1zdp7dc"].join("_");
const gitLogWith = (key: string) => async () =>
  [
    "commit:aaaaaaa1111111 2026-10-01",
    "diff --git a/lib/pay.ts b/lib/pay.ts",
    "+++ b/lib/pay.ts",
    `+const stripe = new Stripe("${key}");`,
    "commit:bbbbbbb2222222 2026-09-01",
    "+++ b/lib/pay.test.ts",
    `+const fake = "${key}";`,
  ].join("\n");

describe("git history secrets", () => {
  it("parses added lines per commit and file", () => {
    const adds = parseAddedLines("commit:abc 2026-01-01\n+++ b/a.ts\n+one\n-gone\n+two\n+++ /dev/null\n+ignored\n");
    expect(adds).toEqual([{ commit: "abc", date: "2026-01-01", file: "a.ts", text: "one\ntwo\n" }]);
  });

  it("flags a key that was committed and later removed, masked, and skips test files", async () => {
    const findings = await checkGitHistorySecrets("/repo", [{ path: "lib/pay.ts", content: "new Stripe(process.env.STRIPE_SECRET_KEY)" }], gitLogWith(stripeLive));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "secrets.history", severity: "CRITICAL", filePath: "lib/pay.ts" });
    expect(findings[0].description).toContain("aaaaaaa");
    expect(findings[0].description).not.toContain(stripeLive);
  });

  it("doesn't repeat a key that's still in the code (the current-code scan reports it)", async () => {
    const files: RepoFile[] = [{ path: "lib/pay.ts", content: `new Stripe("${stripeLive}")` }];
    expect(await checkGitHistorySecrets("/repo", files, gitLogWith(stripeLive))).toEqual([]);
  });
});

const file = (path: string, content: string): RepoFile => ({ path, content });
const pkg = (deps: Record<string, string>) => file("package.json", JSON.stringify({ name: "app", dependencies: deps }));

describe("launch requirements by app type", () => {
  it("asks for terms when taking payments, and consent when setting tracking cookies", () => {
    const { findings, facts } = checkLaunchBasics([
      pkg({ next: "16", stripe: "18", "@sentry/nextjs": "10" }),
      file("app/layout.tsx", '<Script src="https://www.googletagmanager.com/gtag/js?id=G-1" />'),
      file("app/privacy/page.tsx", "Privacy Policy"),
      file("next.config.ts", "headers() { X-Frame-Options }"),
    ]);
    expect(facts.setsTrackingCookies).toBe(true);
    expect(findings.map((f) => f.ruleId)).toEqual(["legal.no-terms", "legal.no-cookie-consent"]);
  });

  it("is satisfied by a terms page and a consent banner", () => {
    const { findings } = checkLaunchBasics([
      pkg({ next: "16", stripe: "18", "@sentry/nextjs": "10", "vanilla-cookieconsent": "3", "posthog-js": "1" }),
      file("app/terms/page.tsx", "export default () => <h1>Terms of Service</h1>"),
      file("app/privacy/page.tsx", "Privacy Policy"),
      file("next.config.ts", "headers() { X-Frame-Options }"),
    ]);
    expect(findings).toEqual([]);
  });

  it("recognises health data from schema names, not prose", () => {
    const schema = file("src/db/schema.ts", 'export const patients = pgTable("patients", {}); export const prescriptions = pgTable("prescriptions", {});');
    const { findings, facts } = checkLaunchBasics([pkg({ next: "16", "@sentry/nextjs": "10" }), schema, file("next.config.ts", "X-Frame-Options")]);
    expect(facts.handlesHealthData).toBe(true);
    expect(findings.map((f) => f.ruleId)).toContain("compliance.health-data");
    const prose = checkLaunchBasics([pkg({ next: "16" }), file("app/page.tsx", "Built for patients and their prescriptions")]);
    expect(prose.facts.handlesHealthData).toBe(false);
  });
});
