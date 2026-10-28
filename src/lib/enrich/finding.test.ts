import { describe, expect, it } from "vitest";
import { enrichFinding } from "@/lib/enrich/finding";

describe("enrichFinding", () => {
  it("treats a critical committed secret as evil and never auto-PRs it", () => {
    const enriched = enrichFinding({
      title: "Hardcoded secret in config",
      description: "An API key committed to the repo",
      severity: "CRITICAL",
      category: "secrets",
    });
    expect(enriched.classification).toBe("evil");
    expect(enriched.autoFixLevel).toBe("red");
    expect(enriched.canOpenPr).toBe(false);
    expect(enriched.simpleExplanation).toMatch(/emergency/i);
  });

  it("keeps auth and database work manual even at medium severity", () => {
    const enriched = enrichFinding({
      title: "Missing ownership check",
      description: "Route reads rows without filtering by user",
      severity: "MEDIUM",
      category: "database",
    });
    expect(enriched.classification).toBe("dangerous");
    expect(enriched.autoFixLevel).toBe("red");
    expect(enriched.canOpenPr).toBe(false);
  });

  it("lets mechanical documentation fixes go to a PR", () => {
    const enriched = enrichFinding({
      title: "README missing setup steps",
      description: "New contributors cannot run the app",
      severity: "MEDIUM",
      category: "documentation",
    });
    expect(enriched.classification).toBe("bad");
    expect(enriched.autoFixLevel).toBe("green");
    expect(enriched.canOpenPr).toBe(true);
  });

  it("asks for approval on a medium refactor", () => {
    const enriched = enrichFinding({
      title: "Duplicated date helpers",
      description: "Two copies of the same formatter",
      severity: "MEDIUM",
      category: "duplicate-code",
    });
    expect(enriched.autoFixLevel).toBe("yellow");
    expect(enriched.canOpenPr).toBe(false);
  });

  it("marks positive findings good", () => {
    const enriched = enrichFinding({
      title: "Central error handling",
      description: "Errors go through one reporter",
      severity: "INFO",
      category: "architecture",
      isPositive: true,
    });
    expect(enriched.classification).toBe("good");
    expect(enriched.simpleExplanation).toMatch(/solid engineering/);
  });
});
