import { describe, expect, it } from "vitest";
import { buildFixPrompt, buildRepairBrief, buildRepairBriefs } from "@/lib/reports/fix-prompt";

describe("buildFixPrompt", () => {
  it("includes repo context and prioritized findings", () => {
    const prompt = buildFixPrompt({
      repoName: "Eddiebm/founder-kit",
      auditedCommit: "abc123",
      auditId: "audit-42",
      stack: ["Next.js", "Stripe"],
      consumerSummary: "The app is not safe to ship publicly yet.",
      releaseReadiness: "Do not deploy",
      topRisk: "Paid orders are not processed",
      briefing: {
        generatedAt: "2026-07-03T00:00:00.000Z",
        greeting: "Hi",
        executiveSummary: "Critical payment handoff is broken.",
        plainEnglishSummary: "Not safe to ship.",
        whatChanged: [],
        newRisks: [],
        fixedRisks: [],
        ignoredRisks: [],
        regressions: [],
        improvements: [],
        classifications: { good: [], bad: [], dangerous: [], evil: [] },
        criticalFindings: [],
        suggestedActions: [],
        topPriorityAction: "Fix payment handoff",
        safePrsReady: [],
        debtHoursEstimate: 12,
        releaseReadiness: "Do not deploy",
        healthDelta: null,
      },
      findings: [
        {
          id: "1",
          title: "Broken payment handoff",
          description: "Orders stay queued after Stripe payment.",
          severity: "CRITICAL",
          classification: "evil",
          filePath: "app/api/stripe/webhook/route.ts",
          evidence: ["Duplicate webhook leaves orders queued"],
        },
      ],
      costUsd: "0.32",
    });

    expect(prompt).toContain("Eddiebm/founder-kit");
    expect(prompt).toContain("Fix now");
    expect(prompt).toContain("Broken payment handoff");
    expect(prompt).toContain("Boswell Repair Brief");
    expect(prompt).toContain("Audited commit: abc123");
    expect(prompt).toContain("audit-42");
    expect(prompt).toContain("untrusted data");
    expect(prompt).toContain("regression test");
    expect(prompt).toContain("only Boswell's independent retest");
    expect(prompt).toContain("Duplicate webhook leaves orders queued");
  });

  it("formats one universal contract for different builders", () => {
    const input = {
      repoName: "owner/repo",
      consumerSummary: "Needs repair.",
      releaseReadiness: "NO-GO",
      briefing: {
        generatedAt: "2026-09-12T00:00:00.000Z",
        greeting: "Hi",
        executiveSummary: "One blocker.",
        plainEnglishSummary: "Not ready.",
        whatChanged: [], newRisks: [], fixedRisks: [], ignoredRisks: [], regressions: [], improvements: [],
        classifications: { good: [], bad: [], dangerous: [], evil: [] },
        criticalFindings: [], suggestedActions: [], topPriorityAction: null, safePrsReady: [],
        debtHoursEstimate: 1, releaseReadiness: "NO-GO", healthDelta: null,
      },
      findings: [],
    };

    expect(buildRepairBrief(input, "lovable")).toContain("Preserve unrelated screens");
    expect(buildRepairBrief(input, "human")).toContain("conventional engineering ticket");
    expect(Object.keys(buildRepairBriefs(input))).toHaveLength(12);
  });
});
