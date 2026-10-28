import { isDemoMode } from "@/lib/demo/mode";
import {
  demoAuditMarkdown,
  demoBriefing,
  demoDependencyFixes,
  demoFindings,
  demoScore,
  demoSlop,
  demoStructuredReport,
  DEMO_REPO_ID,
} from "@/lib/demo/data";
import { requireDb } from "@/lib/db";
import { eq } from "drizzle-orm";
import { dependencyFixes, reports } from "@/lib/db/schema";
import { getAuditForUser } from "@/lib/audits";
import { normalizeAuditMode, type AuditMode } from "@/lib/audit-modes";
import { generateAuditReport, reportToMarkdown } from "@/lib/reports/generate-report";
import { buildFixPrompt } from "@/lib/reports/fix-prompt";
import { buildOwaspTop10Summary, mapFindingToOwasp, type OwaspTop10Summary } from "@/lib/reports/owasp-top10";
import { groupByPriority, prioritizeFindings } from "@/lib/reports/prioritize-findings";
import type { DailyBriefing } from "@/lib/briefing/build-briefing";
import type { CoachingSections } from "@/lib/coaching/build-coaching";
import type { RepoScoreResult } from "@/lib/scoring/types";
import { emptySlopResult, type SlopResult } from "@/lib/slop/engine";
import type { AutoFixLevel } from "@/lib/automation/safe-fix-policy";
import type { FindingClassification } from "@/lib/classification/classify";
import type { DependencyFixView } from "@/components/dependency-fix-card";
import { getFixQueue, getRepoScore } from "./repos";

export type AuditFindingView = {
  id: string;
  title: string;
  description: string;
  severity: string;
  classification: FindingClassification;
  autoFixLevel: AutoFixLevel;
  filePath?: string;
  coaching: unknown;
  evidence: string[];
  priority: ReturnType<typeof prioritizeFindings>[number]["priority"];
  priorityLabel: string;
  owaspCode?: string;
  owaspName?: string;
};

export type AuditReportView = {
  id: string;
  status: string;
  error?: string | null;
  createdAt?: Date | null;
  startedAt?: Date | null;
  repoFullName: string;
  auditMode: AuditMode;
  costUsd?: string | null;
  consumerSummary: string;
  fixPrompt: string;
  markdown: string;
  structured: ReturnType<typeof generateAuditReport> | null;
  findings: AuditFindingView[];
  priorityGroups: {
    fixNow: AuditFindingView[];
    fixNext: AuditFindingView[];
    later: AuditFindingView[];
  };
  owaspSummary: OwaspTop10Summary;
  briefing: DailyBriefing;
  score: RepoScoreResult;
  slop: SlopResult;
  repoId: string;
};

export async function getAuditReport(userId: string, auditId: string): Promise<AuditReportView | null> {
  if (isDemoMode()) {
    const demoPrioritized = prioritizeFindings(demoFindings);
    const demoOwasp = buildOwaspTop10Summary(
      demoFindings.map((f) => ({
        id: f.id,
        title: f.title,
        description: f.description,
        severity: f.severity,
        category: f.category,
        filePath: f.filePath,
      })),
    );
    const demoWithOwasp = demoPrioritized.map((f) => {
      const owasp = mapFindingToOwasp({
        id: f.id,
        title: f.title,
        description: f.description,
        severity: f.severity,
        filePath: f.filePath,
      });
      return {
        ...f,
        owaspCode: owasp.owaspId !== "none" ? owasp.owaspCode : undefined,
        owaspName: owasp.owaspId !== "none" ? owasp.owaspName : undefined,
      };
    });
    const demoPrompt = buildFixPrompt({
      repoName: "Eddiebm/audiolens-app",
      stack: ["Next.js", "React"],
      consumerSummary: demoBriefing.plainEnglishSummary,
      releaseReadiness: demoBriefing.releaseReadiness,
      briefing: demoBriefing,
      findings: demoFindings,
      costUsd: "0.32",
    });
    return {
      id: auditId,
      status: "completed",
      repoFullName: "Eddiebm/audiolens-app",
      auditMode: "standard",
      costUsd: "0.32",
      consumerSummary: demoBriefing.plainEnglishSummary,
      fixPrompt: demoPrompt,
      markdown: demoAuditMarkdown,
      structured: demoStructuredReport,
      findings: demoWithOwasp,
      priorityGroups: groupByPriority(demoWithOwasp),
      owaspSummary: demoOwasp,
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

  const mappedFindings = prioritizeFindings(
    runFindings.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      severity: f.severity,
      classification: (f.classification ?? "bad") as FindingClassification,
      autoFixLevel: (f.autoFixLevel ?? "red") as AutoFixLevel,
      filePath: f.filePath ?? undefined,
      category: f.category,
      coaching: f.coaching,
      evidence: (f.evidence as string[] | null) ?? [],
    })),
  );

  const owaspSummary = buildOwaspTop10Summary(
    mappedFindings.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      severity: f.severity,
      category: (f as { category?: string }).category,
      filePath: f.filePath,
    })),
  );

  const findingsWithOwasp = mappedFindings.map((f) => {
    const owasp = mapFindingToOwasp({
      id: f.id,
      title: f.title,
      description: f.description,
      severity: f.severity,
      category: (f as { category?: string }).category,
      filePath: f.filePath,
    });
    return {
      ...f,
      owaspCode: owasp.owaspId !== "none" ? owasp.owaspCode : undefined,
      owaspName: owasp.owaspId !== "none" ? owasp.owaspName : undefined,
    };
  });

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

  const consumerSummary =
    audit.docs.find((d) => d.docType === "audit-simple")?.content ??
    briefing.plainEnglishSummary ??
    run.summary ??
    "";

  const fixPrompt = buildFixPrompt({
    repoName: repo.fullName,
    stack: (run.stack as string[] | null) ?? [],
    consumerSummary,
    releaseReadiness: briefing.releaseReadiness,
    topRisk: run.topRisk,
    briefing,
    findings: mappedFindings.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      severity: f.severity,
      classification: f.classification,
      filePath: f.filePath,
      category: (f as { category?: string }).category,
      coaching: f.coaching as CoachingSections | null,
    })),
    costUsd: run.costUsd,
  });

  return {
    id: auditId,
    status: run.status,
    error: run.error,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    repoFullName: repo.fullName,
    auditMode: normalizeAuditMode(run.auditMode),
    costUsd: run.costUsd,
    consumerSummary,
    fixPrompt,
    markdown,
    structured,
    findings: findingsWithOwasp,
    priorityGroups: groupByPriority(findingsWithOwasp),
    owaspSummary,
    briefing,
    score,
    slop,
    repoId: repo.id,
  };
}

export async function getDependencyFixesForAudit(userId: string, auditId: string): Promise<DependencyFixView[]> {
  if (isDemoMode()) return demoDependencyFixes;
  const audit = await getAuditForUser(userId, auditId);
  if (!audit) return [];
  const db = requireDb();
  const rows = await db
    .select({
      id: dependencyFixes.id,
      lockfilePath: dependencyFixes.lockfilePath,
      status: dependencyFixes.status,
      prUrl: dependencyFixes.prUrl,
      changes: dependencyFixes.changes,
      pinBumps: dependencyFixes.pinBumps,
      beforeCounts: dependencyFixes.beforeCounts,
      afterCounts: dependencyFixes.afterCounts,
    })
    .from(dependencyFixes)
    .where(eq(dependencyFixes.auditRunId, auditId));
  return rows.map(({ changes, ...row }) => ({ ...row, changeCount: changes.length }));
}
