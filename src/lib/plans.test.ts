import { describe, expect, it } from "vitest";
import {
  canUseExecutiveDashboard,
  canUseLlmBrain,
  canUsePrAutomation,
  planMeetsMinimum,
} from "@/lib/plans";

describe("plans", () => {
  it("ranks plans correctly", () => {
    expect(planMeetsMinimum("team", "pro")).toBe(true);
    expect(planMeetsMinimum("pro", "team")).toBe(false);
    expect(planMeetsMinimum("business", "team")).toBe(true);
  });

  it("gates features by tier", () => {
    expect(canUsePrAutomation("pro")).toBe(true);
    expect(canUsePrAutomation("free")).toBe(false);
    expect(canUseLlmBrain("pro")).toBe(true);
    expect(canUseLlmBrain("free")).toBe(false);
    expect(canUseExecutiveDashboard("pro")).toBe(true);
    expect(canUseExecutiveDashboard("free")).toBe(false);
  });
});
