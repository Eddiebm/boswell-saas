import type { MemoryEvent } from "@/lib/memory/types";

export type MemoryQueryResult = {
  question: string;
  answer: string;
  evidence: string[];
};

export function queryMemory(
  question: string,
  context: {
    events: MemoryEvent[];
    scoreHistory: Array<{ snapshotAt: string; overall: number }>;
    recurringFindings: string[];
    fixedFindings: string[];
    ignoredFindings: string[];
    riskyFiles: string[];
    lastAuditSummary?: string;
  },
): MemoryQueryResult {
  const q = question.toLowerCase();
  const evidence: string[] = [];

  if (q.includes("changed") || q.includes("since")) {
    const recent = context.events.slice(0, 5);
    recent.forEach((e) => evidence.push(`Memory event: ${e.title} (${e.occurredAt})`));
    return {
      question,
      answer: recent.length
        ? `Since the last audit: ${recent.map((e) => e.summary).join("; ")}`
        : "No recorded changes in memory yet.",
      evidence,
    };
  }

  if (q.includes("worse") || q.includes("getting worse")) {
    if (context.scoreHistory.length >= 2) {
      const latest = context.scoreHistory[0].overall;
      const prior = context.scoreHistory[context.scoreHistory.length - 1].overall;
      evidence.push(`Score: ${prior} → ${latest}`);
      if (latest < prior) {
        return {
          question,
          answer: `Health declined from ${prior} to ${latest}. Recurring issues: ${context.recurringFindings.join(", ") || "none logged"}.`,
          evidence,
        };
      }
    }
    return {
      question,
      answer: `Recurring problems: ${context.recurringFindings.join("; ") || "none recorded"}.`,
      evidence: context.recurringFindings.map((r) => `Recurring: ${r}`),
    };
  }

  if (q.includes("improved") || q.includes("fixed")) {
    context.fixedFindings.forEach((f) => evidence.push(`Fixed: ${f}`));
    return {
      question,
      answer: context.fixedFindings.length
        ? `Fixed: ${context.fixedFindings.join("; ")}`
        : "No fixed findings recorded yet.",
      evidence,
    };
  }

  if (q.includes("ignored")) {
    context.ignoredFindings.forEach((f) => evidence.push(`Ignored: ${f}`));
    return {
      question,
      answer: context.ignoredFindings.length
        ? `Ignored findings: ${context.ignoredFindings.join("; ")}`
        : "No ignored findings on record.",
      evidence,
    };
  }

  if (q.includes("warn") || q.includes("before")) {
    const warnings = context.events.filter((e) => e.eventType.includes("finding") || e.eventType.includes("risk"));
    warnings.forEach((e) => evidence.push(`${e.occurredAt}: ${e.title}`));
    return {
      question,
      answer: warnings.length
        ? warnings.map((e) => e.summary).join("; ")
        : "No prior warnings in memory.",
      evidence,
    };
  }

  if (q.includes("risky") || q.includes("files")) {
    context.riskyFiles.forEach((f) => evidence.push(`File: ${f}`));
    return {
      question,
      answer: context.riskyFiles.length
        ? `Repeatedly flagged files: ${context.riskyFiles.join(", ")}`
        : "No repeatedly risky files logged yet.",
      evidence,
    };
  }

  if (q.includes("remember")) {
    evidence.push(context.lastAuditSummary ?? "No audit summary");
    return {
      question,
      answer: context.lastAuditSummary ?? "Run an audit to build repository memory.",
      evidence,
    };
  }

  return {
    question,
    answer: "Try asking about changes, what got worse, fixes, ignored items, prior warnings, or risky files.",
    evidence: [],
  };
}
