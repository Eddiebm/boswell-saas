import { isSourceFile, isTestFile } from "@/lib/checks/collect-files";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

export type DatabaseRulesResult = {
  findings: CheckFinding[];
  /** Whether Boswell could see the rules that protect the database, so Ship Ready knows if a clean result means anything. */
  coverage: "checked" | "unverifiable" | "not-applicable";
};

function usesPackage(files: RepoFile[], name: RegExp) {
  return files.some((f) => f.path.endsWith("package.json") && name.test(f.content));
}

/**
 * Apps that talk to the database straight from the browser (Supabase,
 * Firebase) are only as safe as the database's own rules: the browser key is
 * public by design. A table without row level security, or rules left in
 * "test mode", can be read and rewritten by anyone who opens dev tools.
 */
const DB_DRIVER_NAMES = String.raw`pg|postgres|@neondatabase\/serverless|drizzle-orm\/(?:neon-http|neon-serverless|node-postgres|postgres-js)|@prisma\/client|mysql2(?:\/promise)?|mongodb|mongoose|@planetscale\/database|@vercel\/postgres`;
const DRIVER_IMPORT = new RegExp(String.raw`\bimport\s+([^;"'\x60]*?)\s*from\s+["'](${DB_DRIVER_NAMES})["']|\bimport\s*\(?\s*["'](${DB_DRIVER_NAMES})["']|\brequire\(\s*["'](${DB_DRIVER_NAMES})["']\s*\)`, "g");

/**
 * The first import of a database driver that survives compilation. Type-only
 * imports (`import type { User } from "@prisma/client"`, or every specifier
 * marked `type`) are erased and ship nothing to the browser.
 */
function runtimeDriverImport(content: string): { index: number; name: string } | null {
  for (const m of content.matchAll(DRIVER_IMPORT)) {
    const clause = m[1];
    if (clause !== undefined) {
      if (/^type\s/.test(clause)) continue;
      const named = /^\{([^}]*)\}$/.exec(clause.trim());
      if (named && named[1].split(",").map((x) => x.trim()).filter(Boolean).every((x) => /^type\s/.test(x))) continue;
    }
    return { index: m.index, name: m[2] ?? m[3] ?? m[4] };
  }
  return null;
}

/**
 * Checks for apps whose database is only meant to be reached from the server
 * (Neon, plain Postgres, Prisma, Mongo…): a driver pulled into browser code,
 * TLS turned off, and Neon's direct endpoint used where pooling is needed.
 */
function serverDatabaseChecks(files: RepoFile[]): CheckFinding[] {
  const out: CheckFinding[] = [];
  for (const f of files) {
    if (!isSourceFile(f) || !/^\s*["']use client["']/m.test(f.content.slice(0, 200))) continue;
    const m = runtimeDriverImport(f.content);
    if (!m) continue;
    out.push({
      ruleId: "db.client-database",
      severity: "CRITICAL",
      category: "database",
      title: "Database driver imported into browser code",
      description: `\`${f.path}\` is a client component and imports a database driver (\`${m.name}\`). For it to connect, the connection string — with the database password — has to be in the JavaScript every visitor downloads.`,
      filePath: f.path,
      lineStart: lineOf(f.content, m.index),
      recommendation: "Move the query into a server component, route handler or server action, and pass only the results to the client.",
      confidence: 0.85,
    });
  }

  for (const f of files) {
    if (isTestFile(f)) continue;
    const m = /postgres(?:ql)?:\/\/[^\s"'`]*[?&]sslmode=disable/.exec(f.content);
    if (!m) continue;
    out.push({
      ruleId: "db.ssl-disabled",
      severity: "MEDIUM",
      category: "database",
      title: "Database connection with SSL turned off",
      description: `\`${f.path}\` connects with \`sslmode=disable\`, so the password and every query travel unencrypted between the app and the database.`,
      filePath: f.path,
      lineStart: lineOf(f.content, m.index),
      recommendation: "Use `sslmode=require` (Neon and most hosted Postgres reject unencrypted connections anyway).",
      confidence: 0.85,
    });
    break;
  }

  // Neon's direct endpoint with a TCP driver in serverless functions: each invocation opens its own connection.
  const serverless = files.some((f) => f.path.endsWith("package.json") && /"next"\s*:/.test(f.content));
  const tcpDriver = files.some((f) => isSourceFile(f) && /from\s+["'](?:pg|postgres|drizzle-orm\/(?:node-postgres|postgres-js))["']/.test(f.content));
  const example = files.find((f) => /(^|\/)\.env\.[\w.]*(?:example|sample|template)$/.test(f.path) && /DATABASE_URL\s*=\s*\S*neon\.tech/.test(f.content));
  if (serverless && tcpDriver && example && !/DATABASE_URL\s*=\s*\S*-pooler\./.test(example.content)) {
    out.push({
      ruleId: "db.not-pooled",
      severity: "LOW",
      category: "database",
      title: "Neon's direct endpoint used from serverless functions",
      description: `${example.path} points DATABASE_URL at Neon's direct endpoint, and the app uses a TCP Postgres driver from serverless functions. Under traffic each function opens its own connection, and the database starts refusing them.\n\nNeeds review: your production value may already use the pooled endpoint.`,
      filePath: example.path,
      recommendation: "Use the pooled connection string (the host with `-pooler`) for the app, or Neon's serverless driver (`@neondatabase/serverless`); keep the direct one for migrations.",
      confidence: 0.6,
    });
  }
  return out;
}

export function checkDatabaseRules(files: RepoFile[]): DatabaseRulesResult {
  const findings: CheckFinding[] = [];
  const usesSupabase = usesPackage(files, /"@supabase\/(?:supabase-js|ssr|auth-helpers-[\w-]+)"/) || files.some((f) => f.path.startsWith("supabase/"));
  const usesFirebase = usesPackage(files, /"firebase"\s*:/);
  // Neon's Data API serves tables over HTTP to the browser, so — like Supabase — it's only as safe as RLS.
  const usesNeonDataApi = usesPackage(files, /"@neondatabase\/(?:neon-js|data-api[\w-]*)"\s*:/) || files.some((f) => isSourceFile(f) && /\.apirest\.[\w.-]*neon|data-api\.neon\.tech/.test(f.content));
  findings.push(...serverDatabaseChecks(files));
  if (!usesSupabase && !usesFirebase && !usesNeonDataApi) return { findings, coverage: "not-applicable" };
  const platform = usesSupabase ? "Supabase" : "Neon Data API";

  let sawRules = false;

  if (usesSupabase || usesNeonDataApi) {
    const sql = files.filter((f) => f.path.endsWith(".sql"));
    const created = new Map<string, { file: RepoFile; index: number }>();
    const secured = new Set<string>();
    for (const f of sql) {
      for (const m of f.content.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi)) {
        // Only the public schema is exposed through Supabase's API.
        if (m[1] && m[1].toLowerCase() !== "public") continue;
        const table = m[2].toLowerCase();
        if (!created.has(table)) created.set(table, { file: f, index: m.index });
      }
      for (const m of f.content.matchAll(/\balter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s+enable\s+row\s+level\s+security/gi)) {
        if (!m[1] || m[1].toLowerCase() === "public") secured.add(m[2].toLowerCase());
      }
    }
    if (created.size) sawRules = true;
    const open = [...created.entries()].filter(([table]) => !secured.has(table));
    if (open.length) {
      const [first] = open;
      findings.push({
        ruleId: "db.rls-disabled",
        severity: "CRITICAL",
        category: "database",
        title: `${open.length} ${platform} ${open.length === 1 ? "table has" : "tables have"} no row level security`,
        description: [
          `Your ${platform} key ships to every browser. Without row level security (RLS), anyone holding it can read, change or delete every row in these tables — including other users' data:`,
          "",
          ...open.slice(0, 15).map(([table, at]) => `- \`${table}\` — created in ${at.file.path}:${lineOf(at.file.content, at.index)}`),
          ...(open.length > 15 ? [`- …and ${open.length - 15} more`] : []),
        ].join("\n"),
        filePath: first[1].file.path,
        lineStart: lineOf(first[1].file.content, first[1].index),
        recommendation: "For each table: `alter table <name> enable row level security;` then add policies so users only reach their own rows (e.g. `using (auth.uid() = user_id)`). Check the Supabase dashboard's Security Advisor afterwards — tables created in the dashboard won't appear in your migrations.",
        confidence: 0.85,
      });
    }

    for (const f of files) {
      if (!isSourceFile(f) || !/^\s*["']use client["']/m.test(f.content.slice(0, 200))) continue;
      const m = /SUPABASE_SERVICE_ROLE\w*|service_role/.exec(f.content);
      if (!m) continue;
      findings.push({
        ruleId: "db.service-role-client",
        severity: "CRITICAL",
        category: "database",
        title: "Supabase service-role key used in browser code",
        description: `\`${f.path}\` is a client component and refers to the service-role key, which bypasses every row level security policy. If it reaches the browser, anyone can read and write your whole database.`,
        filePath: f.path,
        lineStart: lineOf(f.content, m.index),
        recommendation: "Use the service-role key only in server code (route handlers, server actions). In the browser, use the anon key and rely on RLS policies.",
        confidence: 0.8,
      });
    }
  }

  if (usesFirebase) {
    for (const f of files) {
      if (/(^|\/)(?:firestore|storage)\.rules$/.test(f.path)) {
        sawRules = true;
        const open =
          /allow\s+(?:read|write|read\s*,\s*write|write\s*,\s*read|get|list|create|update|delete)[^;]*:\s*if\s+true\s*;/.exec(f.content) ??
          /allow\s+(?:read|write|read\s*,\s*write)\s*;/.exec(f.content) ??
          /if\s+request\.time\s*<\s*timestamp\.date\(/.exec(f.content);
        if (open) {
          findings.push({
            ruleId: "db.firebase-open",
            severity: "CRITICAL",
            category: "database",
            title: `${f.path} lets anyone read or write`,
            description: `These security rules ${/request\.time/.test(open[0]) ? "are still in test mode (open to everyone until a date)" : "allow access with no condition"}. Your Firebase config is public by design, so anyone can read or overwrite this data from their browser.`,
            filePath: f.path,
            lineStart: lineOf(f.content, open.index),
            recommendation: "Replace the open rule with per-user rules, e.g. `allow read, write: if request.auth != null && request.auth.uid == userId;`, and test them in the Firebase rules playground.",
            confidence: 0.9,
          });
        }
      }
      if (/(^|\/)database\.rules\.json$/.test(f.path)) {
        sawRules = true;
        const m = /"\.(?:read|write)"\s*:\s*(?:true|"true")/.exec(f.content);
        if (m) {
          findings.push({
            ruleId: "db.firebase-open",
            severity: "CRITICAL",
            category: "database",
            title: `${f.path} lets anyone read or write`,
            description: "A Realtime Database rule is set to `true`, so anyone with your (public) Firebase config can read or write that path.",
            filePath: f.path,
            lineStart: lineOf(f.content, m.index),
            recommendation: 'Scope the rule to the signed-in user, e.g. `".read": "auth != null && auth.uid === $uid"`.',
            confidence: 0.9,
          });
        }
      }
    }
  }

  return { findings, coverage: sawRules || findings.length ? "checked" : "unverifiable" };
}
