import type { FindingSeverity } from "@/lib/fix-queue/types";

export type FixQueueItemInput = {
  id: string;
  title: string;
  severity: FindingSeverity;
  effort: "xs" | "s" | "m" | "l";
  impact: "low" | "medium" | "high" | "critical";
  files: string[];
  whyItMatters: string;
  suggestedFix: string;
  canAutoPr: boolean;
  category: string;
};

const EFFORT_SCORE = { xs: 4, s: 3, m: 2, l: 1 };
const IMPACT_SCORE = { low: 1, medium: 2, high: 3, critical: 4 };
const SEVERITY_SCORE: Record<FindingSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

export function prioritizeFixQueue(items: FixQueueItemInput[]): Array<FixQueueItemInput & { priorityScore: number }> {
  return items
    .map((item) => ({
      ...item,
      priorityScore: computePriority(item),
    }))
    .sort((a, b) => b.priorityScore - a.priorityScore);
}

export function computePriority(item: FixQueueItemInput): number {
  const base =
    SEVERITY_SCORE[item.severity] * 100 +
    IMPACT_SCORE[item.impact] * 40 +
    EFFORT_SCORE[item.effort] * 15;

  let bonus = 0;
  if (item.canAutoPr) bonus += 20;
  if (item.category.includes("secret")) bonus += 50;
  if (item.category.includes("security")) bonus += 30;

  return Math.round(base + bonus);
}
