import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectRepoFiles,
  isEnvExample,
  isRouteHandler,
  isServerFile,
  isSourceFile,
  isTestFile,
} from "@/lib/checks/collect-files";

const file = (p: string, content = "") => ({ path: p, content });

describe("collectRepoFiles", () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-files-"));
    const put = (rel: string, content = "x") => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    };
    put("src/app/page.tsx", "export default function Page() {}");
    put("src/lib/db.sql");
    put("package.json", "{}");
    put(".env.example", "KEY=");
    put("README.md", "# hi");
    put("notes.md", "not collected");
    put("logo.png", "binary");
    put("node_modules/pkg/index.js");
    put(".next/server/page.js");
    put("dist/bundle.js");
    put("src/huge.ts", "x".repeat(512 * 1024 + 1));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads source and named config files, relative to the repo root", () => {
    const files = collectRepoFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual([".env.example", "README.md", "package.json", "src/app/page.tsx", "src/lib/db.sql"]);
    expect(files.find((f) => f.path === "src/app/page.tsx")?.content).toBe("export default function Page() {}");
  });

  it("returns nothing for a directory that can't be read", () => {
    expect(collectRepoFiles(path.join(dir, "missing"))).toEqual([]);
  });
});

describe("file classifiers", () => {
  it("recognises test files by name and by folder", () => {
    expect(isTestFile(file("src/a.test.ts"))).toBe(true);
    expect(isTestFile(file("src/a.spec.mjs"))).toBe(true);
    expect(isTestFile(file("src/__tests__/a.ts"))).toBe(true);
    expect(isTestFile(file("e2e/login.ts"))).toBe(true);
    expect(isTestFile(file("src/latest.ts"))).toBe(false);
  });

  it("counts only non-test JS/TS as source", () => {
    expect(isSourceFile(file("src/a.cjs"))).toBe(true);
    expect(isSourceFile(file("src/a.tsx"))).toBe(true);
    expect(isSourceFile(file("src/a.test.tsx"))).toBe(false);
    expect(isSourceFile(file("src/schema.sql"))).toBe(false);
  });

  it("matches env example files only", () => {
    expect(isEnvExample(file(".env.example"))).toBe(true);
    expect(isEnvExample(file("apps/web/.env.local.example"))).toBe(true);
    expect(isEnvExample(file(".env.template"))).toBe(true);
    expect(isEnvExample(file(".env.local"))).toBe(false);
  });

  it("treats files marked 'use client' as not server code", () => {
    expect(isServerFile(file("src/a.ts", "export const a = 1;"))).toBe(true);
    expect(isServerFile(file("src/b.tsx", '"use client";\nexport function B() {}'))).toBe(false);
    expect(isServerFile(file("src/c.css", "a{}"))).toBe(false);
  });

  it("recognises app routes, pages API routes and server action files", () => {
    expect(isRouteHandler(file("src/app/api/users/route.ts"))).toBe(true);
    expect(isRouteHandler(file("pages/api/users.ts"))).toBe(true);
    expect(isRouteHandler(file("src/actions.ts", "'use server';\nexport async function save() {}"))).toBe(true);
    expect(isRouteHandler(file("src/app/users/page.tsx"))).toBe(false);
  });
});
