import { Octokit } from "@octokit/rest";
import { eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { auditRuns, repositories } from "@/lib/db/schema";
import { completeGuardRun, postStatus } from "@/lib/guard/service";
import { processGuardJob } from "@/lib/worker/process-guard";
import { reportError } from "@/lib/monitoring";
import { redactSecrets } from "@/lib/monitoring-config";

/** Worker entry point for a push-guard run (see runQueuedAudit). */
export async function runGuardAudit(run: typeof auditRuns.$inferSelect, repo: typeof repositories.$inferSelect, token: string) {
  const gh = new Octokit({ auth: token });
  try {
    const result = await processGuardJob({ cloneUrl: repo.cloneUrl, githubToken: token, sha: run.targetSha, prNumber: run.prNumber });
    await completeGuardRun({ run, repo, gh, result });
    return { ok: true as const };
  } catch (error) {
    reportError(error, { component: "guard", runId: run.id });
    const message = redactSecrets(error instanceof Error ? error.message : "Guard check failed");
    const db = requireDb();
    await db.update(auditRuns).set({ status: "failed", finishedAt: new Date(), error: message }).where(eq(auditRuns.id, run.id));
    // Don't leave the commit showing "pending" forever.
    if (run.targetSha) await postStatus(gh, repo, run.targetSha, "error", "Boswell couldn't run its checks on this commit").catch(() => undefined);
    return { ok: false as const, error: message };
  }
}
