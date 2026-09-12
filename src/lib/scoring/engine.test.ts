import { describe, expect, it } from "vitest";
import { computeRepoScore, compareScores } from "@/lib/scoring/engine";

describe("computeRepoScore", () => {
  it("returns high score for healthy repo", () => {
    const result = computeRepoScore({
      criticalFindings: 0,
      highFindings: 0,
      mediumFindings: 1,
      giantFiles: 0,
      circularDeps: 0,
      depCount: 15,
      missingLockfile: false,
      hasReadme: true,
      hasTests: true,
      testFileCount: 20,
      sourceFileCount: 40,
      avgFileLines: 80,
      maxFileLines: 200,
      slopPercent: 10,
      deployVerdict: "Could deploy tomorrow",
    });
    expect(result.overall).toBeGreaterThan(700);
    expect(result.grade).toMatch(/Excellent|Healthy/);
  });

  it("penalizes critical security findings", () => {
    const result = computeRepoScore({
      criticalFindings: 2,
      highFindings: 0,
      mediumFindings: 0,
      giantFiles: 0,
      circularDeps: 0,
      depCount: 20,
      missingLockfile: false,
      hasReadme: true,
      hasTests: false,
      testFileCount: 0,
      sourceFileCount: 30,
      avgFileLines: 100,
      maxFileLines: 300,
      slopPercent: 20,
    });
    expect(result.dimensions.security).toBeLessThanOrEqual(600);
    expect(result.overall).toBeLessThanOrEqual(390);
    expect(result.grade).not.toMatch(/Excellent|Healthy/);
  });

  it("caps the overall score while a high blocker remains", () => {
    const result = computeRepoScore({
      criticalFindings: 0, highFindings: 1, mediumFindings: 0, giantFiles: 0,
      circularDeps: 0, depCount: 10, missingLockfile: false, hasReadme: true,
      hasTests: true, testFileCount: 20, sourceFileCount: 30, avgFileLines: 50,
      maxFileLines: 100, slopPercent: 0, deployVerdict: "Could deploy tomorrow",
    });
    expect(result.overall).toBeLessThanOrEqual(590);
  });
});

describe("compareScores", () => {
  it("computes deltas between snapshots", () => {
    const delta = compareScores(
      { security: 800, architecture: 700, maintainability: 750, dependencies: 700, testing: 600, documentation: 850, complexity: 780, aiSlop: 700, releaseRisk: 720 },
      { security: 750, architecture: 700, maintainability: 700, dependencies: 700, testing: 600, documentation: 850, complexity: 780, aiSlop: 650, releaseRisk: 700 },
    );
    expect(delta.security).toBe(50);
    expect(delta.aiSlop).toBe(50);
  });
});
