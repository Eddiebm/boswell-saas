import { describe, expect, it } from "vitest";
import { assessChange, checkChangeSafety } from "@/lib/checks/change-safety";
import type { RepoFile } from "@/lib/checks/types";

const file = (path: string, content = "export {};\n"): RepoFile => ({ path, content });
const sources = (n: number) => Array.from({ length: n }, (_, i) => file(`src/lib/m${i}.ts`));
const pkg = (scripts: Record<string, string>) => file("package.json", JSON.stringify({ scripts }));
const ids = (files: RepoFile[]) => checkChangeSafety(files).map((f) => `${f.ruleId}:${f.severity}`);

describe("no tests", () => {
  it("flags a repo with source and no tests, higher when it has API routes", () => {
    expect(ids([pkg({ build: "next build" }), ...sources(12)])).toEqual(["habits.no-tests:LOW"]);
    expect(ids([pkg({ build: "next build" }), ...sources(12), file("src/app/api/x/route.ts")])).toEqual(["habits.no-tests:MEDIUM"]);
  });

  it("treats npm's placeholder test script as no tests", () => {
    expect(ids([pkg({ test: 'echo "Error: no test specified" && exit 1' }), ...sources(12)])).toEqual(["habits.no-tests:LOW"]);
  });

  it("stays quiet for tiny repos and repos that have tests", () => {
    expect(ids([pkg({}), ...sources(5)])).toEqual([]);
    const withTests = [pkg({ test: "vitest" }), file(".github/workflows/ci.yml", "steps:\n  - run: npm test\n"), ...sources(12), file("src/lib/m0.test.ts")];
    expect(ids(withTests)).toEqual([]);
  });
});

describe("tests that nothing runs", () => {
  const base = [...sources(12), file("src/lib/m0.test.ts")];

  it("flags tests with no CI at all", () => {
    const [f] = checkChangeSafety([pkg({ test: "vitest" }), ...base]);
    expect(f.ruleId).toBe("habits.tests-not-run");
    expect(f.title).toContain("nothing runs them");
  });

  it("flags CI that never runs them", () => {
    const [f] = checkChangeSafety([pkg({ test: "vitest" }), file(".github/workflows/ci.yml", "steps:\n  - run: npm run build\n"), ...base]);
    expect(f.title).toBe("CI never runs the tests");
    expect(f.filePath).toBe(".github/workflows/ci.yml");
  });

  it("accepts CI that runs them, or a build script that does", () => {
    expect(ids([pkg({ test: "vitest" }), file(".github/workflows/ci.yml", "steps:\n  - run: pnpm test\n"), ...base])).toEqual([]);
    expect(ids([pkg({ test: "vitest", build: "vitest run && next build" }), ...base])).toEqual([]);
  });

  it("follows scripts that call other scripts, from CI or from a build hook", () => {
    const viaCi = [pkg({ test: "vitest", verify: "npm run lint && npm run test:unit", "test:unit": "vitest run" }), file(".github/workflows/ci.yml", "steps:\n  - run: npm run verify\n"), ...base];
    expect(ids(viaCi)).toEqual([]);
    const viaBuild = [pkg({ test: "vitest", build: "npm run check && next build", check: "tsc && vitest run" }), ...base];
    expect(ids(viaBuild)).toEqual([]);
  });

  it("ignores scripts nothing runs, such as an unused test:watch", () => {
    const files = [pkg({ test: "vitest run", "test:watch": "vitest", build: "next build" }), file(".github/workflows/ci.yml", "steps:\n  - run: npm run build\n"), ...base];
    const [f] = checkChangeSafety(files);
    expect(f.title).toBe("CI never runs the tests");
  });

  it("doesn't read `npm ci` (an install) as running a script called ci, or credit scripts named verify or ci that nobody calls", () => {
    const files = [pkg({ test: "vitest", ci: "vitest run", verify: "vitest run" }), file(".github/workflows/ci.yml", "steps:\n  - run: npm ci\n  - run: npm run build\n"), ...base];
    expect(checkChangeSafety(files)[0].title).toBe("CI never runs the tests");
  });
});

describe("payment, login and admin routes without a test", () => {
  const tests = ["a", "b", "c"].map((n) => file(`src/lib/${n}.test.ts`, "it('works', () => {});"));
  const webhook = file("src/app/api/stripe/webhook/route.ts", "export async function POST() {}\n");

  it("lists critical routes no test mentions", () => {
    const found = checkChangeSafety([pkg({ test: "vitest" }), file(".github/workflows/ci.yml", "run: npm test"), ...sources(8), ...tests, webhook, file("src/app/api/photos/route.ts")]);
    const [f] = found.filter((x) => x.ruleId === "habits.untested-critical");
    expect(f.description).toContain("src/app/api/stripe/webhook/route.ts");
    expect(f.description).not.toContain("photos");
    expect(f.severity).toBe("MEDIUM");
  });

  it("clears the route once a test names it", () => {
    const named = file("src/lib/stripe.test.ts", "// POST /api/stripe/webhook rejects a bad signature");
    const found = checkChangeSafety([pkg({ test: "vitest" }), file(".github/workflows/ci.yml", "run: npm test"), ...sources(8), ...tests, named, webhook]);
    expect(found.filter((x) => x.ruleId === "habits.untested-critical")).toEqual([]);
  });
});

describe("assessChange (pull request note)", () => {
  const changed = (filename: string, additions = 10, deletions = 0) => ({ filename, additions, deletions });

  it("says nothing about a small change that comes with a test", () => {
    expect(assessChange([changed("src/lib/a.ts"), changed("src/lib/a.test.ts")])).toBeNull();
  });

  it("notes a large change with no test", () => {
    const risk = assessChange([changed("src/lib/a.ts", 60, 5)]);
    expect(risk?.notes[0]).toContain("65 lines of code changed and no test changed");
  });

  it("notes payment or login code changed without a test, even when small", () => {
    const risk = assessChange([changed("src/app/api/stripe/webhook/route.ts", 3, 1)]);
    expect(risk?.notes).toEqual(["Changes payment, login or admin code and no test changed."]);
  });

  it("notes a change spread across many areas, and a very large one", () => {
    const wide = ["src/app/a", "src/lib/b", "src/components/c", "src/hooks/d", "scripts/e", "docs/f.ts", "prisma/g"].map((d) => changed(`${d}/x.ts`, 2));
    const risk = assessChange([...wide, changed("src/lib/a.test.ts")]);
    expect(risk?.areas).toBe(7);
    expect(risk?.notes.join(" ")).toContain("Spread across 7 areas");
    const huge = assessChange(Array.from({ length: 26 }, (_, i) => changed(`src/lib/f${i}.ts`, 2)).concat([changed("src/lib/f0.test.ts")]));
    expect(huge?.notes.join(" ")).toContain("A large change: 26 code files");
  });

  it("ignores lockfiles, docs and generated files", () => {
    expect(assessChange([changed("package-lock.json", 5000, 4000), changed("README.md", 80)])).toBeNull();
    expect(assessChange([changed("src/generated/api.ts", 900)])).toBeNull();
  });
});
