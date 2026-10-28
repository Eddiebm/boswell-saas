import { and, desc, eq, isNull } from "drizzle-orm";
import { getAuditForUser } from "@/lib/audits";
import type { ChecksSummary } from "@/lib/checks";
import { requireDb } from "@/lib/db";
import { auditRuns, dependencyFixes, repositories, verifyRuns } from "@/lib/db/schema";
import { getLatestCompletedAuditId, getPrimaryRepoId } from "@/lib/data";
import { demoChecksSummary, demoFindings, demoVerifyRuns, DEMO_AUDIT_ID } from "@/lib/demo/data";
import { isDemoMode } from "@/lib/demo/mode";
import { evaluateShipReady, type LiveVerifyState, type ShipFinding, type ShipReadyVerdict } from "@/lib/ship-ready/checklist";

export type ShipReadyView = {
  auditId: string;
  repoFullName: string;
  checkedAt: string | null;
  verdict: ShipReadyVerdict;
  /** A ready dependency fix PR for this audit, if Boswell prepared one. */
  dependencyFixId: string | null;
  /** True when the audit predates Ship Ready's checks, so most items can't be judged. */
  needsReaudit: boolean;
  /** Push guard state for the repository; null in demo mode. */
  guard: { repositoryId: string; enabled: boolean; lastRun: { at: string | null; description: string | null; commitSha: string | null } | null } | null;
  /** The deployed URL the live checks use. */
  liveUrl: string | null;
};

function liveState(result: string | null | undefined): LiveVerifyState {
  if (result === "leak_confirmed") return "leak";
  if (result === "no_leak") return "no-leak";
  return "not-set-up";
}

/** The latest completed audit for the user's primary repo, falling back to their latest audit anywhere. */
async function latestAuditId(userId: string): Promise<string | null> {
  const primary = await getPrimaryRepoId(userId);
  if (primary) {
    const db = requireDb();
    const [row] = await db
      .select({ id: auditRuns.id })
      .from(auditRuns)
      .where(and(eq(auditRuns.userId, userId), eq(auditRuns.repositoryId, primary), eq(auditRuns.status, "completed"), eq(auditRuns.trigger, "manual")))
      .orderBy(desc(auditRuns.finishedAt))
      .limit(1);
    if (row) return row.id;
  }
  return (await getLatestCompletedAuditId(userId))?.auditId ?? null;
}

export async function getShipReady(userId: string, auditId?: string): Promise<ShipReadyView | null> {
  if (isDemoMode()) {
    const latest = demoVerifyRuns[0];
    return {
      auditId: DEMO_AUDIT_ID,
      repoFullName: "Eddiebm/audiolens-app",
      checkedAt: new Date().toISOString(),
      verdict: evaluateShipReady({
        repo: "Eddiebm/audiolens-app",
        findings: demoFindings.map((f) => ({
          id: f.id,
          ruleId: ("ruleId" in f ? f.ruleId : null) ?? null,
          severity: f.severity,
          category: f.category,
          title: f.title,
          description: f.description,
          filePath: f.filePath,
          lineStart: "lineStart" in f ? f.lineStart : null,
          recommendation: f.recommendation,
          confidence: f.confidence,
        })),
        summary: demoChecksSummary,
        live: liveState(latest?.result),
        liveSummary: latest?.summary,
        auditCompleted: true,
      }),
      dependencyFixId: "demo-dependency-fix-1",
      needsReaudit: false,
      guard: { repositoryId: "demo-repo-audiolens", enabled: false, lastRun: null },
      liveUrl: null,
    };
  }

  const id = auditId ?? (await latestAuditId(userId));
  if (!id) return null;
  const audit = await getAuditForUser(userId, id);
  if (!audit || !audit.repo) return null;

  const db = requireDb();
  const [live] = await db
    .select({ result: verifyRuns.result, summary: verifyRuns.summary })
    .from(verifyRuns)
    .where(and(eq(verifyRuns.repositoryId, audit.repo.id), eq(verifyRuns.status, "completed")))
    .orderBy(desc(verifyRuns.finishedAt))
    .limit(1);
  const [fix] = await db
    .select({ id: dependencyFixes.id })
    .from(dependencyFixes)
    .where(and(eq(dependencyFixes.auditRunId, id), eq(dependencyFixes.status, "ready")))
    .limit(1);
  const [repo] = await db
    .select({ fullName: repositories.fullName, guardWebhookId: repositories.guardWebhookId, liveUrl: repositories.liveUrl })
    .from(repositories)
    .where(eq(repositories.id, audit.repo.id))
    .limit(1);

  // A push to the default branch checked by the guard after this audit is the newer truth for the repo checks.
  const [guardRun] = await db
    .select()
    .from(auditRuns)
    .where(and(eq(auditRuns.repositoryId, audit.repo.id), eq(auditRuns.trigger, "guard"), isNull(auditRuns.prNumber), eq(auditRuns.status, "completed")))
    .orderBy(desc(auditRuns.finishedAt))
    .limit(1);
  const useGuard = !auditId && guardRun?.finishedAt && audit.run.finishedAt && guardRun.finishedAt > audit.run.finishedAt;

  const summary = ((useGuard ? guardRun.checksJson : audit.run.checksJson) as ChecksSummary | null) ?? null;
  const engineAndChecks: ShipFinding[] = audit.findings
    .filter((f) => f.status !== "fixed" && f.status !== "ignored" && !f.resolved)
    .map((f) => ({
      id: f.id,
      ruleId: f.ruleId,
      severity: f.severity,
      category: f.category,
      title: f.title,
      description: f.description,
      filePath: f.filePath,
      lineStart: f.lineStart,
      recommendation: f.recommendation,
      confidence: f.confidence ?? 0.8,
    }));
  const findings = useGuard
    ? [...engineAndChecks.filter((f) => !f.ruleId), ...(((guardRun.guardJson as { findings?: ShipFinding[] } | null)?.findings ?? []) as ShipFinding[])]
    : engineAndChecks;

  return {
    auditId: id,
    repoFullName: repo?.fullName ?? audit.repo.fullName,
    checkedAt: ((useGuard ? guardRun.finishedAt : audit.run.finishedAt) ?? null)?.toISOString() ?? null,
    verdict: evaluateShipReady({
      repo: repo?.fullName ?? audit.repo.fullName,
      findings,
      summary,
      live: liveState(live?.result),
      liveSummary: live?.summary,
      auditCompleted: audit.run.status === "completed",
    }),
    dependencyFixId: fix?.id ?? null,
    needsReaudit: summary === null,
    liveUrl: repo?.liveUrl ?? null,
    guard: {
      repositoryId: audit.repo.id,
      enabled: Boolean(repo?.guardWebhookId),
      lastRun: guardRun
        ? { at: guardRun.finishedAt?.toISOString() ?? null, description: guardRun.summary, commitSha: guardRun.commitSha }
        : null,
    },
  };
}
