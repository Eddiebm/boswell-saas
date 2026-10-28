import { and, desc, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { auditDocuments, auditRuns, findings, repositories } from "@/lib/db/schema";
import { claimNextQueuedAudit, recoverStaleAudits } from "@/lib/audit-queue";
import { runQueuedAudit } from "@/lib/audit-runner";

export {
  queueAudit,
  incrementAuditUsage,
  claimNextQueuedAudit,
  recoverStaleAudits,
  recoverStuckAudits,
  requeueFailedAudit,
} from "@/lib/audit-queue";
export { runQueuedAudit } from "@/lib/audit-runner";

export async function listAuditsForUser(userId: string) {
  const db = requireDb();
  return db
    .select({
      id: auditRuns.id,
      status: auditRuns.status,
      summary: auditRuns.summary,
      deployVerdict: auditRuns.deployVerdict,
      topRisk: auditRuns.topRisk,
      costUsd: auditRuns.costUsd,
      auditMode: auditRuns.auditMode,
      createdAt: auditRuns.createdAt,
      startedAt: auditRuns.startedAt,
      error: auditRuns.error,
      finishedAt: auditRuns.finishedAt,
      repoFullName: repositories.fullName,
      repositoryId: repositories.id,
    })
    .from(auditRuns)
    .innerJoin(repositories, eq(auditRuns.repositoryId, repositories.id))
    .where(and(eq(auditRuns.userId, userId), eq(auditRuns.trigger, "manual")))
    .orderBy(desc(auditRuns.createdAt));
}

export async function getAuditForUser(userId: string, auditId: string) {
  const db = requireDb();
  const [run] = await db
    .select()
    .from(auditRuns)
    .where(and(eq(auditRuns.id, auditId), eq(auditRuns.userId, userId)))
    .limit(1);

  if (!run) return null;

  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, run.repositoryId))
    .limit(1);

  const docs = await db
    .select()
    .from(auditDocuments)
    .where(eq(auditDocuments.auditRunId, auditId));

  const runFindings = await db
    .select()
    .from(findings)
    .where(eq(findings.auditRunId, auditId));

  return { run, repo, docs, findings: runFindings };
}

export async function processWorkerTick() {
  if (
    process.env.BOSWELL_CLOUD_WORKER !== "1" &&
    process.env.BOSWELL_ALLOW_LOCAL_WORKER !== "1"
  ) {
    return {
      processed: false as const,
      message:
        "Worker disabled locally. GitHub Actions sets BOSWELL_CLOUD_WORKER=1. For dev: BOSWELL_ALLOW_LOCAL_WORKER=1",
    };
  }

  await recoverStaleAudits();
  const claimed = await claimNextQueuedAudit();
  if (!claimed) {
    return { processed: false };
  }
  const result = await runQueuedAudit(claimed.id);
  return { processed: true, auditId: claimed.id, ...result };
}
