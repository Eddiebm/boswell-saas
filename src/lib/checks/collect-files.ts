import fs from "node:fs";
import path from "node:path";
import type { RepoFile } from "@/lib/checks/types";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "out", "coverage", "vendor", ".turbo", ".vercel", ".boswell",
]);
const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".prisma", ".css", ".yml", ".yaml", ".sql", ".rules", ".html", ".mdx"]);
const NAMED_FILES = new Set([
  "package.json", "package-lock.json", "README.md", "fly.toml", "vercel.json", "netlify.toml", "database.rules.json",
  ".env.example", ".env.sample", ".env.template", ".env.local.example", ".env.development.example",
  ".env", ".env.local", ".env.production", ".env.production.local", ".env.development", ".env.development.local",
]);
const MAX_FILES = 3000;
const MAX_BYTES = 512 * 1024;

/** Every source/config file the checks need, read once. Bounded so a huge repo can't stall the worker. */
export function collectRepoFiles(repoDir: string): RepoFile[] {
  const out: RepoFile[] = [];

  function walk(dir: string) {
    if (out.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTS.has(path.extname(entry.name)) && !NAMED_FILES.has(entry.name)) continue;
      try {
        if (fs.statSync(full).size > MAX_BYTES && entry.name !== "package-lock.json") continue;
        out.push({ path: path.relative(repoDir, full), content: fs.readFileSync(full, "utf8") });
      } catch {
        /* unreadable file — skip */
      }
    }
  }

  walk(repoDir);
  return out;
}

const TEST_PATH = /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)(__tests__|__mocks__|tests?|e2e|fixtures)\/)/;

export function isTestFile(file: RepoFile): boolean {
  return TEST_PATH.test(file.path);
}

export function isSourceFile(file: RepoFile): boolean {
  return /\.[cm]?[jt]sx?$/.test(file.path) && !TEST_PATH.test(file.path);
}

export function isEnvExample(file: RepoFile): boolean {
  return /(^|\/)\.env\.[\w.]*(example|sample|template)$/.test(file.path);
}

/** Server-side code: route handlers, server actions, and anything not marked as client code. */
export function isServerFile(file: RepoFile): boolean {
  if (!isSourceFile(file)) return false;
  if (/^\s*["']use client["']/m.test(file.content.slice(0, 200))) return false;
  return true;
}

export function isRouteHandler(file: RepoFile): boolean {
  return (
    /(^|\/)app\/.*\/route\.[jt]sx?$/.test(file.path) ||
    /(^|\/)pages\/api\//.test(file.path) ||
    /^\s*["']use server["']/m.test(file.content.slice(0, 200))
  );
}
