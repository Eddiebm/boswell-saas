import { describe, expect, it } from "vitest";
import { buildFixPrompt } from "@/lib/reports/fix-prompt";

describe("buildFixPrompt", () => {
  it("includes repo context and prioritized findings", () => {
    const prompt = buildFixPrompt({
      repoName: "Eddiebm/founder-kit",
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
        },
      ],
      costUsd: "0.32",
    });

    expect(prompt).toContain("Eddiebm/founder-kit");
    expect(prompt).toContain("Fix now");
    expect(prompt).toContain("Broken payment handoff");
    expect(prompt).toContain("Phase 1");
    expect(prompt).toContain("$0.32");
  });
});
