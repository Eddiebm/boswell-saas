import { describe, expect, it } from "vitest";
import { prioritizeFixQueue, computePriority } from "@/lib/fix-queue/prioritize";

describe("fix queue prioritization", () => {
  it("ranks critical security above low doc fixes", () => {
    const ranked = prioritizeFixQueue([
      {
        id: "1",
        title: "Add README section",
        severity: "LOW",
        effort: "xs",
        impact: "low",
        files: ["README.md"],
        whyItMatters: "docs",
        suggestedFix: "edit readme",
        canAutoPr: true,
        category: "documentation",
      },
      {
        id: "2",
        title: "Exposed API key",
        severity: "CRITICAL",
        effort: "m",
        impact: "critical",
        files: [".env"],
        whyItMatters: "security",
        suggestedFix: "rotate key",
        canAutoPr: false,
        category: "security",
      },
    ]);
    expect(ranked[0].id).toBe("2");
    expect(ranked[0].priorityScore).toBeGreaterThan(ranked[1].priorityScore);
  });

  it("boosts auto-fixable safe items slightly", () => {
    const withPr = computePriority({
      id: "a",
      title: "t",
      severity: "MEDIUM",
      effort: "s",
      impact: "medium",
      files: [],
      whyItMatters: "x",
      suggestedFix: "y",
      canAutoPr: true,
      category: "documentation",
    });
    const withoutPr = computePriority({
      id: "b",
      title: "t",
      severity: "MEDIUM",
      effort: "s",
      impact: "medium",
      files: [],
      whyItMatters: "x",
      suggestedFix: "y",
      canAutoPr: false,
      category: "documentation",
    });
    expect(withPr).toBeGreaterThan(withoutPr);
  });
});
