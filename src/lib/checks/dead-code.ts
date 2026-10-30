import path from "node:path";
import { isSourceFile, isTestFile } from "@/lib/checks/collect-files";
import { maskNonCode, stripComments } from "@/lib/checks/source-utils";
import type { CheckFinding, RepoFile } from "@/lib/checks/types";

const MAX_LISTED = 10;
const SCRIPT_EXT = /\.[cm]?[jt]sx?$/;
const NOT_A_PROJECT = /(^|\/)(examples?|fixtures?|__tests__|tests?|templates?|demo)\//;

/** Files something other than an import loads: the framework, the build, a CLI, a test runner. */
const ENTRY_POINT: RegExp[] = [
  /(^|\/)app\/(?:.*\/)?(?:page|layout|route|loading|error|global-error|not-found|template|default|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[cm]?[jt]sx?$/,
  /(^|\/)pages\//,
  /(^|\/)(?:middleware|proxy|instrumentation|instrumentation-client)\.[cm]?[jt]sx?$/,
  /\.config\.[cm]?[jt]s$/,
  /(^|\/)(?:sentry|vitest|jest|playwright|tailwind|postcss|drizzle)[\w.-]*\.[cm]?[jt]s$/,
  /(^|\/)(?:scripts|bin|tools|e2e|tests?|__tests__|__mocks__|fixtures|stories|\.storybook|migrations|seeds?)\//,
  /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/,
  /^(?:src\/)?(?:index|main|server|app|worker|cli)\.[cm]?[jt]sx?$/,
  /^(?:api|functions|netlify\/functions|supabase\/functions)\//,
];

function lineCount(content: string): number {
  return content.split("\n").length;
}

/** Every `./x`, `@/x` and `package` specifier a file imports, requires or loads. */
function specifiersOf(content: string): string[] {
  const code = stripComments(content);
  const out: string[] = [];
  const patterns = [
    /(?:import|export)\s[^;'"`]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\b(?:vi|jest)\.(?:mock|importActual|requireActual)\(\s*["']([^"']+)["']/g,
    /["'](\.{1,2}\/[^"']+)["']\s*,\s*import\.meta\.url/g,
  ];
  for (const re of patterns) for (const m of code.matchAll(re)) out.push(m[1]);
  return out;
}

/** Paths named by package.json (main, bin, scripts) and by CI workflows, which load files without importing them. */
function pathsNamedByTooling(files: RepoFile[]): Set<string> {
  const named = new Set<string>();
  for (const f of files) {
    const base = path.posix.basename(f.path);
    if (base !== "package.json" && !/(^|\/)\.github\/workflows\//.test(f.path) && !/(^|\/)\.gitlab-ci\.ya?ml$/.test(f.path) && base !== "vercel.json") continue;
    for (const m of f.content.matchAll(/[\w./@-]+\.[cm]?[jt]sx?\b/g)) named.add(m[0].replace(/^\.\//, ""));
  }
  return named;
}

/**
 * Source files nothing imports. Conservative on purpose: framework entry
 * points, scripts, tests and anything a package.json script or workflow names
 * are left alone, and a monorepo or a repo with computed imports is reported
 * with lower confidence or skipped, because Boswell can't see all the wiring.
 */
function findDeadFiles(files: RepoFile[]): { dead: RepoFile[]; dynamic: boolean } | null {
  const packages = files.filter((f) => path.posix.basename(f.path) === "package.json" && !NOT_A_PROJECT.test(f.path));
  if (packages.length !== 1 || packages[0].path !== "package.json" || /"workspaces"\s*:/.test(packages[0].content)) return null;

  const sources = files.filter((f) => SCRIPT_EXT.test(f.path) && !/\.d\.ts$/.test(f.path));
  if (sources.length < 15) return null;

  const byNoExt = new Map<string, string[]>();
  for (const f of sources) {
    const noExt = f.path.replace(SCRIPT_EXT, "");
    const keys = [noExt];
    if (/\/index$/.test(noExt)) keys.push(noExt.replace(/\/index$/, ""));
    for (const k of keys) byNoExt.set(k, [...(byNoExt.get(k) ?? []), f.path]);
  }

  let dynamic = false;
  const used = new Set<string>();
  for (const f of sources) {
    // A computed path (a template literal or a variable) hides which file is loaded. Text inside strings and comments doesn't count.
    if (/\bimport\(\s*[`A-Za-z_$]|\brequire\(\s*[`A-Za-z_$]/.test(maskNonCode(f.content))) dynamic = true;
    for (const spec of specifiersOf(f.content)) {
      let targets: string[] = [];
      if (spec.startsWith(".")) {
        const joined = path.posix.normalize(path.posix.join(path.posix.dirname(f.path), spec)).replace(/\.(?:[cm]?js|jsx)$/, "");
        targets = byNoExt.get(joined) ?? byNoExt.get(path.posix.normalize(path.posix.join(path.posix.dirname(f.path), spec))) ?? [];
      } else if (/^(?:@|~|#)\//.test(spec) || spec.startsWith("src/")) {
        const rest = spec.replace(/^(?:@|~|#)\//, "").replace(/^src\//, "");
        for (const [key, paths] of byNoExt) if (key === rest || key.endsWith(`/${rest}`)) targets.push(...paths);
      }
      for (const t of targets) if (t !== f.path) used.add(t);
    }
  }

  const named = pathsNamedByTooling(files);
  const everything = files.map((f) => f.content);
  const dead = sources.filter((f) => {
    if (used.has(f.path) || ENTRY_POINT.some((re) => re.test(f.path))) return false;
    if ([...named].some((n) => f.path === n || f.path.endsWith(`/${n}`) || n.endsWith(`/${f.path}`))) return false;
    // Loaded by a path in a string (a test reading its source, a worker URL): not dead.
    const noExt = f.path.replace(SCRIPT_EXT, "");
    return !files.some((o, i) => o.path !== f.path && everything[i].includes(noExt));
  });
  return { dead, dynamic };
}

const CODE_START = /^(?:const|let|var|function|class|import|export|return|await|throw|if|else|for|while|switch|case|try|catch|async|type|interface)\b/;

function looksLikeCode(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (CODE_START.test(t) || /^[}\])]+[;,]?$/.test(t) || /^<\/?[A-Za-z]/.test(t) || /^[\w$.]+\(.*\);?$/.test(t)) return true;
  return /[;{},]$/.test(t) && /[(){}=.[\]]/.test(t);
}

/** Runs of 5+ consecutive `//` lines that are mostly code. Returns how many lines and where the first run is. */
function commentedOutCode(f: RepoFile): { lines: number; first: number } | null {
  const rows = f.content.split("\n");
  let total = 0;
  let first = 0;
  let i = 0;
  while (i < rows.length) {
    if (!/^\s*\/\/(?!\/)/.test(rows[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && /^\s*\/\/(?!\/)/.test(rows[j])) j++;
    const run = rows.slice(i, j).map((r) => r.replace(/^\s*\/\/\s?/, ""));
    const text = run.join(" ");
    if (run.length >= 5 && !/copyright|license|spdx|eslint-|@ts-|prettier-ignore/i.test(text)) {
      const code = run.filter(looksLikeCode).length;
      if (code / run.length >= 0.6) {
        total += run.length;
        if (!first) first = i + 1;
      }
    }
    i = j;
  }
  return total ? { lines: total, first } : null;
}

/** 53-bit string hash, so a million windows don't produce false matches. */
function hash(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const WINDOW = 10;
const MIN_WINDOW_CHARS = 200;
const MAX_LINES_SCANNED = 200_000;

type Block = { file: string; from: number; to: number; sameAs: { file: string; from: number } };

/** The same ten non-trivial lines in two different files, merged into blocks. */
function duplicatedBlocks(sources: RepoFile[]): { blocks: Block[]; marked: number; total: number } {
  const seen = new Map<number, Array<{ file: string; at: number }>>();
  const perFile = new Map<string, Array<{ text: string; line: number }>>();
  let total = 0;
  for (const f of sources) {
    if (/(^|\/)(generated|__generated__|migrations|drizzle|dist)\//.test(f.path) || /@generated|DO NOT EDIT/.test(f.content.slice(0, 400))) continue;
    const kept: Array<{ text: string; line: number }> = [];
    f.content.split("\n").forEach((raw, idx) => {
      const t = raw.trim().replace(/\s+/g, " ");
      if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || /^[{}()[\];,]+$/.test(t) || /^import\b/.test(t) || /^export\s*\{/.test(t)) return;
      kept.push({ text: t, line: idx + 1 });
    });
    total += kept.length;
    if (total > MAX_LINES_SCANNED) break;
    perFile.set(f.path, kept);
    for (let k = 0; k + WINDOW <= kept.length; k++) {
      const text = kept.slice(k, k + WINDOW).map((l) => l.text).join("\n");
      if (text.length < MIN_WINDOW_CHARS) continue;
      const key = hash(text);
      seen.set(key, [...(seen.get(key) ?? []), { file: f.path, at: k }]);
    }
  }

  const marks = new Map<string, Map<number, { file: string; line: number }>>();
  for (const spots of seen.values()) {
    if (new Set(spots.map((s) => s.file)).size < 2) continue;
    for (const s of spots) {
      const partner = spots.find((o) => o.file !== s.file)!;
      const lines = perFile.get(s.file)!;
      const mine = marks.get(s.file) ?? new Map();
      for (let k = s.at; k < s.at + WINDOW; k++) {
        if (!mine.has(lines[k].line)) mine.set(lines[k].line, { file: partner.file, line: perFile.get(partner.file)![partner.at].line });
      }
      marks.set(s.file, mine);
    }
  }

  const blocks: Block[] = [];
  let marked = 0;
  for (const [file, lines] of marks) {
    const sorted = [...lines.keys()].sort((a, b) => a - b);
    marked += sorted.length;
    let start = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i <= sorted.length; i++) {
      const cur = sorted[i];
      if (cur === undefined || cur - prev > 3) {
        const partner = lines.get(start)!;
        blocks.push({ file, from: start, to: prev, sameAs: { file: partner.file, from: partner.line } });
        start = cur;
      }
      prev = cur;
    }
  }
  return { blocks, marked, total };
}

/**
 * Code that piles up without doing anything, the leftovers that turn a small
 * app into a thousand lines nobody dares touch: files nothing imports, old
 * code kept in comments, and the same block pasted into several files.
 */
export function checkDeadCode(files: RepoFile[]): CheckFinding[] {
  const out: CheckFinding[] = [];
  const sources = files.filter((f) => isSourceFile(f) && !isTestFile(f));

  const found = findDeadFiles(files);
  if (found && found.dead.length) {
    const { dead, dynamic } = found;
    const shown = dead.slice(0, MAX_LISTED);
    const lines = dead.reduce((sum, f) => sum + lineCount(f.content), 0);
    out.push({
      ruleId: "habits.dead-file",
      severity: dead.length >= 10 ? "MEDIUM" : "LOW",
      category: "maintainability",
      title: `${dead.length} source ${dead.length === 1 ? "file is" : "files are"} never imported (${lines} lines)`,
      description: [
        "Nothing in this repo imports these files, and they aren't pages, routes, scripts, tests or config. They're usually left over from an earlier version. Every leftover file is more code to read, and a place where an AI tool can wander off and edit the wrong thing.",
        "",
        ...shown.map((f) => `- ${f.path} (${lineCount(f.content)} lines)`),
        ...(dead.length > shown.length ? [`- …and ${dead.length - shown.length} more`] : []),
        "",
        `Needs review: a file loaded by a name Boswell can't see (a plugin, a config file, a computed import${dynamic ? " — this repo has some" : ""}) would show up here.`,
      ].join("\n"),
      filePath: shown[0].path,
      recommendation: "Delete each file you don't recognise as something that's loaded another way. Git keeps the history, so nothing is lost.",
      confidence: dynamic ? 0.45 : 0.6,
    });
  }

  const commented = sources
    .map((f) => ({ f, hit: commentedOutCode(f) }))
    .filter((x): x is { f: RepoFile; hit: { lines: number; first: number } } => x.hit !== null)
    .sort((a, b) => b.hit.lines - a.hit.lines);
  if (commented.length) {
    const lines = commented.reduce((sum, x) => sum + x.hit.lines, 0);
    const shown = commented.slice(0, MAX_LISTED);
    out.push({
      ruleId: "habits.commented-out-code",
      severity: lines >= 150 ? "MEDIUM" : "LOW",
      category: "maintainability",
      title: `${lines} lines of old code are kept in comments`,
      description: [
        "Blocks of code were commented out instead of deleted. They go stale, nobody knows whether they matter, and they make every file longer to read.",
        "",
        ...shown.map((x) => `- ${x.f.path}:${x.hit.first} (${x.hit.lines} lines)`),
        ...(commented.length > shown.length ? [`- …and ${commented.length - shown.length} more files`] : []),
      ].join("\n"),
      filePath: shown[0].f.path,
      lineStart: shown[0].hit.first,
      recommendation: "Delete the commented-out code. If you might want it back, it's in git history.",
      confidence: 0.7,
    });
  }

  const dup = duplicatedBlocks(sources);
  if (dup.marked >= 80) {
    const blocks = [...dup.blocks].sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 8);
    out.push({
      ruleId: "habits.duplicate-code",
      severity: dup.marked >= 400 && dup.marked / Math.max(1, dup.total) >= 0.08 ? "MEDIUM" : "LOW",
      category: "maintainability",
      title: `About ${Math.round(dup.marked / 2)} lines are copy-pasted between files`,
      description: [
        "The same block of code appears in more than one file. When one copy gets a fix, the others keep the bug, and AI tools tend to edit only the copy they happen to see.",
        "",
        ...blocks.map((b) => `- ${b.file}:${b.from}-${b.to} is the same as ${b.sameAs.file}:${b.sameAs.from}`),
        "",
        "Needs review: boilerplate that has to look the same (generated files, framework templates) is fine.",
      ].join("\n"),
      filePath: blocks[0].file,
      lineStart: blocks[0].from,
      recommendation: "Move the shared block into one function or module and import it everywhere it's used.",
      confidence: 0.65,
    });
  }
  return out;
}
