import { after } from "next/server";
import { reportError } from "@/lib/monitoring";

const GITHUB_API = "https://api.github.com";

export async function triggerAuditWorkerDispatch(): Promise<{ ok: boolean; reason?: string }> {
  const token =
    process.env.GITHUB_WORKFLOW_TOKEN ??
    process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_WORKER_REPO ?? "Eddiebm/boswell-saas";

  if (!token) {
    return { ok: false, reason: "no_github_token" };
  }

  const response = await fetch(
    `${GITHUB_API}/repos/${repo}/actions/workflows/audit-worker.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (response.status === 204) {
    return { ok: true };
  }

  const body = await response.text();
  return { ok: false, reason: `github_${response.status}:${body.slice(0, 200)}` };
}

/**
 * Asks GitHub to start the worker now, so a queued audit doesn't wait for the
 * next scheduled run (GitHub runs those hours apart, not every two minutes).
 *
 * Call it from a request handler: `after` keeps the request alive until GitHub
 * has answered, where a plain unawaited fetch can be cut off when a serverless
 * function returns. A failure (no token, an expired token, GitHub down) is
 * reported to Sentry and the log, not swallowed, because the audit then sits
 * queued until it times out.
 */
export function requestAuditWorker() {
  const dispatch = async () => {
    try {
      const result = await triggerAuditWorkerDispatch();
      if (!result.ok) throw new Error(`Audit worker dispatch failed: ${result.reason ?? "unknown"}`);
    } catch (error) {
      console.error("[worker] dispatch failed; the audit waits for the next scheduled run", error);
      reportError(error, { component: "worker" });
    }
  };
  try {
    after(dispatch);
  } catch {
    // Not inside a request (a script or a test): there's nothing to keep alive.
    void dispatch();
  }
}
