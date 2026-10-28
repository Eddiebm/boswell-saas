import fs from "node:fs";
import path from "node:path";

/**
 * Lockfiles other than package-lock.json (which has its own npm-based path),
 * parsed into installed name → versions. Only reads text; no package
 * manager runs.
 */

export type Ecosystem = "npm" | "PyPI" | "RubyGems";
export type LockfileKind = "pnpm" | "yarn" | "bun" | "requirements" | "poetry" | "pipfile" | "gemfile";
export type ParsedLockfile = { path: string; kind: LockfileKind; ecosystem: Ecosystem; packages: Map<string, Set<string>> };

const FILES: Record<string, { kind: LockfileKind; ecosystem: Ecosystem }> = {
  "pnpm-lock.yaml": { kind: "pnpm", ecosystem: "npm" },
  "yarn.lock": { kind: "yarn", ecosystem: "npm" },
  "bun.lock": { kind: "bun", ecosystem: "npm" },
  "requirements.txt": { kind: "requirements", ecosystem: "PyPI" },
  "poetry.lock": { kind: "poetry", ecosystem: "PyPI" },
  "Pipfile.lock": { kind: "pipfile", ecosystem: "PyPI" },
  "Gemfile.lock": { kind: "gemfile", ecosystem: "RubyGems" },
};
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "vendor", ".venv", "venv", "__pycache__", "coverage", ".turbo"]);
const NOT_A_PROJECT = /(^|\/)(examples?|fixtures?|__tests__|tests?|templates?|demo)\//;
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_LOCKFILES = 10;

function add(map: Map<string, Set<string>>, name: string, version: string) {
  if (!name || !/^\d/.test(version)) return;
  if (!map.has(name)) map.set(name, new Set());
  map.get(name)!.add(version);
}

/** `@scope/name@1.2.3` / `name@npm:^1` → `@scope/name`. */
function nameOfSpec(spec: string): string {
  const s = spec.replace(/^["']|["']$/g, "");
  return s.startsWith("@") ? `@${s.slice(1).split("@")[0]}` : s.split("@")[0];
}

export function parsePnpmLock(text: string) {
  const map = new Map<string, Set<string>>();
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) inPackages = /^(?:packages|snapshots):/.test(line);
    if (!inPackages) continue;
    // v6: `  /name@1.2.3(peer@x):`  v5: `  /name/1.2.3:`  v9: `  name@1.2.3:` (optionally quoted)
    const m = /^ {2}['"]?\/?((?:@[^/\s'"]+\/)?[^@/\s'"(]+)[@/](\d[^:('"\s]*)/.exec(line);
    if (m) add(map, m[1], m[2]);
  }
  return map;
}

export function parseYarnLock(text: string) {
  const map = new Map<string, Set<string>>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    if (/^\S.*:\s*$/.test(line) && !line.startsWith("#") && !line.startsWith("__metadata")) {
      const first = line.replace(/:\s*$/, "").split(",")[0].trim();
      current = /@(?:workspace|link|portal|file|patch):/.test(first) ? null : nameOfSpec(first);
      continue;
    }
    const v = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line);
    if (v && current) {
      add(map, current, v[1]);
      current = null;
    }
  }
  return map;
}

export function parseBunLock(text: string) {
  const map = new Map<string, Set<string>>();
  for (const m of text.matchAll(/\[\s*"((?:@[^"/]+\/)?[^"@]+)@(\d[^"]*)"/g)) add(map, m[1], m[2]);
  return map;
}

export function parseRequirements(text: string) {
  const map = new Map<string, Set<string>>();
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([0-9][^\s;,]*)/.exec(line);
    if (m) add(map, m[1].toLowerCase(), m[2]);
  }
  return map;
}

export function parsePoetryLock(text: string) {
  const map = new Map<string, Set<string>>();
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (name && version) add(map, name.toLowerCase(), version);
  }
  return map;
}

export function parsePipfileLock(text: string) {
  const map = new Map<string, Set<string>>();
  try {
    const lock = JSON.parse(text) as Record<string, Record<string, { version?: string }>>;
    for (const section of ["default", "develop"]) {
      for (const [name, info] of Object.entries(lock[section] ?? {})) {
        if (info.version) add(map, name.toLowerCase(), info.version.replace(/^==/, ""));
      }
    }
  } catch {
    /* unreadable — treated as no packages */
  }
  return map;
}

export function parseGemfileLock(text: string) {
  const map = new Map<string, Set<string>>();
  let inSpecs = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) inSpecs = false;
    if (/^\s{2}specs:\s*$/.test(line)) {
      inSpecs = true;
      continue;
    }
    // Direct specs are indented four spaces; their dependencies (six) carry ranges, not versions.
    const m = inSpecs ? /^ {4}([A-Za-z0-9._-]+) \(([0-9][^)-]*)(?:-[^)]*)?\)\s*$/.exec(line) : null;
    if (m) add(map, m[1], m[2]);
  }
  return map;
}

const PARSERS: Record<LockfileKind, (text: string) => Map<string, Set<string>>> = {
  pnpm: parsePnpmLock,
  yarn: parseYarnLock,
  bun: parseBunLock,
  requirements: parseRequirements,
  poetry: parsePoetryLock,
  pipfile: parsePipfileLock,
  gemfile: parseGemfileLock,
};

/**
 * Finds and parses lockfiles on disk (not via collectRepoFiles: lockfiles
 * routinely exceed its per-file size cap). A requirements.txt beside a
 * poetry.lock or Pipfile.lock is skipped as the less precise of the two.
 */
export function findLockfiles(repoDir: string): ParsedLockfile[] {
  const found: ParsedLockfile[] = [];
  function walk(dir: string, depth: number) {
    if (depth > 6 || found.length >= MAX_LOCKFILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoDir, full);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(full, depth + 1);
        continue;
      }
      const spec = FILES[entry.name];
      if (!spec || !entry.isFile() || NOT_A_PROJECT.test(rel)) continue;
      if (spec.kind === "requirements" && (names.has("poetry.lock") || names.has("Pipfile.lock"))) continue;
      try {
        if (fs.statSync(full).size > MAX_BYTES) continue;
        const packages = PARSERS[spec.kind](fs.readFileSync(full, "utf8"));
        if (packages.size) found.push({ path: rel, kind: spec.kind, ecosystem: spec.ecosystem, packages });
      } catch {
        /* unreadable — skip */
      }
      if (found.length >= MAX_LOCKFILES) return;
    }
  }
  walk(repoDir, 0);
  return found;
}
