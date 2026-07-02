import { and, desc, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import {
  auditDocuments,
  auditRuns,
  findings,
  fixQueueItems,
  memoryEvents,
  reports,
  repoScores,
  repositories,
  scoreSnapshots,
  users,
} from "@/lib/db/schema";
import { buildCoaching } from "@/lib/coaching/build-coaching";
import { buildDailyBriefing } from "@/lib/briefing/build-briefing";
import { prioritizeFixQueue } from "@/lib/fix-queue/prioritize";
import { computeRepoScore } from "@/lib/scoring/engine";
import { getGithubToken } from "@/lib/github";
import {
  currentMonthKey,
  getPlanLimits,
  type PlanId,
} from "@/lib/plans";
import { processAuditJob } from "@/lib/worker/process-audit";

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
      createdAt: auditRuns.createdAt,
      finishedAt: auditRuns.finishedAt,
      repoFullName: repositories.fullName,
      repositoryId: repositories.id,
    })
    .from(auditRuns)
    .innerJoin(repositories, eq(auditRuns.repositoryId, repositories.id))
    .where(eq(auditRuns.userId, userId))
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

export async function queueAudit(userId: string, repositoryId: string) {
  const db = requireDb();
  await ensureAuditQuota(userId);

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
    })
    .returning();

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

export async function runQueuedAudit(auditId: string) {
  const db = requireDb();
  const [run] = await db.select().from(auditRuns).where(eq(auditRuns.id, auditId)).limit(1);
  if (!run) throw new Error("Audit not found");

  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, run.repositoryId))
    .limit(1);
  if (!repo) throw new Error("Repository not found");

  const token = await getGithubToken(run.userId);
  if (!token) throw new Error("Missing GitHub token");

  try {
    const result = await processAuditJob({
      cloneUrl: repo.cloneUrl,
      githubToken: token,
      repoFullName: repo.fullName,
    });

    await db.insert(auditDocuments).values(
      Object.entries(result.documents).map(([docType, content]) => ({
        auditRunId: run.id,
        docType,
        content,
      })),
    );

    if (result.findings.length) {
      await db.insert(findings).values(
        result.findings.map((f) => ({
          repositoryId: repo.id,
          auditRunId: run.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          description: f.description,
          filePath: f.filePath,
          lineStart: f.lineStart,
          recommendation: f.recommendation,
          coaching: buildCoaching({
            title: f.title,
            description: f.description,
            severity: f.severity,
            category: f.category,
            filePath: f.filePath,
            recommendation: f.recommendation,
          }),
          confidence: 0.85,
          autoFixable: f.category === "documentation",
        })),
      );
    }

    await db.insert(reports).values(
      Object.entries(result.documents).map(([docType, markdown]) => ({
        auditRunId: run.id,
        docType,
        markdown,
      })),
    );

    const score = computeRepoScore(result.scoreInput);
    await db.insert(repoScores).values({
      repositoryId: repo.id,
      overall: score.overall,
      security: score.dimensions.security,
      architecture: score.dimensions.architecture,
      maintainability: score.dimensions.maintainability,
      dependencies: score.dimensions.dependencies,
      testing: score.dimensions.testing,
      documentation: score.dimensions.documentation,
      complexity: score.dimensions.complexity,
      aiSlop: score.dimensions.aiSlop,
      releaseRisk: score.dimensions.releaseRisk,
      details: score,
    });

    await db.insert(scoreSnapshots).values({
      repositoryId: repo.id,
      auditRunId: run.id,
      overall: score.overall,
      security: score.dimensions.security,
      architecture: score.dimensions.architecture,
      maintainability: score.dimensions.maintainability,
      dependencies: score.dimensions.dependencies,
      testing: score.dimensions.testing,
      documentation: score.dimensions.documentation,
      complexity: score.dimensions.complexity,
      aiSlop: score.dimensions.aiSlop,
      releaseRisk: score.dimensions.releaseRisk,
    });

    const briefing = buildDailyBriefing({
      repoName: repo.fullName,
      currentScore: score,
      newFindings: result.findings
        .filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL")
        .map((f) => ({
          id: f.title,
          title: f.title,
          severity: f.severity,
          href: `/dashboard/audits/${run.id}`,
        })),
      fixedFindings: [],
      recurringFindings: [],
      slop: result.slop,
      deployVerdict: result.deployVerdict,
    });

    const queue = prioritizeFixQueue(
      result.findings
        .filter((f) => f.severity !== "INFO")
        .map((f) => ({
          id: f.title,
          title: f.title,
          severity: f.severity,
          effort: f.severity === "HIGH" ? "m" : "s",
          impact: f.severity === "CRITICAL" ? "critical" : "high",
          files: f.filePath ? [f.filePath] : [],
          whyItMatters: f.description,
          suggestedFix: f.recommendation ?? "Review manually",
          canAutoPr: f.category === "documentation",
          category: f.category,
        })),
    );

    if (queue.length) {
      await db.insert(fixQueueItems).values(
        queue.map((q) => ({
          repositoryId: repo.id,
          title: q.title,
          severity: q.severity,
          effort: q.effort,
          impact: q.impact,
          files: q.files,
          whyItMatters: q.whyItMatters,
          suggestedFix: q.suggestedFix,
          canAutoPr: q.canAutoPr,
          priorityScore: q.priorityScore,
        })),
      );
    }

    await db.insert(memoryEvents).values({
      repositoryId: repo.id,
      eventType: "audit_completed",
      title: `Audit completed for ${repo.fullName}`,
      summary: briefing.executiveSummary,
    });

    await db
      .update(auditRuns)
      .set({
        status: "completed",
        finishedAt: new Date(),
        stack: result.stack,
        costUsd: result.costUsd?.toString(),
        summary: result.summary,
        deployVerdict: result.deployVerdict,
        topRisk: result.topRisk,
        briefingJson: briefing,
        slopJson: result.slop,
        scoresJson: score,
      })
      .where(eq(auditRuns.id, run.id));

    await db
      .update(repositories)
      .set({
        lastAuditAt: new Date(),
        healthScore: score.overall,
        slopPercent: result.slop.overallPercent,
      })
      .where(eq(repositories.id, repo.id));

    await incrementAuditUsage(run.userId);
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit failed";
    await db
      .update(auditRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: message,
      })
      .where(eq(auditRuns.id, run.id));
    return { ok: false as const, error: message };
  }
}

export async function processWorkerTick() {
  const claimed = await claimNextQueuedAudit();
  if (!claimed) {
    return { processed: false };
  }
  const result = await runQueuedAudit(claimed.id);
  return { processed: true, auditId: claimed.id, ...result };
}
