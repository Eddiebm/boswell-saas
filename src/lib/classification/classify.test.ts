import { describe, expect, it } from "vitest";
import { classifyFinding, groupByClassification } from "./classify";

describe("classifyFinding", () => {
  it("marks positive findings as good", () => {
    const result = classifyFinding({
      title: "Clean architecture",
      description: "Well structured modules",
      severity: "INFO",
      category: "architecture",
      isPositive: true,
    });
    expect(result.classification).toBe("good");
  });

  it("marks critical secrets as evil when evidence is strong", () => {
    const result = classifyFinding({
      title: "Hardcoded secret in repo",
      description: "API key committed in config — bypass auth risk",
      severity: "CRITICAL",
      category: "security",
    });
    expect(result.classification).toBe("evil");
  });

  it("marks high security as dangerous", () => {
    const result = classifyFinding({
      title: "Missing auth check",
      description: "Route lacks authentication",
      severity: "HIGH",
      category: "security",
    });
    expect(result.classification).toBe("dangerous");
  });

  it("groups findings by classification", () => {
    const grouped = groupByClassification([
      { classification: "good" as const, id: "1" },
      { classification: "bad" as const, id: "2" },
      { classification: "dangerous" as const, id: "3" },
    ]);
    expect(grouped.good).toHaveLength(1);
    expect(grouped.bad).toHaveLength(1);
    expect(grouped.dangerous).toHaveLength(1);
    expect(grouped.evil).toHaveLength(0);
  });
});
