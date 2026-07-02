import { isDemoMode } from "@/lib/demo/mode";
import {
  demoAuditMarkdown,
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
  answerBrainQuestion,
} from "@/lib/demo/data";
import { requireDb } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import {
  auditRuns,
  findings,
  fixQueueItems,
  memoryEvents,
  repoScores,
  repositories,
  scoreSnapshots,
} from "@/lib/db/schema";

export async function getDashboardBriefing(userId: string) {
  if (isDemoMode()) return demoBriefing;
  const db = requireDb();
  const repos = await db.select().from(repositories).where(eq(repositories.userId, userId)).limit(1);
  const repo = repos[0];
  if (!repo) return null;

  const runs = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.repositoryId, repo.id))
    .orderBy(desc(auditRuns.createdAt))
    .limit(2);

  const latest = runs[0];
  if (!latest?.briefingJson) return demoBriefing;
  return latest.briefingJson as typeof demoBriefing;
}

export async function getRepositories(userId: string) {
  if (isDemoMode()) return demoRepos;
  const db = requireDb();
  return db.select().from(repositories).where(eq(repositories.userId, userId));
}

export async function getRepository(userId: string, repoId: string) {
  if (isDemoMode()) return demoRepos.find((r) => r.id === repoId) ?? null;
  const db = requireDb();
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  return repo ?? null;
}

export async function getRepoScore(repoId: string) {
  if (isDemoMode()) return demoScore;
  const db = requireDb();
  const [score] = await db.select().from(repoScores).where(eq(repoScores.repositoryId, repoId)).limit(1);
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
    grade: score.overall >= 750 ? "Healthy" : "Drifting",
    summary: `Overall ${score.overall}/1000`,
  };
}

export async function getScoreHistory(repoId: string) {
  if (isDemoMode()) return demoScoreHistory;
  const db = requireDb();
  return db
    .select()
    .from(scoreSnapshots)
    .where(eq(scoreSnapshots.repositoryId, repoId))
    .orderBy(desc(scoreSnapshots.snapshotAt))
    .limit(12);
}

export async function getSlop(repoId: string) {
  if (isDemoMode()) return demoSlop;
  const db = requireDb();
  const [run] = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.repositoryId, repoId))
    .orderBy(desc(auditRuns.createdAt))
    .limit(1);
  return (run?.slopJson as typeof demoSlop) ?? demoSlop;
}

export async function getFindings(repoId: string) {
  if (isDemoMode()) return demoFindings;
  const db = requireDb();
  return db.select().from(findings).where(eq(findings.repositoryId, repoId));
}

export async function getFixQueue(repoId: string) {
  if (isDemoMode()) return demoFixQueue;
  const db = requireDb();
  const items = await db
    .select()
    .from(fixQueueItems)
    .where(eq(fixQueueItems.repositoryId, repoId));
  return items;
}

export async function getMemory(repoId: string) {
  if (isDemoMode()) return demoMemory;
  const db = requireDb();
  return db
    .select()
    .from(memoryEvents)
    .where(eq(memoryEvents.repositoryId, repoId))
    .orderBy(desc(memoryEvents.occurredAt))
    .limit(50);
}

export async function getAuditReport(auditId: string) {
  if (isDemoMode()) {
    return {
      id: auditId,
      markdown: demoAuditMarkdown,
      findings: demoFindings,
      briefing: demoBriefing,
      score: demoScore,
      slop: demoSlop,
      repoId: DEMO_REPO_ID,
    };
  }
  return null;
}

export async function askBrain(_userId: string, question: string) {
  return answerBrainQuestion(question);
}

export { DEMO_REPO_ID, DEMO_AUDIT_ID };
