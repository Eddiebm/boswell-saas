import { buildDailyBriefing, type DailyBriefing } from "@/lib/briefing/build-briefing";
import { buildCoaching, type CoachingSections } from "@/lib/coaching/build-coaching";
import { prioritizeFixQueue } from "@/lib/fix-queue/prioritize";
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

export const demoFindings = [
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
].map((f) => ({
  ...f,
  coaching: buildCoaching({
    title: f.title,
    description: f.description,
    severity: f.severity,
    category: f.category,
    filePath: f.filePath,
    isPositive: "isPositive" in f ? f.isPositive : false,
  }),
}));

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
      canAutoPr: f.coaching.autoFixStatus === "safe",
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
  recurringFindings: ["No automated tests detected"],
  slop: demoSlop,
  deployVerdict: "Needs fixes before production",
  commitSummary: ["3 commits since last audit", "API route touched", "Dependencies updated"],
});

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
  { snapshotAt: "2026-07-02", overall: demoScore.overall, security: demoScore.dimensions.security, architecture: demoScore.dimensions.architecture, aiSlop: demoScore.dimensions.aiSlop },
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

export const demoAuditMarkdown = `## Deploy Verdict
**Verdict:** Needs fixes before production — address HIGH items first.

## Findings
- **[HIGH]** \`src/app/api/process-audio/route.ts:18\` — API key handling needs hardening
- **[MEDIUM]** \`src/components/Dashboard.tsx:1\` — oversized component
- **[MEDIUM]** No test files detected
- **[INFO]** \`src/middleware.ts\` — auth routing is well centralized
`;

export function answerBrainQuestion(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("authentication") || q.includes("auth")) {
    return "Authentication is handled in `src/middleware.ts`, which protects `/dashboard` routes before requests reach page handlers.";
  }
  if (q.includes("billing") || q.includes("stripe")) {
    return "Billing is not fully implemented in audiolens-app. Boswell Cloud billing lives in the SaaS app under `/dashboard/billing`.";
  }
  if (q.includes("risky") || q.includes("risk")) {
    return `This repo scores ${demoScore.overall}/1000. Top risks: missing tests, API key handling, and ${demoSlop.overallPercent}% AI slop indicators.`;
  }
  if (q.includes("review first") || q.includes("files")) {
    return "Review first: `src/app/api/process-audio/route.ts`, `src/components/Dashboard.tsx`, and any file flagged in the AI Slop report.";
  }
  if (q.includes("changed") || q.includes("last audit")) {
    return demoBriefing.whatChanged.join("; ");
  }
  if (q.includes("debt")) {
    return "Biggest technical debt: no automated tests, one oversized component, and repeated generic helper patterns (AI slop).";
  }
  if (q.includes("fix today") || q.includes("today")) {
    return demoBriefing.suggestedActions.map((a) => a.title).join("; ") || "No urgent actions.";
  }
  if (q.includes("ai") || q.includes("slop")) {
    return `AI Slop Score is ${demoSlop.overallPercent}%. Top cause: ${demoSlop.topCauses[0]?.label ?? "none"}.`;
  }
  return "I can answer questions about auth, billing, risks, files to review, changes since last audit, tech debt, and AI slop. Try rephrasing with one of those topics.";
}

export type { CoachingSections };
