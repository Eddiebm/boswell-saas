import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  askBrain,
  DEMO_AUDIT_ID,
  DEMO_REPO_ID,
  getAuditReport,
  getDependencyFixesForAudit,
  getLatestCompletedAuditId,
  getPrimaryRepoId,
  getPrimaryRepository,
  getRepositories,
  getRepository,
  getSlop,
  getWorkerHealth,
  setPrimaryRepository,
} from "@/lib/data";
import { demoDependencyFixes, demoFindings, demoRepos, demoSlop } from "@/lib/demo/data";

describe("data layer in demo mode", () => {
  beforeEach(() => {
    vi.stubEnv("BOSWELL_DEMO", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves the demo repositories without a database", async () => {
    expect(await getPrimaryRepoId("user-1")).toBe(DEMO_REPO_ID);
    expect(await getRepositories("user-1")).toBe(demoRepos);
    expect(await getRepository("user-1", DEMO_REPO_ID)).toEqual(demoRepos.find((r) => r.id === DEMO_REPO_ID));
    expect(await getRepository("user-1", "someone-elses-repo")).toBeNull();
    expect((await getPrimaryRepository("user-1"))?.id).toBe(DEMO_REPO_ID);
    expect(await getLatestCompletedAuditId("user-1")).toEqual({ auditId: DEMO_AUDIT_ID, repoFullName: "Eddiebm/audiolens-app" });
    expect(await getSlop(DEMO_REPO_ID)).toBe(demoSlop);
    await expect(setPrimaryRepository("user-1", "anything")).resolves.toBeUndefined();
  });

  it("builds a full audit report view for the demo audit", async () => {
    const report = await getAuditReport("user-1", "requested-id");
    expect(report).not.toBeNull();
    expect(report!.id).toBe("requested-id");
    expect(report!.repoId).toBe(DEMO_REPO_ID);
    expect(report!.auditMode).toBe("standard");
    expect(report!.findings).toHaveLength(demoFindings.length);
    const grouped = report!.priorityGroups;
    expect(grouped.fixNow.length + grouped.fixNext.length + grouped.later.length).toBe(demoFindings.length);
    for (const f of report!.findings) {
      expect(f.priorityLabel).toBeTruthy();
      // OWASP fields are set together or not at all.
      expect(Boolean(f.owaspCode)).toBe(Boolean(f.owaspName));
    }
    expect(report!.fixPrompt).toContain("Eddiebm/audiolens-app");
  });

  it("returns the demo dependency fixes and an idle worker", async () => {
    expect(await getDependencyFixesForAudit("user-1", DEMO_AUDIT_ID)).toBe(demoDependencyFixes);
    expect(await getWorkerHealth()).toEqual({ queuedAudits: 0, runningAudits: 0, failedAudits: 0 });
  });

  it("answers brain questions from demo context", async () => {
    const result = await askBrain("user-1", "Where is authentication handled?");
    expect(result.source).toBe("demo");
    expect(result.answer).toContain("src/middleware.ts");
  });
});

describe("data layer without demo mode or a database", () => {
  beforeEach(() => {
    vi.stubEnv("BOSWELL_DEMO", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.skipIf(Boolean(process.env.DATABASE_URL))("fails loudly instead of returning demo data", async () => {
    await expect(getRepositories("user-1")).rejects.toThrow("DATABASE_URL is not configured");
    await expect(getWorkerHealth()).rejects.toThrow("DATABASE_URL is not configured");
  });
});
