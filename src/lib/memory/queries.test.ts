import { describe, expect, it } from "vitest";
import { queryMemory } from "./queries";

describe("queryMemory", () => {
  const base = {
    events: [
      {
        id: "1",
        eventType: "audit_completed",
        title: "Audit done",
        summary: "Score dropped 20 points",
        occurredAt: "2026-07-01",
      },
    ],
    scoreHistory: [
      { snapshotAt: "2026-07-02", overall: 680 },
      { snapshotAt: "2026-06-01", overall: 720 },
    ],
    recurringFindings: ["No tests"],
    fixedFindings: ["Removed secret"],
    ignoredFindings: ["Console log"],
    riskyFiles: ["src/api.ts"],
    lastAuditSummary: "Needs work on security",
  };

  it("answers what changed with evidence", () => {
    const result = queryMemory("What changed since the last audit?", base);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.answer).toContain("Score dropped");
  });

  it("answers what got worse", () => {
    const result = queryMemory("What keeps getting worse?", base);
    expect(result.answer).toContain("680");
  });

  it("answers risky files", () => {
    const result = queryMemory("Which files are repeatedly risky?", base);
    expect(result.answer).toContain("src/api.ts");
    expect(result.evidence).toContain("File: src/api.ts");
  });
});
