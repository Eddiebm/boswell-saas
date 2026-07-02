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
  demoStructuredReport,
  DEMO_AUDIT_ID,
  DEMO_REPO_ID,
} from "@/lib/demo/data";
import { answerBrainQuestion } from "@/lib/brain/answer";
import { askOpenRouter, buildEvidenceContext } from "@/lib/brain/openrouter";
import { requireDb } from "@/lib/db";
import { eq, desc, and } from "drizzle-orm";
import {
  auditRuns,
  findings,
  fixQueueItems,
  memoryEvents,
  repoAnswers,
  repoQuestions,
  repoScores,
  repositories,
  reports,
  scoreSnapshots,
  users,
} from "@/lib/db/schema";
import { getAuditForUser } from "@/lib/audits";
import { generateAuditReport, reportToMarkdown } from "@/lib/reports/generate-report";
import type { DailyBriefing } from "@/lib/briefing/build-briefing";
import type { RepoScoreResult } from "@/lib/scoring/types";
import { emptySlopResult, type SlopResult } from "@/lib/slop/engine";
import type { AutoFixLevel } from "@/lib/automation/safe-fix-policy";
import type { FindingClassification } from "@/lib/classification/classify";
import { canUseExecutiveDashboard, canUseLlmBrain, type PlanId } from "@/lib/plans";

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

export async function getDashboardBriefing(userId: string) {
  if (isDemoMode()) return demoBriefing;
  const repoId = await getPrimaryRepoId(userId);
  if (!repoId) return null;

  const db = requireDb();
  const runs = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.repositoryId, repoId))
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
    .where(and(eq(auditRuns.repositoryId, repoId), eq(auditRuns.status, "completed")))
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

export type AuditReportView = {
  id: string;
  status: string;
  error?: string | null;
  markdown: string;
  structured: ReturnType<typeof generateAuditReport> | null;
  findings: Array<{
    id: string;
    title: string;
    description: string;
    severity: string;
    classification: FindingClassification;
    autoFixLevel: AutoFixLevel;
    filePath?: string;
    coaching: unknown;
    evidence: string[];
  }>;
  briefing: DailyBriefing;
  score: RepoScoreResult;
  slop: SlopResult;
  repoId: string;
};

export async function getAuditReport(userId: string, auditId: string): Promise<AuditReportView | null> {
  if (isDemoMode()) {
    return {
      id: auditId,
      status: "completed",
      markdown: demoAuditMarkdown,
      structured: demoStructuredReport,
      findings: demoFindings,
      briefing: demoBriefing,
      score: demoScore,
      slop: demoSlop,
      repoId: DEMO_REPO_ID,
    };
  }

  const audit = await getAuditForUser(userId, auditId);
  if (!audit) return null;

  const { run, repo, findings: runFindings } = audit;
  const db = requireDb();
  const reportRows = await db.select().from(reports).where(eq(reports.auditRunId, auditId));
  const primaryReport = reportRows.find((r) => r.docType === "full") ?? reportRows.find((r) => r.docType === "audit") ?? reportRows[0];

  const score =
    (run.scoresJson as RepoScoreResult | null) ??
    (await getRepoScore(repo.id)) ?? {
      overall: 0,
      dimensions: {
        security: 0,
        architecture: 0,
        maintainability: 0,
        dependencies: 0,
        testing: 0,
        documentation: 0,
        complexity: 0,
        aiSlop: 0,
        releaseRisk: 0,
      },
      grade: "Unknown",
      summary: "No score yet",
    };

  const slop = (run.slopJson as SlopResult | null) ?? emptySlopResult();
  const briefing = (run.briefingJson as DailyBriefing | null) ?? {
    generatedAt: new Date().toISOString(),
    greeting: "Audit in progress",
    executiveSummary: run.summary ?? "Processing…",
    plainEnglishSummary: run.summary ?? "",
    whatChanged: [],
    newRisks: [],
    fixedRisks: [],
    ignoredRisks: [],
    regressions: [],
    improvements: [],
    classifications: { good: [], bad: [], dangerous: [], evil: [] },
    criticalFindings: [],
    suggestedActions: [],
    topPriorityAction: null,
    safePrsReady: [],
    debtHoursEstimate: 0,
    releaseReadiness: run.deployVerdict ?? "Pending",
    healthDelta: null,
  };

  const mappedFindings = runFindings.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    severity: f.severity,
    classification: (f.classification ?? "bad") as FindingClassification,
    autoFixLevel: (f.autoFixLevel ?? "red") as AutoFixLevel,
    filePath: f.filePath ?? undefined,
    coaching: f.coaching,
    evidence: (f.evidence as string[] | null) ?? [],
  }));

  let structured = (primaryReport?.structured as ReturnType<typeof generateAuditReport> | null) ?? null;
  if (!structured && run.status === "completed") {
    const fixQueue = await getFixQueue(repo.id);
    structured = generateAuditReport({
      repoName: repo.fullName,
      findings: mappedFindings.map((f) => ({
        id: f.id,
        title: f.title,
        description: f.description,
        severity: f.severity,
        classification: f.classification,
        filePath: f.filePath,
        evidence: f.evidence,
        autoFixLevel: f.autoFixLevel,
      })),
      score,
      slop,
      briefing,
      fixQueueCount: fixQueue.length,
    });
  }

  const markdown =
    primaryReport?.markdown ??
    (structured ? reportToMarkdown(structured) : audit.docs.find((d) => d.docType === "audit")?.content ?? "");

  return {
    id: auditId,
    status: run.status,
    error: run.error,
    markdown,
    structured,
    findings: mappedFindings,
    briefing,
    score,
    slop,
    repoId: repo.id,
  };
}

export async function askBrain(userId: string, question: string, repoId?: string) {
  if (isDemoMode()) {
    const result = answerBrainQuestion(question, {
      repoName: "Eddiebm/audiolens-app",
      score: demoScore,
      slop: demoSlop,
      memoryEvents: demoMemory,
      scoreHistory: demoScoreHistory.map((s) => ({ snapshotAt: s.snapshotAt, overall: s.overall })),
      recurringFindings: ["No automated tests detected"],
      fixedFindings: ["Removed tracked .env.example secret placeholder"],
      ignoredFindings: ["Legacy console.log in API route"],
      riskyFiles: ["src/app/api/process-audio/route.ts", "src/components/Dashboard.tsx"],
      briefingSummary: demoBriefing.executiveSummary,
      whatChanged: demoBriefing.whatChanged,
      topActions: demoBriefing.suggestedActions.map((a) => a.title),
      authPath: "src/middleware.ts",
      billingNote: "Stripe billing lives in the SaaS dashboard.",
    });
    return result;
  }

  const targetRepoId = repoId ?? (await getPrimaryRepoId(userId));
  if (!targetRepoId) {
    return {
      answer: "Sync a GitHub repository first, then run an audit.",
      evidence: [],
    };
  }

  const repo = await getRepository(userId, targetRepoId);
  if (!repo) {
    return { answer: "Repository not found.", evidence: [] };
  }

  const score = (await getRepoScore(targetRepoId)) ?? demoScore;
  const slop = await getSlop(targetRepoId);
  const memoryEvents = await getMemory(targetRepoId);
  const history = await getScoreHistory(targetRepoId);
  const allFindings = await getFindings(targetRepoId);
  const fixQueue = await getFixQueue(targetRepoId);
  const briefing = await getDashboardBriefing(userId);

  const db = requireDb();
  const [userRow] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const userPlan = (userRow?.plan ?? "free") as PlanId;

  const recurring = allFindings.filter((f) => f.status === "recurring").map((f) => f.title);
  const fixed = allFindings.filter((f) => f.status === "fixed").map((f) => f.title);
  const ignored = allFindings.filter((f) => f.status === "ignored").map((f) => f.title);
  const riskyFiles = [
    ...new Set(allFindings.filter((f) => f.filePath).map((f) => f.filePath!)),
  ].slice(0, 5);

  const templateResult = answerBrainQuestion(question, {
    repoName: repo.fullName,
    score,
    slop,
    memoryEvents,
    scoreHistory: history.map((h) => ({ snapshotAt: h.snapshotAt, overall: h.overall })),
    recurringFindings: recurring,
    fixedFindings: fixed,
    ignoredFindings: ignored,
    riskyFiles,
    briefingSummary: briefing?.executiveSummary ?? "Run an audit to build repository memory.",
    whatChanged: briefing?.whatChanged ?? [],
    topActions: fixQueue.slice(0, 5).map((q) => q.title),
    authPath: riskyFiles.find((f) => f.includes("middleware")) ?? "src/middleware.ts",
    billingNote: "Check /dashboard/billing for Stripe configuration.",
  });

  const evidenceContext = buildEvidenceContext({
    repoName: repo.fullName,
    score: score.overall,
    slopPercent: slop.overallPercent,
    briefingSummary: briefing?.executiveSummary ?? "",
    topFindings: allFindings.slice(0, 8).map((f) => `${f.title} (${f.filePath ?? "no file"})`),
    memoryEvents: memoryEvents.map((m) => m.summary),
    fixQueue: fixQueue.slice(0, 5).map((q) => q.title),
    riskyFiles,
  });

  const llm = canUseLlmBrain(userPlan) ? await askOpenRouter(question, evidenceContext) : null;
  const result = llm
    ? {
        answer: llm.answer,
        evidence: [...templateResult.evidence, `Model: ${llm.model}`],
      }
    : templateResult;

  const [qRow] = await db
    .insert(repoQuestions)
    .values({
      repositoryId: targetRepoId,
      userId,
      question,
    })
    .returning();

  await db.insert(repoAnswers).values({
    questionId: qRow.id,
    answer: result.answer,
    evidence: result.evidence,
  });

  return result;
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

export { DEMO_REPO_ID, DEMO_AUDIT_ID };
