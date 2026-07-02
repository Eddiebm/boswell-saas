import { describe, expect, it } from "vitest";
import { getSafeFixPolicy } from "./safe-fix-policy";

describe("getSafeFixPolicy", () => {
  it("returns red for auth issues", () => {
    const policy = getSafeFixPolicy({
      category: "auth",
      severity: "HIGH",
      classification: "dangerous",
      title: "Missing session validation",
    });
    expect(policy.level).toBe("red");
    expect(policy.canOpenPr).toBe(false);
  });

  it("returns green for documentation cleanup", () => {
    const policy = getSafeFixPolicy({
      category: "documentation",
      severity: "LOW",
      classification: "bad",
      title: "Remove unused file",
    });
    expect(policy.level).toBe("green");
    expect(policy.canOpenPr).toBe(true);
  });

  it("returns yellow for medium refactors", () => {
    const policy = getSafeFixPolicy({
      category: "architecture",
      severity: "MEDIUM",
      classification: "bad",
      title: "Split large component",
    });
    expect(policy.level).toBe("yellow");
    expect(policy.requiresApproval).toBe(true);
  });
});
