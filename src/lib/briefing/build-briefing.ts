import type { SlopResult } from "@/lib/slop/engine";
import type { RepoScoreResult } from "@/lib/scoring/types";

export type BriefingAction = {
  id: string;
  title: string;
  severity: string;
  href: string;
  effort: string;
};

export type DailyBriefing = {
  generatedAt: string;
  greeting: string;
  executiveSummary: string;
  whatChanged: string[];
  newRisks: string[];
  regressions: string[];
  improvements: string[];
  criticalFindings: BriefingAction[];
  suggestedActions: BriefingAction[];
  releaseReadiness: string;
  healthDelta: number | null;
};

type BriefingInput = {
  repoName: string;
  currentScore?: RepoScoreResult;
  previousOverall?: number;
  newFindings: Array<{ id: string; title: string; severity: string; href: string }>;
  fixedFindings: string[];
  recurringFindings: string[];
  slop?: SlopResult;
  deployVerdict?: string;
  commitSummary?: string[];
};

export function buildDailyBriefing(input: BriefingInput): DailyBriefing {
  const healthDelta =
    input.currentScore && input.previousOverall != null
      ? input.currentScore.overall - input.previousOverall
      : null;

  const critical = input.newFindings.filter((f) => f.severity === "CRITICAL" || f.severity === "HIGH");

  const regressions: string[] = [];
  if (healthDelta != null && healthDelta < -30) {
    regressions.push(`Health score dropped ${Math.abs(healthDelta)} points since last audit.`);
  }
  regressions.push(...input.recurringFindings.slice(0, 3).map((r) => `Recurring: ${r}`));

  const improvements: string[] = [...input.fixedFindings.slice(0, 3)];
  if (healthDelta != null && healthDelta > 20) {
    improvements.push(`Health score improved by ${healthDelta} points.`);
  }

  const whatChanged = [
    ...(input.commitSummary ?? []).slice(0, 4),
    `${input.newFindings.length} new findings since last audit`,
    ...(input.slop ? [`AI Slop Score: ${input.slop.overallPercent}%`] : []),
  ];

  const suggestedActions: BriefingAction[] = critical.slice(0, 5).map((f) => ({
    id: f.id,
    title: f.title,
    severity: f.severity,
    href: f.href,
    effort: f.severity === "CRITICAL" ? "1–4 hours" : "30–90 min",
  }));

  if (suggestedActions.length < 3 && input.slop?.topCauses[0]) {
    suggestedActions.push({
      id: "slop-1",
      title: `Reduce AI slop: ${input.slop.topCauses[0].label}`,
      severity: "MEDIUM",
      href: "#slop",
      effort: "1–2 hours",
    });
  }

  const releaseReadiness =
    input.deployVerdict ??
    (critical.length > 0 ? "Not ready — address critical/high items first." : "Likely ready for careful release.");

  return {
    generatedAt: new Date().toISOString(),
    greeting: "Good morning — here is your engineering briefing.",
    executiveSummary: buildExecutiveSummary(input, critical.length, healthDelta),
    whatChanged,
    newRisks: critical.map((f) => f.title),
    regressions,
    improvements,
    criticalFindings: suggestedActions.filter((a) => a.severity === "CRITICAL" || a.severity === "HIGH"),
    suggestedActions,
    releaseReadiness,
    healthDelta,
  };
}

function buildExecutiveSummary(
  input: BriefingInput,
  criticalCount: number,
  healthDelta: number | null,
): string {
  const score = input.currentScore?.overall ?? "—";
  const trend =
    healthDelta == null ? "" : healthDelta >= 0 ? ` (↑${healthDelta})` : ` (↓${Math.abs(healthDelta)})`;
  if (criticalCount > 0) {
    return `${input.repoName} scores ${score}/1000${trend}. ${criticalCount} high-priority items need attention today.`;
  }
  return `${input.repoName} scores ${score}/1000${trend}. No critical blockers — focus on top suggested improvements.`;
}
