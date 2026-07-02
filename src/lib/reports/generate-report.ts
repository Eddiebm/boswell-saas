import type { FindingClassification } from "@/lib/classification/classify";
import type { AutoFixLevel } from "@/lib/automation/safe-fix-policy";
import type { DailyBriefing } from "@/lib/briefing/build-briefing";
import type { RepoScoreResult } from "@/lib/scoring/types";
import type { SlopResult } from "@/lib/slop/engine";

export type ReportFinding = {
  id: string;
  title: string;
  description: string;
  severity: string;
  classification: FindingClassification;
  filePath?: string;
  evidence: string[];
  autoFixLevel: AutoFixLevel;
};

export type AuditReport = {
  executiveSummary: string;
  developerSummary: string;
  good: ReportFinding[];
  bad: ReportFinding[];
  dangerous: ReportFinding[];
  evil: ReportFinding[];
  score: RepoScoreResult;
  slop: SlopResult;
  briefing: DailyBriefing;
  debtHoursEstimate: number;
  fixQueueCount: number;
  safePrCount: number;
  generatedAt: string;
};

export function generateAuditReport(input: {
  repoName: string;
  findings: ReportFinding[];
  score: RepoScoreResult;
  slop: SlopResult;
  briefing: DailyBriefing;
  fixQueueCount: number;
}): AuditReport {
  const good = input.findings.filter((f) => f.classification === "good");
  const bad = input.findings.filter((f) => f.classification === "bad");
  const dangerous = input.findings.filter((f) => f.classification === "dangerous");
  const evil = input.findings.filter((f) => f.classification === "evil");
  const safePrCount = input.findings.filter((f) => f.autoFixLevel === "green").length;

  const debtHoursEstimate = estimateDebtHours(input.findings);

  return {
    executiveSummary: input.briefing.executiveSummary,
    developerSummary: `${input.repoName}: ${input.findings.length} findings — ${dangerous.length} dangerous, ${evil.length} evil, ${bad.length} bad, ${good.length} good.`,
    good,
    bad,
    dangerous,
    evil,
    score: input.score,
    slop: input.slop,
    briefing: input.briefing,
    debtHoursEstimate,
    fixQueueCount: input.fixQueueCount,
    safePrCount,
    generatedAt: new Date().toISOString(),
  };
}

export function reportToMarkdown(report: AuditReport): string {
  const sections = [
    `# Audit Report`,
    ``,
    `*Generated ${report.generatedAt}*`,
    ``,
    `## Executive summary`,
    report.executiveSummary,
    ``,
    `## Developer summary`,
    report.developerSummary,
    ``,
    `## Health score: ${report.score.overall}/1000`,
    report.score.summary,
    ``,
    `## AI Slop: ${report.slop.overallPercent}%`,
    `Human review confidence: ${report.slop.humanReviewConfidence}%`,
    ``,
    `## Technical debt estimate`,
    `~${report.debtHoursEstimate} engineering hours`,
    ``,
    sectionFindings("Good", report.good),
    sectionFindings("Bad", report.bad),
    sectionFindings("Dangerous", report.dangerous),
    sectionFindings("Evil", report.evil),
    `## Fix queue`,
    `${report.fixQueueCount} items prioritized. ${report.safePrCount} safe for automated PR.`,
    ``,
    `## Explain like I'm new`,
    `Your codebase scored ${report.score.overall} out of 1000. Think of it like a health checkup — ${report.dangerous.length + report.evil.length} items need urgent attention, and Boswell suggests fixing the top ${Math.min(3, report.fixQueueCount)} first.`,
  ];
  return sections.join("\n");
}

function sectionFindings(label: string, items: ReportFinding[]): string {
  if (!items.length) return `## ${label}\n\nNone.\n`;
  return (
    `## ${label}\n\n` +
    items
      .map(
        (f) =>
          `- **${f.title}** (${f.severity})${f.filePath ? ` — \`${f.filePath}\`` : ""}\n  ${f.description.slice(0, 200)}`,
      )
      .join("\n") +
    `\n`
  );
}

function estimateDebtHours(findings: ReportFinding[]): number {
  let hours = 0;
  for (const f of findings) {
    if (f.classification === "evil") hours += 8;
    else if (f.classification === "dangerous") hours += 4;
    else if (f.classification === "bad") hours += 1.5;
  }
  return Math.round(hours);
}
