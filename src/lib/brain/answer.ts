import { queryMemory } from "@/lib/memory/queries";
import type { MemoryEvent } from "@/lib/memory/types";
import type { RepoScoreResult } from "@/lib/scoring/types";
import type { SlopResult } from "@/lib/slop/engine";

export type BrainAnswer = {
  answer: string;
  evidence: string[];
};

type BrainContext = {
  repoName: string;
  score: RepoScoreResult;
  slop: SlopResult;
  memoryEvents: MemoryEvent[];
  scoreHistory: Array<{ snapshotAt: string; overall: number }>;
  recurringFindings: string[];
  fixedFindings: string[];
  ignoredFindings: string[];
  riskyFiles: string[];
  briefingSummary: string;
  whatChanged: string[];
  topActions: string[];
  authPath?: string;
  billingNote?: string;
};

export function answerBrainQuestion(question: string, ctx: BrainContext): BrainAnswer {
  const q = question.toLowerCase();
  const evidence: string[] = [];

  if (q.includes("authentication") || q.includes("auth")) {
    const path = ctx.authPath ?? "src/middleware.ts";
    evidence.push(`File: ${path}`);
    return {
      answer: `Authentication is handled in \`${path}\`, which protects dashboard routes before requests reach page handlers.`,
      evidence,
    };
  }

  if (q.includes("billing") || q.includes("stripe")) {
    evidence.push("Finding: billing integration status from audit memory");
    return {
      answer:
        ctx.billingNote ??
        "Billing is configured in the SaaS app under `/dashboard/billing`. Check Stripe env vars for live mode.",
      evidence,
    };
  }

  if (q.includes("dangerous") || q.includes("evil")) {
    evidence.push(`Health score: ${ctx.score.overall}/1000`);
    evidence.push(`Top action: ${ctx.topActions[0] ?? "none"}`);
    return {
      answer: `Dangerous items are tracked in the fix queue and audit report. Top priority today: ${ctx.topActions[0] ?? "run an audit first"}.`,
      evidence,
    };
  }

  if (q.includes("safe") && q.includes("fix")) {
    const safe = ctx.topActions.filter((a) => !a.toLowerCase().includes("auth"));
    evidence.push("Policy: green-tier fixes only (docs, dead imports, formatting)");
    return {
      answer: safe.length
        ? `Safe to auto-PR (with review): ${safe.slice(0, 3).join("; ")}`
        : "No green-tier fixes in the current queue — manual review required for remaining items.",
      evidence,
    };
  }

  if (q.includes("fragile") || q.includes("review first") || q.includes("files")) {
    ctx.riskyFiles.forEach((f) => evidence.push(`File: ${f}`));
    return {
      answer: ctx.riskyFiles.length
        ? `Most fragile / repeatedly flagged: ${ctx.riskyFiles.join(", ")}`
        : "No repeatedly flagged files yet — run another audit to build history.",
      evidence,
    };
  }

  if (q.includes("ai") || q.includes("slop") || q.includes("generated")) {
    evidence.push(`AI Slop Score: ${ctx.slop.overallPercent}%`);
    if (ctx.slop.topCauses[0]) evidence.push(`Top cause: ${ctx.slop.topCauses[0].label}`);
    ctx.slop.affectedFiles.slice(0, 3).forEach((f) => evidence.push(`File: ${f}`));
    return {
      answer: `AI Slop Score is ${ctx.slop.overallPercent}% (indicators only, not proof). Top cause: ${ctx.slop.topCauses[0]?.label ?? "none"}. Review: ${ctx.slop.affectedFiles.slice(0, 3).join(", ") || "no files flagged"}.`,
      evidence,
    };
  }

  if (q.includes("fix first") || q.includes("today") || q.includes("priority")) {
    ctx.topActions.forEach((a) => evidence.push(`Fix queue: ${a}`));
    return {
      answer: ctx.topActions.length
        ? `Fix these first: ${ctx.topActions.join("; ")}`
        : "No urgent fixes — focus on maintainability improvements.",
      evidence,
    };
  }

  if (q.includes("debt")) {
    evidence.push(`Score: ${ctx.score.overall}/1000`);
    evidence.push(`Slop: ${ctx.slop.overallPercent}%`);
    return {
      answer: `Biggest technical debt drivers: ${ctx.recurringFindings.join("; ") || "insufficient history"}. Slop at ${ctx.slop.overallPercent}%.`,
      evidence,
    };
  }

  if (q.includes("risky") || q.includes("risk")) {
    evidence.push(`Health: ${ctx.score.overall}/1000`);
    evidence.push(`Summary: ${ctx.briefingSummary}`);
    return {
      answer: `${ctx.repoName} scores ${ctx.score.overall}/1000. ${ctx.briefingSummary}`,
      evidence,
    };
  }

  if (q.includes("new") || q.includes("explain") && q.includes("repo")) {
    evidence.push(ctx.briefingSummary);
    return {
      answer: `${ctx.repoName} in plain terms: ${ctx.briefingSummary} Start with the fix queue — ignore most findings and fix the top 3.`,
      evidence,
    };
  }

  const memoryResult = queryMemory(question, {
    events: ctx.memoryEvents,
    scoreHistory: ctx.scoreHistory,
    recurringFindings: ctx.recurringFindings,
    fixedFindings: ctx.fixedFindings,
    ignoredFindings: ctx.ignoredFindings,
    riskyFiles: ctx.riskyFiles,
    lastAuditSummary: ctx.briefingSummary,
  });

  if (memoryResult.evidence.length) {
    return memoryResult;
  }

  if (q.includes("changed") || q.includes("recent")) {
    ctx.whatChanged.forEach((c) => evidence.push(`Change: ${c}`));
    return {
      answer: ctx.whatChanged.join("; ") || "No changes recorded since last audit.",
      evidence,
    };
  }

  return {
    answer:
      "Ask about auth, billing, risks, dangerous items, safe fixes, fragile files, AI slop, tech debt, or what changed.",
    evidence: [],
  };
}
