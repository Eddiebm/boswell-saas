import type { FindingClassification } from "@/lib/classification/classify";

export type FindingPriority = "fix-now" | "fix-next" | "later";

export type PrioritizedFinding = {
  id: string;
  title: string;
  description: string;
  severity: string;
  classification: FindingClassification;
  filePath?: string;
  priority: FindingPriority;
  priorityLabel: string;
};

export function priorityForFinding(input: {
  severity: string;
  classification: FindingClassification;
}): FindingPriority {
  if (
    input.classification === "evil" ||
    input.classification === "dangerous" ||
    input.severity === "CRITICAL" ||
    input.severity === "HIGH"
  ) {
    return "fix-now";
  }

  if (input.classification === "bad" || input.severity === "MEDIUM") {
    return "fix-next";
  }

  return "later";
}

export function priorityLabel(priority: FindingPriority): string {
  switch (priority) {
    case "fix-now":
      return "Fix now";
    case "fix-next":
      return "Fix next";
    case "later":
      return "Can wait";
    default: {
      const _exhaustive: never = priority;
      return _exhaustive;
    }
  }
}

export function prioritizeFindings<T extends {
  id: string;
  title: string;
  description: string;
  severity: string;
  classification: FindingClassification;
  filePath?: string;
}>(findings: T[]): Array<T & { priority: FindingPriority; priorityLabel: string }> {
  return findings.map((finding) => {
    const priority = priorityForFinding(finding);
    return {
      ...finding,
      priority,
      priorityLabel: priorityLabel(priority),
    };
  });
}

export function groupByPriority<T extends { priority: FindingPriority }>(findings: T[]) {
  return {
    fixNow: findings.filter((f) => f.priority === "fix-now"),
    fixNext: findings.filter((f) => f.priority === "fix-next"),
    later: findings.filter((f) => f.priority === "later"),
  };
}
