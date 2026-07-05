import { describe, expect, it } from "vitest";
import { buildOwaspTop10Summary, mapFindingToOwasp } from "@/lib/reports/owasp-top10";

describe("owasp-top10", () => {
  it("maps explicit OWASP references in finding text", () => {
    const result = mapFindingToOwasp({
      id: "1",
      title: "Route allows IDOR",
      description: "Matches A01:2021 broken access control in admin API",
      severity: "HIGH",
    });
    expect(result.owaspId).toBe("A01");
    expect(result.owaspCode).toBe("A01:2021");
  });

  it("maps injection findings to A03", () => {
    const result = mapFindingToOwasp({
      id: "2",
      title: "Possible SQL injection",
      description: "User input passed to query without sanitization",
      severity: "CRITICAL",
      category: "injection",
    });
    expect(result.owaspId).toBe("A03");
  });

  it("maps secrets to A02", () => {
    const result = mapFindingToOwasp({
      id: "3",
      title: "Hardcoded secret in config",
      description: "API key committed to repo",
      severity: "CRITICAL",
    });
    expect(result.owaspId).toBe("A02");
  });

  it("builds category summary with unmapped bucket", () => {
    const summary = buildOwaspTop10Summary([
      {
        id: "a",
        title: "XSS in form handler",
        description: "Reflected XSS in search",
        severity: "HIGH",
      },
      {
        id: "b",
        title: "Missing README",
        description: "No setup docs",
        severity: "LOW",
        category: "documentation",
      },
    ]);

    expect(summary.totalMapped).toBe(1);
    expect(summary.unmappedCount).toBe(1);
    expect(summary.categories.some((c) => c.id === "A03")).toBe(true);
  });
});
