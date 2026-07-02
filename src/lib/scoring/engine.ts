import {
  SCORE_WEIGHTS,
  type DimensionScores,
  type RepoScoreResult,
  type ScoreInput,
  type ScoreDimension,
} from "./types";

/** Clamp sub-score to 0–1000 where higher is healthier. */
function clamp(n: number) {
  return Math.max(0, Math.min(1000, Math.round(n)));
}

function securityScore(input: ScoreInput): number {
  let penalty = input.criticalFindings * 200 + input.highFindings * 80 + input.mediumFindings * 25;
  return clamp(1000 - penalty);
}

function architectureScore(input: ScoreInput): number {
  let penalty = input.giantFiles * 40 + input.circularDeps * 120;
  return clamp(1000 - penalty);
}

function maintainabilityScore(input: ScoreInput): number {
  let penalty = 0;
  if (input.avgFileLines > 200) penalty += 150;
  else if (input.avgFileLines > 120) penalty += 60;
  if (input.maxFileLines > 800) penalty += 120;
  return clamp(1000 - penalty);
}

function dependenciesScore(input: ScoreInput): number {
  let penalty = 0;
  if (input.missingLockfile) penalty += 200;
  if (input.depCount > 60) penalty += 150;
  else if (input.depCount > 35) penalty += 70;
  penalty += (input.outdatedDeps ?? 0) * 15;
  return clamp(1000 - penalty);
}

function testingScore(input: ScoreInput): number {
  if (!input.hasTests) return 200;
  const ratio = input.sourceFileCount > 0 ? input.testFileCount / input.sourceFileCount : 0;
  if (ratio >= 0.4) return 950;
  if (ratio >= 0.2) return 750;
  if (ratio >= 0.1) return 550;
  return 350;
}

function documentationScore(input: ScoreInput): number {
  return input.hasReadme ? 850 : 300;
}

function complexityScore(input: ScoreInput): number {
  let penalty = 0;
  if (input.sourceFileCount > 200) penalty += 120;
  if (input.maxFileLines > 1000) penalty += 100;
  return clamp(1000 - penalty);
}

function aiSlopScore(input: ScoreInput): number {
  return clamp(1000 - input.slopPercent * 10);
}

function releaseRiskScore(input: ScoreInput): number {
  const verdict = (input.deployVerdict ?? "").toLowerCase();
  if (verdict.includes("do not deploy")) return 150;
  if (verdict.includes("could deploy")) return 900;
  if (input.criticalFindings > 0) return 200;
  if (input.highFindings > 2) return 400;
  return 700;
}

function gradeFromOverall(overall: number): string {
  if (overall >= 900) return "Excellent";
  if (overall >= 750) return "Healthy";
  if (overall >= 600) return "Stable";
  if (overall >= 450) return "Drifting";
  if (overall >= 300) return "Degraded";
  return "Critical";
}

export function computeRepoScore(input: ScoreInput): RepoScoreResult {
  const dimensions: DimensionScores = {
    security: securityScore(input),
    architecture: architectureScore(input),
    maintainability: maintainabilityScore(input),
    dependencies: dependenciesScore(input),
    testing: testingScore(input),
    documentation: documentationScore(input),
    complexity: complexityScore(input),
    aiSlop: aiSlopScore(input),
    releaseRisk: releaseRiskScore(input),
  };

  let overall = 0;
  for (const key of Object.keys(SCORE_WEIGHTS) as ScoreDimension[]) {
    overall += dimensions[key] * SCORE_WEIGHTS[key];
  }

  const rounded = clamp(overall);
  return {
    overall: rounded,
    dimensions,
    grade: gradeFromOverall(rounded),
    summary: `Overall health ${rounded}/1000 (${gradeFromOverall(rounded)}). Security ${dimensions.security}, architecture ${dimensions.architecture}.`,
  };
}

export function compareScores(
  current: DimensionScores,
  previous: DimensionScores,
): Record<ScoreDimension, number> {
  const delta = {} as Record<ScoreDimension, number>;
  for (const key of Object.keys(current) as ScoreDimension[]) {
    delta[key] = current[key] - previous[key];
  }
  return delta;
}
