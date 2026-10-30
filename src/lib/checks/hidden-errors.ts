import { isRouteHandler, isSourceFile } from "@/lib/checks/collect-files";
import { balancedBlock, maskNonCode, stripComments } from "@/lib/checks/source-utils";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

const MAX_LISTED = 10;
/** One-off tools, seeds and examples: a swallowed error there costs a rerun, not a customer. */
const NOT_SERVING = /(^|\/)(scripts|bin|tools|examples?|fixtures?|demo|seeds?)\//;
/** Files where a hidden failure loses money, access or data. */
const CRITICAL_PATH = /stripe|webhook|billing|checkout|payment|subscription|(^|[\/._-])auth|login|password|migrat|schema|(^|[\/._-])db([\/._-]|$)|order/i;
/** The code just before a catch: what the try block was doing. */
const CRITICAL_CALL = /\bstripe\b|\.(?:insert|update|delete|upsert|execute)\s*\(|\bprisma\.|\bsupabase\b|\bresend\b|sendMail|sendEmail|\bcharge|createCheckoutSession|signIn\s*\(|createUser|\.transaction\s*\(/i;
/** Words that dismiss an error without saying why it's safe to dismiss. */
const DISMISSAL = new Set(
  ("ignore ignored ignoring skip skipped skipping noop no op nothing todo fixme whatever ok okay fine swallow swallowed silent silently " +
    "empty error errors failure failures handle handled handling is are it its that this the a an here for now to do dont don't care need needed safe can be we just catch").split(" "),
);
const LOGS = /\bconsole\.(?:error|warn|log)\b|\blogger\b|\bcaptureException\b|\breportError\b|\bSentry\b|\blog\s*\(/;
const REPORTS_SUCCESS = /\b(?:success|ok)\s*:\s*true\b|\bstatus\s*:\s*["']?(?:ok|success)["']?|\.status\s*\(\s*200\s*\)|\bstatus\s*:\s*200\b/;
const VALIDATION = /\b(?:zod|valibot|yup|joi|ajv|superstruct|typebox|arktype|io-ts)\b|\.safeParse\(|\bz\.object|\bv\.object|\bschema\.(?:parse|validate)/i;

/** True when the comments in an otherwise empty block give a real reason (anything beyond "ignore", "skip", "ok"…). */
function hasReason(block: string): boolean {
  const comments = [...block.matchAll(/\/\*([\s\S]*?)\*\/|\/\/([^\n]*)/g)].map((m) => m[1] ?? m[2] ?? "");
  return comments.some((c) => (c.toLowerCase().match(/[a-z']+/g) ?? []).some((w) => !DISMISSAL.has(w)));
}

/** One statement that only turns text into a value (and falls back when it can't): the safe, ordinary reason to catch and carry on. */
const PARSE_ONLY = /(?:^|[=\s(])(?:await\s+)?(?:JSON\.parse|new URL|decodeURIComponent|decodeURI|parseInt|parseFloat|BigInt|atob)\s*\(/;

/** True for a try block that only parses text, or only touches browser storage (which can be unavailable, e.g. in private mode). */
function isOrdinaryFallback(tryBody: string): boolean {
  if (/\b(?:localStorage|sessionStorage)\b/.test(tryBody)) return true;
  const statements = stripComments(tryBody).split(";").map((x) => x.trim()).filter(Boolean);
  return statements.length === 1 && PARSE_ONLY.test(statements[0]);
}

/** The body of the `try { … }` that ends just before `catchIndex`, or null. */
function tryBodyBefore(code: string, original: string, catchIndex: number): string | null {
  let end = catchIndex - 1;
  while (end >= 0 && /\s/.test(code[end])) end--;
  if (code[end] !== "}") return null;
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    if (code[i] === "}") depth++;
    else if (code[i] === "{" && --depth === 0) return /\btry\s*$/.test(code.slice(Math.max(0, i - 12), i)) ? original.slice(i + 1, end) : null;
  }
  return null;
}

/** A comment on the same line or the two lines above that gives a reason ("best effort", "the next poll retries"). */
function explainedNearby(lines: string[], line: number): boolean {
  const comments = lines
    .slice(Math.max(0, line - 3), line)
    .map((l) => /(?:^|[\s;{}(),])\/\/(.*)$/.exec(l)?.[1])
    .filter((c): c is string => c !== undefined);
  return hasReason(comments.map((c) => `//${c}`).join("\n"));
}

/** Analytics and metrics are best-effort by nature: losing one event shouldn't break a checkout. */
const BEST_EFFORT_CALL = /\btrack\w*\s*\(|\banalytics\b|\btelemetry\b|\bmetrics?\.|\bbeacon\b|\bposthog\b|\bmixpanel\b|\bgtag\b|\bfunnel/i;

type Spot = { file: string; line: number };

function listing(spots: Spot[]): string[] {
  const shown = spots.slice(0, MAX_LISTED);
  return [...shown.map((s) => `- ${s.file}:${s.line}`), ...(spots.length > shown.length ? [`- …and ${spots.length - shown.length} more`] : [])];
}

/**
 * Code that hides what went wrong, the habit that turns one small failure into
 * a mystery:
 * - an error swallowed with nothing said about why that's safe,
 * - a catch block that tells the caller everything worked,
 * - a request body trusted by a type cast and never checked.
 * Pattern-based, so every finding asks for review.
 */
export function checkHiddenErrors(files: RepoFile[]): CheckFinding[] {
  const swallowedCritical: Spot[] = [];
  const swallowedOther: Spot[] = [];
  const fakeSuccess: Spot[] = [];
  const unvalidated: Spot[] = [];

  for (const f of files) {
    if (!isSourceFile(f) || NOT_SERVING.test(f.path)) continue;
    // Patterns run on a copy with comments and string contents blanked out (same length, so indexes match the original).
    const code = maskNonCode(f.content);
    const criticalHere = (index: number) => CRITICAL_PATH.test(f.path) || CRITICAL_CALL.test(code.slice(Math.max(0, index - 600), index));

    for (const m of code.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/g)) {
      const open = m.index + m[0].length - 1;
      const masked = balancedBlock(code, open);
      if (masked === null) continue;
      const original = f.content.slice(open + 1, open + 1 + masked.length);
      const line = lineOf(f.content, m.index);
      if (masked.trim() === "") {
        const tryBody = tryBodyBefore(code, f.content, m.index);
        if (!hasReason(original) && !(tryBody !== null && isOrdinaryFallback(tryBody))) (criticalHere(m.index) ? swallowedCritical : swallowedOther).push({ file: f.path, line });
      } else {
        const body = stripComments(original);
        // A comment that says why answering "ok" is deliberate (a replayed webhook, a retry) counts as a reason.
        const explained = /\bthrow\b|retry|retries|idempot|already|replay|duplicate/i.test(original);
        if (REPORTS_SUCCESS.test(body) && !LOGS.test(body) && !explained) fakeSuccess.push({ file: f.path, line });
      }
    }

    // `.catch(() => {})` on a call whose failure matters: fire-and-forget that can't fail loudly.
    const lines = f.content.split("\n");
    for (const m of code.matchAll(/\.catch\(\s*(?:async\s*)?\(\s*\w*\s*\)\s*=>\s*(\{\s*\}|undefined|void 0)\s*\)/g)) {
      if (m[1].startsWith("{") && hasReason(f.content.slice(m.index, m.index + m[0].length))) continue;
      if (explainedNearby(lines, lineOf(f.content, m.index)) || BEST_EFFORT_CALL.test(code.slice(Math.max(0, m.index - 160), m.index))) continue;
      (criticalHere(m.index) ? swallowedCritical : swallowedOther).push({ file: f.path, line: lineOf(f.content, m.index) });
    }

    if (isRouteHandler(f) && /\bexport\s+(?:async\s+function|const)\s+(?:POST|PUT|PATCH|DELETE)\b/.test(f.content) && !VALIDATION.test(f.content)) {
      const cast = /await\s+(?:req|request)\.json\(\)\s*\)?\s+as\s+/.exec(f.content);
      if (cast) unvalidated.push({ file: f.path, line: lineOf(f.content, cast.index) });
    }
  }

  const out: CheckFinding[] = [];
  const swallowedRecommendation =
    "Either handle the failure (log it with context, return an error, retry), or write one line saying why ignoring it is safe. If an error can lose a payment, an email or a write, it should never disappear.";
  if (swallowedCritical.length) {
    out.push({
      ruleId: "habits.swallowed-error",
      severity: "MEDIUM",
      category: "reliability",
      title: `${swallowedCritical.length} error${swallowedCritical.length === 1 ? " is" : "s are"} swallowed in payment, login or database code`,
      description: [
        "These catch blocks (or `.catch(() => {})`) throw the error away without saying why that's safe. When something fails here, nobody finds out: the payment isn't recorded, the user isn't logged in, the write is lost, and nothing in the logs says so.",
        "",
        ...listing(swallowedCritical),
        "",
        "Needs review: some are deliberate. A comment that says why (\"not JSON\", \"the next poll retries\") marks one as deliberate; Boswell skips those.",
      ].join("\n"),
      filePath: swallowedCritical[0].file,
      lineStart: swallowedCritical[0].line,
      recommendation: swallowedRecommendation,
      confidence: 0.6,
    });
  }
  if (swallowedOther.length) {
    out.push({
      ruleId: "habits.swallowed-error",
      severity: "LOW",
      category: "reliability",
      title: `${swallowedOther.length} error${swallowedOther.length === 1 ? " is" : "s are"} swallowed without a reason`,
      description: ["These catch blocks throw the error away without saying why that's safe.", "", ...listing(swallowedOther), "", "Needs review: some are deliberate."].join("\n"),
      filePath: swallowedOther[0].file,
      lineStart: swallowedOther[0].line,
      recommendation: swallowedRecommendation,
      confidence: 0.6,
    });
  }
  if (fakeSuccess.length) {
    out.push({
      ruleId: "habits.fake-success",
      severity: "MEDIUM",
      category: "reliability",
      title: `${fakeSuccess.length} failure${fakeSuccess.length === 1 ? "" : "s"} report${fakeSuccess.length === 1 ? "s" : ""} success`,
      description: [
        "These catch blocks answer \"ok\" or \"success\" without logging or reporting the error. The caller (or your user) believes it worked, so the problem only shows up later, as missing data.",
        "",
        ...listing(fakeSuccess),
        "",
        "Needs review: answering 200 on purpose (so a webhook sender stops retrying) is fine when the error is logged.",
      ].join("\n"),
      filePath: fakeSuccess[0].file,
      lineStart: fakeSuccess[0].line,
      recommendation: "Return a real error status, or log and report the failure before answering. Never say \"success\" for something that failed.",
      confidence: 0.6,
    });
  }
  if (unvalidated.length) {
    out.push({
      ruleId: "habits.unvalidated-input",
      severity: "LOW",
      category: "reliability",
      title: `${unvalidated.length} route${unvalidated.length === 1 ? " trusts" : "s trust"} the shape of the request`,
      description: [
        "These routes read the request body and tell TypeScript what it is (`as { … }`) without checking. TypeScript doesn't check it at runtime: a caller can send a number where a string is expected, or nothing at all.",
        "",
        ...listing(unvalidated),
        "",
        "Needs review: if the route checks every field by hand, this is a style point.",
      ].join("\n"),
      filePath: unvalidated[0].file,
      lineStart: unvalidated[0].line,
      recommendation: "Parse the body with a schema (zod, valibot) and return 400 when it doesn't match, instead of casting it.",
      confidence: 0.4,
    });
  }
  return out;
}
