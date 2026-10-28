import type { CheckFinding } from "@/lib/checks/types";
import type { Session } from "@/lib/dynamic-verify/engine";
import { sessionHeaders } from "@/lib/dynamic-verify/engine";
import type { LiveFetch } from "@/lib/live/http";
import type { RouteInfo } from "@/lib/live/routes";

const MAX_ROUTES = 40;
/** Routes that are public on purpose. */
const PUBLIC_BY_DESIGN = /^\/api\/(?:auth|health|healthz|status|ping|og|webhooks?|stripe|cron|sitemap|robots|manifest|public)(?:\/|$)/;
const SENSITIVE_KEYS = /"(?:email|e_mail|phone|phoneNumber|address|password|passwordHash|password_hash|hashedPassword|token|accessToken|refreshToken|apiKey|api_key|secret|ssn|dob|dateOfBirth|stripeCustomerId|stripe_customer_id)"\s*:\s*(?!null|""|\[\]|\{\})/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Which personal-data fields a JSON body exposes. Bodies are inspected in memory, never stored. */
export function exposedFields(body: string): string[] {
  const fields = new Set([...body.matchAll(SENSITIVE_KEYS)].map((m) => m[0].split('"')[1]));
  const emails = new Set(body.match(EMAIL) ?? []);
  if (emails.size >= 2) fields.add(`${emails.size} email addresses`);
  return [...fields];
}

/**
 * Calls every static API route with GET — never anything that changes data:
 * - with no session: routes that hand personal data to anyone on the internet,
 * - as test account B (a normal user, when live verification is set up): admin routes it can open.
 */
export async function sweepApiRoutes(input: { baseUrl: string; routes: RouteInfo[]; fetcher: LiveFetch; sessionB?: Session | null }): Promise<CheckFinding[]> {
  const out: CheckFinding[] = [];
  const candidates = input.routes.filter((r) => !r.dynamic && r.path.startsWith("/api") && !PUBLIC_BY_DESIGN.test(r.path)).slice(0, MAX_ROUTES);
  const openToAll: Array<{ route: RouteInfo; fields: string[] }> = [];

  for (const route of candidates) {
    const url = new URL(route.path, input.baseUrl).toString();
    let res;
    try {
      res = await input.fetcher(url);
    } catch {
      continue;
    }
    if (res.status === 200 && /json/.test(res.headers.get("content-type") ?? "")) {
      const fields = exposedFields(res.text);
      if (fields.length) openToAll.push({ route, fields });
      else if (/(^|\/)admin(\/|$)/.test(route.path)) openToAll.push({ route, fields: ["admin data"] });
      continue;
    }
    // Locked to strangers; is an admin route open to any signed-in user?
    if (input.sessionB && /(^|\/)admin(\/|$)/.test(route.path) && (res.status === 401 || res.status === 403)) {
      try {
        const asB = await input.fetcher(url, { headers: sessionHeaders(input.sessionB) as Record<string, string> });
        if (asB.status === 200) {
          out.push({
            ruleId: "authz.admin-reachable",
            severity: "CRITICAL",
            category: "security",
            title: `Admin route opens for a normal user: ${route.path}`,
            description: `Without a session ${route.path} returns ${res.status}, but signed in as your test account B it returns 200. Any signed-in user can use it.\n\nIf test account B is an admin, this is expected — use a normal account for live verification.`,
            filePath: route.file,
            recommendation: "Check the user's role (or an admin allowlist) on the server at the top of this route, not just that they're signed in.",
            confidence: 0.85,
          });
        }
      } catch {
        /* unreachable as B */
      }
    }
  }

  for (const { route, fields } of openToAll) {
    out.push({
      ruleId: "authz.public-data",
      severity: fields.some((f) => /password|token|secret|apiKey|api_key|ssn/i.test(f)) ? "CRITICAL" : "HIGH",
      category: "security",
      title: `${route.path} returns personal data without logging in`,
      description: `A plain GET to ${route.path} on your live site — no cookie, no token — returned 200 with: ${fields.join(", ")}. Anyone who finds the URL can read it.\n\n(Boswell checked the response in memory and stored only the field names.)`,
      filePath: route.file,
      recommendation: "Require a signed-in user in this route and return only the caller's own data. If it's meant to be public, remove the personal fields from the response.",
      // An admin route answering JSON with no personal fields might be harmless (a status check), so it asks for review.
      confidence: fields.includes("admin data") ? 0.7 : 0.85,
    });
  }
  return out;
}
