import { and, desc, eq, lt } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import { fixQueueItems, memoryEvents, repositories, users, verifyRuns, verifyTargets } from "@/lib/db/schema";
import { canUseDynamicVerify } from "@/lib/plans";
import { runAccessControlCheck, type VerifyTargetConfig } from "@/lib/dynamic-verify/engine";
import type { DiscoveryResult } from "@/lib/dynamic-verify/discover";
import { isDemoMode } from "@/lib/demo/mode";
import { demoDiscovery, demoVerifyRuns, demoVerifyTargets, DEMO_VERIFY_TARGET_ID } from "@/lib/demo/data";
import { assertRelativePath, assertSafeStagingUrl } from "@/lib/dynamic-verify/validate-target";

const QUEUED_TIMEOUT_MS = 60 * 60 * 1000;
const RUNNING_TIMEOUT_MS = 10 * 60 * 1000;

export type CreateVerifyTargetInput = {
  label: string;
  stagingUrl: string;
  loginPath: string;
  accountAEmail: string;
  accountAPassword: string;
  accountBEmail: string;
  accountBPassword: string;
  resourcePathTemplate: string;
  accountAResourceId: string;
  consentConfirmed: boolean;
};

async function requirePlanAndOwnership(userId: string, repositoryId: string) {
  if (isDemoMode()) return;
  const db = requireDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || !canUseDynamicVerify(user.plan)) {
    throw new Error("Live access-control verification requires the Pro plan.");
  }

  const [repo] = await db
    .select()
    .from(repositories)
    .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, userId)))
    .limit(1);
  if (!repo) {
    throw new Error("Repository not found");
  }
  return repo;
}

export async function createVerifyTarget(
  userId: string,
  repositoryId: string,
  input: CreateVerifyTargetInput,
) {
  await requirePlanAndOwnership(userId, repositoryId);

  if (!input.consentConfirmed) {
    throw new Error(
      "consentConfirmed must be true: you must confirm this is a staging/non-production environment you're authorized to test.",
    );
  }

  if (input.accountAEmail.trim().toLowerCase() === input.accountBEmail.trim().toLowerCase()) {
    throw new Error(
      "accountAEmail and accountBEmail must be two different accounts — using the same account for both always reads as a leak.",
    );
  }

  if (isDemoMode()) {
    // Demo mode is read-only sample data — nothing is persisted.
    return demoVerifyTargets[0];
  }

  // Attacker-controlled destination: reject anything but a public http(s)
  // host, and refuse login/resource paths that could resolve off-origin.
  await assertSafeStagingUrl(input.stagingUrl);
  assertRelativePath(input.loginPath, "loginPath");
  assertRelativePath(input.resourcePathTemplate, "resourcePathTemplate");

  const db = requireDb();
  const [target] = await db
    .insert(verifyTargets)
    .values({
      userId,
      repositoryId,
      label: input.label,
      stagingUrl: input.stagingUrl,
      loginPath: input.loginPath,
      accountAEmail: input.accountAEmail,
      accountAPassword: input.accountAPassword,
      accountBEmail: input.accountBEmail,
      accountBPassword: input.accountBPassword,
      resourcePathTemplate: input.resourcePathTemplate,
      accountAResourceId: input.accountAResourceId,
      consentConfirmedAt: new Date(),
    })
    .returning();

  return target;
}

/**
 * Candidates discovered statically from the repo's own source during the
 * most recent audit (`src/lib/dynamic-verify/discover.ts`, run inside
 * `processAuditJob`). Refreshes every audit — no separate clone or scan.
 */
export async function getDiscoveredCandidates(
  userId: string,
  repositoryId: string,
): Promise<DiscoveryResult> {
  if (isDemoMode()) return demoDiscovery;
  const db = requireDb();
  const [repo] = await db
    .select({ discoveryJson: repositories.discoveryJson })
    .from(repositories)
    .where(and(eq(repositories.id, repositoryId), eq(repositories.userId, userId)))
    .limit(1);

  return repo?.discoveryJson ?? { loginCandidates: [], resourceCandidates: [] };
}

export async function listVerifyTargets(userId: string, repositoryId: string) {
  if (isDemoMode()) return demoVerifyTargets;
  const db = requireDb();
  return db
    .select()
    .from(verifyTargets)
    .where(and(eq(verifyTargets.userId, userId), eq(verifyTargets.repositoryId, repositoryId)))
    .orderBy(desc(verifyTargets.createdAt));
}

export async function listVerifyRuns(userId: string, targetId: string) {
  if (isDemoMode()) return targetId === DEMO_VERIFY_TARGET_ID ? demoVerifyRuns : [];
  const db = requireDb();
  return db
    .select()
    .from(verifyRuns)
    .where(and(eq(verifyRuns.userId, userId), eq(verifyRuns.targetId, targetId)))
    .orderBy(desc(verifyRuns.createdAt))
    .limit(20);
}

export async function queueVerifyRun(userId: string, targetId: string) {
  if (isDemoMode()) {
    // Demo mode is read-only sample data — nothing is queued or persisted.
    return demoVerifyRuns[0];
  }
  const db = requireDb();
  const [target] = await db
    .select()
    .from(verifyTargets)
    .where(and(eq(verifyTargets.id, targetId), eq(verifyTargets.userId, userId)))
    .limit(1);

  if (!target) throw new Error("Verification target not found");
  if (!target.enabled) throw new Error("This verification target is disabled");
  if (!target.consentConfirmedAt) throw new Error("This target has not confirmed consent");

  await requirePlanAndOwnership(userId, target.repositoryId);

  // Re-check at run time, not just at creation: catches rows saved before
  // this validation existed and DNS rebinding between save and run.
  await assertSafeStagingUrl(target.stagingUrl);

  const [run] = await db
    .insert(verifyRuns)
    .values({
      targetId: target.id,
      repositoryId: target.repositoryId,
      userId,
      status: "queued",
    })
    .returning();

  return run;
}

export async function claimNextQueuedVerifyRun() {
  const db = requireDb();
  const [next] = await db
    .select()
    .from(verifyRuns)
    .where(eq(verifyRuns.status, "queued"))
    .orderBy(verifyRuns.createdAt)
    .limit(1);

  if (!next) return null;

  const [claimed] = await db
    .update(verifyRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(verifyRuns.id, next.id), eq(verifyRuns.status, "queued")))
    .returning();

  return claimed ?? null;
}

export async function recoverStaleVerifyRuns() {
  const db = requireDb();
  const now = Date.now();

  await db
    .update(verifyRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      error: "Worker did not pick up this verification run within 60 minutes.",
    })
    .where(
      and(eq(verifyRuns.status, "queued"), lt(verifyRuns.createdAt, new Date(now - QUEUED_TIMEOUT_MS))),
    );

  await db
    .update(verifyRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      error: "Verification run exceeded the 10-minute execution timeout.",
    })
    .where(
      and(eq(verifyRuns.status, "running"), lt(verifyRuns.startedAt, new Date(now - RUNNING_TIMEOUT_MS))),
    );
}

async function recordLeakInMemoryAndFixQueue(repositoryId: string, target: typeof verifyTargets.$inferSelect) {
  const db = requireDb();

  await db.insert(memoryEvents).values({
    repositoryId,
    eventType: "dynamic_verify_leak",
    title: `Live access-control leak confirmed: ${target.label}`,
    summary: `Account B was able to read account A's resource via ${target.resourcePathTemplate} on ${target.stagingUrl}. Proven against the running app, not inferred from code.`,
    metadata: { targetId: target.id, resourcePathTemplate: target.resourcePathTemplate },
  });

  await db.insert(fixQueueItems).values({
    repositoryId,
    title: `Fix broken access control: ${target.label}`,
    severity: "CRITICAL",
    effort: "medium",
    impact: "high",
    files: [],
    whyItMatters:
      "A live, proven cross-account leak was demonstrated against the staging instance: one account could read another account's data through an authorization check that isn't actually enforced.",
    suggestedFix: `Add an ownership check on the handler behind ${target.resourcePathTemplate} so it verifies the resource belongs to the authenticated account before returning it.`,
    canAutoPr: false,
    priorityScore: 1000,
    source: "dynamic_verify",
  });
}

/**
 * Strips the stored test-account passwords before a target is ever
 * serialized back to the client — they're write-only from the API's
 * perspective. Accepts both real DB rows and the demo-seeded shape.
 */
export function toPublicTarget<T extends Record<string, unknown>>(
  target: T,
): Omit<T, "accountAPassword" | "accountBPassword"> {
  const rest = { ...target };
  delete rest.accountAPassword;
  delete rest.accountBPassword;
  return rest;
}

export async function runQueuedVerifyRun(runId: string) {
  const db = requireDb();
  const [run] = await db.select().from(verifyRuns).where(eq(verifyRuns.id, runId)).limit(1);
  if (!run) throw new Error("Verification run not found");

  const [target] = await db.select().from(verifyTargets).where(eq(verifyTargets.id, run.targetId)).limit(1);
  if (!target) throw new Error("Verification target not found");

  const config: VerifyTargetConfig = {
    stagingUrl: target.stagingUrl,
    loginPath: target.loginPath,
    accountAEmail: target.accountAEmail,
    accountAPassword: target.accountAPassword,
    accountBEmail: target.accountBEmail,
    accountBPassword: target.accountBPassword,
    resourcePathTemplate: target.resourcePathTemplate,
    accountAResourceId: target.accountAResourceId,
  };

  try {
    const outcome = await runAccessControlCheck(config);

    await db
      .update(verifyRuns)
      .set({
        status: "completed",
        result: outcome.result,
        httpStatus: outcome.httpStatus,
        matchedFields: outcome.matchedFields,
        summary: outcome.summary,
        finishedAt: new Date(),
      })
      .where(eq(verifyRuns.id, runId));

    if (outcome.result === "leak_confirmed") {
      await recordLeakInMemoryAndFixQueue(run.repositoryId, target);
    }

    return { ok: true, result: outcome.result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verification run failed";
    await db
      .update(verifyRuns)
      .set({ status: "failed", error: message, finishedAt: new Date() })
      .where(eq(verifyRuns.id, runId));
    return { ok: false, error: message };
  }
}

export async function processVerifyWorkerTick() {
  if (
    process.env.BOSWELL_CLOUD_WORKER !== "1" &&
    process.env.BOSWELL_ALLOW_LOCAL_WORKER !== "1"
  ) {
    return {
      processed: false as const,
      message: "Worker disabled locally. GitHub Actions sets BOSWELL_CLOUD_WORKER=1.",
    };
  }

  await recoverStaleVerifyRuns();
  const claimed = await claimNextQueuedVerifyRun();
  if (!claimed) {
    return { processed: false as const };
  }

  const result = await runQueuedVerifyRun(claimed.id);
  return { processed: true as const, runId: claimed.id, ...result };
}
