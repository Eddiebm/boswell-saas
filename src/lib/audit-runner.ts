import { and, eq } from "drizzle-orm";
import { requireDb } from "@/lib/db";
import {
  auditDocuments,
  auditRuns,
  dependencyFixes,
  findings,
  fixQueueItems,
  memoryEvents,
  reports,
  repoScores,
  repositories,
  scoreSnapshots,
} from "@/lib/db/schema";
import { buildCoaching } from "@/lib/coaching/build-coaching";
import { buildDailyBriefing } from "@/lib/briefing/build-briefing";
import { enrichFinding } from "@/lib/enrich/finding";
import { groupByClassification } from "@/lib/classification/classify";
import { prioritizeFixQueue } from "@/lib/fix-queue/prioritize";
import { computeRepoScore } from "@/lib/scoring/engine";
import { getGithubToken } from "@/lib/github/token";
import { normalizeAuditMode } from "@/lib/audit-modes";
import { generateAuditReport, reportToMarkdown } from "@/lib/reports/generate-report";
import { processAuditJob } from "@/lib/worker/process-audit";
import { runGuardAudit } from "@/lib/guard/run";
import { sendAuditAlert } from "@/lib/alerts/audit-alerts";
import { reportError } from "@/lib/monitoring";
import { redactSecrets } from "@/lib/monitoring-config";
import { incrementAuditUsage } from "@/lib/audit-queue";
import { liveTestAccount, providerConnectionsFor } from "@/lib/audit-credentials";

export async function runQueuedAudit(auditId: string) {
  const db = requireDb();
  const [run] = await db.select().from(auditRuns).where(eq(auditRuns.id, auditId)).limit(1);
  if (!run) throw new Error("Audit not found");

  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, run.repositoryId))
    .limit(1);
  if (!repo) throw new Error("Repository not found");

  const token = await getGithubToken(run.userId);
  if (!token) throw new Error("Missing GitHub token");

  // Push-guard runs are checks-only and report to GitHub; they never touch scores, reports or the fix queue.
  if (run.trigger === "guard") return runGuardAudit(run, repo, token);

  try {
    const result = await processAuditJob({
      cloneUrl: repo.cloneUrl,
      githubToken: token,
      repoFullName: repo.fullName,
      auditMode: normalizeAuditMode(run.auditMode),
      live: repo.liveUrl ? { url: repo.liveUrl, account: await liveTestAccount(repo.id) } : null,
      providers: await providerConnectionsFor(repo.id),
    });

    await db.insert(auditDocuments).values(
      Object.entries(result.documents).map(([docType, content]) => ({
        auditRunId: run.id,
        docType,
        content,
      })),
    );

    if (result.findings.length) {
      await db.insert(findings).values(
        result.findings.map((f) => {
          const enriched = enrichFinding({
            title: f.title,
            description: f.description,
            severity: f.severity,
            category: f.category,
          });
          return {
            repositoryId: repo.id,
            auditRunId: run.id,
            severity: f.severity,
            category: f.category,
            title: f.title,
            description: f.description,
            filePath: f.filePath,
            lineStart: f.lineStart,
            recommendation: f.recommendation,
            simpleExplanation: enriched.simpleExplanation,
            classification: enriched.classification,
            fixSteps: enriched.canOpenPr
              ? "Boswell can open a safe PR after confirmation."
              : "Manual steps required.",
            autoFixLevel: enriched.autoFixLevel,
            coaching: buildCoaching({
              title: f.title,
              description: f.description,
              severity: f.severity,
              category: f.category,
              filePath: f.filePath,
              recommendation: f.recommendation,
            }),
            confidence: f.confidence ?? 0.85,
            ruleId: f.ruleId ?? null,
            autoFixable: enriched.canOpenPr,
          };
        }),
      );
    }

    if (result.dependencyFixes.length) {
      // Only the newest patch is worth opening a PR from; older ones were computed against older lockfiles.
      await db
        .update(dependencyFixes)
        .set({ status: "stale", patchedLockfile: "", patchedPackageJson: null })
        .where(and(eq(dependencyFixes.repositoryId, repo.id), eq(dependencyFixes.status, "ready")));
      await db.insert(dependencyFixes).values(
        result.dependencyFixes.map((fix) => ({
          repositoryId: repo.id,
          auditRunId: run.id,
          lockfilePath: fix.lockfilePath,
          baseLockfileBlobSha: fix.baseLockfileBlobSha,
          patchedLockfile: fix.patchedLockfile,
          packageJsonPath: fix.packageJsonPath,
          basePackageJsonBlobSha: fix.basePackageJsonBlobSha,
          patchedPackageJson: fix.patchedPackageJson,
          pinBumps: fix.pinBumps,
          changes: fix.changes,
          beforeCounts: fix.beforeCounts,
          afterCounts: fix.afterCounts,
        })),
      );
    }

    await db.insert(reports).values(
      Object.entries(result.documents).map(([docType, markdown]) => ({
        auditRunId: run.id,
        docType,
        markdown,
      })),
    );

    const score = computeRepoScore(result.scoreInput);

    const classified = groupByClassification(
      result.findings.map((f) => ({
        ...enrichFinding({
          title: f.title,
          description: f.description,
          severity: f.severity,
          category: f.category,
        }),
        title: f.title,
      })),
    );

    const briefing = buildDailyBriefing({
      repoName: repo.fullName,
      currentScore: score,
      newFindings: result.findings
        .filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL")
        .map((f) => ({
          id: f.title,
          title: f.title,
          severity: f.severity,
          href: `/dashboard/audits/${run.id}`,
        })),
      fixedFindings: [],
      ignoredFindings: [],
      recurringFindings: [],
      classifications: {
        good: classified.good.map((f) => f.title),
        bad: classified.bad.map((f) => f.title),
        dangerous: classified.dangerous.map((f) => f.title),
        evil: classified.evil.map((f) => f.title),
      },
      safePrTitles: result.findings
        .filter(
          (f) =>
            enrichFinding({
              title: f.title,
              description: f.description,
              severity: f.severity,
              category: f.category,
            }).autoFixLevel === "green",
        )
        .map((f) => f.title),
      slop: result.slop,
      deployVerdict: result.deployVerdict,
    });

    const queue = prioritizeFixQueue(
      result.findings
        .filter((f) => f.severity !== "INFO")
        .map((f) => {
          const enriched = enrichFinding({
            title: f.title,
            description: f.description,
            severity: f.severity,
            category: f.category,
          });
          return {
            id: f.title,
            title: f.title,
            severity: f.severity,
            effort: f.severity === "HIGH" ? ("m" as const) : ("s" as const),
            impact: f.severity === "CRITICAL" ? ("critical" as const) : ("high" as const),
            files: f.filePath ? [f.filePath] : [],
            whyItMatters: f.description,
            suggestedFix: f.recommendation ?? "Review manually",
            canAutoPr: enriched.canOpenPr,
            category: f.category,
          };
        }),
    );

    const structuredReport = generateAuditReport({
      repoName: repo.fullName,
      findings: result.findings.map((f) => {
        const enriched = enrichFinding({
          title: f.title,
          description: f.description,
          severity: f.severity,
          category: f.category,
        });
        return {
          id: f.title,
          title: f.title,
          description: f.description,
          severity: f.severity,
          classification: enriched.classification,
          filePath: f.filePath,
          evidence: f.filePath ? [`${f.filePath}:${f.lineStart ?? 1}`] : [],
          autoFixLevel: enriched.autoFixLevel,
        };
      }),
      score,
      slop: result.slop,
      briefing,
      fixQueueCount: queue.length,
    });

    const fullMarkdown = reportToMarkdown(structuredReport);

    await db.insert(reports).values({
      auditRunId: run.id,
      docType: "full",
      markdown: fullMarkdown,
      structured: structuredReport,
    });

    await db.delete(repoScores).where(eq(repoScores.repositoryId, repo.id));
    await db.insert(repoScores).values({
      repositoryId: repo.id,
      overall: score.overall,
      security: score.dimensions.security,
      architecture: score.dimensions.architecture,
      maintainability: score.dimensions.maintainability,
      dependencies: score.dimensions.dependencies,
      testing: score.dimensions.testing,
      documentation: score.dimensions.documentation,
      complexity: score.dimensions.complexity,
      aiSlop: score.dimensions.aiSlop,
      releaseRisk: score.dimensions.releaseRisk,
      details: score,
    });

    await db.insert(scoreSnapshots).values({
      repositoryId: repo.id,
      auditRunId: run.id,
      overall: score.overall,
      security: score.dimensions.security,
      architecture: score.dimensions.architecture,
      maintainability: score.dimensions.maintainability,
      dependencies: score.dimensions.dependencies,
      testing: score.dimensions.testing,
      documentation: score.dimensions.documentation,
      complexity: score.dimensions.complexity,
      aiSlop: score.dimensions.aiSlop,
      releaseRisk: score.dimensions.releaseRisk,
    });

    await db
      .delete(fixQueueItems)
      .where(
        and(
          eq(fixQueueItems.repositoryId, repo.id),
          eq(fixQueueItems.status, "pending"),
          eq(fixQueueItems.source, "audit"),
        ),
      );

    if (queue.length) {
      await db.insert(fixQueueItems).values(
        queue.map((q) => ({
          repositoryId: repo.id,
          title: q.title,
          severity: q.severity,
          effort: q.effort,
          impact: q.impact,
          files: q.files,
          whyItMatters: q.whyItMatters,
          suggestedFix: q.suggestedFix,
          canAutoPr: q.canAutoPr,
          priorityScore: q.priorityScore,
          source: "audit",
        })),
      );
    }

    await db.insert(memoryEvents).values({
      repositoryId: repo.id,
      eventType: "audit_completed",
      title: `Audit completed for ${repo.fullName}`,
      summary: briefing.executiveSummary,
    });

    await db
      .update(auditRuns)
      .set({
        status: "completed",
        finishedAt: new Date(),
        commitSha: result.commitSha,
        checksJson: result.checksSummary,
        stack: result.stack,
        costUsd: result.costUsd?.toString(),
        summary: result.summary,
        deployVerdict: result.deployVerdict,
        topRisk: result.topRisk,
        briefingJson: briefing,
        slopJson: result.slop,
        scoresJson: score,
      })
      .where(eq(auditRuns.id, run.id));

    await db
      .update(repositories)
      .set({
        lastAuditAt: new Date(),
        healthScore: score.overall,
        slopPercent: result.slop.overallPercent,
        discoveryJson: result.discovery,
      })
      .where(eq(repositories.id, repo.id));

    await incrementAuditUsage(run.userId);
    return { ok: true as const };
  } catch (error) {
    reportError(error, { component: "audit", runId: run.id });
    // Stored, emailed and shown to the user: a failed clone's message contains the token-bearing URL.
    const message = redactSecrets(error instanceof Error ? error.message : "Audit failed");
    await db
      .update(auditRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: message,
      })
      .where(eq(auditRuns.id, run.id));

    await sendAuditAlert({
      auditId: run.id,
      repoFullName: repo.fullName,
      reason: message,
      status: "failed",
    });

    return { ok: false as const, error: message };
  }
}
