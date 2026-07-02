import { buildDailyBriefing, type DailyBriefing } from "@/lib/briefing/build-briefing";
import { buildCoaching, type CoachingSections } from "@/lib/coaching/build-coaching";
import { enrichFinding } from "@/lib/enrich/finding";
import { groupByClassification } from "@/lib/classification/classify";
import { prioritizeFixQueue } from "@/lib/fix-queue/prioritize";
import { generateAuditReport, reportToMarkdown } from "@/lib/reports/generate-report";
import { computeRepoScore } from "@/lib/scoring/engine";
import type { RepoScoreResult } from "@/lib/scoring/types";
import { scanAiSlop, type SlopResult } from "@/lib/slop/engine";
import type { ScoreInput } from "@/lib/scoring/types";

export const DEMO_USER_ID = "demo-user";
export const DEMO_REPO_ID = "demo-repo-audiolens";
export const DEMO_AUDIT_ID = "demo-audit-1";

const demoScoreInput: ScoreInput = {
  criticalFindings: 0,
  highFindings: 2,
  mediumFindings: 4,
  giantFiles: 1,
  circularDeps: 0,
  depCount: 28,
  missingLockfile: false,
  hasReadme: true,
  hasTests: false,
  testFileCount: 0,
  sourceFileCount: 42,
  avgFileLines: 145,
  maxFileLines: 520,
  slopPercent: 34,
  deployVerdict: "Needs fixes before production",
  outdatedDeps: 3,
};

const demoSlopFiles = [
  {
    path: "src/lib/utils.ts",
    lines: 180,
    content: `export function handleData(x: unknown) { /* TODO: implement */ console.log(x); }\nexport function processData(y: unknown) { try {} catch(e) {} }`,
  },
  {
    path: "src/components/Helper.tsx",
    lines: 420,
    content: `// placeholder component\nfunction Wrapper() { return null }\n// FIXME add logic here`,
  },
  {
    path: "src/app/api/route.ts",
    lines: 95,
    content: `export async function GET() { console.log('debug'); return Response.json({ ok: true }) }`,
  },
];

export const demoSlop: SlopResult = scanAiSlop({
  files: demoSlopFiles,
});

export const demoScore: RepoScoreResult = computeRepoScore({
  ...demoScoreInput,
  slopPercent: demoSlop.overallPercent,
});

export const demoPreviousScore = 712;

const rawFindings = [
  {
    id: "f1",
    repositoryId: DEMO_REPO_ID,
    auditRunId: DEMO_AUDIT_ID,
    title: "Missing server-side API key validation",
    description: "[HIGH] `src/app/api/process-audio/route.ts:18` — OPENROUTER_API_KEY checked only at runtime without clear error boundary.",
    severity: "HIGH" as const,
    category: "security",
    filePath: "src/app/api/process-audio/route.ts",
    lineStart: 18,
    status: "open" as const,
    confidence: 0.91,
    autoFixable: false,
  },
  {
    id: "f2",
    repositoryId: DEMO_REPO_ID,
    auditRunId: DEMO_AUDIT_ID,
    title: "Large component file hurts maintainability",
    description: "[MEDIUM] `src/components/Dashboard.tsx:1` — 520 lines; consider splitting UI sections.",
    severity: "MEDIUM" as const,
    category: "architecture",
    filePath: "src/components/Dashboard.tsx",
    lineStart: 1,
    status: "open" as const,
    confidence: 0.88,
    autoFixable: false,
  },
  {
    id: "f3",
    repositoryId: DEMO_REPO_ID,
    auditRunId: DEMO_AUDIT_ID,
    title: "No automated tests detected",
    description: "[MEDIUM] No test files found — regressions may ship unnoticed.",
    severity: "MEDIUM" as const,
    category: "testing",
    status: "recurring" as const,
    confidence: 0.95,
    autoFixable: false,
  },
  {
    id: "f4",
    repositoryId: DEMO_REPO_ID,
    auditRunId: DEMO_AUDIT_ID,
    title: "Well-structured auth middleware",
    description: "[INFO] `src/middleware.ts` — single entry point for protected routes.",
    severity: "INFO" as const,
    category: "auth",
    filePath: "src/middleware.ts",
    status: "open" as const,
    confidence: 0.9,
    autoFixable: false,
    isPositive: true,
  },
  {
    id: "f5",
    repositoryId: DEMO_REPO_ID,
    auditRunId: DEMO_AUDIT_ID,
    title: "Unused helper file with placeholder logic",
    description: "[LOW] `src/lib/legacy-helper.ts` — dead code candidate, generic TODO comments.",
    severity: "LOW" as const,
    category: "documentation",
    filePath: "src/lib/legacy-helper.ts",
    status: "open" as const,
    confidence: 0.82,
    autoFixable: true,
  },
];

export const demoFindings = rawFindings.map((f) => {
  const enriched = enrichFinding({
    title: f.title,
    description: f.description,
    severity: f.severity,
    category: f.category,
    isPositive: "isPositive" in f ? f.isPositive : false,
  });
  return {
    ...f,
    ...enriched,
    evidence: f.filePath ? [`${f.filePath}:${f.lineStart ?? 1}`] : [],
    recommendation: enriched.classification === "good" ? "Keep this pattern." : "Review and remediate.",
    fixSteps: enriched.canOpenPr
      ? "Boswell can open a safe PR after you confirm."
      : "Manual review required before any automated change.",
    coaching: buildCoaching({
      title: f.title,
      description: f.description,
      severity: f.severity,
      category: f.category,
      filePath: f.filePath,
      isPositive: "isPositive" in f ? f.isPositive : false,
    }),
  };
});

const classifiedGroups = groupByClassification(
  demoFindings.map((f) => ({ ...f, classification: f.classification })),
);

export const demoFixQueue = prioritizeFixQueue(
  demoFindings
    .filter((f) => f.severity !== "INFO")
    .map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      effort: f.severity === "HIGH" ? ("m" as const) : ("s" as const),
      impact: f.severity === "HIGH" ? ("high" as const) : ("medium" as const),
      files: f.filePath ? [f.filePath] : [],
      whyItMatters: f.coaching.whyBad ?? f.coaching.whatHappened,
      suggestedFix: f.coaching.howToFix,
      canAutoPr: f.autoFixLevel === "green",
      category: f.category,
    })),
);

export const demoBriefing: DailyBriefing = buildDailyBriefing({
  repoName: "Eddiebm/audiolens-app",
  currentScore: demoScore,
  previousOverall: demoPreviousScore,
  newFindings: demoFindings
    .filter((f) => (["HIGH", "CRITICAL"] as string[]).includes(f.severity))
    .map((f) => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      href: `/dashboard/audits/${DEMO_AUDIT_ID}#${f.id}`,
    })),
  fixedFindings: ["Removed tracked .env.example secret placeholder"],
  ignoredFindings: ["Legacy console.log in API route (accepted risk)"],
  recurringFindings: ["No automated tests detected"],
  classifications: {
    good: classifiedGroups.good.map((f) => f.title),
    bad: classifiedGroups.bad.map((f) => f.title),
    dangerous: classifiedGroups.dangerous.map((f) => f.title),
    evil: classifiedGroups.evil.map((f) => f.title),
  },
  safePrTitles: demoFindings.filter((f) => f.autoFixLevel === "green").map((f) => f.title),
  slop: demoSlop,
  deployVerdict: "Needs fixes before production",
  commitSummary: ["3 commits since last audit", "API route touched", "Dependencies updated"],
});

export const demoStructuredReport = generateAuditReport({
  repoName: "Eddiebm/audiolens-app",
  findings: demoFindings.map((f) => ({
    id: f.id,
    title: f.title,
    description: f.description,
    severity: f.severity,
    classification: f.classification,
    filePath: f.filePath,
    evidence: f.evidence,
    autoFixLevel: f.autoFixLevel,
  })),
  score: demoScore,
  slop: demoSlop,
  briefing: demoBriefing,
  fixQueueCount: demoFixQueue.length,
});

export const demoAuditMarkdown = reportToMarkdown(demoStructuredReport);

export const demoMemory = [
  {
    id: "m1",
    eventType: "finding_recurring",
    title: "Testing gap keeps reappearing",
    summary: "No test files found in 3 consecutive audits.",
    occurredAt: "2026-07-01T10:00:00Z",
  },
  {
    id: "m2",
    eventType: "finding_fixed",
    title: "Gitignore gap resolved",
    summary: ".env patterns added and verified.",
    occurredAt: "2026-06-28T14:30:00Z",
  },
  {
    id: "m3",
    eventType: "score_change",
    title: "Health score improved then regressed",
    summary: "Score went 680 → 745 → 698 over three audits.",
    occurredAt: "2026-07-02T08:00:00Z",
  },
  {
    id: "m4",
    eventType: "dependency_change",
    title: "Next.js minor bump",
    summary: "next 16.2.x → 16.2.10",
    occurredAt: "2026-06-30T09:15:00Z",
  },
];

export const demoScoreHistory = [
  { snapshotAt: "2026-06-15", overall: 680, security: 720, architecture: 650, aiSlop: 600 },
  { snapshotAt: "2026-06-22", overall: 712, security: 740, architecture: 670, aiSlop: 580 },
  { snapshotAt: "2026-06-29", overall: 745, security: 780, architecture: 710, aiSlop: 550 },
  {
    snapshotAt: "2026-07-02",
    overall: demoScore.overall,
    security: demoScore.dimensions.security,
    architecture: demoScore.dimensions.architecture,
    aiSlop: demoScore.dimensions.aiSlop,
  },
];

export const demoRepos = [
  {
    id: DEMO_REPO_ID,
    fullName: "Eddiebm/audiolens-app",
    description: "Next.js web companion for AudioLens",
    healthScore: demoScore.overall,
    slopPercent: demoSlop.overallPercent,
    lastAuditAt: "2026-07-02T08:00:00Z",
  },
  {
    id: "demo-repo-boswell",
    fullName: "Eddiebm/boswell",
    description: "Universal repo auditor engine",
    healthScore: 810,
    slopPercent: 18,
    lastAuditAt: "2026-07-01T12:00:00Z",
  },
];

export { answerBrainQuestion } from "@/lib/brain/answer";
export type { CoachingSections };
