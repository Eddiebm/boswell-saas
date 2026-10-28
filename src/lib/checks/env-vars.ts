import { isEnvExample, isSourceFile } from "@/lib/checks/collect-files";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

/** Set by the platform or the runtime, never by the person deploying. */
const PLATFORM_VARS = new Set([
  "NODE_ENV", "NEXT_RUNTIME", "NEXT_PHASE", "CI", "PORT", "HOST", "HOSTNAME", "HOME", "PATH", "PWD", "TZ", "LANG", "USER", "SHELL", "TMPDIR",
  "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_REGION", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL", "NETLIFY", "RENDER",
  "GITHUB_ACTIONS", "GITHUB_SHA", "GITHUB_REF", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_WORKSPACE", "RAILWAY_ENVIRONMENT", "FLY_APP_NAME",
  "DEBUG", "LOG_LEVEL", "npm_package_version",
]);
const PLATFORM_PREFIXES = ["VERCEL_GIT_", "npm_", "NEXT_PUBLIC_VERCEL_", "RENDER_", "RAILWAY_", "FLY_"];

const ENV_REF = /\bprocess\.env\.([A-Z_][A-Z0-9_]*)|\bprocess\.env\[\s*["']([A-Z_][A-Z0-9_]*)["']\s*\]|\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)|\bos\.environ(?:\.get\(\s*|\[\s*)["']([A-Z_][A-Z0-9_]*)["']|\bos\.getenv\(\s*["']([A-Z_][A-Z0-9_]*)["']/g;

export type EnvRef = { name: string; file: string; line: number };

export function findEnvRefs(files: RepoFile[]): EnvRef[] {
  const refs: EnvRef[] = [];
  for (const f of files) {
    if (!isSourceFile(f) && !f.path.endsWith(".py")) continue;
    for (const m of f.content.matchAll(ENV_REF)) {
      const name = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5];
      if (!name || PLATFORM_VARS.has(name) || PLATFORM_PREFIXES.some((p) => name.startsWith(p))) continue;
      refs.push({ name, file: f.path, line: lineOf(f.content, m.index) });
    }
  }
  return refs;
}

/**
 * A variable the code reads but that no .env example, README, or deploy
 * config mentions. The next person to deploy — or you, on a new host —
 * won't know to set it, and the failure only shows up at runtime.
 */
export function checkEnvVars(files: RepoFile[]): CheckFinding[] {
  const refs = findEnvRefs(files);
  const byName = new Map<string, EnvRef[]>();
  for (const r of refs) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  if (byName.size === 0) return [];

  const examples = files.filter(isEnvExample);
  const docs = files.filter(
    (f) => isEnvExample(f) || /(^|\/)README\.md$/i.test(f.path) || /\.(ya?ml|toml)$/.test(f.path),
  );
  const documented = (name: string) => docs.some((d) => new RegExp(`\\b${name}\\b`).test(d.content));

  const missing = [...byName.entries()].filter(([name]) => !documented(name)).sort(([a], [b]) => a.localeCompare(b));
  if (missing.length === 0) return [];

  const list = missing.slice(0, 20).map(([name, rs]) => `- \`${name}\` — read in ${rs[0].file}:${rs[0].line}${rs.length > 1 ? ` (+${rs.length - 1} more)` : ""}`);
  if (missing.length > 20) list.push(`- …and ${missing.length - 20} more`);

  const noExample = examples.length === 0;
  return [
    {
      ruleId: "deploy.env-undocumented",
      severity: noExample && missing.length >= 3 ? "MEDIUM" : "LOW",
      category: "deploy",
      title: noExample
        ? `No .env.example: ${missing.length} environment ${missing.length === 1 ? "variable is" : "variables are"} undocumented`
        : `${missing.length} environment ${missing.length === 1 ? "variable is" : "variables are"} missing from ${examples[0].path}`,
      description: [
        `The code reads ${missing.length === 1 ? "this variable" : "these variables"}, but no .env example, README or deploy config mentions ${missing.length === 1 ? "it" : "them"}. A fresh deploy won't know to set ${missing.length === 1 ? "it" : "them"}, and the failure only shows up at runtime — often as a confusing \`undefined\` deep inside a request.`,
        "",
        ...list,
      ].join("\n"),
      filePath: missing[0][1][0].file,
      lineStart: missing[0][1][0].line,
      recommendation: noExample
        ? "Add a `.env.example` listing every variable with a placeholder value and a one-line comment, and commit it."
        : `Add ${missing.length === 1 ? "it" : "them"} to ${examples[0].path} with a placeholder value. Consider validating required variables at startup so a missing one fails the deploy instead of a request.`,
      confidence: 0.8,
    },
  ];
}
