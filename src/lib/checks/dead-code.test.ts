import { describe, expect, it } from "vitest";
import { checkDeadCode } from "@/lib/checks/dead-code";
import type { RepoFile } from "@/lib/checks/types";

const file = (path: string, content: string): RepoFile => ({ path, content });
const pkg = (extra = "") => file("package.json", `{ "name": "app", "scripts": { "build": "next build"${extra} } }`);

/** A small Next.js app: enough files to be worth judging, all wired together. */
function app(): RepoFile[] {
  const files = [
    pkg(),
    file("src/app/layout.tsx", 'import { Nav } from "@/components/nav";\nexport default function L() { return <Nav />; }\n'),
    file("src/app/page.tsx", 'import { format } from "../lib/format";\nexport default function P() { return <p>{format(1)}</p>; }\n'),
    file("src/app/api/x/route.ts", 'import { db } from "@/lib/db";\nexport async function GET() { return Response.json(await db()); }\n'),
    file("src/components/nav.tsx", "export function Nav() { return <nav />; }\n"),
    file("src/lib/format.ts", "export const format = (n: number) => String(n);\n"),
    file("src/lib/db.ts", 'import { pool } from "./pool";\nexport const db = async () => pool;\n'),
    file("src/lib/pool.ts", "export const pool = [];\n"),
    file("src/lib/barrel/index.ts", 'export * from "./a";\n'),
    file("src/lib/barrel/a.ts", "export const a = 1;\n"),
    file("src/lib/uses-barrel.ts", 'import { a } from "./barrel";\nexport const b = a;\n'),
    file("src/app/page2/page.tsx", 'import { b } from "@/lib/uses-barrel";\nexport default function P() { return <p>{b}</p>; }\n'),
    file("scripts/seed.ts", "console.log('seed');\n"),
    file("next.config.ts", "export default {};\n"),
    file("src/middleware.ts", "export function middleware() {}\n"),
    file("src/lib/tested.ts", "export const t = 1;\n"),
    file("src/lib/tested.test.ts", 'import { t } from "./tested";\n'),
  ];
  return files;
}

describe("dead files", () => {
  it("finds a file nothing imports and leaves framework and tooling files alone", () => {
    const files = [...app(), file("src/components/old-banner.tsx", "export function OldBanner() { return null; }\n")];
    const dead = checkDeadCode(files).filter((f) => f.ruleId === "habits.dead-file");
    expect(dead).toHaveLength(1);
    expect(dead[0].description).toContain("src/components/old-banner.tsx");
    expect(dead[0].description).not.toMatch(/layout\.tsx|route\.ts|middleware|next\.config|seed\.ts|barrel|tested/);
    expect(dead[0].severity).toBe("LOW");
    expect(dead[0].confidence).toBe(0.6);
  });

  it("counts imports through aliases, index files, side effects, dynamic imports and test mocks", () => {
    const files = [
      ...app(),
      file("src/lib/viaalias.ts", "export const v = 1;\n"),
      file("src/lib/lazy.ts", "export const l = 1;\n"),
      file("src/lib/mocked.ts", "export const m = 1;\n"),
      file("src/lib/sideeffect.ts", "console.log('boot');\n"),
      file("src/lib/user.ts", 'import "./sideeffect";\nimport("./lazy");\nimport { v } from "@/lib/viaalias";\nexport const u = v;\n'),
      file("src/lib/user.test.ts", 'vi.mock("./mocked");\nimport { u } from "./user";\n'),
      file("src/app/page3/page.tsx", 'import { u } from "@/lib/user";\nexport default () => u;\n'),
    ];
    expect(checkDeadCode(files).filter((f) => f.ruleId === "habits.dead-file")).toEqual([]);
  });

  it("does not call a file dead when a package script, a workflow or a test names its path", () => {
    const files = [
      file("package.json", '{ "scripts": { "worker": "tsx src/worker/run.ts" } }'),
      ...app().slice(1),
      file("src/worker/run.ts", "export {};\n"),
      file("src/lib/cron.ts", "export {};\n"),
      file(".github/workflows/cron.yml", "jobs:\n  a:\n    steps:\n      - run: npx tsx src/lib/cron.ts\n"),
      file("src/lib/read-me.ts", "export {};\n"),
      file("src/lib/read.test.ts", 'const text = fs.readFileSync("src/lib/read-me.ts", "utf8");\n'),
    ];
    expect(checkDeadCode(files).filter((f) => f.ruleId === "habits.dead-file")).toEqual([]);
  });

  it("lowers confidence when the repo computes import paths", () => {
    const files = [...app(), file("src/components/old.tsx", "export {};\n"), file("src/lib/loader.ts", "export const load = (n: string) => import(`./plugins/${n}`);\n")];
    const dead = checkDeadCode(files).filter((f) => f.ruleId === "habits.dead-file");
    expect(dead[0].confidence).toBe(0.45);
  });

  it("doesn't mistake an example of a computed import, in a string or a comment, for one", () => {
    const files = [...app(), file("src/components/old.tsx", "export {};\n"), file("src/lib/docs.ts", '// import(`./plugins/${n}`)\nexport const tip = "await import(`./x/${name}`)";\n')];
    const dead = checkDeadCode(files).filter((f) => f.ruleId === "habits.dead-file");
    expect(dead[0].confidence).toBe(0.6);
  });

  it("raises severity when there are many", () => {
    const orphans = Array.from({ length: 10 }, (_, i) => file(`src/components/orphan${i}.tsx`, "export {};\n"));
    const dead = checkDeadCode([...app(), ...orphans]).filter((f) => f.ruleId === "habits.dead-file");
    expect(dead[0].severity).toBe("MEDIUM");
  });

  it("stays quiet for monorepos and tiny repos, where imports can't all be seen", () => {
    const orphan = file("src/components/old.tsx", "export {};\n");
    expect(checkDeadCode([...app(), pkg(), file("packages/ui/package.json", "{}"), orphan]).filter((f) => f.ruleId === "habits.dead-file")).toEqual([]);
    expect(checkDeadCode([...app(), file("package.json", '{ "workspaces": ["packages/*"] }'), orphan]).filter((f) => f.ruleId === "habits.dead-file")).toEqual([]);
    expect(checkDeadCode([pkg(), file("src/a.ts", "export {};\n"), orphan]).filter((f) => f.ruleId === "habits.dead-file")).toEqual([]);
  });
});

describe("commented-out code", () => {
  const code = ["const user = await getUser(id);", "if (!user) {", "  return null;", "}", "const plan = user.plan;", "return plan;"].map((l) => `// ${l}`).join("\n");

  it("flags a block of old code kept in comments", () => {
    const [finding] = checkDeadCode([file("src/lib/a.ts", `export const a = 1;\n${code}\nexport const b = 2;\n`)]).filter((f) => f.ruleId === "habits.commented-out-code");
    expect(finding.title).toContain("6 lines");
    expect(finding.lineStart).toBe(2);
    expect(finding.severity).toBe("LOW");
  });

  it("leaves explanations, licences and short notes alone", () => {
    const prose = ["This is where we decide which plan applies.", "The rules come from the billing team and", "change every quarter, so keep them in one place.", "See the pricing page for the current numbers", "before editing anything in this function."].map((l) => `// ${l}`).join("\n");
    const licence = ["Copyright (c) 2024 Someone", "Permission is hereby granted, free of charge,", "to any person obtaining a copy of this software", "and associated documentation files (the Software)", "to deal in the Software without restriction."].map((l) => `// ${l}`).join("\n");
    const short = "// const a = 1;\n// const b = 2;\nexport const c = 3;\n";
    expect(checkDeadCode([file("src/lib/a.ts", `${prose}\n${licence}\n${short}`)]).filter((f) => f.ruleId === "habits.commented-out-code")).toEqual([]);
  });
});

describe("copy-pasted code", () => {
  const block = (name: string) => Array.from({ length: 50 }, (_, i) => `  const ${name}${i} = compute(${i}, "value ${i}", options.${name}${i});`).join("\n");

  it("flags the same block in two files", () => {
    const a = file("src/lib/a.ts", `export function a(options: any) {\n${block("step")}\n}\n`);
    const b = file("src/lib/b.ts", `export function b(options: any) {\n${block("step")}\n}\n`);
    const [finding] = checkDeadCode([a, b]).filter((f) => f.ruleId === "habits.duplicate-code");
    expect(finding.description).toContain("src/lib/a.ts");
    expect(finding.description).toContain("src/lib/b.ts");
    expect(finding.severity).toBe("LOW");
  });

  it("ignores code that only repeats inside one file, and distinct code", () => {
    const twice = file("src/lib/a.ts", `export function a(options: any) {\n${block("step")}\n}\nexport function again(options: any) {\n${block("step")}\n}\n`);
    const other = file("src/lib/b.ts", `export function b(options: any) {\n${block("other")}\n}\n`);
    expect(checkDeadCode([twice, other]).filter((f) => f.ruleId === "habits.duplicate-code")).toEqual([]);
  });

  it("ignores generated files", () => {
    const gen = (n: string) => file(`src/generated/${n}.ts`, `// @generated\n${block("step")}\n`);
    expect(checkDeadCode([gen("a"), gen("b")]).filter((f) => f.ruleId === "habits.duplicate-code")).toEqual([]);
  });
});
