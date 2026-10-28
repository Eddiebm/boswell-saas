import { isRouteHandler, isSourceFile } from "@/lib/checks/collect-files";
import { escapeRegExp } from "@/lib/checks/source-utils";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

const ROLE_CHECK =
  /\b(?:role|roles|isAdmin|is_admin|isSuperuser|admin)\b\s*(?:===|!==|==|!=|\.includes\()|\b(?:requireAdmin|assertAdmin|isAdmin|hasRole|checkRole|requireRole|ensureAdmin|adminOnly|withAdmin)\s*\(|ADMIN_EMAILS?\b|ADMIN_USER_IDS?\b|\bpermissions?\b/i;
/**
 * The app's own guard helpers: `isAdminUser()`, `isAdminSession(jar)`,
 * `requirePlatformRoleOrResponse(req, roles)`, `requireOperator()`,
 * `assertStaff(user)`… — a verb that checks, then admin/role/operator/staff.
 */
const ROLE_HELPER = /\b(?:is|require|assert|ensure|check|has|can|verify|with|get)\w*(?:Admin|Role|Operator|Staff|Superuser|Moderator|Permission)\w*\s*\(/;

/** Machine-only admin routes guarded by a shared secret in a request header (`x-admin-secret` vs ADMIN_SECRET). */
function headerSecretGuard(content: string) {
  return /headers\.get\(\s*["'`][\w-]+["'`]\s*\)/.test(content) && /process\.env\.\w*(?:SECRET|TOKEN|KEY|PASSWORD)\b/.test(content);
}

/** Variables holding the raw request body: `const body = await req.json()`, `const data = req.body`. */
function bodyVariables(content: string): string[] {
  const names = new Set<string>();
  for (const m of content.matchAll(/\b(?:const|let|var)\s+(\w+)\s*(?::\s*[\w<>[\]{}|, ]+)?=\s*(?:await\s+)?(?:req|request)\s*\.\s*(?:json\s*\(\s*\)|body\b)/g)) names.add(m[1]);
  return [...names];
}

/**
 * Two authorization mistakes AI-written code makes constantly:
 * - writing the request body straight into the database, so a user can send
 *   `{"role":"admin"}` or `{"credits":99999}` along with their name,
 * - admin routes that check you're signed in but not that you're an admin.
 * Both are pattern matches and ask for review.
 */
export function checkAuthorization(files: RepoFile[]): CheckFinding[] {
  const out: CheckFinding[] = [];
  const middleware = files.find((f) => /(^|\/)(?:src\/)?(?:middleware|proxy)\.[jt]s$/.test(f.path));
  const middlewareGuardsAdmin = Boolean(middleware && /\/admin/.test(middleware.content) && ROLE_CHECK.test(middleware.content));
  const unguardedAdmin: Array<{ file: RepoFile }> = [];

  for (const f of files) {
    if (!isSourceFile(f) || !isRouteHandler(f)) continue;

    const vars = bodyVariables(f.content);
    const sources = [...vars.map(escapeRegExp), "(?:req|request)\\.body", "await\\s+(?:req|request)\\.json\\(\\)"];
    const raw = `(?:${sources.join("|")})`;
    const sink = new RegExp(
      [
        `\\.set\\(\\s*(?:\\{\\s*\\.\\.\\.)?${raw}\\s*[,})]`, // drizzle .set(body) / .set({ ...body
        `\\bdata\\s*:\\s*(?:\\{\\s*\\.\\.\\.)?${raw}\\s*[,}]`, // prisma update/create({ data: body })
        `\\b(?:findByIdAndUpdate|findOneAndUpdate|updateOne|updateMany)\\([^,]+,\\s*(?:\\{\\s*\\.\\.\\.)?${raw}\\s*[,})]`, // mongoose
        `Object\\.assign\\(\\s*\\w+\\s*,\\s*${raw}\\s*\\)`,
      ].join("|"),
    );
    const m = vars.length || /(?:req|request)\.(?:body|json)/.test(f.content) ? sink.exec(f.content) : null;
    if (m) {
      out.push({
        ruleId: "authz.mass-assignment",
        severity: "HIGH",
        category: "security",
        title: "Request body written straight to the database",
        description: `This route saves whatever the request sends (\`${m[0].replace(/\s+/g, " ").slice(0, 80)}\`). Anyone can add extra fields — \`"role": "admin"\`, \`"plan": "pro"\`, \`"credits": 99999\`, someone else's \`userId\` — and they'll be written too.\n\nNeeds review: Boswell matched the pattern; it's safe only if the body is validated against a strict schema first.`,
        filePath: f.path,
        lineStart: lineOf(f.content, m.index),
        recommendation: "Pick the allowed fields explicitly (`const { name, bio } = await req.json()`), or parse the body with a strict schema (e.g. `z.object({...}).strict()`) and write only the parsed result. Set ownership fields like userId from the session, never from the body.",
        confidence: 0.6,
      });
    }

    // The admin login/logout endpoints are how an admin gets in; they can't require being one already.
    const adminAuthEndpoint = /(^|\/)admin\/(?:[\w-]+\/)*(?:login|logout|sign-?in|sign-?out|auth|session)(\/|\.|$)/i.test(f.path);
    if (/(^|\/)admin(\/|\b)/.test(f.path) && !adminAuthEndpoint && !middlewareGuardsAdmin && !ROLE_CHECK.test(f.content) && !ROLE_HELPER.test(f.content) && !headerSecretGuard(f.content)) {
      unguardedAdmin.push({ file: f });
    }
  }

  if (unguardedAdmin.length) {
    out.push({
      ruleId: "authz.admin-unguarded",
      severity: "HIGH",
      category: "security",
      title: `${unguardedAdmin.length} admin ${unguardedAdmin.length === 1 ? "route doesn't" : "routes don't"} check for an admin`,
      description: [
        "These admin routes have no role or admin check in the handler or in middleware. If they only check that someone is signed in, any user who finds the URL can use them:",
        "",
        ...unguardedAdmin.slice(0, 10).map((r) => `- ${r.file.path}`),
        "",
        "Needs review: the check may live in a helper Boswell didn't recognise.",
      ].join("\n"),
      filePath: unguardedAdmin[0].file.path,
      recommendation: "At the top of every admin route, load the signed-in user and reject unless they're an admin (a role column, or an allowlist of admin emails in an environment variable).",
      confidence: 0.6,
    });
  }
  return out;
}
