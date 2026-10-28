import { describe, expect, it } from "vitest";
import { buildDailyBriefing } from "@/lib/briefing/build-briefing";
import { emptySlopResult } from "@/lib/slop/engine";
import type { RepoScoreResult } from "@/lib/scoring/types";

function score(overall: number): RepoScoreResult {
  return {
    overall,
    dimensions: {
      security: overall,
      architecture: overall,
      maintainability: overall,
      dependencies: overall,
      testing: overall,
      documentation: overall,
      complexity: overall,
      aiSlop: overall,
      releaseRisk: overall,
    },
    grade: "Stable",
    summary: "",
  };
}

const base = { repoName: "acme/app", newFindings: [], fixedFindings: [], recurringFindings: [] };

describe("buildDailyBriefing", () => {
  it("turns high and critical findings into suggested actions with effort", () => {
    const briefing = buildDailyBriefing({
      ...base,
      currentScore: score(700),
      newFindings: [
        { id: "a", title: "Leaked key", severity: "CRITICAL", href: "/a" },
        { id: "b", title: "Missing auth check", severity: "HIGH", href: "/b" },
        { id: "c", title: "Long file", severity: "MEDIUM", href: "/c" },
      ],
    });
    expect(briefing.suggestedActions.map((a) => [a.title, a.effort])).toEqual([
      ["Leaked key", "1–4 hours"],
      ["Missing auth check", "30–90 min"],
    ]);
    expect(briefing.newRisks).toEqual(["Leaked key", "Missing auth check"]);
    expect(briefing.topPriorityAction).toBe("Leaked key");
    expect(briefing.releaseReadiness).toMatch(/^Not ready/);
    expect(briefing.executiveSummary).toBe("acme/app scores 700/1000. 2 high-priority items need attention today.");
    expect(briefing.whatChanged).toContain("3 new findings since last audit");
  });

  it("reports a score drop as a regression and a rise as an improvement", () => {
    const dropped = buildDailyBriefing({ ...base, currentScore: score(600), previousOverall: 700 });
    expect(dropped.healthDelta).toBe(-100);
    expect(dropped.regressions[0]).toBe("Health score dropped 100 points since last audit.");
    expect(dropped.executiveSummary).toContain("(↓100)");

    const rose = buildDailyBriefing({ ...base, currentScore: score(760), previousOverall: 700 });
    expect(rose.healthDelta).toBe(60);
    expect(rose.improvements).toContain("Health score improved by 60 points.");
    expect(rose.executiveSummary).toContain("(↑60)");
  });

  it("ignores small score moves and has no delta without a previous score", () => {
    const small = buildDailyBriefing({ ...base, currentScore: score(690), previousOverall: 700 });
    expect(small.regressions).toEqual([]);
    expect(buildDailyBriefing({ ...base, currentScore: score(690) }).healthDelta).toBeNull();
  });

  it("suggests a slop fix when there are fewer than three actions", () => {
    const briefing = buildDailyBriefing({
      ...base,
      slop: { ...emptySlopResult(), overallPercent: 22, topCauses: [{ id: "x", label: "Placeholder comments", weight: 1, count: 3, files: [] }] },
    });
    expect(briefing.suggestedActions).toEqual([
      { id: "slop-1", title: "Reduce AI slop: Placeholder comments", severity: "MEDIUM", href: "#slop", effort: "1–2 hours" },
    ]);
    expect(briefing.whatChanged).toContain("AI Slop Score: 22%");
    expect(briefing.criticalFindings).toEqual([]);
  });

  it("estimates debt hours from the classification counts", () => {
    const briefing = buildDailyBriefing({
      ...base,
      classifications: { good: ["g"], bad: ["b1", "b2"], dangerous: ["d"], evil: ["e"] },
    });
    // 1 evil * 8 + 1 dangerous * 4 + 2 bad * 1.5
    expect(briefing.debtHoursEstimate).toBe(15);
    expect(briefing.plainEnglishSummary).toContain("1 good patterns, 2 messy items, 1 dangerous, 1 evil.");
  });

  it("prefers the deploy verdict and keeps recurring findings to three", () => {
    const briefing = buildDailyBriefing({
      ...base,
      deployVerdict: "Could deploy tomorrow",
      recurringFindings: ["r1", "r2", "r3", "r4"],
    });
    expect(briefing.releaseReadiness).toBe("Could deploy tomorrow");
    expect(briefing.regressions).toEqual(["Recurring: r1", "Recurring: r2", "Recurring: r3"]);
    expect(briefing.plainEnglishSummary).toContain("acme/app health is unknown/1000.");
    expect(briefing.plainEnglishSummary).toContain("No urgent blockers today.");
  });
});
