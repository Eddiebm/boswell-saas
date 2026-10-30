import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import type { Octokit } from "@octokit/rest";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { requireDb } from "@/lib/db";
import { auditRuns, findings, repositories } from "@/lib/db/schema";
import { getGithubClient } from "@/lib/github";
import { assessChange, type ChangedFile, type ChangeRisk } from "@/lib/checks/change-safety";
import { compareGuard, GUARD_MARKER, guardComment, type GuardFinding } from "@/lib/guard/compare";
import { reportError } from "@/lib/monitoring";
import { requestAuditWorker } from "@/lib/worker/trigger-worker";
import type { CheckFinding } from "@/lib/checks";

export const GUARD_CONTEXT = "Boswell / Ship Ready";

export function appUrl(): string {
  const base = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
  if (!base) throw new Error("AUTH_URL is not configured, so GitHub has nowhere to send push events");
  return base.replace(/\/$/, "");
}

type RepoRow = typeof repositories.$inferSelect;

/** Creates the repository webhook (push + pull_request) and queues a first run on the default branch as the baseline. */
export async function enableGuard(userId: string, repo: RepoRow, octokit?: Octokit) {
  const gh = octokit ?? (await getGithubClient(userId));
  const secret = randomBytes(32).toString("hex");
  const { data: hook } = await gh.rest.repos.createWebhook({
    owner: repo.owner,
    repo: repo.name,
    active: true,
    events: ["push", "pull_request"],
    config: { url: `${appUrl()}/api/github/webhook`, content_type: "json", secret, insecure_ssl: "0" },
  });
  const db = requireDb();
  await db
    .update(repositories)
    .set({ guardWebhookId: hook.id, guardSecret: encryptSecret(secret), guardEnabledAt: new Date() })
    .where(eq(repositories.id, repo.id));
  await queueGuardRun({ ...repo, guardWebhookId: hook.id }, { sha: null, prNumber: null });
  return hook.id;
}

export async function disableGuard(userId: string, repo: RepoRow, octokit?: Octokit) {
  if (repo.guardWebhookId) {
    const gh = octokit ?? (await getGithubClient(userId));
    try {
      await gh.rest.repos.deleteWebhook({ owner: repo.owner, repo: repo.name, hook_id: repo.guardWebhookId });
    } catch (error) {
      // Already deleted on GitHub — nothing left to clean up there.
      if ((error as { status?: number }).status !== 404) throw error;
    }
  }
  const db = requireDb();
  await db.update(repositories).set({ guardWebhookId: null, guardSecret: null, guardEnabledAt: null }).where(eq(repositories.id, repo.id));
}

export function guardSecretFor(repo: RepoRow): string | null {
  return repo.guardSecret ? decryptSecret(repo.guardSecret) : null;
}

/**
 * Queues a checks-only run. A push storm collapses into one run: a run still
 * waiting for the same branch or PR is pointed at the newest commit instead
 * of queueing another.
 */
export async function queueGuardRun(repo: RepoRow, target: { sha: string | null; prNumber: number | null }) {
  const db = requireDb();
  const samePr = target.prNumber === null ? isNull(auditRuns.prNumber) : eq(auditRuns.prNumber, target.prNumber);
  const [waiting] = await db
    .select({ id: auditRuns.id })
    .from(auditRuns)
    .where(and(eq(auditRuns.repositoryId, repo.id), eq(auditRuns.trigger, "guard"), eq(auditRuns.status, "queued"), samePr))
    .limit(1);
  if (waiting) {
    // Only while it's still queued: if the worker claimed it in the meantime it's
    // checking the older commit, and this one needs its own run.
    const [updated] = await db
      .update(auditRuns)
      .set({ targetSha: target.sha })
      .where(and(eq(auditRuns.id, waiting.id), eq(auditRuns.status, "queued")))
      .returning({ id: auditRuns.id });
    if (updated) return updated.id;
  }
  const [run] = await db
    .insert(auditRuns)
    .values({ userId: repo.userId, repositoryId: repo.id, status: "queued", auditMode: "quick", trigger: "guard", targetSha: target.sha, prNumber: target.prNumber })
    .returning({ id: auditRuns.id });
  requestAuditWorker();
  return run.id;
}

export async function postStatus(gh: Octokit, repo: RepoRow, sha: string, state: "pending" | "success" | "failure" | "error", description: string) {
  await gh.rest.repos.createCommitStatus({
    owner: repo.owner,
    repo: repo.name,
    sha,
    state,
    context: GUARD_CONTEXT,
    description: description.slice(0, 140),
    target_url: `${appUrl()}/dashboard/ship-ready`,
  });
}

/** One Boswell comment per PR, edited in place on every push rather than piling up. */
export async function upsertPrComment(gh: Octokit, repo: RepoRow, prNumber: number, body: string) {
  const comments = await gh.paginate(gh.rest.issues.listComments, { owner: repo.owner, repo: repo.name, issue_number: prNumber, per_page: 100 });
  const mine = comments.find((c) => c.body?.includes(GUARD_MARKER));
  if (mine) await gh.rest.issues.updateComment({ owner: repo.owner, repo: repo.name, comment_id: mine.id, body });
  else await gh.rest.issues.createComment({ owner: repo.owner, repo: repo.name, issue_number: prNumber, body });
}

/** The files a pull request changes (the first 300), for the size note. */
async function changedFiles(gh: Octokit, repo: RepoRow, prNumber: number): Promise<ChangedFile[]> {
  const out: ChangedFile[] = [];
  for (let page = 1; page <= 3; page++) {
    const { data } = await gh.rest.pulls.listFiles({ owner: repo.owner, repo: repo.name, pull_number: prNumber, per_page: 100, page });
    out.push(...data.map((f) => ({ filename: f.filename, additions: f.additions, deletions: f.deletions })));
    if (data.length < 100) break;
  }
  return out;
}

function toGuardFinding(f: CheckFinding, i: number): GuardFinding {
  return { id: `g${i}`, ruleId: f.ruleId, severity: f.severity, category: f.category, title: f.title, description: f.description, filePath: f.filePath, lineStart: f.lineStart, recommendation: f.recommendation, confidence: f.confidence };
}

/** The default branch's latest known state: a guard run on it, or the checks from the latest full audit. */
export async function loadBaseline(repoId: string, excludeRunId: string): Promise<GuardFinding[] | null> {
  const db = requireDb();
  const [base] = await db
    .select()
    .from(auditRuns)
    .where(
      and(
        eq(auditRuns.repositoryId, repoId),
        eq(auditRuns.status, "completed"),
        ne(auditRuns.id, excludeRunId),
        or(eq(auditRuns.trigger, "manual"), and(eq(auditRuns.trigger, "guard"), isNull(auditRuns.prNumber))),
      ),
    )
    .orderBy(desc(auditRuns.finishedAt))
    .limit(1);
  if (!base) return null;
  if (base.trigger === "guard") return ((base.guardJson as { findings?: GuardFinding[] } | null)?.findings ?? []) as GuardFinding[];
  if (!base.checksJson) return null; // a full audit from before the checks existed can't serve as a baseline
  const rows = await db.select().from(findings).where(eq(findings.auditRunId, base.id));
  return rows
    .filter((f) => f.ruleId)
    .map((f) => ({ id: f.id, ruleId: f.ruleId, severity: f.severity, category: f.category, title: f.title, description: f.description, filePath: f.filePath, lineStart: f.lineStart, recommendation: f.recommendation, confidence: f.confidence ?? 0.8 }));
}

/** Finishes a guard run: compare with the default branch, store the result, and report back on GitHub. */
export async function completeGuardRun(input: {
  run: typeof auditRuns.$inferSelect;
  repo: RepoRow;
  gh: Octokit;
  result: { findings: CheckFinding[]; summary: unknown; commitSha: string };
}) {
  const { run, repo, gh, result } = input;
  const current = result.findings.map(toGuardFinding);
  const outcome = compareGuard(await loadBaseline(repo.id, run.id), current);
  const db = requireDb();
  await db
    .update(auditRuns)
    .set({
      status: "completed",
      finishedAt: new Date(),
      commitSha: result.commitSha,
      checksJson: result.summary,
      guardJson: { findings: current, outcome: { state: outcome.state, description: outcome.description, newBlockers: outcome.newBlockers.length, newReview: outcome.newReview.length, resolved: outcome.resolved.length } },
      summary: outcome.description,
    })
    .where(eq(auditRuns.id, run.id));

  await postStatus(gh, repo, result.commitSha, outcome.state, outcome.description);
  if (run.prNumber !== null) {
    // The size note is a bonus: if GitHub won't list the files, the verdict still goes out, and the failure is reported.
    let risk: ChangeRisk | null = null;
    try {
      risk = assessChange(await changedFiles(gh, repo, run.prNumber));
    } catch (error) {
      reportError(error, { component: "guard", runId: run.id });
    }
    await upsertPrComment(gh, repo, run.prNumber, guardComment(outcome, `${appUrl()}/dashboard/ship-ready`, risk));
  }
  return outcome;
}
