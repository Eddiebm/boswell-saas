import { createHmac, timingSafeEqual } from "node:crypto";

/** GitHub's `X-Hub-Signature-256`: HMAC-SHA256 of the raw body with the webhook's secret. */
export function verifySignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const ZERO_SHA = /^0+$/;
const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review"]);

type PushPayload = { ref?: string; after?: string; deleted?: boolean };
type PullPayload = { action?: string; number?: number; pull_request?: { head?: { sha?: string }; draft?: boolean } };

/**
 * Which commit a GitHub event asks the guard to check: pushes to the
 * default branch (to keep its baseline current) and PRs as they open or
 * get new commits. Everything else is ignored.
 */
export function guardTarget(event: string | null, payload: unknown, defaultBranch: string): { sha: string; prNumber: number | null } | null {
  if (event === "push") {
    const p = payload as PushPayload;
    if (p.deleted || !p.after || ZERO_SHA.test(p.after) || p.ref !== `refs/heads/${defaultBranch}`) return null;
    return { sha: p.after, prNumber: null };
  }
  if (event === "pull_request") {
    const p = payload as PullPayload;
    const sha = p.pull_request?.head?.sha;
    if (!p.action || !PR_ACTIONS.has(p.action) || !sha || typeof p.number !== "number") return null;
    return { sha, prNumber: p.number };
  }
  return null;
}
