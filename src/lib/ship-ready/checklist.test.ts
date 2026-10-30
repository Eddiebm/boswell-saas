import { describe, expect, it } from "vitest";
import type { ChecksSummary } from "@/lib/checks";
import { evaluateShipReady, type ShipFinding } from "@/lib/ship-ready/checklist";

const summary: ChecksSummary = {
  version: 1,
  coverage: { dependencies: "checked", databaseRules: "checked" },
  facts: { framework: "next", host: "vercel", database: "supabase", emailProvider: null, takesPayments: true, collectsUserData: true, setsTrackingCookies: false, handlesHealthData: false },
};

let n = 0;
const finding = (over: Partial<ShipFinding>): ShipFinding => ({
  id: `f${++n}`,
  ruleId: null,
  severity: "HIGH",
  category: "security",
  title: "Something",
  description: "",
  filePath: "app/x.ts",
  lineStart: 3,
  recommendation: "Fix it.",
  confidence: 0.9,
  ...over,
});

const item = (v: ReturnType<typeof evaluateShipReady>, id: string) => v.items.find((i) => i.id === id)!;
const base = { repo: "acme/app", summary, live: "no-leak" as const, auditCompleted: true };

describe("evaluateShipReady", () => {
  it("is Ship Ready only when nothing fails, nothing needs review, and nothing is left to confirm", () => {
    const v = evaluateShipReady({ ...base, findings: [] });
    // Backups and uptime can never be seen from code (and the live site needs its URL), so a clean repo is "almost", never silently "ready".
    expect(v.state).toBe("almost");
    expect(v.blockers).toBe(0);
    expect(v.items.filter((i) => i.status === "unverified").map((i) => i.id)).toEqual(["live-site", "production-config", "backups", "uptime"]);
    expect(item(v, "backups").steps[0]).toContain("Supabase");
  });

  it("blocks on proven findings and asks for review on pattern matches", () => {
    const v = evaluateShipReady({
      ...base,
      findings: [
        finding({ ruleId: "money.webhook-unverified", severity: "CRITICAL", confidence: 0.85, title: "Stripe webhook doesn't verify the signature" }),
        finding({ ruleId: "money.ai-route-no-auth", severity: "HIGH", confidence: 0.65 }),
        finding({ ruleId: "deps.vulnerable", severity: "MEDIUM", confidence: 0.95 }),
      ],
    });
    expect(v.state).toBe("not-ready");
    expect(v.headline).toBe("Not ready to ship: 1 blocker");
    expect(item(v, "payments").status).toBe("fail");
    expect(item(v, "ai-costs").status).toBe("review");
    // A medium dependency issue is noted, not a launch blocker.
    expect(item(v, "dependencies").status).toBe("pass");
    expect(item(v, "payments").prompt).toContain("Stripe webhook doesn't verify the signature — app/x.ts:3");
    expect(v.fixAllPrompt).toContain("every launch blocker");
  });

  it("never passes a check that couldn't run", () => {
    const v = evaluateShipReady({
      ...base,
      summary: { ...summary, coverage: { dependencies: "unverifiable", databaseRules: "unverifiable" } },
      findings: [],
    });
    expect(item(v, "dependencies").status).toBe("unverified");
    expect(item(v, "database-rules").status).toBe("unverified");
    expect(item(v, "database-rules").steps[0]).toContain("Security Advisor");
  });

  it("treats audits from before Ship Ready as unverified rather than clean", () => {
    const v = evaluateShipReady({ ...base, summary: null, findings: [] });
    // Only the engine's code review and the (independent) live verification ran.
    expect(v.items.filter((i) => i.status === "pass").map((i) => i.id)).toEqual(["data-isolation", "code-review"]);
    expect(item(v, "secrets").status).toBe("unverified");
  });

  it("marks items that don't apply to this app as not needed", () => {
    const v = evaluateShipReady({
      ...base,
      summary: { ...summary, coverage: { ...summary.coverage, databaseRules: "not-applicable" }, facts: { ...summary.facts!, takesPayments: false, emailProvider: null } },
      findings: [],
    });
    expect(item(v, "payments").status).toBe("n/a");
    expect(item(v, "email-dns").status).toBe("n/a");
    expect(item(v, "database-rules").status).toBe("n/a");
  });

  it("fails data isolation when live verification proved a leak, and asks to set it up otherwise", () => {
    const leak = evaluateShipReady({ ...base, live: "leak", liveSummary: "Account B read account A's invoice.", findings: [] });
    expect(item(leak, "data-isolation").status).toBe("fail");
    expect(item(leak, "data-isolation").findings[0].description).toBe("Account B read account A's invoice.");
    const none = evaluateShipReady({ ...base, live: "not-set-up", findings: [] });
    expect(item(none, "data-isolation").status).toBe("unverified");
    expect(item(none, "data-isolation").steps[0]).toContain("Live verification");
  });

  it("lets engine findings block only when critical, and routes secrets to the secrets item", () => {
    const v = evaluateShipReady({
      ...base,
      findings: [
        finding({ category: "auth", severity: "HIGH", confidence: 0.85 }),
        finding({ category: "secrets", severity: "HIGH", confidence: 0.85, title: "Key in repo" }),
      ],
    });
    expect(item(v, "code-review").status).toBe("review");
    expect(item(v, "secrets").status).toBe("fail");
    const critical = evaluateShipReady({ ...base, findings: [finding({ category: "auth", severity: "CRITICAL", confidence: 0.85 })] });
    expect(item(critical, "code-review").status).toBe("fail");
  });

  it("ignores informational rules that aren't launch criteria", () => {
    const v = evaluateShipReady({ ...base, findings: [finding({ ruleId: "integrations.unused-deps", severity: "INFO" }), finding({ ruleId: "deps.audit-unavailable", severity: "INFO" })] });
    expect(v.blockers + v.toReview).toBe(0);
  });
});

describe("evaluateShipReady thresholds", () => {
  it("blocks on lockfile drift even though it's rated medium, and only flags undocumented env vars for review", () => {
    const v = evaluateShipReady({
      ...base,
      findings: [
        finding({ ruleId: "deps.lockfile-drift", severity: "MEDIUM", confidence: 0.95 }),
        finding({ ruleId: "deploy.env-undocumented", severity: "MEDIUM", confidence: 0.8 }),
      ],
    });
    expect(item(v, "dependencies").status).toBe("fail");
    expect(item(v, "config").status).toBe("review");
  });

  it("passes production settings only when the host was actually read", () => {
    expect(item(evaluateShipReady({ ...base, findings: [] }), "production-config").status).toBe("unverified");
    const connected = { ...summary, coverage: { ...summary.coverage, productionEnv: "checked" as const } };
    expect(item(evaluateShipReady({ ...base, summary: connected, findings: [] }), "production-config").status).toBe("pass");
    const missing = finding({ ruleId: "deploy.env-missing-prod", category: "deploy", severity: "HIGH", confidence: 0.85 });
    expect(item(evaluateShipReady({ ...base, summary: connected, findings: [missing] }), "production-config").status).toBe("fail");
  });
});

describe("the four habits items", () => {
  const habit = (ruleId: string, severity: ShipFinding["severity"], confidence: number) => finding({ ruleId, severity, category: "reliability", confidence });

  it("ask for review on pattern matches and never block a launch", () => {
    const v = evaluateShipReady({
      ...base,
      findings: [
        habit("habits.swallowed-error", "MEDIUM", 0.6),
        habit("habits.dead-file", "MEDIUM", 0.6),
        habit("habits.untested-critical", "MEDIUM", 0.5),
        habit("habits.unbounded-loop", "HIGH", 0.6),
      ],
    });
    expect(item(v, "hidden-errors").status).toBe("review");
    expect(item(v, "dead-code").status).toBe("review");
    expect(item(v, "change-safety").status).toBe("review");
    expect(item(v, "bounded-loops").status).toBe("review");
    expect(v.blockers).toBe(0);
    expect(v.state).toBe("almost");
  });

  it("only note low-severity findings, and pass when nothing is found", () => {
    const v = evaluateShipReady({ ...base, findings: [habit("habits.unvalidated-input", "LOW", 0.4), habit("habits.commented-out-code", "LOW", 0.7)] });
    expect(item(v, "hidden-errors").status).toBe("pass");
    expect(item(v, "hidden-errors").findings).toHaveLength(1);
    expect(item(v, "dead-code").status).toBe("pass");
    expect(item(evaluateShipReady({ ...base, findings: [] }), "bounded-loops").status).toBe("pass");
  });

  it("don't pass when the checks never ran", () => {
    const v = evaluateShipReady({ ...base, summary: null, findings: [] });
    for (const id of ["hidden-errors", "dead-code", "change-safety", "bounded-loops"]) expect(item(v, id).status).toBe("unverified");
  });

  it("put the problem and a fix prompt in front of the user", () => {
    const v = evaluateShipReady({ ...base, findings: [{ ...habit("habits.unbounded-loop", "HIGH", 0.6), title: "1 loop calls an AI model with no limit" }] });
    expect(item(v, "bounded-loops").prompt).toContain("1 loop calls an AI model with no limit");
  });
});
