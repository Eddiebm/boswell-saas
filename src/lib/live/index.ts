import type { CheckFinding, RepoFile } from "@/lib/checks/types";
import type { Coverage } from "@/lib/checks";
import { login, type Session } from "@/lib/dynamic-verify/engine";
import { assertRelativePath, assertSafeStagingUrl } from "@/lib/dynamic-verify/validate-target";
import { sweepApiRoutes } from "@/lib/live/authz-sweep";
import { createLiveFetch, type LiveFetch } from "@/lib/live/http";
import { extractRoutes, hasGetHandler } from "@/lib/live/routes";
import { scanSite } from "@/lib/live/site-scan";
import { runSmoke } from "@/lib/live/smoke";

export type LiveAccount = { loginPath: string; email: string; password: string };
export type LiveResult = { findings: CheckFinding[]; coverage: { liveSite: Coverage; smoke: Coverage } };

/**
 * Everything Boswell checks against the running app: what the deployed site
 * exposes, which API routes answer without a login, and whether pages load
 * in a real browser. GET requests and page loads only — nothing that changes
 * data. With a test account (from live verification), private pages and
 * admin routes are checked as that user too.
 */
export async function runLiveChecks(input: {
  liveUrl: string;
  files: RepoFile[];
  account?: LiveAccount | null;
  allowPrivate?: boolean;
  fetcher?: LiveFetch;
  smoke?: typeof runSmoke;
}): Promise<LiveResult> {
  if (!input.allowPrivate) await assertSafeStagingUrl(input.liveUrl);
  const fetcher = input.fetcher ?? createLiveFetch({ allowPrivate: input.allowPrivate });
  const findings: CheckFinding[] = [];

  const site = await scanSite(input.liveUrl, fetcher);
  findings.push(...site.findings);
  if (!site.reachable) return { findings, coverage: { liveSite: "unverifiable", smoke: "unverifiable" } };

  let session: Session | null = null;
  if (input.account) {
    try {
      assertRelativePath(input.account.loginPath, "loginPath");
      session = await login({ stagingUrl: input.liveUrl, loginPath: input.account.loginPath }, input.account.email, input.account.password);
    } catch (error) {
      findings.push({
        ruleId: "ops.live-login-failed",
        severity: "INFO",
        category: "operations",
        title: "Couldn't sign in with the test account",
        description: `Boswell tried to sign in as ${input.account.email} on the live site to check private pages and admin routes, and couldn't: ${error instanceof Error ? error.message.slice(0, 200) : "login failed"}. Those checks ran as a signed-out visitor only.`,
        recommendation: "Check the login path and test account in Live verification.",
        confidence: 1,
      });
    }
  }

  const routes = extractRoutes(input.files);
  const filesByPath = new Map(input.files.map((f) => [f.path, f]));
  const api = routes.api.filter((r) => {
    const file = filesByPath.get(r.file);
    return file ? hasGetHandler(file) : false;
  });
  findings.push(...(await sweepApiRoutes({ baseUrl: input.liveUrl, routes: api, fetcher, sessionB: session })));

  const smoke = await (input.smoke ?? runSmoke)({
    baseUrl: input.liveUrl,
    pages: routes.pages.filter((p) => !p.dynamic).map((p) => p.path),
    session,
    allowPrivate: input.allowPrivate,
  });
  findings.push(...smoke.findings);

  return { findings, coverage: { liveSite: "checked", smoke: smoke.ran ? "checked" : "unverifiable" } };
}
