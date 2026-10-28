import { isDemoMode } from "@/lib/demo/mode";
import {
  demoBriefing,
  demoFindings,
  demoFixQueue,
  demoMemory,
  demoRepos,
  demoScore,
  demoScoreHistory,
  demoSlop,
  DEMO_AUDIT_ID,
  DEMO_REPO_ID,
} from "@/lib/demo/data";
import { requireDb } from "@/lib/db";
import { eq, desc, and } from "drizzle-orm";
import {
  auditRuns,
  findings,
  fixQueueItems,
  memoryEvents,
  repoScores,
  repositories,
  scoreSnapshots,
  users,
} from "@/lib/db/schema";
import type { DailyBriefing } from "@/lib/briefing/build-briefing";
import type { RepoScoreResult } from "@/lib/scoring/types";
import { emptySlopResult, type SlopResult } from "@/lib/slop/engine";
import type { AutoFixLevel } from "@/lib/automation/safe-fix-policy";
import type { FindingClassification } from "@/lib/classification/classify";

export async function getPrimaryRepoId(userId: string): Promise<string | null> {
  if (isDemoMode()) return DEMO_REPO_ID;
  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (user?.primaryRepositoryId) {
    const owned = await getRepository(userId, user.primaryRepositoryId);
    if (owned) return user.primaryRepositoryId;
  }
  const repos = await getRepositories(userId);
  return repos[0]?.id ?? null;
}

export async function setPrimaryRepository(userId: string, repositoryId: string) {
  if (isDemoMode()) return;
  const repo = await getRepository(userId, repositoryId);
  if (!repo) throw new Error("Repository not found");
  const db = requireDb();
  await db
    .update(users)
    .set({ primaryRepositoryId: repositoryId })
    .where(eq(users.id, userId));
}

export async function getPrimaryRepository(userId: string) {
  const repoId = await getPrimaryRepoId(userId);
  if (!repoId) return null;
  return getRepository(userId, repoId);
}

export async function getLatestCompletedAuditId(userId: string) {
  if (isDemoMode()) return { auditId: DEMO_AUDIT_ID, repoFullName: "Eddiebm/audiolens-app" };
  const db = requireDb();
  const [row] = await db
    .select({
      auditId: auditRuns.id,
      repoFullName: repositories.fullName,
    })
    .from(auditRuns)
    .innerJoin(repositories, eq(auditRuns.repositoryId, repositories.id))
    .where(and(eq(auditRuns.userId, userId), eq(auditRuns.status, "completed"), eq(auditRuns.trigger, "manual")))
    .orderBy(desc(auditRuns.finishedAt))
    .limit(1);
  return row ?? null;
}

export async function getDashboardBriefing(userId: string) {
  if (isDemoMode()) return demoBriefing;
  const repoId = await getPrimaryRepoId(userId);
  if (!repoId) return null;

  const db = requireDb();
  const runs = await db
    .select()
    .from(auditRuns)
    .where(and(eq(auditRuns.repositoryId, repoId), eq(auditRuns.trigger, "manual")))
    .orderBy(desc(auditRuns.createdAt))
    .limit(1);

  const latest = runs[0];
  if (!latest?.briefingJson) return null;
  return latest.briefingJson as DailyBriefing;
}

export async function getRepositories(userId: string) {
  if (isDemoMode()) return demoRepos;
  const db = requireDb();
  const rows = await db.select().from(repositories).where(eq(repositories.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    description: r.description ?? "",
    healthScore: r.healthScore,
    slopPercent: r.slopPercent,
    lastAuditAt: r.lastAuditAt?.toISOString() ?? null,
  }));
}

export async function getRepository(userId: string, repoId: string) {
  if (isDemoMode()) return demoRepos.find((r) => r.id === repoId) ?? null;
  const db = requireDb();
  const [repo] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, userId)))
    .limit(1);
  if (!repo) return null;
  return {
    id: repo.id,
    fullName: repo.fullName,
    description: repo.description ?? "",
    healthScore: repo.healthScore,
    slopPercent: repo.slopPercent,
    lastAuditAt: repo.lastAuditAt?.toISOString() ?? null,
  };
}

export async function getRepoScore(repoId: string): Promise<RepoScoreResult | null> {
  if (isDemoMode()) return demoScore;
  const db = requireDb();
  const [score] = await db
    .select()
    .from(repoScores)
    .where(eq(repoScores.repositoryId, repoId))
    .orderBy(desc(repoScores.updatedAt))
    .limit(1);
  if (!score) return null;
  return {
    overall: score.overall,
    dimensions: {
      security: score.security,
      architecture: score.architecture,
      maintainability: score.maintainability,
      dependencies: score.dependencies,
      testing: score.testing,
      documentation: score.documentation,
      complexity: score.complexity,
      aiSlop: score.aiSlop,
      releaseRisk: score.releaseRisk,
    },
    grade: score.overall >= 750 ? "Healthy" : score.overall >= 600 ? "Drifting" : "At risk",
    summary: `Overall ${score.overall}/1000`,
  };
}

export async function getScoreHistory(repoId: string) {
  if (isDemoMode()) return demoScoreHistory;
  const db = requireDb();
  const rows = await db
    .select()
    .from(scoreSnapshots)
    .where(eq(scoreSnapshots.repositoryId, repoId))
    .orderBy(desc(scoreSnapshots.snapshotAt))
    .limit(12);
  return rows.map((s) => ({
    snapshotAt: s.snapshotAt.toISOString().slice(0, 10),
    overall: s.overall,
    security: s.security,
    architecture: s.architecture,
    aiSlop: s.aiSlop,
  }));
}

export async function getSlop(repoId: string): Promise<SlopResult> {
  if (isDemoMode()) return demoSlop;
  const db = requireDb();
  const [run] = await db
    .select()
    .from(auditRuns)
    .where(and(eq(auditRuns.repositoryId, repoId), eq(auditRuns.status, "completed"), eq(auditRuns.trigger, "manual")))
    .orderBy(desc(auditRuns.createdAt))
    .limit(1);
  if (!run?.slopJson) return emptySlopResult();
  return run.slopJson as SlopResult;
}

export async function getFindings(repoId: string) {
  if (isDemoMode()) return demoFindings;
  const db = requireDb();
  const rows = await db.select().from(findings).where(eq(findings.repositoryId, repoId));
  return rows.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    severity: f.severity,
    category: f.category,
    filePath: f.filePath ?? undefined,
    lineStart: f.lineStart ?? undefined,
    status: f.status,
    confidence: f.confidence ?? 0.8,
    classification: (f.classification ?? "bad") as FindingClassification,
    autoFixLevel: (f.autoFixLevel ?? "red") as AutoFixLevel,
    coaching: f.coaching,
    evidence: f.evidence ?? [],
  }));
}

export async function getFixQueue(repoId: string) {
  if (isDemoMode()) return demoFixQueue;
  const db = requireDb();
  return db
    .select()
    .from(fixQueueItems)
    .where(eq(fixQueueItems.repositoryId, repoId))
    .orderBy(desc(fixQueueItems.priorityScore));
}

export async function getMemory(repoId: string) {
  if (isDemoMode()) return demoMemory;
  const db = requireDb();
  const rows = await db
    .select()
    .from(memoryEvents)
    .where(eq(memoryEvents.repositoryId, repoId))
    .orderBy(desc(memoryEvents.occurredAt))
    .limit(50);
  return rows.map((e) => ({
    id: e.id,
    eventType: e.eventType,
    title: e.title,
    summary: e.summary,
    occurredAt: e.occurredAt.toISOString(),
  }));
}
export async function getWorkerHealth() {
  if (isDemoMode()) {
    return { queuedAudits: 0, runningAudits: 0, failedAudits: 0 };
  }
  const db = requireDb();
  const queued = await db.select().from(auditRuns).where(eq(auditRuns.status, "queued"));
  const running = await db.select().from(auditRuns).where(eq(auditRuns.status, "running"));
  const failed = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.status, "failed"))
    .orderBy(desc(auditRuns.createdAt))
    .limit(5);
  return {
    queuedAudits: queued.length,
    runningAudits: running.length,
    recentFailures: failed.map((f) => ({ id: f.id, error: f.error })),
  };
}
