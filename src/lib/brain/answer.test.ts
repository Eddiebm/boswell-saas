import { describe, expect, it } from "vitest";
import { answerBrainQuestion } from "@/lib/brain/answer";
import { emptySlopResult } from "@/lib/slop/engine";
import type { RepoScoreResult } from "@/lib/scoring/types";

const score: RepoScoreResult = {
  overall: 640,
  dimensions: {
    security: 600,
    architecture: 700,
    maintainability: 700,
    dependencies: 700,
    testing: 550,
    documentation: 850,
    complexity: 900,
    aiSlop: 800,
    releaseRisk: 700,
  },
  grade: "Stable",
  summary: "Overall 640/1000",
};

function ctx(overrides: Partial<Parameters<typeof answerBrainQuestion>[1]> = {}) {
  return {
    repoName: "acme/app",
    score,
    slop: {
      ...emptySlopResult(),
      overallPercent: 18,
      topCauses: [{ id: "generic-names", label: "Generic naming", weight: 1, count: 4, files: [] }],
      affectedFiles: ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts"],
    },
    memoryEvents: [],
    scoreHistory: [],
    recurringFindings: ["Unvalidated input"],
    fixedFindings: [],
    ignoredFindings: [],
    riskyFiles: ["src/middleware.ts", "src/lib/db.ts"],
    briefingSummary: "Two high findings need attention.",
    whatChanged: ["Added billing page"],
    topActions: ["Rotate leaked key", "Fix auth bypass", "Add rate limit"],
    ...overrides,
  };
}

describe("answerBrainQuestion", () => {
  it("points auth questions at the configured auth path", () => {
    const result = answerBrainQuestion("How does authentication work?", ctx({ authPath: "src/proxy.ts" }));
    expect(result.answer).toContain("`src/proxy.ts`");
    expect(result.evidence).toEqual(["File: src/proxy.ts"]);
  });

  it("defaults the auth path to the middleware", () => {
    expect(answerBrainQuestion("where is auth?", ctx()).evidence).toEqual(["File: src/middleware.ts"]);
  });

  it("uses the billing note when one is given", () => {
    expect(answerBrainQuestion("Is Stripe live?", ctx({ billingNote: "Stripe is in test mode." })).answer).toBe(
      "Stripe is in test mode.",
    );
  });

  it("names the top fix-queue item for dangerous questions", () => {
    const result = answerBrainQuestion("What is dangerous here?", ctx());
    expect(result.answer).toContain("Rotate leaked key");
    expect(result.evidence).toContain("Health score: 640/1000");
  });

  it("leaves auth-related actions out of the safe-fix list", () => {
    const result = answerBrainQuestion("What is safe to fix automatically?", ctx());
    expect(result.answer).toBe("Safe to auto-PR (with review): Rotate leaked key; Add rate limit");
  });

  it("says manual review is needed when nothing is safe", () => {
    const result = answerBrainQuestion("Any safe fix?", ctx({ topActions: ["Fix auth bypass"] }));
    expect(result.answer).toMatch(/No green-tier fixes/);
  });

  it("reports slop with at most three affected files", () => {
    const result = answerBrainQuestion("How much AI slop is there?", ctx());
    expect(result.answer).toContain("18%");
    expect(result.answer).toContain("Generic naming");
    expect(result.evidence.filter((e) => e.startsWith("File:"))).toEqual(["File: src/a.ts", "File: src/b.ts", "File: src/c.ts"]);
  });

  it("lists the fix queue for priority questions", () => {
    const result = answerBrainQuestion("What should I fix first?", ctx());
    expect(result.answer).toBe("Fix these first: Rotate leaked key; Fix auth bypass; Add rate limit");
    expect(result.evidence).toHaveLength(3);
  });

  it("summarises risk with the score and briefing", () => {
    expect(answerBrainQuestion("How risky is this repo?", ctx()).answer).toBe(
      "acme/app scores 640/1000. Two high findings need attention.",
    );
  });

  it("answers what changed from memory events first", () => {
    const result = answerBrainQuestion(
      "What changed recently?",
      ctx({
        memoryEvents: [
          { id: "1", eventType: "audit_completed", title: "Audit completed", summary: "Score up 20", occurredAt: "2026-01-02" },
        ],
      }),
    );
    expect(result.answer).toContain("Score up 20");
    expect(result.evidence[0]).toContain("Audit completed");
  });

  it("explains what it can answer when the question matches nothing", () => {
    const result = answerBrainQuestion("Hello there", ctx());
    expect(result.answer).toMatch(/^Ask about auth/);
    expect(result.evidence).toEqual([]);
  });
});
