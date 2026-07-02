export type ScoreDimension =
  | "security"
  | "architecture"
  | "maintainability"
  | "dependencies"
  | "testing"
  | "documentation"
  | "complexity"
  | "aiSlop"
  | "releaseRisk";

export type DimensionScores = Record<ScoreDimension, number>;

export const SCORE_WEIGHTS: Record<ScoreDimension, number> = {
  security: 0.25,
  architecture: 0.2,
  maintainability: 0.15,
  dependencies: 0.1,
  testing: 0.1,
  documentation: 0.05,
  complexity: 0.05,
  aiSlop: 0.05,
  releaseRisk: 0.05,
};

export type RepoScoreResult = {
  overall: number;
  dimensions: DimensionScores;
  grade: string;
  summary: string;
};

export type ScoreInput = {
  criticalFindings: number;
  highFindings: number;
  mediumFindings: number;
  giantFiles: number;
  circularDeps: number;
  depCount: number;
  missingLockfile: boolean;
  hasReadme: boolean;
  hasTests: boolean;
  testFileCount: number;
  sourceFileCount: number;
  avgFileLines: number;
  maxFileLines: number;
  slopPercent: number;
  deployVerdict?: string;
  outdatedDeps?: number;
};
