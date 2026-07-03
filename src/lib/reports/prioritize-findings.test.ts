import { describe, expect, it } from "vitest";
import { groupByPriority, prioritizeFindings } from "@/lib/reports/prioritize-findings";

describe("prioritizeFindings", () => {
  it("puts critical findings in fix now", () => {
    const findings = prioritizeFindings([
      {
        id: "1",
        title: "Critical issue",
        description: "bad",
        severity: "CRITICAL",
        classification: "dangerous",
      },
      {
        id: "2",
        title: "Minor issue",
        description: "low",
        severity: "LOW",
        classification: "good",
      },
    ]);

    const groups = groupByPriority(findings);
    expect(groups.fixNow).toHaveLength(1);
    expect(groups.later).toHaveLength(1);
  });
});
