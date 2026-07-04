import type { FindingClassification } from "@/lib/classification/classify";
import type { DailyBriefing } from "@/lib/briefing/build-briefing";
import type { CoachingSections } from "@/lib/coaching/build-coaching";
import { groupByPriority, prioritizeFindings } from "@/lib/reports/prioritize-findings";

type FixPromptFinding = {
  id: string;
  title: string;
  description: string;
  severity: string;
  classification: FindingClassification;
  filePath?: string;
  coaching?: CoachingSections | null;
};

export type FixPromptInput = {
  repoName: string;
  stack?: string[];
  consumerSummary: string;
  releaseReadiness: string;
  topRisk?: string | null;
  briefing: DailyBriefing;
  findings: FixPromptFinding[];
  costUsd?: string | null;
};

function formatFinding(f: FixPromptFinding & { priorityLabel: string }, index: number) {
  const coaching = f.coaching;
  const lines = [
    `${index}. [${f.priorityLabel}] ${f.title} (${f.severity})`,
    `   Classification: ${f.classification}`,
    f.filePath ? `   File: ${f.filePath}` : null,
    `   Issue: ${f.description}`,
    coaching?.howToFix ? `   Suggested fix: ${coaching.howToFix.replace(/\n/g, "\n   ")}` : null,
    coaching?.ifIgnored ? `   If ignored: ${coaching.ifIgnored}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

export function buildFixPrompt(input: FixPromptInput): string {
  const prioritized = prioritizeFindings(input.findings);
  const groups = groupByPriority(prioritized);

  const findingsBlock = [
    groups.fixNow.length ? `### Fix now (${groups.fixNow.length})\n${groups.fixNow.map((f, i) => formatFinding(f, i + 1)).join("\n\n")}` : null,
    groups.fixNext.length ? `### Fix next (${groups.fixNext.length})\n${groups.fixNext.map((f, i) => formatFinding(f, i + 1)).join("\n\n")}` : null,
    groups.later.length ? `### Can wait (${groups.later.length})\n${groups.later.map((f, i) => formatFinding(f, i + 1)).join("\n\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return `You are my senior engineer helping me fix issues found in a Boswell audit.

## Your job
Turn this audit into a safe, practical fix plan and then implement the fixes in this repo.

## Rules
1. Work in small steps. Fix the highest-risk issues first.
2. Do NOT do large refactors unless required to fix a finding.
3. Do NOT change unrelated files.
4. For every fix: explain the problem, show files to change, make the smallest safe change, tell me how to test it.
5. If a finding is unclear, inspect the code first before guessing.
6. Ask me before changing auth, payments, webhooks, database schema, or anything that deletes data.
7. Prefer a branch and grouped commits.
8. At the end: what was fixed, what still needs review, and a deploy checklist.

## Repo context
- Repo: ${input.repoName}
- Stack: ${input.stack?.length ? input.stack.join(", ") : "unknown"}
- Release readiness: ${input.releaseReadiness}
- Top risk: ${input.topRisk ?? input.briefing.topPriorityAction ?? "See findings below"}
${input.costUsd ? `- Audit cost: ~$${input.costUsd}` : ""}

## Plain-English summary
${input.consumerSummary.trim()}

## Executive summary
${input.briefing.executiveSummary.trim()}

## Prioritized findings
${findingsBlock || "No findings recorded."}

## What I want from you
### Phase 1 — Consumer summary
Answer in plain English:
1. Is this app working?
2. Is it safe?
3. Can I ship it?
4. What are the top 3 fixes first?
5. What can wait?

### Phase 2 — Fix plan
Create a prioritized table with Priority, Issue, Why it matters, Files, Risk, Effort, Safe to auto-fix.

### Phase 3 — Implement fixes
Fix ALL issues listed above, in priority order:
1. Fix every item in "Fix now"
2. Then fix every item in "Fix next"
3. Then fix items in "Can wait" if time allows
Do not stop after the first few fixes. Continue until every listed issue has been addressed or you are blocked and explain why.

### Phase 4 — Final handoff
Return summary of fixes, remaining risks, deploy checklist, and suggested commit messages.

Start now by reading the repo and producing Phase 1.`;
}
