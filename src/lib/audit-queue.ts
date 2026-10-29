import { and, eq, lt } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { auditRuns, repositories, users } from "@/lib/db/schema";
import {
  currentMonthKey,
  getPlanLimits,
  type PlanId,
} from "@/lib/plans";
import type { AuditMode } from "@/lib/audit-modes";
import { normalizeAuditMode } from "@/lib/audit-modes";
import { sendAuditAlert } from "@/lib/alerts/audit-alerts";
import { requestAuditWorker } from "@/lib/worker/trigger-worker";

async function ensureAuditQuota(userId: string) {
  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new Error("User not found");

  const plan = (user.plan ?? "free") as PlanId;
  const limits = getPlanLimits(plan);
  const monthKey = currentMonthKey();

  let used = user.auditsUsedThisMonth;
  if (user.auditMonthKey !== monthKey) {
    used = 0;
    await db
      .update(users)
      .set({ auditsUsedThisMonth: 0, auditMonthKey: monthKey })
      .where(eq(users.id, userId));
  }

  if (used >= limits.auditsPerMonth) {
    throw new Error(`Monthly audit limit reached (${limits.auditsPerMonth})`);
  }
}

export async function queueAudit(userId: string, repositoryId: string, auditMode: AuditMode = "standard") {
  const db = requireDb();
  await ensureAuditQuota(userId);
  const mode = normalizeAuditMode(auditMode);

  const [repo] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, userId)))
    .limit(1);

  if (!repo) {
    throw new Error("Repository not found");
  }

  const [run] = await db
    .insert(auditRuns)
    .values({
      userId,
      repositoryId,
      status: "queued",
      auditMode: mode,
    })
    .returning();

  requestAuditWorker();

  return run;
}

export async function incrementAuditUsage(userId: string) {
  const db = requireDb();
  const monthKey = currentMonthKey();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return;

  const used =
    user.auditMonthKey === monthKey ? (user.auditsUsedThisMonth ?? 0) + 1 : 1;

  await db
    .update(users)
    .set({ auditsUsedThisMonth: used, auditMonthKey: monthKey })
    .where(eq(users.id, userId));
}

export async function claimNextQueuedAudit() {
  const db = requireDb();
  const [next] = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.status, "queued"))
    .orderBy(auditRuns.createdAt)
    .limit(1);

  if (!next) return null;

  const [updated] = await db
    .update(auditRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(auditRuns.id, next.id), eq(auditRuns.status, "queued")))
    .returning();

  return updated ?? null;
}

const QUEUED_TIMEOUT_MS = 60 * 60 * 1000;
const RUNNING_TIMEOUT_MS = 25 * 60 * 1000;
const MAX_AUDIT_RETRIES = 3;

const WORKER_FAILURE_MESSAGE =
  "Worker did not pick up this audit within 60 minutes. The cloud worker may be delayed — try again or check GitHub Actions (audit-worker workflow).";

function parseRetryCount(error: string | null | undefined) {
  if (!error) return 0;
  const match = error.match(/\[retry:(\d+)\]/);
  return match ? Number(match[1]) : 0;
}

export async function recoverStaleAudits() {
  const db = requireDb();
  const now = Date.now();
  const queuedCutoff = new Date(now - QUEUED_TIMEOUT_MS);

  const staleQueued = await db
    .select({
      id: auditRuns.id,
      repoFullName: repositories.fullName,
    })
    .from(auditRuns)
    .innerJoin(repositories, eq(auditRuns.repositoryId, repositories.id))
    .where(and(eq(auditRuns.status, "queued"), lt(auditRuns.createdAt, queuedCutoff)));

  for (const run of staleQueued) {
    await db
      .update(auditRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: WORKER_FAILURE_MESSAGE,
      })
      .where(eq(auditRuns.id, run.id));

    await sendAuditAlert({
      auditId: run.id,
      repoFullName: run.repoFullName,
      reason: WORKER_FAILURE_MESSAGE,
      status: "stale_queued",
    });
  }

  const runningCutoff = new Date(now - RUNNING_TIMEOUT_MS);
  const stuckRunning = await db
    .select({
      id: auditRuns.id,
      error: auditRuns.error,
      repoFullName: repositories.fullName,
    })
    .from(auditRuns)
    .innerJoin(repositories, eq(auditRuns.repositoryId, repositories.id))
    .where(and(eq(auditRuns.status, "running"), lt(auditRuns.startedAt, runningCutoff)));

  for (const run of stuckRunning) {
    const retries = parseRetryCount(run.error);
    if (retries >= MAX_AUDIT_RETRIES) {
      const error = `Audit exceeded maximum retries (${MAX_AUDIT_RETRIES}). Last attempt timed out after 25 minutes.`;
      await db
        .update(auditRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error,
        })
        .where(eq(auditRuns.id, run.id));

      await sendAuditAlert({
        auditId: run.id,
        repoFullName: run.repoFullName,
        reason: error,
        status: "max_retries",
      });
      continue;
    }

    const nextRetry = retries + 1;
    await db
      .update(auditRuns)
      .set({
        status: "queued",
        startedAt: null,
        error: `[retry:${nextRetry}] Requeued after worker timeout (attempt ${nextRetry} of ${MAX_AUDIT_RETRIES})`,
      })
      .where(eq(auditRuns.id, run.id));
  }
}

/** @deprecated use recoverStaleAudits */
export async function recoverStuckAudits() {
  await recoverStaleAudits();
}
export async function requeueFailedAudit(auditId: string) {
  const db = requireDb();
  const [updated] = await db
    .update(auditRuns)
    .set({
      status: "queued",
      error: null,
      startedAt: null,
      finishedAt: null,
    })
    .where(and(eq(auditRuns.id, auditId), eq(auditRuns.status, "failed")))
    .returning();

  if (!updated) {
    throw new Error("Audit not found or not in failed status");
  }
  return updated;
}
