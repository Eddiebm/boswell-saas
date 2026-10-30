import path from "node:path";
import { isRouteHandler, isSourceFile, isTestFile } from "@/lib/checks/collect-files";
import type { CheckFinding, RepoFile } from "@/lib/checks/types";

const MAX_LISTED = 10;
const NOT_A_PROJECT = /(^|\/)(examples?|fixtures?|__tests__|tests?|templates?|demo)\//;
const CI_FILE = /(^|\/)(?:\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|\.circleci\/config\.yml|azure-pipelines\.ya?ml|bitbucket-pipelines\.yml|\.travis\.yml)$/;
/** Running tests, by name. `npm ci` is an install and `check`/`verify` are only names: those count when the script they call runs a test runner. */
const RUNS_TESTS = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bnpx\s+(?:vitest|jest|playwright|mocha)\b|\b(?:vitest|jest|pytest|mocha|playwright test|go test|cargo test|rspec)\b/;
/** Routes and files where a break costs money or lets the wrong person in. */
const CRITICAL = /stripe|webhook|billing|checkout|payment|subscription|(^|[/._-])auth|login|admin/i;

type Scripts = Record<string, string>;

/** Scripts the host or the package manager runs on its own (a deploy runs `build`; an install runs `postinstall`). */
const LIFECYCLE = ["build", "prebuild", "postbuild", "vercel-build", "heroku-postbuild", "postinstall", "prepare", "prepublishOnly", "prepack"];

/** The script names a command line calls: `npm run x`, `npm test`, `pnpm x`, `yarn x`, `bun run x`. */
function scriptsCalledBy(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/\bnpm\s+run(?:-script)?\s+([\w:.-]+)|\bnpm\s+(test|start|stop|restart)\b|\b(?:pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/g)) names.push(m[1] ?? m[2] ?? m[3]);
  return names;
}

/** The text of every script something runs on its own: build and lifecycle hooks, scripts CI calls, and anything those call. */
function automatedScriptText(scripts: Scripts, ci: RepoFile[]): string {
  const reached = new Set<string>(LIFECYCLE.filter((n) => typeof scripts[n] === "string"));
  for (const f of ci) for (const n of scriptsCalledBy(f.content)) if (typeof scripts[n] === "string") reached.add(n);
  for (let grew = true; grew; ) {
    grew = false;
    for (const name of [...reached]) {
      for (const called of scriptsCalledBy(scripts[name])) {
        if (typeof scripts[called] === "string" && !reached.has(called)) {
          reached.add(called);
          grew = true;
        }
      }
    }
  }
  return [...reached].map((n) => scripts[n]).join("\n");
}

function scriptsOf(files: RepoFile[]): Scripts | null {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return null;
  try {
    const scripts = (JSON.parse(pkg.content) as { scripts?: Scripts }).scripts;
    return scripts && typeof scripts === "object" ? scripts : {};
  } catch {
    return null;
  }
}

/**
 * Whether a change can break something without anyone finding out:
 * - no automated tests at all,
 * - tests that nothing runs when code changes,
 * - payment, login or admin routes no test touches.
 * Pattern-based, so findings ask for review rather than block.
 */
export function checkChangeSafety(files: RepoFile[]): CheckFinding[] {
  const out: CheckFinding[] = [];
  const sources = files.filter((f) => isSourceFile(f) && !NOT_A_PROJECT.test(f.path));
  const tests = files.filter(isTestFile);
  const routes = sources.filter(isRouteHandler);
  const scripts = scriptsOf(files);

  const placeholderTestScript = !scripts?.test || /no test specified/.test(scripts.test);
  if (sources.length >= 10 && tests.length === 0 && placeholderTestScript) {
    out.push({
      ruleId: "habits.no-tests",
      severity: routes.length ? "MEDIUM" : "LOW",
      category: "testing",
      title: "No automated tests, so every change is a gamble",
      description: `This repo has ${sources.length} source files${routes.length ? ` and ${routes.length} API ${routes.length === 1 ? "route" : "routes"}` : ""} and no tests. When you (or an AI tool) change one thing, nothing tells you it broke three others until a user finds out.\n\nNeeds review: tests kept outside this repo, or a test runner Boswell doesn't recognise, wouldn't show up here.`,
      recommendation: "Start where a break costs most: ask your AI tool to write tests for login, payments and the one feature people use most, then run them before every deploy.",
      confidence: 0.75,
    });
    return out;
  }

  if (tests.length > 0 && scripts?.test && !/no test specified/.test(scripts.test)) {
    const ci = files.filter((f) => CI_FILE.test(f.path));
    const runs = ci.some((f) => RUNS_TESTS.test(f.content)) || RUNS_TESTS.test(automatedScriptText(scripts, ci));
    if (!runs) {
      out.push({
        ruleId: "habits.tests-not-run",
        severity: "MEDIUM",
        category: "testing",
        title: ci.length ? "CI never runs the tests" : "Tests exist, but nothing runs them when code changes",
        description: `This repo has ${tests.length} test ${tests.length === 1 ? "file" : "files"} and a \`test\` script, but ${ci.length ? "none of its CI workflows run it" : "it has no CI workflow"}. Tests nobody runs can't catch a break; they quietly go stale.\n\nNeeds review: a host that runs the tests as part of its build (set in its dashboard, not in the repo) wouldn't show up here.`,
        filePath: ci[0]?.path,
        recommendation: "Add a CI workflow that runs `npm ci`, `npm test` and `npm run build` on every push and pull request, and require it to pass before merging.",
        confidence: 0.7,
      });
    }
  }

  if (tests.length >= 3) {
    const testText = tests.map((t) => t.content).join("\n");
    const untested = routes.filter((r) => {
      if (!CRITICAL.test(r.path) && !/\bconstructEvent\b/.test(r.content)) return false;
      const routeKey = r.path.replace(/^.*?(?:app|pages)\//, "").replace(/\/route\.[cm]?[jt]sx?$/, "").replace(/\.[cm]?[jt]sx?$/, "");
      return !testText.includes(routeKey) && !testText.includes(r.path.replace(/\.[cm]?[jt]sx?$/, ""));
    });
    if (untested.length) {
      const shown = untested.slice(0, MAX_LISTED);
      out.push({
        ruleId: "habits.untested-critical",
        severity: "MEDIUM",
        category: "testing",
        title: `${untested.length} payment, login or admin ${untested.length === 1 ? "route has" : "routes have"} no test`,
        description: [
          "These routes handle money or access, and no test file mentions them. A change that breaks one won't be caught before a customer hits it.",
          "",
          ...shown.map((r) => `- ${r.path}`),
          ...(untested.length > shown.length ? [`- …and ${untested.length - shown.length} more`] : []),
          "",
          "Needs review: a test that reaches the route through a helper, without naming it, won't be seen here.",
        ].join("\n"),
        filePath: shown[0].path,
        recommendation: "Write a test for each: one request that should succeed, and one that must be refused (no login, wrong user, bad signature).",
        confidence: 0.5,
      });
    }
  }
  return out;
}

export type ChangedFile = { filename: string; additions: number; deletions: number };

export type ChangeRisk = { files: number; areas: number; changedLines: number; testsChanged: boolean; notes: string[] };

const LOCK_OR_GENERATED = /(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|Gemfile\.lock)$|(^|\/)(?:generated|__generated__|dist|\.next)\//;

/** The first three folders of a path: the part of the app a change lives in. */
function areaOf(file: string): string {
  const dir = path.posix.dirname(file);
  return dir === "." ? "(root)" : dir.split("/").slice(0, 3).join("/");
}

/**
 * How widely a pull request spreads, for the guard's comment. A change that
 * touches many parts of the app, with no test changed, is where one edit
 * quietly breaks three unrelated things. Advice only: it never fails a check.
 */
export function assessChange(changed: ChangedFile[]): ChangeRisk | null {
  const real = changed.filter((c) => !LOCK_OR_GENERATED.test(c.filename));
  const code = real.filter((c) => isSourceFile({ path: c.filename, content: "" }) || /\.sql$/.test(c.filename));
  if (!code.length) return null;
  const testsChanged = real.some((c) => isTestFile({ path: c.filename, content: "" }));
  const changedLines = code.reduce((sum, c) => sum + c.additions + c.deletions, 0);
  const areas = new Set(code.map((c) => areaOf(c.filename))).size;
  const touchesCritical = code.some((c) => CRITICAL.test(c.filename));

  const notes: string[] = [];
  if (!testsChanged && touchesCritical) notes.push("Changes payment, login or admin code and no test changed.");
  else if (!testsChanged && changedLines >= 40) notes.push(`${changedLines} lines of code changed and no test changed, so nothing here checks it.`);
  if (areas >= 6) notes.push(`Spread across ${areas} areas of the code. Wide changes are where unrelated things break: check the parts you didn't mean to touch.`);
  if (code.length >= 25) notes.push(`A large change: ${code.length} code files. Smaller pull requests are easier to review and to undo.`);
  return notes.length ? { files: code.length, areas, changedLines, testsChanged, notes } : null;
}
