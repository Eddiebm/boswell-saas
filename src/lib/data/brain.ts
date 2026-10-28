import { isDemoMode } from "@/lib/demo/mode";
import {
  demoBriefing,
  demoMemory,
  demoScore,
  demoScoreHistory,
  demoSlop,
} from "@/lib/demo/data";
import { answerBrainQuestion } from "@/lib/brain/answer";
import { askOpenRouter, buildEvidenceContext } from "@/lib/brain/openrouter";
import { requireDb } from "@/lib/db";
import { eq } from "drizzle-orm";
import { repoAnswers, repoQuestions, users } from "@/lib/db/schema";
import { canUseLlmBrain, type PlanId } from "@/lib/plans";
import {
  getDashboardBriefing,
  getFindings,
  getFixQueue,
  getMemory,
  getPrimaryRepoId,
  getRepoScore,
  getRepository,
  getScoreHistory,
  getSlop,
} from "./repos";

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
    return { ...result, source: "demo" as const };
  }

  const targetRepoId = repoId ?? (await getPrimaryRepoId(userId));
  if (!targetRepoId) {
    return {
      answer: "Sync a GitHub repository first, then run an audit.",
      evidence: [],
      source: "template" as const,
    };
  }

  const repo = await getRepository(userId, targetRepoId);
  if (!repo) {
    return { answer: "Repository not found.", evidence: [], source: "template" as const };
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
        source: "llm" as const,
      }
    : { ...templateResult, source: "template" as const };

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
