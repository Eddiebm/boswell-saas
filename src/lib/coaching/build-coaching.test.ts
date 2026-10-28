import { describe, expect, it } from "vitest";
import { buildCoaching } from "@/lib/coaching/build-coaching";

describe("buildCoaching", () => {
  it("treats a leaked secret as dangerous and manual-only", () => {
    const coaching = buildCoaching({
      title: "Stripe key in source",
      description: "A live secret key is committed",
      severity: "CRITICAL",
      category: "secrets",
      filePath: "src/lib/stripe.ts",
      recommendation: "Move the key to an environment variable and rotate it.",
    });
    expect(coaching.whyDangerous).toMatch(/unauthorized access/);
    expect(coaching.autoFixStatus).toBe("manual");
    expect(coaching.ifIgnored).toMatch(/Security risk compounds/);
    expect(coaching.explainLikeImNew).toMatch(/house key/);
    expect(coaching.howToFix).toContain("1. Open src/lib/stripe.ts.");
    expect(coaching.howToFix).toContain("2. Move the key to an environment variable and rotate it.");
    expect(coaching.howToFix).toContain("Effort: medium (1–4 hours)");
    expect(coaching.evidence).toEqual(["File: src/lib/stripe.ts", "Category: secrets", "Severity: CRITICAL"]);
    // 0.75 base + 0.12 for a file + 0.08 for a secret
    expect(coaching.confidence).toBe(0.95);
  });

  it("describes positive findings without a bad or dangerous section", () => {
    const coaching = buildCoaching({
      title: "Central error reporter",
      description: "All failures go through one function.",
      severity: "INFO",
      category: "architecture",
      isPositive: true,
    });
    expect(coaching.whatHappened).toMatch(/well done/);
    expect(coaching.whyGood).toContain("All failures go through one function.");
    expect(coaching.whyBad).toBeUndefined();
    expect(coaching.whyDangerous).toBeUndefined();
    expect(coaching.confidence).toBe(0.88);
    expect(coaching.explainLikeImNew).toMatch(/toolbox/);
  });

  it("marks mechanical categories safe to auto-fix", () => {
    const coaching = buildCoaching({
      title: "Unused import",
      description: "lodash is imported but unused",
      severity: "LOW",
      category: "dead-import",
    });
    expect(coaching.autoFixStatus).toBe("safe");
    expect(coaching.whyDangerous).toBeUndefined();
    expect(coaching.howToFix).toMatch(/^Review the affected files/);
    expect(coaching.evidence[0]).toBe("Static analysis");
  });

  it("explains duplication and flags AI-looking descriptions as indicators only", () => {
    const coaching = buildCoaching({
      title: "Duplicated helper",
      description: "A generic helper wrapper is copied in three places",
      severity: "HIGH",
      category: "duplicate-code",
    });
    expect(coaching.whyBad).toMatch(/Duplicated logic/);
    expect(coaching.whyDangerous).toMatch(/may not break production today/);
    expect(coaching.whyAiGenerated).toMatch(/indicator, not proof/);
    expect(coaching.autoFixStatus).toBe("review");
    expect(coaching.explainLikeImNew).toMatch(/instruction manual/);
  });

  it("strips markdown bold from the summary and caps it", () => {
    const coaching = buildCoaching({
      title: "Long finding",
      description: `**Important** ${"x".repeat(400)}`,
      severity: "MEDIUM",
      category: "maintainability",
    });
    expect(coaching.whatHappened).not.toContain("**");
    const summary = coaching.whatHappened.split("Long finding. ")[1];
    expect(summary).toHaveLength(280);
  });
});
