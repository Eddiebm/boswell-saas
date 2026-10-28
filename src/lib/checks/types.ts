export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type RepoFile = { path: string; content: string };

/**
 * A finding produced by one of Boswell's own repo checks, in the same shape
 * the worker already persists for engine findings, plus a confidence score.
 * Deterministic checks report ~0.9+; pattern-based checks that need a human
 * to confirm report lower and say so in their description.
 */
export type CheckFinding = {
  severity: Severity;
  category: string;
  title: string;
  description: string;
  filePath?: string;
  lineStart?: number;
  recommendation?: string;
  confidence: number;
};

export function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}
