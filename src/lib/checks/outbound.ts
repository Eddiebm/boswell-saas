import { isRouteHandler, isServerFile } from "@/lib/checks/collect-files";
import { findCalls, splitArgs } from "@/lib/checks/source-utils";
import { lineOf, type CheckFinding, type RepoFile } from "@/lib/checks/types";

/** Reads something the caller controls. */
const REQUEST_INPUT = /\bsearchParams\b|\breq(?:uest)?\.(?:query|body|json\s*\(|formData\s*\(|text\s*\(|nextUrl)|\bparams\b|\bformData\b/;
/** Signs the author already validates destinations. */
const URL_GUARD = /\ballow(?:ed)?(?:List|Hosts?|Origins?|Domains?)\b|\bALLOWED_[A-Z_]+|\bassertSafe\w*|\bisSafeUrl\b|\bisAllowed\w*|\.hostname\s*(?:===|!==|\)|\.endsWith)|\bssrf\b/i;
const MAX_LISTED = 10;

function isFixedDestination(arg: string): boolean {
  const s = arg.trim();
  if (/^["']/.test(s)) return true;
  // A template whose host is literal (`https://api.example.com/${id}`) can't be redirected to another host.
  if (s.startsWith("`")) return !s.startsWith("`${") && /^`(?:https?:\/\/[^/$`]+\/|\/)/.test(s);
  return false;
}

/**
 * When the URL is a variable, look at its nearest preceding assignment in
 * the same file: `const url = \`https://api.unsplash.com/...${q}\`` is just as
 * fixed as writing the literal inline.
 */
function resolvesToFixedDestination(arg: string, content: string, callIndex: number): boolean {
  if (isFixedDestination(arg)) return true;
  const ident = /^([\w$]+)(?:\.(?:toString\(\)|href))?$/.exec(arg.trim());
  if (!ident) return false;
  const decl = new RegExp(`\\b(?:const|let|var)\\s+${ident[1].replace(/\$/g, "\\$")}\\s*=\\s*([^\\n;]+)`, "g");
  let expr: string | undefined;
  for (const m of content.slice(0, callIndex).matchAll(decl)) expr = m[1];
  if (!expr) return false;
  expr = expr.trim();
  return (
    isFixedDestination(expr) ||
    /^process\.env\.\w+/.test(expr) ||
    /^new URL\(\s*(?:["']https?:\/\/|`https?:\/\/[^/$`]+\/)/.test(expr)
  );
}

function isRelative(arg: string): boolean {
  return /^["'`]\//.test(arg.trim());
}

/**
 * Outbound HTTP from server code:
 * - no timeout: a slow or hung upstream holds the request (and a serverless
 *   instance) open until the platform kills it,
 * - possible SSRF: a route handler fetches a URL it didn't write down, in a
 *   file that also reads request input — if that URL comes from the caller,
 *   they can make your server request internal addresses.
 */
export function checkOutbound(files: RepoFile[]): CheckFinding[] {
  const noTimeout: Array<{ file: string; line: number }> = [];
  const ssrf: CheckFinding[] = [];

  for (const f of files) {
    if (!isServerFile(f) || !/\bfetch\s*\(|\baxios\b/.test(f.content)) continue;
    const handlesTimeouts = /AbortSignal\.timeout|new AbortController|\btimeout\s*:/.test(f.content);
    // One-off CLI scripts aren't serving traffic; a hang there just means rerunning the script.
    const isScript = /^(?:scripts|bin|tools)\//.test(f.path);
    const route = isRouteHandler(f);
    const readsInput = route && REQUEST_INPUT.test(f.content);
    const guarded = URL_GUARD.test(f.content);

    for (const call of findCalls(f.content, /fetch|axios(?:\.(?:get|post|put|patch|delete|request))?/)) {
      const [first = "", options = ""] = splitArgs(call.args);
      if (!first || isRelative(first)) continue;
      const line = lineOf(f.content, call.index);

      if (!handlesTimeouts && !isScript && !/\bsignal\b|\btimeout\b/.test(options)) noTimeout.push({ file: f.path, line });

      if (readsInput && !guarded && !resolvesToFixedDestination(first, f.content, call.index) && ssrf.length < MAX_LISTED) {
        ssrf.push({
          ruleId: "security.ssrf",
          severity: "MEDIUM",
          category: "security",
          title: "Possible SSRF: route fetches a URL it didn't choose",
          description: `This route handler requests \`${first.slice(0, 80)}\` and also reads request input. If any part of that URL's host comes from the caller, they can make your server fetch internal addresses (cloud metadata at 169.254.169.254, localhost admin ports, private services) and read the response.\n\nNeeds review: Boswell matched this by pattern and hasn't traced where the URL comes from.`,
          filePath: f.path,
          lineStart: line,
          recommendation: "If the destination comes from input, parse it with `new URL()`, allow only `https:`, check the hostname against an allowlist, and reject private/loopback IPs after DNS resolution. If it never comes from input, no change needed.",
          confidence: 0.5,
        });
      }
    }
  }

  const out: CheckFinding[] = [...ssrf];
  if (noTimeout.length) {
    const shown = noTimeout.slice(0, MAX_LISTED);
    out.push({
      ruleId: "reliability.no-timeout",
      severity: "LOW",
      category: "reliability",
      title: `${noTimeout.length} outbound ${noTimeout.length === 1 ? "request has" : "requests have"} no timeout`,
      description: [
        "These server-side requests wait as long as the other side takes. When an upstream API hangs, every request that hits it hangs too — tying up your server or serverless instances until the platform's own limit kills them, usually with a generic 504 and no useful error.",
        "",
        ...shown.map((n) => `- ${n.file}:${n.line}`),
        ...(noTimeout.length > shown.length ? [`- …and ${noTimeout.length - shown.length} more`] : []),
        "",
        "Needs review: a timeout set by a shared wrapper elsewhere won't be visible here.",
      ].join("\n"),
      filePath: shown[0].file,
      lineStart: shown[0].line,
      recommendation: "Pass `signal: AbortSignal.timeout(10_000)` (or a value that suits the upstream) to each `fetch`, or `timeout` to axios, and handle the resulting error.",
      confidence: 0.6,
    });
  }
  return out;
}
