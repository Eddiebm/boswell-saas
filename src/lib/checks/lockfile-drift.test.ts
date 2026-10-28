import { describe, expect, it } from "vitest";
import { checkLockfileDrift } from "@/lib/checks/lockfile-drift";

const pkg = (deps: Record<string, string>, dev: Record<string, string> = {}) =>
  JSON.stringify({ name: "app", dependencies: deps, devDependencies: dev });

const lock = (deps: Record<string, string>, resolved: string[] = Object.keys(deps)) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "app", dependencies: deps },
      ...Object.fromEntries(resolved.map((n) => [`node_modules/${n}`, { version: "1.0.0" }])),
    },
  });

describe("checkLockfileDrift", () => {
  it("reports nothing when package.json and the lockfile agree", () => {
    expect(checkLockfileDrift({ dir: "", packageJson: pkg({ next: "^15.0.0" }), lockfile: lock({ next: "^15.0.0" }), otherLockfiles: [] })).toEqual([]);
  });

  it("reports a dependency added to package.json but never locked (npm ci would fail)", () => {
    const [finding] = checkLockfileDrift({
      dir: "",
      packageJson: pkg({ next: "^15.0.0", "@sentry/nextjs": "^10.0.0" }),
      lockfile: lock({ next: "^15.0.0" }),
      otherLockfiles: [],
    });
    expect(finding.severity).toBe("MEDIUM");
    expect(finding.title).toContain("out of sync");
    expect(finding.description).toContain("`@sentry/nextjs` is in package.json but missing from the lockfile");
    expect(finding.filePath).toBe("package-lock.json");
  });

  it("reports changed specs, removed packages, and unresolved entries", () => {
    const [finding] = checkLockfileDrift({
      dir: "apps/web",
      packageJson: pkg({ next: "^16.0.0", zod: "^4.0.0" }),
      lockfile: lock({ next: "^15.0.0", zod: "^4.0.0", lodash: "^4.0.0" }, ["next", "lodash"]),
      otherLockfiles: [],
    });
    expect(finding.description).toContain("`next` is `^16.0.0` in package.json but `^15.0.0` in the lockfile");
    expect(finding.description).toContain("`zod` has no resolved version");
    expect(finding.description).toContain("`lodash` is in the lockfile but was removed");
    expect(finding.filePath).toBe("apps/web/package-lock.json");
  });

  it("flags a missing lockfile only when no other package manager's lockfile exists", () => {
    expect(checkLockfileDrift({ dir: "", packageJson: pkg({ next: "1" }), lockfile: null, otherLockfiles: ["pnpm-lock.yaml"] })).toEqual([]);
    const [finding] = checkLockfileDrift({ dir: "", packageJson: pkg({ next: "1" }), lockfile: null, otherLockfiles: [] });
    expect(finding.severity).toBe("LOW");
  });

  it("reports an unparseable lockfile (usually committed merge conflict markers)", () => {
    const [finding] = checkLockfileDrift({ dir: "", packageJson: pkg({ next: "1" }), lockfile: "<<<<<<< HEAD\n{", otherLockfiles: [] });
    expect(finding.title).toContain("not valid JSON");
  });
});
