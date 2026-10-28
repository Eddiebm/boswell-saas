import { isRouteHandler, isSourceFile } from "@/lib/checks/collect-files";
import { findEnvRefs } from "@/lib/checks/env-vars";
import { balancedArgs, escapeRegExp, findCalls } from "@/lib/checks/source-utils";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

const SECRET_COLUMN = /^(?:password|passwd|pass_?hash|password_?hash|hashed_?password|hash|salt|secret|\w*_?secret|api_?key|\w*_?api_?key|\w*_?token|token|private_?key|otp|otp_?secret|totp_?secret|mfa_?secret|ssn|recovery_?codes?)$/i;
/** Column names that look like tokens but are public by design. */
const NOT_SECRET = /^(?:token_?type|expires_?at|\w*_?token_?expires\w*|csrf_?token|push_?token|token_?count|tokens_?used|\w*_?tokens)$/i;

export type SecretTable = { variable: string; table: string; columns: string[]; file: string; line: number; orm: "drizzle" | "prisma" };

function isSecretColumn(name: string) {
  return SECRET_COLUMN.test(name) && !NOT_SECRET.test(name);
}

export function findSecretTables(files: RepoFile[]): SecretTable[] {
  const out: SecretTable[] = [];
  for (const f of files) {
    if (isSourceFile(f)) {
      for (const m of f.content.matchAll(/(?:export\s+)?const\s+(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\s*\(\s*["'`](\w+)["'`]\s*,\s*/g)) {
        const open = f.content.indexOf("{", m.index + m[0].length - 1);
        if (open === -1) continue;
        const body = balancedArgs(`(${f.content.slice(open, open + 8000)}`, 0) ?? "";
        const columns = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((c) => c[1]).filter(isSecretColumn);
        if (columns.length) out.push({ variable: m[1], table: m[2], columns, file: f.path, line: lineOf(f.content, m.index), orm: "drizzle" });
      }
    }
    if (f.path.endsWith(".prisma")) {
      for (const m of f.content.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
        const columns = [...m[2].matchAll(/^\s*(\w+)\s+\w/gm)].map((c) => c[1]).filter(isSecretColumn);
        const client = m[1][0].toLowerCase() + m[1].slice(1);
        if (columns.length) out.push({ variable: client, table: m[1], columns, file: f.path, line: lineOf(f.content, m.index), orm: "prisma" });
      }
    }
  }
  return out;
}

const RETURNS_JSON = /\b(?:NextResponse|Response)\.json\s*\(|\bres\.(?:json|send)\s*\(|\bc\.json\s*\(|\bjson\s*\(/;

/**
 * Two ways secrets leave the building without anyone noticing:
 * - a route reads every column of a table that holds password hashes or
 *   tokens and returns the row as JSON,
 * - a secret is put in a NEXT_PUBLIC_/VITE_ variable, which the bundler
 *   inlines into JavaScript every visitor downloads.
 */
export function checkSecretExposure(files: RepoFile[]): CheckFinding[] {
  const out: CheckFinding[] = [];
  const tables = findSecretTables(files);

  for (const f of files) {
    if (!isSourceFile(f) || !isRouteHandler(f) || !RETURNS_JSON.test(f.content)) continue;
    for (const t of tables) {
      // The route mentions the secret column itself — it's probably stripping or deliberately handling it.
      if (t.columns.some((c) => new RegExp(`\\b${escapeRegExp(c)}\\b`).test(f.content))) continue;

      let hit: number | undefined;
      if (t.orm === "drizzle") {
        const fullSelect = new RegExp(`\\.select\\(\\s*\\)\\s*\\.from\\(\\s*${escapeRegExp(t.variable)}\\s*\\)`);
        const m = fullSelect.exec(f.content);
        if (m) hit = m.index;
        else {
          const call = findCalls(f.content, new RegExp(`\\w+\\.query\\.${escapeRegExp(t.variable)}\\.find(?:First|Many)`)).find((c) => !/\bcolumns\s*:/.test(c.args));
          if (call) hit = call.index;
        }
      } else {
        const call = findCalls(f.content, new RegExp(`\\w+\\.${escapeRegExp(t.variable)}\\.find(?:Unique|UniqueOrThrow|First|FirstOrThrow|Many)`)).find((c) => !/\b(?:select|omit)\s*:/.test(c.args));
        if (call) hit = call.index;
      }
      if (hit === undefined) continue;

      out.push({
        ruleId: "secrets.row-exposure",
        severity: "MEDIUM",
        category: "secrets",
        title: `Route may return \`${t.table}\` rows including ${t.columns.map((c) => `\`${c}\``).join(", ")}`,
        description: `This route handler reads every column of \`${t.table}\` (defined in ${t.file}:${t.line}) and returns JSON, and nothing in it removes ${t.columns.length === 1 ? "the secret column" : "the secret columns"}. If that row reaches the response, ${t.columns.join(", ")} go${t.columns.length === 1 ? "es" : ""} to the client — visible in the browser's network tab to anyone who can call the route.\n\nNeeds review: Boswell matched the query and the JSON response by pattern; check whether this row is what's returned.`,
        filePath: f.path,
        lineStart: lineOf(f.content, hit),
        recommendation: t.orm === "drizzle"
          ? "Select only the columns the client needs (`db.select({ id: t.id, name: t.name })`, or `columns: { … }` with the query API) instead of the full row."
          : "Add `select: { … }` (or `omit: { " + t.columns[0] + ": true }`) so the secret column is never loaded into the response.",
        confidence: 0.5,
      });
    }
  }

  const publicSecrets = new Map<string, { file: string; line: number }>();
  for (const ref of findEnvRefs(files)) {
    if (/^(?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_)\w*(?:SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|DATABASE_URL|WEBHOOK_SECRET)/.test(ref.name) && !publicSecrets.has(ref.name)) {
      publicSecrets.set(ref.name, { file: ref.file, line: ref.line });
    }
  }
  for (const f of files) {
    for (const m of f.content.matchAll(/^\s*((?:NEXT_PUBLIC_|VITE_|PUBLIC_|REACT_APP_|EXPO_PUBLIC_)\w*(?:SECRET|PRIVATE|SERVICE_ROLE|PASSWORD|DATABASE_URL))\s*=/gm)) {
      if (!publicSecrets.has(m[1])) publicSecrets.set(m[1], { file: f.path, line: lineOf(f.content, m.index) });
    }
  }
  for (const [name, at] of publicSecrets) {
    out.push({
      ruleId: "secrets.public-env",
      severity: "HIGH",
      category: "secrets",
      title: `Secret in a public environment variable: ${name}`,
      description: `Variables prefixed \`${name.split("_")[0]}_\` are inlined into the JavaScript bundle at build time, so every visitor can read \`${name}\` in their browser's dev tools. A value named like this is meant to stay on the server.`,
      filePath: at.file,
      lineStart: at.line,
      recommendation: `Rename it without the public prefix, read it only in server code (route handlers, server actions), and rotate the current value — anyone who loaded the site may already have it.`,
      confidence: 0.85,
    });
  }
  return out;
}
