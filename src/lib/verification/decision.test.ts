import { describe, expect, it } from "vitest";
import { decideRepairVerification } from "./decision";

describe("decideRepairVerification", () => {
  const previous = [{ title: "Auth bypass", filePath: "auth.ts" }, { title: "Missing test" }];
  it("rejects when no blocker was repaired", () => {
    expect(decideRepairVerification({ previous, current: [
      { title: "Auth bypass", filePath: "auth.ts", severity: "CRITICAL" },
      { title: "Missing test", severity: "HIGH" },
    ] })).toBe("REJECTED");
  });
  it("reports partial progress while a blocker remains", () => {
    expect(decideRepairVerification({ previous, current: [
      { title: "Auth bypass", filePath: "auth.ts", severity: "CRITICAL" },
    ] })).toBe("PARTIAL");
  });
  it("does not call residual findings verified", () => {
    expect(decideRepairVerification({ previous, current: [
      { title: "Minor issue", severity: "LOW" },
    ] })).toBe("PASS WITH RISKS");
  });
  it("verifies only when no findings remain", () => {
    expect(decideRepairVerification({ previous, current: [] })).toBe("VERIFIED");
  });
});
