import { describe, expect, it } from "vitest";
import { generateAuditReport, reportToMarkdown } from "./generate-report";
import { buildDailyBriefing } from "@/lib/briefing/build-briefing";
import { computeRepoScore } from "@/lib/scoring/engine";
import { scanAiSlop } from "@/lib/slop/engine";

describe("generateAuditReport", () => {
  const score = computeRepoScore({
    criticalFindings: 0,
    highFindings: 1,
    mediumFindings: 2,
    giantFiles: 0,
    circularDeps: 0,
    depCount: 10,
    missingLockfile: false,
    hasReadme: true,
    hasTests: false,
    testFileCount: 0,
    sourceFileCount: 20,
    avgFileLines: 100,
    maxFileLines: 200,
    slopPercent: 20,
    deployVerdict: "ok",
    outdatedDeps: 1,
  });

  const slop = scanAiSlop({
    files: [{ path: "a.ts", lines: 50, content: "// TODO fix\nconsole.log('x')" }],
  });

  const briefing = buildDailyBriefing({
    repoName: "test/repo",
    currentScore: score,
    newFindings: [],
    fixedFindings: [],
    recurringFindings: [],
  });

  it("builds structured report with classifications", () => {
    const report = generateAuditReport({
      repoName: "test/repo",
      findings: [
        {
          id: "1",
          title: "Good pattern",
          description: "Clean tests",
          severity: "INFO",
          classification: "good",
          evidence: ["tests/app.test.ts"],
          autoFixLevel: "green",
        },
        {
          id: "2",
          title: "Auth gap",
          description: "Missing check",
          severity: "HIGH",
          classification: "dangerous",
          evidence: ["src/auth.ts"],
          autoFixLevel: "red",
        },
      ],
      score,
      slop,
      briefing,
      fixQueueCount: 2,
    });

    expect(report.good).toHaveLength(1);
    expect(report.dangerous).toHaveLength(1);
    expect(report.debtHoursEstimate).toBeGreaterThan(0);
    expect(report.safePrCount).toBe(1);
  });

  it("renders markdown with executive summary", () => {
    const report = generateAuditReport({
      repoName: "test/repo",
      findings: [],
      score,
      slop,
      briefing,
      fixQueueCount: 0,
    });
    const md = reportToMarkdown(report);
    expect(md).toContain("Executive summary");
    expect(md).toContain("1000");
  });
});
